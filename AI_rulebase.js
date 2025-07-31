// Rule-based AI logic for voxel society simulator
// This function is a direct extraction of the original decideNextAction from character.js
// It is designed to be called as: decideNextAction_rulebase(character, isNight)
import { worldData, BLOCK_TYPES } from './world.js';

export function decideNextAction_rulebase(character, isNight) {
    // --- 10%の確率で強制的にWANDERまたはSOCIALIZEを選ぶ（ダイナミックな試行錯誤） ---
    if (Math.random() < 0.10) {
        const chars = (typeof window !== 'undefined' && window.characters) ? window.characters : (typeof characters !== 'undefined' ? characters : []);
        let nearbyPartner = null;
        for (const char of chars) {
            if (char.id === character.id) continue;
            const dist = Math.abs(character.gridPos.x - char.gridPos.x) + Math.abs(character.gridPos.y - char.gridPos.y) + Math.abs(character.gridPos.z - char.gridPos.z);
            if (dist <= 2) { nearbyPartner = char; break; }
        }
        if (nearbyPartner) {
            character.setNextAction('SOCIALIZE', nearbyPartner, nearbyPartner.gridPos); return;
        } else {
            character.setNextAction('WANDER'); return;
        }
    }
    // --- Emergency: If needs are critically low, always prioritize survival actions ---
    if (character.needs.hunger <= 10) {
        // 1. まずインベントリ内の食料を食べる
        const foodIdx = character.inventory.findIndex(item => item === 'FRUIT_ITEM' || item === 'FRUIT');
        if (foodIdx !== -1) {
            character.inventory[foodIdx] = null;
            character.carriedItemMesh.visible = false;
            character.needs.hunger = Math.min(100, character.needs.hunger + 40 + Math.random() * 20);
            character.eatCount = (character.eatCount || 0) + 1;
            character.log('Ate food from inventory');
            character.state = 'idle';
            character.action = null;
            character.actionCooldown = 0.5;
            return;
        }
        // 2. 近くのキャラから食料を奪う
        const chars = (typeof window !== 'undefined' && window.characters) ? window.characters : (typeof characters !== 'undefined' ? characters : []);
        let stealTarget = null;
        for (const char of chars) {
            if (char.id === character.id) continue;
            const dist = Math.abs(character.gridPos.x - char.gridPos.x) + Math.abs(character.gridPos.y - char.gridPos.y) + Math.abs(character.gridPos.z - char.gridPos.z);
            if (dist <= 1 && char.inventory && (char.inventory.includes('FRUIT_ITEM') || char.inventory.includes('FRUIT'))) {
                stealTarget = char;
                break;
            }
        }
        if (stealTarget) {
            const idx = stealTarget.inventory.findIndex(item => item === 'FRUIT_ITEM' || item === 'FRUIT');
            if (idx !== -1) {
                const stolen = stealTarget.inventory[idx];
                stealTarget.inventory[idx] = null;
                character.inventory[0] = stolen;
                character.carriedItemMesh.visible = true;
                character.log('Stole food from character', stealTarget.id);
                character.inventory[0] = null;
                character.carriedItemMesh.visible = false;
                character.needs.hunger = Math.min(100, character.needs.hunger + 40 + Math.random() * 20);
                character.eatCount = (character.eatCount || 0) + 1;
                character.log('Ate stolen food');
                character.state = 'idle';
                character.action = null;
                character.actionCooldown = 0.5;
                return;
            }
        }
        // 3. ワールド上の食料を探す
        const foodPos = character.findClosestFood && character.findClosestFood();
        if (foodPos) {
            const adjacentSpot = character.findAdjacentSpot && character.findAdjacentSpot(foodPos);
            if (adjacentSpot) {
                character.setNextAction('EAT', foodPos, adjacentSpot); return;
            }
        }
        character.setNextAction('WANDER'); return;
    }
    if (character.needs.energy <= 10) {
        if (character.isSafe && character.isSafe(isNight)) {
            character.setNextAction('REST'); return;
        }
        const shelterPos = character.findShelter && character.findShelter(isNight);
        if (shelterPos) {
            const adjacentSpot = character.findAdjacentSpot && character.findAdjacentSpot(shelterPos);
            if (adjacentSpot) {
                character.setNextAction('SEEK_SHELTER_TO_REST', shelterPos, adjacentSpot); return;
            }
        }
        character.setNextAction('WANDER'); return;
    }
    if (character.needs.social <= 30) {
        const partner = character.findClosestPartner && character.findClosestPartner();
        if (partner) {
            character.setNextAction('SOCIALIZE', partner, partner.gridPos); return;
        }
        character.setNextAction('WANDER'); return;
    }
    character.log('decideNextAction', { needs: character.needs, state: character.state, personality: character.personality, role: character.role });
    // --- Role-based AI priority (強化) ---
    if (character.role === 'leader') {
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
        if (character.inventory[0] === null) {
            const foodPos = character.findClosestFood();
            if (foodPos) {
                const adjacentSpot = character.findAdjacentSpot(foodPos);
                if(adjacentSpot){
                    character.setNextAction('COLLECT_FOOD', foodPos, adjacentSpot); return;
                }
            }
            const woodPos = character.findClosestWood();
            if (woodPos) {
                const adjacentSpot = character.findAdjacentSpot(woodPos);
                if(adjacentSpot){
                    character.setNextAction('CHOP_WOOD', woodPos, adjacentSpot); return;
                }
            }
        } else {
            if (character.homePosition) {
                const storageSpot = character.findStorageSpot && character.findStorageSpot();
                if (storageSpot) {
                    character.setNextAction('STORE_ITEM', storageSpot, character.findAdjacentSpot(storageSpot) || character.gridPos, BLOCK_TYPES.FRUIT); return;
                }
            }
        }
    }
    if (!character.inventory.includes('STONE_TOOL')) {
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
    if (character.needs.safety < 50 * character.personality.bravery && isNight) {
        const shelterPos = character.findShelter(isNight);
        if (shelterPos) {
            character.setNextAction('SEEK_SHELTER', shelterPos, shelterPos); return;
        }
        const wallSpots = character.findWallSpots && character.findWallSpots();
        if (wallSpots && wallSpots.length > 0) {
            character.setNextAction('BUILD_WALL', wallSpots, character.gridPos); return;
        }
        const digWallTarget = character.findDiggableShelterSpot && character.findDiggableShelterSpot();
        if (digWallTarget) {
            const adjacentSpot = character.findAdjacentSpot(digWallTarget);
            if (adjacentSpot) {
                character.setNextAction('CREATE_SHELTER', digWallTarget, adjacentSpot); return;
            }
        }
        if (character.canDigDown && character.canDigDown()) {
            const digDownTarget = { x: character.gridPos.x, y: character.gridPos.y - 1, z: character.gridPos.z };
            const adjacentSpot = character.findAdjacentSpot && character.findAdjacentSpot(character.gridPos);
            if (adjacentSpot) {
                character.setNextAction('CREATE_SHELTER', digDownTarget, adjacentSpot); return;
            }
        }
    }
    if (character.needs.energy < 70 * character.personality.bravery) {
        if (character.isSafe(isNight)) {
            character.setNextAction('REST'); return;
        }
        const shelterPos = character.findShelter(isNight) || (character.findDiggableShelterSpot && character.findDiggableShelterSpot());
        if (shelterPos) {
            const adjacentSpot = character.findAdjacentSpot(shelterPos) || shelterPos;
            if (adjacentSpot) {
                character.setNextAction('SEEK_SHELTER_TO_REST', shelterPos, adjacentSpot); return;
            }
        }
    }
    if (character.needs.hunger < 90) {
        const foodPos = character.findClosestFood();
        if (foodPos) {
            const adjacentSpot = character.findAdjacentSpot(foodPos);
            if(adjacentSpot){
                character.setNextAction('EAT', foodPos, adjacentSpot); return;
            }
        }
        const digTarget = character.findDiggableBlock();
        if (digTarget) {
            const adjacentSpot = character.findAdjacentSpot(digTarget);
            if (adjacentSpot) {
                character.setNextAction('DESTROY_BLOCK', digTarget, adjacentSpot); return;
            }
        }
    }
    if (character.needs.social < 90) {
        const partner = character.findClosestPartner();
        if (partner) {
            character.setNextAction('SOCIALIZE', partner, partner.gridPos); return;
        } else {
            character.setNextAction('WANDER'); return;
        }
    }
    const diligentRand = Math.random();
    if (diligentRand < character.personality.diligence - 0.5) {
        if (character.inventory[0] !== null) {
            const item = ITEM_TYPES[character.inventory[0]];
            if (item && item.isStorable && character.homePosition) {
                const storageSpot = character.findStorageSpot && character.findStorageSpot();
                if (storageSpot) {
                    character.setNextAction('STORE_ITEM', storageSpot, character.findAdjacentSpot(storageSpot) || character.gridPos, BLOCK_TYPES.FRUIT); return;
                }
            } else if (character.inventory[0] === 'WOOD_LOG' && character.provisionalHome && !character.homePosition) {
                character.setNextAction('BUILD_HOME', character.provisionalHome, character.provisionalHome); return;
            }
        } else {
            if (character.needs.hunger > 90 && character.homePosition) {
                const foodPos = character.findClosestFood();
                if (foodPos) {
                    const adjacentSpot = character.findAdjacentSpot(foodPos);
                    if(adjacentSpot){
                        character.setNextAction('COLLECT_FOR_STORAGE', foodPos, adjacentSpot); return;
                    }
                }
            }
            if (character.provisionalHome && !character.homePosition) {
                const woodPos = character.findClosestWood();
                if (woodPos) {
                    const adjacentSpot = character.findAdjacentSpot(woodPos);
                    if(adjacentSpot){
                        character.setNextAction('CHOP_WOOD', woodPos, adjacentSpot); return;
                    }
                }
            }
        }
    }
    const chars = (typeof window !== 'undefined' && window.characters) ? window.characters : (typeof characters !== 'undefined' ? characters : []);
    let nearbyPartner = null;
    for (const char of chars) {
        if (char.id === character.id) continue;
        const dist = Math.abs(character.gridPos.x - char.gridPos.x) + Math.abs(character.gridPos.y - char.gridPos.y) + Math.abs(character.gridPos.z - char.gridPos.z);
        if (dist <= 2) {
            nearbyPartner = char;
            break;
        }
    }
    if (nearbyPartner) {
        character.setNextAction('SOCIALIZE', nearbyPartner, nearbyPartner.gridPos); return;
    }
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
    let moveTo = null;
    if (wanderSpots.length > 0) {
        moveTo = wanderSpots[Math.floor(Math.random() * wanderSpots.length)];
        character.setNextAction('WANDER', null, moveTo);
    } else {
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
        } else {
            let foundMove = false;
            for (let dx = -1; dx <= 1 && !foundMove; dx++) {
                for (let dy = -1; dy <= 1 && !foundMove; dy++) {
                    for (let dz = -1; dz <= 1 && !foundMove; dz++) {
                        if (dx === 0 && dy === 0 && dz === 0) continue;
                        const x = character.gridPos.x + dx, y = character.gridPos.y + dy, z = character.gridPos.z + dz;
                        if (y < 0 || y > maxHeight) continue;
                        character.setNextAction('WANDER', null, {x, y, z});
                        foundMove = true;
                    }
                }
            }
            if (!foundMove) {
                character.log('NO_ACTION_POSSIBLE: Character is completely stuck', {id: character.id, gridPos: character.gridPos, state: character.state});
                character.actionCooldown = 1.0;
            }
        }
        character.actionCooldown = 0.5;
    }
}
