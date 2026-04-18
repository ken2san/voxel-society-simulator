// Rule-based AI logic for voxel society simulator
// This function is a direct extraction of the original decideNextAction from character.js
// It is designed to be called as: decideNextAction_rulebase(character, isNight)
import { worldData, BLOCK_TYPES, ITEM_TYPES, maxHeight, removeBlock, addBlock } from '../world.js';

function getTunableNumber(key, fallback, { min = -Infinity, max = Infinity } = {}) {
    const raw = (typeof window !== 'undefined' && window[key] !== undefined) ? Number(window[key]) : fallback;
    const numeric = Number.isFinite(raw) ? raw : fallback;
    return Math.max(min, Math.min(max, numeric));
}

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
    const homeReturnHungerLevel = (typeof window !== 'undefined' && window.homeReturnHungerLevel !== undefined) ? window.homeReturnHungerLevel : 90;
    const energyEmergency = (typeof window !== 'undefined' && window.energyEmergencyThreshold !== undefined) ? Number(window.energyEmergencyThreshold) : 32;
    const foodSeekHungerThreshold = getTunableNumber('foodSeekHungerThreshold', 35, { min: 10, max: 80 });
    const explorationBaseRate = getTunableNumber('explorationBaseRate', 0.05, { min: 0, max: 0.4 });
    const explorationMinRate = getTunableNumber('explorationMinRate', 0.02, { min: 0, max: 0.2 });
    const explorationMaxRate = getTunableNumber('explorationMaxRate', 0.12, { min: 0, max: 0.5 });
    const explorationAdaptBoost = getTunableNumber('explorationAdaptBoost', 0.25, { min: 0, max: 1 });
    const explorationForagePenalty = getTunableNumber('explorationForagePenalty', 0.75, { min: 0, max: 1 });
    const explorationRestPenalty = getTunableNumber('explorationRestPenalty', 0.9, { min: 0, max: 1 });
    const socialAdaptationBoost = getTunableNumber('socialAdaptationBoost', 0.35, { min: 0, max: 1 });
    const socialForagePenalty = getTunableNumber('socialForagePenalty', 0.25, { min: 0, max: 1 });
    const socialRestPenalty = getTunableNumber('socialRestPenalty', 0.20, { min: 0, max: 1 });
    const lowPrioritySocialOffset = getTunableNumber('lowPrioritySocialOffset', 12, { min: 0, max: 100 });
    const supportSeekingDrive = getTunableNumber('supportSeekingDrive', 0.18, { min: 0, max: 0.6 });
    const socialAnchorBias = getTunableNumber('socialAnchorBias', 0.28, { min: 0, max: 1 });
    const wanderReserveEnergy = getTunableNumber('wanderReserveEnergy', 10, { min: 0, max: 30 });
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const socialDriftThreshold = clamp(socialThreshold + lowPrioritySocialOffset, 0, 92);
    const adapt = character.adaptiveTendencies || { forage: 0, rest: 0, social: 0, explore: 0 };
    const aging = character.getAgingProfile
        ? character.getAgingProfile()
        : { mobilityMul: 1.0, exploreMul: 1.0, socialMul: 1.0, workMul: 1.0, restThresholdBonus: 0, stage: 'adult' };
    // resilience: hardy characters tolerate lower energy before forcing REST
    const effectiveEnergyEmergency = (energyEmergency / Math.max(0.3, character.personality.resilience ?? 1.0))
        * (1 + (1 - (aging.mobilityMul || 1.0)) * 0.8);
    const effectiveRestThreshold = clamp(45 + (2.0 - (character.personality.bravery ?? 1.0)) * 18 + (adapt.rest * 15) + (aging.restThresholdBonus || 0), 25, 75);
    const readyToRoamThreshold = Math.max(effectiveEnergyEmergency + 16, effectiveRestThreshold + wanderReserveEnergy);

    // === PRIORITY 0: EMERGENCY ENERGY — force REST before any other decision ===
    // Home-building and wandering both consume energy; a depleted character must rest
    // regardless of other priorities or it enters a drain spiral it cannot recover from.
    // Exception: if hunger is also critical (≤ hungerEmergency+5), hunger takes precedence
    // to prevent characters with high effectiveEnergyEmergency from resting until they starve.
    const hungerCrisisLevel = (typeof window !== 'undefined' && window.hungerEmergencyThreshold !== undefined) ? Number(window.hungerEmergencyThreshold) + 5 : 15;
    if (character.needs.energy <= effectiveEnergyEmergency && character.needs.hunger > hungerCrisisLevel) {
        if (character.isSafe(isNight)) {
            character.log(`Action: REST (energy emergency=${character.needs.energy.toFixed(1)})`);
            character.setNextAction('REST');
            return;
        }
        // Not safe: seek shelter then rest
        const shelterPos = character.findShelter && character.findShelter(isNight);
        if (shelterPos) {
            character.log(`Action: SEEK_SHELTER_TO_REST (energy emergency)`);
            const adj = character.findAdjacentSpot && character.findAdjacentSpot(shelterPos);
            character.setNextAction('SEEK_SHELTER_TO_REST', shelterPos, adj || shelterPos);
            return;
        }
        // No shelter found — rest in place anyway; starvation is worse
        character.log(`Action: REST (energy emergency, unsafe but no shelter)`);
        character.setNextAction('REST');
        return;
    }

    // === PRIORITY 0.5: HUNGER CRISIS — single-purpose food seeking ===
    // When hunger is critically low, all social/home/exploration rules are suspended.
    // Character has one goal: find and eat food. Reproduction is also blocked at source
    // (character.js) when either partner is in hunger crisis.
    if (character.needs.hunger <= 15) {
        const foodPos = character.findClosestFood && character.findClosestFood();
        if (foodPos) {
            const adjacentSpot = character.findAdjacentSpot && character.findAdjacentSpot(foodPos);
            if (adjacentSpot) {
                character.log(`Action: EAT (hunger crisis=${character.needs.hunger.toFixed(1)})`);
                character.setNextAction('EAT', foodPos, adjacentSpot);
                return;
            }
        }
        // No food in range — wander to search
        character.log(`Action: WANDER (hunger crisis, no food in range hunger=${character.needs.hunger.toFixed(1)})`);
        character.setNextAction('WANDER');
        return;
    }

    // If food is available, start foraging before reaching crisis so the hunger bar behaves more naturally.
    if (character.needs.hunger <= foodSeekHungerThreshold) {
        const foodPos = character.findClosestFood && character.findClosestFood();
        if (foodPos) {
            const adjacentSpot = character.findAdjacentSpot && character.findAdjacentSpot(foodPos);
            if (adjacentSpot) {
                character.log(`Action: COLLECT_FOOD (early forage threshold=${foodSeekHungerThreshold}, hunger=${character.needs.hunger.toFixed(1)})`);
                character.setNextAction('COLLECT_FOOD', foodPos, adjacentSpot);
                return;
            }
        }
    }

    // === PRIORITY 0.75: SEEK TRUSTED SUPPORT WHEN ANXIOUS OR LONELY ===
    const supportUrgency = clamp(
        (Math.max(0, 55 - character.needs.social) / 55) * 0.55 +
        (Math.max(0, 50 - character.needs.safety) / 50) * 0.45,
        0,
        1
    );
    if (character.needs.energy > (effectiveEnergyEmergency + 8) && character.needs.hunger > 25) {
        const trustedTarget = character.getPreferredSupportTarget && character.getPreferredSupportTarget();
        const supportSeekChance = clamp((supportUrgency * supportSeekingDrive) + ((character._socialAnchorId ? 1 : 0) * socialAnchorBias * 0.25), 0, 1);
        if (trustedTarget?.char && Math.random() < supportSeekChance) {
            character.log(`Action: SOCIALIZE (support-seeking pull=${supportSeekChance.toFixed(2)})`);
            character.setNextAction('SOCIALIZE', trustedTarget.char, trustedTarget.targetPos || trustedTarget.char.gridPos);
            return;
        }
    }

    // === PRIORITY 1: RANDOM EXPLORATION (only when the character can afford to roam) ===
    const canExploreFreely = character.needs.energy > Math.max(effectiveEnergyEmergency + 18, effectiveRestThreshold + wanderReserveEnergy)
        && character.needs.hunger > 30
        && character.needs.social > socialDriftThreshold;
    const explorationWeight = canExploreFreely
        ? clamp(
            explorationBaseRate * (character.personality.curiosity ?? 1.0) * (aging.exploreMul || 1.0)
                * (1 + (adapt.explore * explorationAdaptBoost) - (adapt.forage * explorationForagePenalty) - (adapt.rest * explorationRestPenalty)),
            explorationMinRate,
            explorationMaxRate
        )
        : 0;
    if (Math.random() < explorationWeight) {
        const chars = (typeof window !== 'undefined' && window.characters) ? window.characters : (typeof characters !== 'undefined' ? characters : []);
        const nearbyPartnerRange = getTunableNumber('perceptionRange', 3, { min: 1, max: 8 });
        let nearbyPartner = null;
        for (const char of chars) {
            if (char.id === character.id) continue;
            const dist = Math.abs(character.gridPos.x - char.gridPos.x) + Math.abs(character.gridPos.y - char.gridPos.y) + Math.abs(character.gridPos.z - char.gridPos.z);
            if (dist <= nearbyPartnerRange) { nearbyPartner = char; break; }
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
    // sociality scales the threshold: social characters seek interaction earlier
    const effectiveSocialThreshold = socialThreshold * (character.personality.sociality ?? 1.0) * (aging.socialMul || 1.0) * (1 + adapt.social * socialAdaptationBoost - adapt.forage * socialForagePenalty - adapt.rest * socialRestPenalty);
    if (character.needs.social <= effectiveSocialThreshold) {
        const partner = character.findClosestPartner && character.findClosestPartner();
        if (partner) {
            character.log(`SOCIALIZE selected: social=${character.needs.social}, threshold=${effectiveSocialThreshold.toFixed(1)}`);
            character.setNextAction('SOCIALIZE', partner, partner.gridPos);
            return;
        }
        if (character.needs.energy > readyToRoamThreshold && character.needs.hunger > 35) {
            character.setNextAction('WANDER');
        } else {
            character.setNextAction('REST');
            character.log('Action: REST (social search paused to preserve energy)');
        }
        return;
    }

    // === PRIORITY 3: HOME BUILDING (Priority-configurable) ===
    // UI設定の優先順位をチェック
    const homeBuildingPriority = (typeof window !== 'undefined' && window.homeBuildingPriority !== undefined) ? window.homeBuildingPriority : 50;
    const shouldBuildHome = Math.random() * 100 < (homeBuildingPriority * (aging.workMul || 1.0));

    // 最善の木材ターゲット選択とprovisionalHomeからの復帰
    function findClosestReachableWood() {
        if (!character.findClosestWood) return null;
        const woods = (typeof worldData !== 'undefined' && worldData) ? Array.from(worldData.entries()).filter(([key, val]) => {
            if (typeof val === 'object' && val.id !== undefined) val = val.id;
            return val === BLOCK_TYPES.WOOD.id;
        }) : [];
        let best = null;
        let minDist = Infinity;
        for (const [key,] of woods) {
            const [x, y, z] = key.split(',').map(Number);
            const wood = {x, y, z};
            const adjacentSpot = character.findAdjacentSpot && character.findAdjacentSpot(wood);
            if (adjacentSpot) {
                const testPath = character.findPath && character.findPath(character.gridPos, adjacentSpot);
                if (testPath && testPath.length > 0) {
                    const dist = Math.abs(character.gridPos.x - x) + Math.abs(character.gridPos.y - y) + Math.abs(character.gridPos.z - z);
                    if (dist < minDist) {
                        minDist = dist;
                        best = wood;
                    }
                }
            }
        }
        return best;
    }

    if (shouldBuildHome && ((character.needs.hunger >= homeReturnHungerLevel && !character.homePosition) || (character.provisionalHome && !character.homePosition))) {
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
            // provisionalHome解除
            if (character.provisionalHome) character.provisionalHome = null;
            return;
        }

        // Check if we've been stuck trying to get wood (use shared failure tracking)
        if (!character._woodFailureCount) character._woodFailureCount = 0;
        if (!character._lastWoodTarget) character._lastWoodTarget = null;

        // === 優先: 隣接する木材を直接チェック ===
        character.log('🏠 Checking for adjacent wood blocks...');
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    if (dx === 0 && dy === 0 && dz === 0) continue;
                    const x = character.gridPos.x + dx, y = character.gridPos.y + dy, z = character.gridPos.z + dz;
                    const key = `${x},${y},${z}`;
                    let blockId = worldData.get(key);
                    if (typeof blockId === 'object' && blockId.id !== undefined) blockId = blockId.id;
                    if (blockId === BLOCK_TYPES.WOOD.id) {
                        character.log(`🏠 Found adjacent wood at (${x},${y},${z}) → CHOP_WOOD (no movement needed)`);
                        const wood = {x, y, z};
                        character.setNextAction('CHOP_WOOD', wood, null); // moveTo=null で移動不要を明示
                        if (character.provisionalHome) character.provisionalHome = null;
                        return;
                    }
                }
            }
        }
        character.log('🏠 No adjacent wood found, trying reachable wood...');

        // 最善の木材ターゲットを選択
        const wood = findClosestReachableWood();
        if (wood) {
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
                character.provisionalHome = character.gridPos;
                character._woodFailureCount = 0;
                character._lastWoodTarget = null;
                character.log('🏠 Created provisional home due to wood access issues');
                character.setNextAction('WANDER');
                return;
            }

            // 隣接しているかチェック（移動不要で即座に実行可能）
            const dist = Math.abs(character.gridPos.x - wood.x) +
                        Math.abs(character.gridPos.y - wood.y) +
                        Math.abs(character.gridPos.z - wood.z);

            if (dist === 1) {
                // 隣接している場合は移動不要で即座にCHOP_WOOD実行
                character.log('🏠 Adjacent wood → CHOP_WOOD (no movement needed)');
                character.setNextAction('CHOP_WOOD', wood, null); // moveTo=null で移動不要を明示
                if (character.provisionalHome) character.provisionalHome = null;
                return;
            } else {
                // 隣接していない場合は従来通り移動が必要
                const adjacentSpot = character.findAdjacentSpot && character.findAdjacentSpot(wood);
                if (adjacentSpot) {
                    const testPath = character.findPath && character.findPath(character.gridPos, adjacentSpot);
                    if (testPath && testPath.length > 0) {
                        character.log('🏠 No wood → CHOP_WOOD (reachable with valid path)');
                        character.setNextAction('CHOP_WOOD', wood, adjacentSpot);
                        // provisionalHome解除
                        if (character.provisionalHome) character.provisionalHome = null;
                        return;
                    }
                }
            }
            // ここに到達することはほぼないが、念のため障害物破壊
            const blockingBlocks = character.findBlockingPath && character.findBlockingPath(wood);
            if (blockingBlocks && blockingBlocks.length > 0) {
                const targetBlock = blockingBlocks[0];
                const digSpot = character.findAdjacentSpot && character.findAdjacentSpot(targetBlock);
                if (digSpot) {
                    character.log('🏠 Clearing path to wood → DESTROY_BLOCK (forced)');
                    character.setNextAction('DESTROY_BLOCK', targetBlock, digSpot);
                    return;
                }
            }
            character.log('🏠 No blocking blocks found → exploring');
            character.setNextAction('WANDER', null, wood);
            return;
        } else {
            character.log('🏠 No reachable wood found → exploring for wood');
            // Create provisional home to prevent getting stuck in this state
            if (!character.provisionalHome) {
                character.provisionalHome = character.gridPos;
                character.log('🏠 Created provisional home at current position');
            }
            // provisionalHome状態が続いた回数をカウント
            if (!character._provisionalHomeCount) character._provisionalHomeCount = 0;
            character._provisionalHomeCount++;

            // 木が少ない環境での代替戦略
            if (character._provisionalHomeCount >= 3) {
                character.log('🏠 Few trees available: trying alternative home building');

                // 代替戦略1: 石で簡易的な家を建てる
                const stone = character.findClosestStone && character.findClosestStone();
                if (stone) {
                    const adjacentSpot = character.findAdjacentSpot && character.findAdjacentSpot(stone);
                    if (adjacentSpot) {
                        const testPath = character.findPath && character.findPath(character.gridPos, adjacentSpot);
                        if (testPath && testPath.length > 0) {
                            character.log('🏠 Using stone for emergency home → DESTROY_BLOCK (stone)');
                            character.setNextAction('DESTROY_BLOCK', stone, adjacentSpot);
                            character._provisionalHomeCount = 0;
                            // 石の家建設フラグ
                            character._buildingStoneHome = true;
                            character._stoneHomeLocation = stone;
                            return;
                        }
                    }
                }

                // 代替戦略2: 他のキャラクターから木材を取得
                if (typeof window !== 'undefined' && window.characters) {
                    const chars = window.characters.filter(c =>
                        c.id !== character.id &&
                        c.inventory[0] === 'WOOD_LOG' &&
                        Math.abs(c.gridPos.x - character.gridPos.x) + Math.abs(c.gridPos.z - character.gridPos.z) <= 5
                    );
                    if (chars.length > 0) {
                        const nearbyChar = chars[0];
                        character.log('🏠 Requesting wood from nearby character');
                        character.setNextAction('SOCIALIZE', nearbyChar, nearbyChar.gridPos);
                        return;
                    }
                }

                // 代替戦略3: 土を掘って地下の家を作る（安全チェック強化）
                character.log('🏠 Checking for adjacent diggable blocks for shelter...');
                // まず隣接する掘れるブロックを直接チェック
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dz = -1; dz <= 1; dz++) {
                            if (dx === 0 && dy === 0 && dz === 0) continue;
                            const x = character.gridPos.x + dx, y = character.gridPos.y + dy, z = character.gridPos.z + dz;
                            if (y <= 1) continue; // 地面付近は避ける
                            const key = `${x},${y},${z}`;
                            let blockId = worldData.get(key);
                            if (typeof blockId === 'object' && blockId.id !== undefined) blockId = blockId.id;
                            if (blockId && blockId !== BLOCK_TYPES.AIR.id && blockId !== BLOCK_TYPES.BED.id) {
                                // 安全チェック
                                const isSafeToDigHere = character.isSafeToFallOrDig && character.isSafeToFallOrDig(x, y, z);
                                if (isSafeToDigHere) {
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
                                    if (hasGround) {
                                        character.log(`🏠 Found adjacent diggable block at (${x},${y},${z}) → DESTROY_BLOCK (no movement needed)`);
                                        const diggableSpot = {x, y, z};
                                        character.setNextAction('DESTROY_BLOCK', diggableSpot, null); // moveTo=null で移動不要を明示
                                        character._provisionalHomeCount = 0;
                                        character._diggingShelter = true;
                                        character._shelterLocation = diggableSpot;
                                        return;
                                    }
                                }
                            }
                        }
                    }
                }
                character.log('🏠 No adjacent diggable blocks found, trying findDiggableShelterSpot...');

                const diggableSpot = character.findDiggableShelterSpot && character.findDiggableShelterSpot();
                if (diggableSpot) {
                    // 隣接しているかチェック（移動不要で即座に実行可能）
                    const dist = Math.abs(character.gridPos.x - diggableSpot.x) +
                                Math.abs(character.gridPos.y - diggableSpot.y) +
                                Math.abs(character.gridPos.z - diggableSpot.z);

                    if (dist === 1) {
                        // 隣接している場合は移動不要で即座にDESTROY_BLOCK実行
                        const isSafeToDigHere = character.isSafeToFallOrDig && character.isSafeToFallOrDig(diggableSpot.x, diggableSpot.y, diggableSpot.z);
                        if (isSafeToDigHere) {
                            character.log('🏠 Adjacent underground shelter → DESTROY_BLOCK (no movement needed)');
                            character.setNextAction('DESTROY_BLOCK', diggableSpot, null); // moveTo=null で移動不要を明示
                            character._provisionalHomeCount = 0;
                            character._diggingShelter = true;
                            character._shelterLocation = diggableSpot;
                            return;
                        }
                    } else {
                        // 隣接していない場合は従来通り移動が必要
                        const adjacentSpot = character.findAdjacentSpot && character.findAdjacentSpot(diggableSpot);
                        if (adjacentSpot) {
                            // 追加安全チェック: 掘った後にキャラクターが落下しないか確認
                            const isSafeToDigHere = character.isSafeToFallOrDig && character.isSafeToFallOrDig(diggableSpot.x, diggableSpot.y, diggableSpot.z);
                            if (isSafeToDigHere) {
                                character.log('🏠 Building underground shelter → DESTROY_BLOCK (dig shelter)');
                                character.setNextAction('DESTROY_BLOCK', diggableSpot, adjacentSpot);
                                character._provisionalHomeCount = 0;
                                // 地下シェルターを掘ったら、それを家として設定
                                character._diggingShelter = true;
                                character._shelterLocation = diggableSpot;
                                return;
                            } else {
                                character.log('🏠 Diggable shelter spot found but not safe to dig');
                            }
                        }
                    }
                }
            }

            // 周囲の未探索エリアや木の多い方向へ優先的にWANDER
            let wanderTarget = null;
            let maxWoodCount = -1;
            for (let dx = -5; dx <= 5; dx++) {
                for (let dz = -5; dz <= 5; dz++) {
                    if (dx === 0 && dz === 0) continue;
                    const x = character.gridPos.x + dx, y = character.gridPos.y, z = character.gridPos.z + dz;
                    let woodCount = 0;
                    for (let ddx = -1; ddx <= 1; ddx++) {
                        for (let ddz = -1; ddz <= 1; ddz++) {
                            const key = `${x+ddx},${y},${z+ddz}`;
                            let val = worldData.get(key);
                            if (typeof val === 'object' && val.id !== undefined) val = val.id;
                            if (val === BLOCK_TYPES.WOOD.id) woodCount++;
                        }
                    }
                    if (woodCount > maxWoodCount) {
                        maxWoodCount = woodCount;
                        wanderTarget = {x, y, z};
                    }
                }
            }
            if (wanderTarget && maxWoodCount > 0) {
                character.log('🏠 WANDER: moving toward wood-rich area');
                character.setNextAction('WANDER', null, wanderTarget);
            } else {
                // 木が全くない場合は、より広範囲を探索
                const expandedWanderSpots = [];
                for (let dx = -8; dx <= 8; dx++) {
                    for (let dz = -8; dz <= 8; dz++) {
                        if (Math.abs(dx) < 3 && Math.abs(dz) < 3) continue;
                        const x = character.gridPos.x + dx, y = character.gridPos.y, z = character.gridPos.z + dz;
                        const key = `${x},${y},${z}`;
                        const below = `${x},${y-1},${z}`;
                        if (!worldData.has(key) && worldData.has(below)) {
                            expandedWanderSpots.push({x, y, z});
                        }
                    }
                }
                if (expandedWanderSpots.length > 0) {
                    const moveTo = expandedWanderSpots[Math.floor(Math.random() * expandedWanderSpots.length)];
                    character.log('🏠 WANDER: expanding search for wood');
                    character.setNextAction('WANDER', null, moveTo);
                } else {
                    character.setNextAction('WANDER');
                }
            }

            // パスファインディング失敗が多発している場合の緊急対策
            if (character._provisionalHomeCount >= 3) { // 5から3に変更してより早く発動
                character.log('🏠 Pathfinding issues detected: trying emergency home building');
                // 現在位置の足元にベッドを直接設置（移動不要）
                const currentPos = character.gridPos;
                const belowKey = `${currentPos.x},${currentPos.y-1},${currentPos.z}`;
                if (worldData.has(belowKey)) {
                    character.log('🏠 Emergency: Creating home at current position (no movement needed)');
                    character.homePosition = currentPos;
                    character.provisionalHome = null;
                    character._provisionalHomeCount = 0;

                    // 可能であればベッドブロックを設置
                    if (typeof addBlock === 'function' && BLOCK_TYPES.BED) {
                        addBlock(currentPos.x, currentPos.y, currentPos.z, BLOCK_TYPES.BED, true);
                        character.log('🏠 Emergency bed placed at current position');
                    }
                    return;
                }
            }

            // provisionalHome状態が長期間続いたら強制的な解決策
            if (character._provisionalHomeCount >= 6) { // 8から6に変更
                character.log('🏠 Long-term provisionalHome: accepting current location as home');
                character.homePosition = character.provisionalHome;
                character.provisionalHome = null;
                character._provisionalHomeCount = 0;
                character.log('🏠 Emergency: Set current location as home');
                return;
            }
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
    // nightSafetyOverride: brave characters (bravery > 1.2) with adequate energy stay outside at night.
    // bravery direction fix: low bravery → high threshold (flees at moderate danger);
    //                        high bravery → low threshold (only flees in extreme danger).
    const nightSafetyOverride = (character.personality.bravery ?? 1.0) > 1.2 && character.needs.energy > 60;
    if (!nightSafetyOverride && character.needs.safety < 20 * (2.0 - (character.personality.bravery ?? 1.0)) && isNight) {
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

    // === PRIORITY 6.5: BONDED PARTNER AID — move toward bonded partner in danger ===
    // A bonded character (affinity ≥ 80) who is unsafe at night triggers movement aid.
    // Being adjacent provides the +3/s safety bonus in character.js need updates.
    // Only triggers when self has enough energy; avoids creating rescue-death spirals.
    if (isNight && character.needs.energy > 50 && character.relationships && character.relationships.size > 0) {
        const _aidChars = (typeof window !== 'undefined' && window.characters) ? window.characters : [];
        for (const [otherId, aff] of character.relationships.entries()) {
            if (aff >= 80) { // bonded only
                const other = _aidChars.find(c => c.id === otherId && c.state !== 'dead');
                if (other && other.needs.safety < 30) {
                    const d = Math.abs(character.gridPos.x - other.gridPos.x) + Math.abs(character.gridPos.z - other.gridPos.z);
                    if (d <= 10 && d > 1) { // detect within 10 tiles, skip if already adjacent
                        const adj = character.findAdjacentSpot && character.findAdjacentSpot(other.gridPos);
                        if (adj) {
                            character.log(`Action: WANDER toward bonded #${otherId} in danger (safety=${other.needs.safety.toFixed(0)})`);
                            character.setNextAction('WANDER', null, adj);
                            return;
                        }
                    }
                }
            }
        }
    }

    // === PRIORITY 7: ENERGY MANAGEMENT ===
    // bravery direction fix: low bravery → high rest threshold (cautious, conserves energy);
    //                        high bravery → low rest threshold (pushes through fatigue).
    if (character.needs.energy < effectiveRestThreshold) {
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
        character.log('Action: REST (tired fallback, no shelter found)');
        character.setNextAction('REST');
        return;
    }

    // === PRIORITY 8: FOOD COLLECTION (resourcefulness: proactive characters forage earlier) ===
    // resourcefulness direction: high (1.7) → threshold 84 (eats proactively, before getting hungry);
    //                            low  (0.3) → threshold 56 (waits until quite hungry).
    // Formula: 70 + (resourcefulness - 1.0) * 20. Removed Math.min(1.0, ...) cap so trait has full range.
    const hungerCollectionThreshold = clamp(
        70 + ((character.personality.resourcefulness ?? 1.0) - 1.0) * 20 + (adapt.forage * 15),
        30, 90);
    if (character.needs.hunger < hungerCollectionThreshold) {
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
    if (character.needs.social < socialDriftThreshold
        && character.needs.energy > (effectiveEnergyEmergency + 6)
        && character.needs.hunger > 25) {
        const partner = character.findClosestPartner();
        if (partner) {
            character.setNextAction('SOCIALIZE', partner, partner.gridPos);
            return;
        } else if (character.needs.energy > readyToRoamThreshold && character.needs.hunger > 45) {
            character.setNextAction('WANDER');
            return;
        }
    }

    // === PRIORITY 10: PRODUCTIVE WORK (Random chance) ===
    if (Math.random() < 0.3 * character.personality.diligence * (aging.workMul || 1.0)) {
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
    if (character.needs.energy < readyToRoamThreshold && character.needs.hunger > 20) {
        character.setNextAction('REST');
        character.log('Action: REST (preserve energy, skip default wander)');
        return;
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
