// Rule-based AI logic for voxel society simulator
// This function is a direct extraction of the original decideNextAction from character.js
// It is designed to be called as: decideNextAction_rulebase(character, isNight)
import { worldData, BLOCK_TYPES, ITEM_TYPES, maxHeight, removeBlock } from './world.js';

export function decideNextAction_rulebase(character, isNight) {
    // === RULE-BASED AI DECISION SYSTEM ===
    // Priority Order: Social → Home Building → Role-based → Survival → Work

    // Debug logging
    character.log('=== AI DECISION START ===');
    character.log(`Needs: hunger=${character.needs.hunger.toFixed(1)}, energy=${character.needs.energy.toFixed(1)}, social=${character.needs.social.toFixed(1)}`);
    character.log(`Home: homePosition=${!!character.homePosition}, provisionalHome=${!!character.provisionalHome}`);
    character.log(`Role: ${character.role}, Inventory: [${character.inventory.map(i => i || 'null').join(', ')}]`);

    // === CONFIGURATION ===
    const socialThreshold = (typeof window !== 'undefined' && window.socialThreshold !== undefined) ? window.socialThreshold : 30;
    const homeBuildingHungerThreshold = (typeof window !== 'undefined' && window.homeBuildingHungerThreshold !== undefined) ? window.homeBuildingHungerThreshold : 80;

    // === PRIORITY 1: RANDOM EXPLORATION (10% chance) ===
    if (Math.random() < 0.10) {
        const chars = (typeof window !== 'undefined' && window.characters) ? window.characters : (typeof characters !== 'undefined' ? characters : []);
        let nearbyPartner = null;
        for (const char of chars) {
            if (char.id === character.id) continue;
            const dist = Math.abs(character.gridPos.x - char.gridPos.x) + Math.abs(character.gridPos.y - char.gridPos.y) + Math.abs(character.gridPos.z - char.gridPos.z);
            if (dist <= 2) { nearbyPartner = char; break; }
        }
        if (nearbyPartner) {
            character.setNextAction('SOCIALIZE', nearbyPartner, nearbyPartner.gridPos);
            character.log('Action: SOCIALIZE (random exploration)');
            return;
        } else {
            character.setNextAction('WANDER');
            character.log('Action: WANDER (random exploration)');
            return;
        }
    }

    // === PRIORITY 2: SOCIAL NEEDS ===
    if (character.needs.social <= socialThreshold) {
        const partner = character.findClosestPartner && character.findClosestPartner();
        if (partner) {
            character.log(`SOCIALIZE selected: social=${character.needs.social}, threshold=${socialThreshold}`);
            character.setNextAction('SOCIALIZE', partner, partner.gridPos);
            return;
        }
        character.setNextAction('WANDER');
        return;
    }

    // === PRIORITY 3: HOME BUILDING (If well-fed but homeless) ===
    if (character.needs.hunger >= homeBuildingHungerThreshold && !character.homePosition && !character.provisionalHome) {
        character.log('🏠 HOME BUILDING PRIORITY: Well-fed but homeless');

        // Already have wood? Build immediately
        if (character.inventory[0] === 'WOOD_LOG') {
            character.log('🏠 Has wood → BUILD_HOME');
            character.setNextAction('BUILD_HOME');
            return;
        }

        // Check if we've been stuck trying to get wood (use shared failure tracking)
        if (!character._woodFailureCount) character._woodFailureCount = 0;
        if (!character._lastWoodTarget) character._lastWoodTarget = null;

        // Try to find wood and chop it
        const wood = character.findClosestWood && character.findClosestWood();
        if (wood) {
            // Check if we're stuck on the same wood target
            const woodKey = `${wood.x},${wood.y},${wood.z}`;
            if (character._lastWoodTarget === woodKey) {
                character._woodFailureCount++;
                character.log(`🏠 Stuck on same wood target (${character._woodFailureCount} attempts)`);
            } else {
                character._woodFailureCount = 0;
                character._lastWoodTarget = woodKey;
            }

            // If we've failed too many times, try alternative strategies
            if (character._woodFailureCount >= 3) {
                character.log('🏠 Too many wood failures → alternative strategy');

                // Strategy 1: Create provisional home and try different approach
                character.provisionalHome = character.gridPos;
                character._woodFailureCount = 0;
                character._lastWoodTarget = null;
                character.log('🏠 Created provisional home due to wood access issues');
                character.setNextAction('WANDER');
                return;
            }

            const adjacentSpot = character.findAdjacentSpot && character.findAdjacentSpot(wood);
            if (adjacentSpot) {
                // Additional check: verify pathfinding will actually work
                const testPath = character.findPath && character.findPath(character.gridPos, adjacentSpot);
                if (testPath && testPath.length > 0) {
                    character.log('🏠 No wood → CHOP_WOOD (reachable with valid path)');
                    character.setNextAction('CHOP_WOOD', wood, adjacentSpot);
                    return;
                } else {
                    character.log('🏠 Adjacent spot found but no valid path → treating as unreachable');
                    // Treat as unreachable and proceed to alternative strategies
                }
            } else {
                character.log('🏠 Wood found but unreachable → searching for alternative');

                // Strategy 1: Try to destroy blocking blocks to reach wood
                const blockingBlocks = character.findBlockingPath && character.findBlockingPath(wood);
                if (blockingBlocks && blockingBlocks.length > 0) {
                    const targetBlock = blockingBlocks[0];
                    const digSpot = character.findAdjacentSpot && character.findAdjacentSpot(targetBlock);
                    if (digSpot) {
                        character.log('🏠 Clearing path to wood → DESTROY_BLOCK');
                        character.setNextAction('DESTROY_BLOCK', targetBlock, digSpot);
                        return;
                    }
                }

                // Strategy 2: Move closer to wood area
                character.log('🏠 Moving closer to wood area');
                character.setNextAction('WANDER', null, wood);
                return;
            }
        } else {
            character.log('🏠 No wood found → exploring for wood');
            // Create provisional home to prevent getting stuck in this state
            if (!character.provisionalHome) {
                character.provisionalHome = character.gridPos;
                character.log('🏠 Created provisional home at current position');
            }
            character.setNextAction('WANDER');
            return;
        }
    }

    // === PRIORITY 4: ROLE-BASED BEHAVIORS ===
    if (character.role === 'leader') {
        // Leader: Hold meetings and expand territory
        if (Math.random() < 0.18) {
            character.setNextAction('MEETING');
            const chars = (typeof window !== 'undefined' && window.characters) ? window.characters : (typeof characters !== 'undefined' ? characters : []);
            const myGroup = chars.filter(c => c.groupId === character.groupId && c.id !== character.id);
            for (const member of myGroup) {
                const spot = character.findAdjacentSpot ? character.findAdjacentSpot(character.gridPos) : null;
                if (spot) {
                    member.setNextAction && member.setNextAction('GO_TO_MEETING', character, spot);
                }
            }
            return;
        }
        // Expand owned land
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                if (dx === 0 && dz === 0) continue;
                const x = character.gridPos.x + dx, y = character.gridPos.y, z = character.gridPos.z + dz;
                const key = `${x},${y},${z}`;
                if (!character.ownedLand.has(key) && !character.isLandOwnedByOther({x, y, z})) {
                    character.setNextAction('WANDER', null, {x, y, z});
                    return;
                }
            }
        }
    } else if (character.role === 'worker') {
        // Worker: Collect resources based on needs
        if (character.inventory[0] === null) {
            // High priority: If homeless and well-fed, always prefer wood over food
            if (!character.homePosition && character.needs.hunger >= 70) {
                // Use shared failure tracking system (same as Priority 3)
                if (!character._woodFailureCount) character._woodFailureCount = 0;
                if (!character._lastWoodTarget) character._lastWoodTarget = null;

                const woodPos = character.findClosestWood();
                if (woodPos) {
                    // Check if we're stuck on the same wood target
                    const woodKey = `${woodPos.x},${woodPos.y},${woodPos.z}`;
                    if (character._lastWoodTarget === woodKey) {
                        character._woodFailureCount++;
                        character.log(`Worker: Stuck on same wood target (${character._woodFailureCount} attempts)`);
                    } else {
                        character._woodFailureCount = 0;
                        character._lastWoodTarget = woodKey;
                    }

                    // If we've failed too many times, skip wood collection temporarily
                    if (character._woodFailureCount >= 2) {
                        character.log('Worker: Too many wood failures → skipping wood collection temporarily');
                        character._woodFailureCount = 0;
                        character._lastWoodTarget = null;
                        // Force switch to food collection or wandering
                    } else if (character._woodFailureCount >= 1) {
                        // Even one failure means we should try a different approach
                        character.log('Worker: Previous failure on same wood → trying alternative');
                        // Don't attempt the same wood again, move on to food collection
                    } else {
                        const adjacentSpot = character.findAdjacentSpot(woodPos);
                        if (adjacentSpot) {
                            // Additional check: verify pathfinding will actually work
                            const testPath = character.findPath && character.findPath(character.gridPos, adjacentSpot);
                            if (testPath && testPath.length > 0) {
                                character.log('Worker: Prioritizing wood for home building (verified path)');
                                character.setNextAction('CHOP_WOOD', woodPos, adjacentSpot);
                                return;
                            } else {
                                character.log('Worker: Adjacent spot found but no valid path → switching strategies');
                                // Don't attempt, proceed to food collection
                            }
                        } else {
                            character.log('Worker: Wood unreachable, switching to food collection or wandering');
                            // Don't get stuck on unreachable wood - switch strategies
                        }
                    }
                }
            }

            // Need food? Collect it
            if (character.needs.hunger < 85) {
                const foodPos = character.findClosestFood();
                if (foodPos) {
                    const adjacentSpot = character.findAdjacentSpot(foodPos);
                    if (adjacentSpot) {
                        character.setNextAction('COLLECT_FOOD', foodPos, adjacentSpot);
                        return;
                    }
                }
            }

            // Fallback: try wood again, but only if we haven't been failing on it
            if (!character._woodFailureCount || character._woodFailureCount < 2) {
                const woodPos = character.findClosestWood();
                if (woodPos) {
                    // Check if this is the same wood we've been failing on
                    const woodKey = `${woodPos.x},${woodPos.y},${woodPos.z}`;
                    if (character._lastWoodTarget === woodKey && character._woodFailureCount >= 1) {
                        character.log('Worker: Avoiding same failed wood target → exploring');
                        character.setNextAction('WANDER');
                        return;
                    }

                    const adjacentSpot = character.findAdjacentSpot(woodPos);
                    if (adjacentSpot) {
                        // Additional check: verify pathfinding will actually work
                        const testPath = character.findPath && character.findPath(character.gridPos, adjacentSpot);
                        if (testPath && testPath.length > 0) {
                            character.setNextAction('CHOP_WOOD', woodPos, adjacentSpot);
                            return;
                        } else {
                            character.log('Worker: Fallback wood has no valid path → exploring');
                            character.setNextAction('WANDER');
                            return;
                        }
                    } else {
                        character.log('Worker: All wood unreachable → exploring');
                        character.setNextAction('WANDER');
                        return;
                    }
                }
            } else {
                character.log('Worker: Skipping wood fallback due to recent failures');
            }
        } else {
            // Have items? Store them if have home
            if (character.homePosition) {
                const storageSpot = character.findStorageSpot && character.findStorageSpot();
                if (storageSpot) {
                    character.setNextAction('STORE_ITEM', storageSpot, character.findAdjacentSpot(storageSpot) || character.gridPos, BLOCK_TYPES.FRUIT);
                    return;
                }
            }
        }
    }

    // === PRIORITY 5: TOOL CRAFTING ===
    if (!character.inventory.includes('STONE_TOOL') && character.inventory.includes('WOOD_LOG')) {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dz = -1; dz <= 1; dz++) {
                    if (dx === 0 && dy === 0 && dz === 0) continue;
                    const x = character.gridPos.x + dx, y = character.gridPos.y + dy, z = character.gridPos.z + dz;
                    const key = `${x},${y},${z}`;
                    let blockId = worldData.get(key);
                    if (typeof blockId === 'object' && blockId.id !== undefined) blockId = blockId.id;
                    if (blockId === BLOCK_TYPES.STONE.id) {
                        character.setNextAction('CRAFT_TOOL', {x, y, z}, character.gridPos);
                        return;
                    }
                }
            }
        }
    }

    // === PRIORITY 6: SAFETY (Night time) ===
    if (character.needs.safety < 20 * character.personality.bravery && isNight) {
        const shelterPos = character.findShelter(isNight);
        if (shelterPos) {
            character.setNextAction('SEEK_SHELTER', shelterPos, shelterPos);
            return;
        }
        const wallSpots = character.findWallSpots && character.findWallSpots();
        if (wallSpots && wallSpots.length > 0) {
            character.setNextAction('BUILD_WALL', wallSpots, character.gridPos);
            return;
        }
        const digWallTarget = character.findDiggableShelterSpot && character.findDiggableShelterSpot();
        if (digWallTarget) {
            const adjacentSpot = character.findAdjacentSpot(digWallTarget);
            if (adjacentSpot) {
                character.setNextAction('CREATE_SHELTER', digWallTarget, adjacentSpot);
                return;
            }
        }
    }

    // === PRIORITY 7: ENERGY MANAGEMENT ===
    if (character.needs.energy < 70 * character.personality.bravery) {
        if (character.isSafe(isNight)) {
            character.setNextAction('REST');
            return;
        }
        const shelterPos = character.findShelter(isNight) || (character.findDiggableShelterSpot && character.findDiggableShelterSpot());
        if (shelterPos) {
            const adjacentSpot = character.findAdjacentSpot(shelterPos) || shelterPos;
            if (adjacentSpot) {
                character.setNextAction('SEEK_SHELTER_TO_REST', shelterPos, adjacentSpot);
                return;
            }
        }
    }

    // === PRIORITY 8: FOOD COLLECTION (Not quite full) ===
    if (character.needs.hunger < 95) {
        const foodPos = character.findClosestFood();
        if (foodPos) {
            const adjacentSpot = character.findAdjacentSpot(foodPos);
            if (adjacentSpot) {
                character.setNextAction('EAT', foodPos, adjacentSpot);
                return;
            }
        }
    }

    // === PRIORITY 9: SOCIAL NEEDS (Lower priority) ===
    if (character.needs.social < socialThreshold + 60) {
        const partner = character.findClosestPartner();
        if (partner) {
            character.setNextAction('SOCIALIZE', partner, partner.gridPos);
            return;
        } else {
            character.setNextAction('WANDER');
            return;
        }
    }

    // === PRIORITY 10: PRODUCTIVE WORK (Random chance) ===
    if (Math.random() < 0.3 * character.personality.diligence) {
        const digTarget = character.findDiggableBlock();
        if (digTarget) {
            const adjacentSpot = character.findAdjacentSpot(digTarget);
            if (adjacentSpot) {
                character.setNextAction('DESTROY_BLOCK', digTarget, adjacentSpot);
                return;
            }
        }
    }

    // === PRIORITY 11: EMERGENCY WOOD COLLECTION (If pathfinding consistently fails) ===
    if (!character.homePosition && character.needs.hunger >= 70 && Math.random() < 0.4) {
        character.log('🏠 Emergency wood collection attempt');
        const woodPos = character.findClosestWood();
        if (woodPos) {
            // Try a more lenient approach - just move towards wood area
            character.setNextAction('WANDER', null, woodPos);
            return;
        }
    }

    // === DEFAULT: WANDERING ===
    const wanderSpots = [];
    for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dz === 0 && dy === 0) continue;
                const x = character.gridPos.x + dx, y = character.gridPos.y + dy, z = character.gridPos.z + dz;
                if (y < 0 || y > maxHeight) continue;
                const key = `${x},${y},${z}`;
                const below = `${x},${y-1},${z}`;
                if (!worldData.has(key) && worldData.has(below)) {
                    wanderSpots.push({x, y, z});
                }
            }
        }
    }

    if (wanderSpots.length > 0) {
        const moveTo = wanderSpots[Math.floor(Math.random() * wanderSpots.length)];
        character.setNextAction('WANDER', null, moveTo);
        character.log('Action: WANDER (default exploration)');
    } else {
        // Last resort: break blocks to create space
        let destroyable = null;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                if (dx === 0 && dz === 0) continue;
                const x = character.gridPos.x + dx, y = character.gridPos.y, z = character.gridPos.z + dz;
                const key = `${x},${y},${z}`;
                const blockId = worldData.get(key);
                if (blockId !== undefined && blockId !== null && blockId !== BLOCK_TYPES.AIR.id && blockId !== BLOCK_TYPES.BED.id) {
                    destroyable = {x, y, z};
                    break;
                }
            }
            if (destroyable) break;
        }

        if (destroyable) {
            const adjacentSpot = character.findAdjacentSpot ? character.findAdjacentSpot(destroyable) : character.gridPos;
            character.setNextAction('DESTROY_BLOCK', destroyable, adjacentSpot);
            character.log('Action: DESTROY_BLOCK (create space)');
        } else {
            // Absolutely last resort
            character.setNextAction('WANDER', null, {x: character.gridPos.x + 1, y: character.gridPos.y, z: character.gridPos.z});
            character.log('Action: WANDER (last resort)');
        }
    }
}
