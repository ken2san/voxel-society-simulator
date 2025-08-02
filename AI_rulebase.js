// Rule-based AI logic for voxel society simulator
// This function is a direct extraction of the original decideNextAction from character.js
// It is designed to be called as: decideNextAction_rulebase(character, isNight)
import { worldData, BLOCK_TYPES, ITEM_TYPES, maxHeight, removeBlock, addBlock } from './world.js';

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

    // === PRIORITY 3: HOME BUILDING (Priority-configurable) ===
    // UI設定の優先順位をチェック
    const homeBuildingPriority = (typeof window !== 'undefined' && window.homeBuildingPriority !== undefined) ? window.homeBuildingPriority : 50;
    const shouldBuildHome = Math.random() * 100 < homeBuildingPriority;

    // デバッグログ
    if (character.id === 0) {
        character.log(`[DEBUG] homeBuildingPriority: ${homeBuildingPriority}%, shouldBuildHome: ${shouldBuildHome}`);
    }

    // 優先順位が低い場合は家建設をスキップ
    if (!shouldBuildHome) {
        character.log(`🏠 HOME BUILDING SKIPPED (priority: ${homeBuildingPriority}%)`);
    } else if ((character.needs.hunger >= homeBuildingHungerThreshold && !character.homePosition) || (character.provisionalHome && !character.homePosition)) {
        character.log('🏠 HOME BUILDING PRIORITY: Well-fed but homeless or provisionalHome');

        // まだ家が完成していない場合はBUILD_HOMEを継続
        if (character._buildingProgress && character._buildingProgress > 0 && character._buildingProgress < 25) {
            character.log('🏠 建築途中 → BUILD_HOME継続');
            character.setNextAction('BUILD_HOME');
            return;
        }

        // 木材があれば建築開始
        if (character.inventory[0] === 'WOOD_LOG') {
            character.log('🏠 Has wood → BUILD_HOME');
            character.setNextAction('BUILD_HOME');
            return;
        }

        // 木材を探す（シンプルなロジック）
        const wood = character.findClosestWood();
        if (wood) {
            character.log('🏠 Found wood → CHOP_WOOD');
            character.setNextAction('CHOP_WOOD', wood, wood);
            return;
        } else {
            character.log('🏠 No wood found → WANDER');
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
        // Worker: Collect resources based on UI priority settings
        if (character.inventory[0] === null) {

            // UI優先度設定をチェック
            const woodPriority = (typeof window !== 'undefined' && window.woodCollectionPriority) ? window.woodCollectionPriority : 5;
            const shouldCollectWood = Math.random() < (woodPriority / 10);

            // 家がなく、お腹が満たされている場合でも、UI優先度を尊重
            if (!character.homePosition && character.needs.hunger >= 70 && shouldCollectWood) {
                const woodPos = character.findClosestWood();
                if (woodPos) {
                    const adjacentSpot = character.findAdjacentSpot(woodPos);
                    if (adjacentSpot) {
                        character.log(`Worker: Collecting wood (priority: ${woodPriority})`);
                        character.setNextAction('CHOP_WOOD', woodPos, adjacentSpot);
                        return;
                    }
                }
            }

            // 食料が必要な場合は収集
            if (character.needs.hunger < 85) {
                const foodPos = character.findClosestFood();
                if (foodPos) {
                    const adjacentSpot = character.findAdjacentSpot(foodPos);
                    if (adjacentSpot) {
                        character.log('Worker: Collecting food');
                        character.setNextAction('COLLECT_FOOD', foodPos, adjacentSpot);
                        return;
                    }
                }
            }
        } else {
            // アイテムを持っている場合、家があれば保管
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
        // 地下シェルター掘りは代替家建築でのみ実行（スタック防止）
        // const digWallTarget = character.findDiggableShelterSpot && character.findDiggableShelterSpot();
        // if (digWallTarget) {
        //     const adjacentSpot = character.findAdjacentSpot(digWallTarget);
        //     if (adjacentSpot) {
        //         character.setNextAction('DESTROY_BLOCK', digWallTarget, adjacentSpot);
        //         return;
        //     }
        // }
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
        const digTarget = character.findDiggableBlock && character.findDiggableBlock();
        if (digTarget) {
            const adjacentSpot = character.findAdjacentSpot && character.findAdjacentSpot(digTarget);
            if (adjacentSpot) {
                // 掘った後のy座標から3段以内に必ずブロックがあるか厳密チェック
                let belowY = digTarget.y - 1;
                let hasGround = false;
                for (let i = 0; i < 3; i++) {
                    if (belowY < 0) break;
                    const key = `${digTarget.x},${belowY},${digTarget.z}`;
                    if (worldData.has(key)) {
                        hasGround = true;
                        break;
                    }
                    belowY--;
                }
                // 安全チェック: 掘った後にキャラクターや周囲が安全かどうか確認
                const isSafeToDigHere = character.isSafeToFallOrDig && character.isSafeToFallOrDig(digTarget.x, digTarget.y, digTarget.z);
                if (isSafeToDigHere && hasGround) {
                    // 追加チェック: y=0,1の地面付近は掘らない（安全マージン）
                    if (digTarget.y > 1) {
                        character.log('PRODUCTIVE WORK: Safe digging → DESTROY_BLOCK');
                        character.setNextAction('DESTROY_BLOCK', digTarget, adjacentSpot);
                        return;
                    } else {
                        character.log('PRODUCTIVE WORK: Skipping ground level digging (y<=1)');
                    }
                } else {
                    character.log('PRODUCTIVE WORK: Unsafe to dig here or no ground below, skipping');
                }
            }
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
        // Last resort: break blocks to create space (but not ground level)
        let destroyable = null;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                if (dx === 0 && dz === 0) continue;
                const x = character.gridPos.x + dx, y = character.gridPos.y, z = character.gridPos.z + dz;
                // y=0,1の地面付近は掘らない（安全マージン）
                if (y <= 1) continue;
                // 掘った後のy座標から3段以内に必ずブロックがあるか厳密チェック
                let belowY = y - 1;
                let hasGround = false;
                for (let i = 0; i < 3; i++) {
                    if (belowY < 0) break;
                    const keyBelow = `${x},${belowY},${z}`;
                    if (worldData.has(keyBelow)) {
                        hasGround = true;
                        break;
                    }
                    belowY--;
                }
                const key = `${x},${y},${z}`;
                const blockId = worldData.get(key);
                if (blockId !== undefined && blockId !== null && blockId !== BLOCK_TYPES.AIR.id && blockId !== BLOCK_TYPES.BED.id) {
                    // 安全チェック
                    const isSafe = character.isSafeToFallOrDig && character.isSafeToFallOrDig(x, y, z);
                    if (isSafe && hasGround) {
                        destroyable = {x, y, z};
                        break;
                    }
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
