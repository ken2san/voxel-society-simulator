// --- 落下先が安全か（抜け出せるか）判定 ---

import * as THREE from 'three';
import { worldData, BLOCK_TYPES, ITEM_TYPES, blockMaterials, gridSize, findGroundY, addBlock, removeBlock, spawnCharacter, maxHeight, pickDistrictMoveTargetForCharacter } from './world.js';
import { decideNextAction_rulebase } from './AI_rulebase.js';
import { decideNextAction_utility } from './AI_utility.js';
import { chooseClosestTarget, simpleNeedsPriority } from './character_ai.js';

// --- Helper: 3Dオブジェクトのワールド座標をスクリーン座標に変換 ---
function toScreenPosition(obj, camera, canvas = null) {
    if (!obj || !camera || obj.visible === false) return null;
    // obj: THREE.Object3D, camera: THREE.Camera, canvas: HTMLCanvasElement
    const vector = new THREE.Vector3();
    obj.updateMatrixWorld();
    vector.setFromMatrixPosition(obj.matrixWorld);
    vector.project(camera);

    // Outside the camera frustum or behind the camera: do not show DOM overlays.
    if (!Number.isFinite(vector.x) || !Number.isFinite(vector.y) || !Number.isFinite(vector.z)) return null;
    if (vector.z < -1 || vector.z > 1) return null;

    let rect = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    if (!canvas) {
        canvas = document.getElementById('gameCanvas');
    }
    if (canvas && typeof canvas.getBoundingClientRect === 'function') {
        rect = canvas.getBoundingClientRect();
    }
    const x = (vector.x + 1) / 2 * rect.width + rect.left;
    const y = (1 - vector.y) / 2 * rect.height + rect.top;
    const margin = 24;
    if (x < rect.left - margin || x > rect.left + rect.width + margin || y < rect.top - margin || y > rect.top + rect.height + margin) {
        return null;
    }
    return { x, y };
}
// charactersはグローバル参照のまま（循環参照回避のため）


// 家タイプごとの設定（今後拡張しやすい形で）
const HOME_TYPES = {
    wood: {
        bed: 'BED',
        wall: 'HOUSE_WALL',
        roof: 'HOUSE_ROOF',
        wallPositions: [
            {dx: -1, dy: 0, dz: 0}, {dx: 1, dy: 0, dz: 0},
            {dx: 0, dy: 0, dz: -1}, {dx: 0, dy: 0, dz: 1},
            {dx: -1, dy: 1, dz: 0}, {dx: 1, dy: 1, dz: 0},
            {dx: 0, dy: 1, dz: -1}, {dx: 0, dy: 1, dz: 1}
        ],
        roofPosition: {dx: 0, dy: 2, dz: 0}
    },
    stone: {
        bed: 'BED',
        wall: 'HOUSE_WALL',
        roof: 'HOUSE_ROOF',
        wallArea: 1, // 周囲1マス
        roofArea: 1
    },
    underground: {
        bed: 'BED',
        wall: 'HOUSE_WALL',
        roof: null // 屋根なし
    }
};

class Character {
    // --- 家完成処理の共通化 ---
    completeHomeBuild(type, pos) {
        // type: 'wood' | 'stone' | 'underground'
        // pos: {x, y, z}
        const config = HOME_TYPES[type];
        const bedBlock = BLOCK_TYPES[config.bed];
        const wallBlock = BLOCK_TYPES[config.wall];
        const roofBlock = config.roof ? BLOCK_TYPES[config.roof] : null;
        // ベッド設置
        if (typeof addBlock === 'function' && bedBlock) {
            addBlock(pos.x, pos.y, pos.z, bedBlock, true);
            this.log('Placed bed block at', pos);
        }
        // 壁・屋根設置
        if (wallBlock) {
            if (type === 'wood') {
                // 設定駆動で壁設置
                for (const rel of config.wallPositions) {
                    const wx = pos.x + rel.dx, wy = pos.y + rel.dy, wz = pos.z + rel.dz;
                    const key = `${wx},${wy},${wz}`;
                    if (!worldData.has(key)) {
                        addBlock(wx, wy, wz, wallBlock, true);
                        this.log('Placed wall block at', { x: wx, y: wy, z: wz });
                    }
                }
                // 設定駆動で屋根設置
                if (config.roofPosition && roofBlock) {
                    const rx = pos.x + config.roofPosition.dx, ry = pos.y + config.roofPosition.dy, rz = pos.z + config.roofPosition.dz;
                    const roofKey = `${rx},${ry},${rz}`;
                    if (!worldData.has(roofKey)) {
                        addBlock(rx, ry, rz, roofBlock, true);
                        this.log('Placed roof block at', { x: rx, y: ry, z: rz });
                    }
                }
            } else if (type === 'stone') {
                // 設定駆動で壁設置
                const area = config.wallArea || 1;
                for (let dx = -area; dx <= area; dx++) {
                    for (let dz = -area; dz <= area; dz++) {
                        if (dx === 0 && dz === 0) continue;
                        const wx = pos.x + dx, wy = pos.y, wz = pos.z + dz;
                        const wallKey = `${wx},${wy},${wz}`;
                        if (!worldData.has(wallKey)) {
                            addBlock(wx, wy, wz, wallBlock, true);
                        }
                    }
                }
                // 設定駆動で屋根設置
                const roofArea = config.roofArea || 1;
                if (roofBlock) {
                    for (let dx = -roofArea; dx <= roofArea; dx++) {
                        for (let dz = -roofArea; dz <= roofArea; dz++) {
                            const rx = pos.x + dx, ry = pos.y + 1, rz = pos.z + dz;
                            const roofKey = `${rx},${ry},${rz}`;
                            if (!worldData.has(roofKey)) {
                                addBlock(rx, ry, rz, roofBlock, true);
                            }
                        }
                    }
                }
            } else if (type === 'underground') {
                // 設定駆動で壁設置（地下シェルターは上に1マス壁）
                addBlock(pos.x, pos.y + 1, pos.z, wallBlock, true);
            }
        }
        // 完了共通処理
        this.homePosition = pos;
        this.provisionalHome = null;
        if (type === 'wood' || type === 'stone') {
            this.buildCount = (this.buildCount || 0) + 1;
        }
        // フラグリセット
        if (type === 'underground') {
            this._diggingShelter = false;
            this._shelterLocation = null;
            this._provisionalHomeCount = 0;
            this.showActionIcon('🏠✨', 3.0);
        } else if (type === 'stone') {
            this._buildingStoneHome = false;
            this._stoneHomeLocation = null;
            this._provisionalHomeCount = 0;
            this.showActionIcon('🏠🗿', 3.0);
        } else if (type === 'wood') {
            // 木の家完成時はインベントリクリア処理を削除（buildHome内で既に処理済み）
            this.showActionIcon('🏠', 3.0);
        }
        this.log(`Construction complete! type=${type} buildCount=${this.buildCount || 0}`, this.homePosition);
        this._buildingProgress = 0;
        this._buildingStage = 0;
        this._diggingProgress = 0;
        this._diggingStage = 0;
        this.state = 'idle';
        this.action = null;
        this.actionCooldown = (type === 'wood') ? 3.0 : 1.0;
    }
    // --- 夜間に安全かどうか判定 ---
    isSafe(isNight) {
        if (!isNight) return true;
        // 頭上2マス以内にブロックがあれば安全
        for (let i = 1; i <= 2; i++) {
            const above = worldData.get(`${this.gridPos.x},${this.gridPos.y + i},${this.gridPos.z}`);
            if (above && ((typeof above === 'object' && above.cave) || (typeof above === 'number' && above !== BLOCK_TYPES.AIR.id))) {
                return true;
            }
        }
        // 現在地が洞窟エアブロックなら安全
        const here = worldData.get(`${this.gridPos.x},${this.gridPos.y},${this.gridPos.z}`);
        if (here && typeof here === 'object' && here.cave) return true;
        return false;
    }

    // Consolidate repeated idle-transition logic used across action handlers.
    setIdleState({ clearAction = false, cooldown = null } = {}) {
        this.state = 'idle';
        if (clearAction) this.action = null;
        if (cooldown !== null) this.actionCooldown = cooldown;
    }

    setNavigationTarget(targetPos) {
        if (targetPos && targetPos.x !== undefined && targetPos.y !== undefined && targetPos.z !== undefined) {
            this.targetPos = { x: targetPos.x, y: targetPos.y, z: targetPos.z };
        } else {
            this.targetPos = null;
        }
        this.lastTargetPos = null;
    }

    clearNavigationTarget() {
        this.setNavigationTarget(null);
    }

    clearNavigationState({ clearTarget = true, resetBlockedRetry = false } = {}) {
        if (clearTarget) {
            this.clearNavigationTarget();
        } else {
            this.lastTargetPos = null;
        }
        this.path = [];
        if (resetBlockedRetry) this._blockedRetryCount = 0;
    }

    runWorkAction(actionType = this.action?.type) {
        switch (actionType) {
            case 'BUILD_HOME':    this.buildHome();    return true;
            case 'CRAFT_TOOL':   this.craftTool();    return true;
            case 'DESTROY_BLOCK': this.destroyBlock(); return true;
            default: return false;
        }
    }

    // --- 現在のアクションを実行する ---
    performAction() {
        this.log('⚡ performAction called:', this.action?.type);
        if (!this.action || !this.action.type) {
            this.setIdleState();
            return;
        }
        switch (this.action.type) {
            case 'WANDER':
                // 徘徊状態に遷移
                this.state = 'moving';
                break;
            case 'SOCIALIZE':
                // 社交状態に遷移
                this.state = 'socializing';
                // パートナーも同時に社交状態にする
                const partner = this.action.target;
                if (partner && partner !== this) {
                    // パートナーの緊急ニーズをチェック
                    const hungerEmergency = (typeof window !== 'undefined' && window.hungerEmergencyThreshold !== undefined) ? Number(window.hungerEmergencyThreshold) : 5;
                    const energyEmergency = (typeof window !== 'undefined' && window.energyEmergencyThreshold !== undefined) ? Number(window.energyEmergencyThreshold) : 20;
                    const partnerCritical = (partner.needs?.hunger <= (hungerEmergency + 2) || partner.needs?.energy <= (energyEmergency + 2));
                    if (partnerCritical) {
                        this.setIdleState({ clearAction: true, cooldown: 1.0 });
                        break;
                    }
                    // パートナーがdead/confused以外かつ緊急ニーズがなければsocializingにする
                    if (partner.state !== 'socializing' && partner.state !== 'dead' && partner.state !== 'confused') {
                        partner.setNextAction && partner.setNextAction('SOCIALIZE', this, this.gridPos);
                        partner.performAction && partner.performAction();
                    }
                }
                break;
            case 'COLLECT_FOOD':
                // 食料収集のため移動状態に遷移
                this.state = 'moving';
                break;
            case 'EAT':
                // 食事のため移動状態に遷移
                this.state = 'moving';
                break;
            case 'CHOP_WOOD':
                // 木材収集: 2ブロック以内なら即座に実行、それ以外は移動
                if (this.action.target) {
                    const dist = Math.abs(this.gridPos.x - this.action.target.x) +
                                Math.abs(this.gridPos.y - this.action.target.y) +
                                Math.abs(this.gridPos.z - this.action.target.z);
                    if (dist <= 2) {
                        this.log('⚡ CHOP_WOOD: Within range, starting work immediately');
                        this.state = 'working';
                    } else if (this.targetPos) {
                        this.log('⚡ CHOP_WOOD: Moving to target');
                        this.state = 'moving';
                    } else {
                        this.log('⚡ CHOP_WOOD: No path, starting work anyway');
                        this.state = 'working';
                    }
                } else {
                    this.log('⚡ CHOP_WOOD: No target, starting work anyway');
                    this.state = 'working';
                }
                break;
            case 'BUILD_HOME':
                // 家建設のため作業状態に遷移
                this.log('⚡ BUILD_HOME: Starting work immediately');
                this.state = 'working';
                break;
            case 'SEEK_SHELTER':
                // シェルター探索のため移動状態に遷移
                this.state = 'moving';
                break;
            case 'SEEK_SHELTER_TO_REST':
                // シェルターに移動し、そのまま休息へ入る
                this.state = 'moving';
                break;
            case 'REST':
                // 休息状態に遷移
                this.state = 'resting';
                break;
            case 'CRAFT_TOOL':
                // 道具作成のため作業状態に遷移
                this.state = 'working';
                break;
            case 'DESTROY_BLOCK':
                // ブロック破壊: targetPosが設定されていない場合は隣接しているので即座に実行
                if (this.targetPos) {
                    this.log('⚡ DESTROY_BLOCK: Moving to target');
                    this.state = 'moving';
                } else {
                    this.log('⚡ DESTROY_BLOCK: Adjacent target, starting work immediately');
                    this.state = 'working';
                }
                break;
            case 'MEETING':
                // 会議状態に遷移
                this.state = 'meeting';
                this.actionCooldown = 3.0; // 3秒間会議
                break;
            // 必要に応じて他のアクションタイプも追加
            default:
                this.log('Unknown action type:', this.action.type);
                this.setIdleState();
                break;
        }
    }

    // --- 目的地到着後の実際のアクション実行 ---
    executeAction() {
        this.log('⚡ executeAction called:', this.action?.type);
        // Release reservation for this target (if we reserved it)
        if (this.action && this.action.target) {
            const rt = this.action.target;
            const rkey = `${rt.x},${rt.y},${rt.z}`;
            if (typeof window !== 'undefined' && window.worldReservations) {
                const res = window.worldReservations.get(rkey);
                if (res && res.owner === this.id) {
                    window.worldReservations.delete(rkey);
                }
            }
        }
        if (!this.action || !this.action.type) {
            this.setIdleState();
            return;
        }

        this.log('Executing action:', this.action.type, this.action);

        switch (this.action.type) {
            case 'WANDER':
                // WANDER action is completed by reaching the destination
                this.setIdleState({ clearAction: true, cooldown: 0.5 });
                break;
            case 'COLLECT_FOOD':
                this.collectFood();
                break;
            case 'EAT':
                this.eatFood();
                break;
            case 'CHOP_WOOD':
                this.chopWood();
                break;
            case 'BUILD_HOME':
            case 'CRAFT_TOOL':
            case 'DESTROY_BLOCK':
                this.runWorkAction(this.action.type);
                break;
            case 'SEEK_SHELTER':
                this.seekShelter();
                break;
            case 'SEEK_SHELTER_TO_REST':
                this.seekShelter();
                this.state = 'resting';
                break;
            case 'REST':
                this.state = 'resting';
                break;
            default:
                this.log('No execution handler for action:', this.action.type);
                this.setIdleState({ clearAction: true, cooldown: 0.5 });
                break;
        }
    }

    // --- 個別のアクション実行メソッド ---

    // アクションアイコンを表示
    showActionIcon(iconText, duration = 2.0) {
        if (!this.actionIconDiv) return;

        // Debounce rapid icon switches to avoid visual flicker.
        try {
            if (!this._lastActionIconTs) this._lastActionIconTs = 0;
            if (!this._lastActionIcon) this._lastActionIcon = null;
            const now = Date.now();
            const minIntervalMs = (typeof window !== 'undefined' && window.actionIconMinIntervalMs !== undefined) ? Number(window.actionIconMinIntervalMs) : 350;

            // If same icon being set too quickly, ignore to prevent flicker
            if (this._lastActionIcon === iconText && (now - this._lastActionIconTs) < minIntervalMs) {
                return;
            }

            // update last icon/time
            this._lastActionIcon = iconText;
            this._lastActionIconTs = now;
        } catch (e) { /* ignore */ }

        // Cancel any pending fade-out so we don't flicker or prematurely hide
        if (this._actionIconTimeout) {
            clearTimeout(this._actionIconTimeout);
            this._actionIconTimeout = null;
        }

        this.actionIconDiv.textContent = iconText;
        this.actionIconDiv.style.opacity = 1;
        this.actionIconDiv.style.transform = 'scale(1.2)'; // 少し大きく表示
        this.actionIconDiv.style.filter = 'drop-shadow(2px 2px 4px rgba(0,0,0,0.3))';

        // キャラクターの頭上に配置
        const screenPos = this.getScreenPosition();
        if (!screenPos) {
            this.actionIconDiv.style.opacity = 0;
            return;
        }
        this.actionIconDiv.style.left = (screenPos.x - 20) + 'px';
        this.actionIconDiv.style.top = (screenPos.y - 60) + 'px';

        // バウンスアニメーション: only re-run animation when enough time passed since last animation
        try {
            const animMinMs = (typeof window !== 'undefined' && window.actionIconAnimMinMs !== undefined) ? Number(window.actionIconAnimMinMs) : 300;
            if (!this._lastActionAnimTs) this._lastActionAnimTs = 0;
            if ((Date.now() - this._lastActionAnimTs) >= animMinMs) {
                this.actionIconDiv.style.animation = 'bounce 0.6s ease-out';
                this._lastActionAnimTs = Date.now();
            }
        } catch (e) { this.actionIconDiv.style.animation = 'bounce 0.6s ease-out'; }

        // 指定時間後にフェードアウト
        this._actionIconTimeout = setTimeout(() => {
            if (this.actionIconDiv) {
                this.actionIconDiv.style.opacity = 0;
                this.actionIconDiv.style.transform = 'scale(0.8) translateY(-10px)';
                this.actionIconDiv.style.animation = '';
            }
            this._actionIconTimeout = null;
        }, duration * 1000);
    }

    // スクリーン座標を取得
    getScreenPosition() {
        if (!this.mesh || !window.camera || !window.renderer || this.mesh.visible === false) return null;
        return toScreenPosition(this.iconAnchor || this.mesh, window.camera, window.renderer.domElement);
    }

    // アイテム種類に応じてcarriedItemMeshのマテリアルを変更
    updateCarriedItemAppearance(itemType) {
        if (!this.carriedItemMesh) return;

        let material;
        switch (itemType) {
            case 'FRUIT_ITEM':
                material = new THREE.MeshLambertMaterial({ color: 0xFF6B35 }); // オレンジ色（果実）
                break;
            case 'WOOD_LOG':
                material = new THREE.MeshLambertMaterial({ color: 0x8B4513 }); // 茶色（木材）
                break;
            case 'STONE_TOOL':
                material = new THREE.MeshLambertMaterial({ color: 0x696969 }); // グレー（石）
                break;
            default:
                material = new THREE.MeshLambertMaterial({ color: 0x8B4513 }); // デフォルト茶色
                break;
        }

        // 古いマテリアルを破棄して新しいマテリアルを設定
        if (this.carriedItemMesh.material) {
            this.carriedItemMesh.material.dispose();
        }
        this.carriedItemMesh.material = material;
    }

    collectFood() {
        if (!this.action.target) {
            this.log('COLLECT_FOOD: No target specified');
            this.state = 'idle';
            this.action = null;
            return;
        }

        const { x, y, z } = this.action.target;
        const key = `${x},${y},${z}`;
        const blockId = worldData.get(key);

        if (blockId) {
            const blockType = Object.values(BLOCK_TYPES).find(t => t.id === blockId);
            if (blockType && blockType.isEdible) {
                // 収集アニメーション
                this.showActionIcon('🍎', 1.0);

                // 食料ブロックを回収
                // Use reservation-based remove to avoid races
                this.reserveAndRemoveBlock(x, y, z);

                // インベントリに追加
                this.inventory[0] = 'FRUIT_ITEM';
                this.updateCarriedItemAppearance('FRUIT_ITEM'); // オレンジ色に変更
                this.carriedItemMesh.visible = true;

                this.log('Successfully collected food', { x, y, z });

                // 即座に食べる（美味しそうなアニメーション）
                setTimeout(() => {
                    this.showActionIcon('😋', 1.5);
                    this.inventory[0] = null;
                    this.carriedItemMesh.visible = false;
                    const inDanger = this.needs.hunger <= 15 || this.needs.energy <= 15;
                    this.needs.hunger = Math.min(100, this.needs.hunger + 40 + Math.random() * 20);
                    this.learn && this.learn({ type: 'ATE_FOOD', inDanger });
                    if (this._knownFoodSpots) this._knownFoodSpots.set(key, Date.now()); // remember this food spawn location
                    this.eatCount = (this.eatCount || 0) + 1;
                    this.log(`Meal complete! eatCount=${this.eatCount}, hunger=${this.needs.hunger.toFixed(1)}`);

                    // 満腹感の表現
                    setTimeout(() => {
                        if (this.needs.hunger > 80) {
                            this.showActionIcon('😊', 1.0);
                        }
                    }, 1000);

                    this.log('Ate collected food, hunger restored to', this.needs.hunger);
                }, 800);
            } else {
                this.log('COLLECT_FOOD: Target is not edible', { blockId, blockType });
            }
        } else {
            this.log('COLLECT_FOOD: Target block not found', { x, y, z });
        }

        this.state = 'idle';
        this.action = null;
        this.actionCooldown = 1.0;
    }

    eatFood() {
        // EATアクションはCOLLECT_FOODと同様の処理
        this.log('EAT_FOOD: meal started');
        this.collectFood();
    }

    chopWood() {
        this.log('⚡ CHOP_WOOD execution started', this.action);
        if (!this.action.target) {
            this.log('CHOP_WOOD: No target specified');
            this.state = 'idle';
            this.action = null;
            return;
        }

        // 段階的な伐採アニメーション
        if (!this._choppingProgress) {
            this._choppingProgress = 0;
            this._choppingStage = 0;
        }

        const { x, y, z } = this.action.target;
        const key = `${x},${y},${z}`;
        const blockId = worldData.get(key);

        // 範囲内チェック（2ブロック以内なら伐採可能）
        const dist = Math.abs(this.gridPos.x - x) + Math.abs(this.gridPos.y - y) + Math.abs(this.gridPos.z - z);
        if (dist > 2) {
            this.log('CHOP_WOOD: Target too far, distance:', dist);
            this.state = 'idle';
            this.action = null;
            this.actionCooldown = 1.0;
            return;
        }

        if (blockId) {
            const blockType = Object.values(BLOCK_TYPES).find(t => t.id === blockId);
            // 木ブロックまたは葉ブロックから木材を取得可能
            if (blockType && (blockType.name === 'Wood' || blockType.name === 'Leaf')) {
                this._choppingProgress += 1;

                // 段階的なアイコン表示（ブロックタイプに応じて変更）
                let stages;
                if (blockType.name === 'Leaf') {
                    stages = ['✂️', '🍃', '🍃💥', '🪵']; // 葉の場合
                } else {
                    stages = ['🪓', '⛏️', '🌲💥', '🪵']; // 木の幹の場合
                }
                const currentStage = Math.floor(this._choppingProgress / 2) % stages.length;
                if (currentStage !== this._choppingStage) {
                    this.showActionIcon(stages[currentStage], 0.8);
                    this._choppingStage = currentStage;
                }

            // 完了判定（7→10に変更でさらに時間をかける）
            if (this._choppingProgress >= 10) {
                // Use reservation-based remove to avoid races
                this.reserveAndRemoveBlock(x, y, z);

                // 1個の木材を取得（さらに控えめに調整）
                let woodAdded = 0;
                for (let i = 0; i < this.inventory.length && woodAdded < 1; i++) {
                    if (this.inventory[i] === null) {
                        this.inventory[i] = 'WOOD_LOG';
                        woodAdded++;
                    }
                }                    // carriedItemMeshを最初の非nullアイテムで更新
                    const firstItem = this.inventory.find(item => item !== null);
                    if (firstItem) {
                        this.updateCarriedItemAppearance(firstItem);
                        this.carriedItemMesh.visible = true;
                    }

                    // 完了アイコンをブロックタイプに応じて変更
                    if (blockType.name === 'Leaf') {
                        this.showActionIcon('✅🍃🪵', 3.0); // 葉から木材1個取得
                    } else {
                        this.showActionIcon('✅🪵', 3.0); // 木から木材1個取得
                    }
                    this.log(`Successfully chopped ${blockType.name} - got ${woodAdded} logs`, { x, y, z });

                    this._choppingProgress = 0;
                    this._choppingStage = 0;
                    this.state = 'idle';
                    this.action = null;
                    this.actionCooldown = 5.0; // クールダウンをさらに長く（3→5秒）
                }
                return;
            }
        }

        this.state = 'idle';
        this.action = null;
        this.actionCooldown = 1.0;
    }

    destroyBlock() {
        this.log('⚡ DESTROY_BLOCK execution started', this.action);
        if (!this.action.target) {
            this.log('DESTROY_BLOCK: No target specified');
            this.state = 'idle';
            this.action = null;
            return;
        }

        // 段階的な採掘アニメーション
        if (!this._diggingProgress) {
            this._diggingProgress = 0;
            this._diggingStage = 0;
            this.log('DESTROY_BLOCK: digging started');
        }

        const { x, y, z } = this.action.target;
        const key = `${x},${y},${z}`;
        const blockId = worldData.get(key);

        if (blockId) {
            this._diggingProgress += 1;

            // 段階的なアイコン表示とエフェクト
            const stages = ['⛏️', '💪⛏️', '💥⛏️', '🔥⛏️', '✨💎'];
            const currentStage = Math.floor(this._diggingProgress / 4) % stages.length;
            if (currentStage !== this._diggingStage) {
                this.showActionIcon(stages[currentStage], 0.6);
                this._diggingStage = currentStage;
                this.log(`Dig progress: ${this._diggingProgress}/18 [stage ${currentStage}]`);
            }

            // 完了判定
            if (this._diggingProgress >= 18) {
                const blockType = Object.values(BLOCK_TYPES).find(t => t.id === blockId);

                // Use reservation-based remove to avoid races
                this.reserveAndRemoveBlock(x, y, z);
                this.digCount = (this.digCount || 0) + 1;
                this.log(`Dig complete! digCount=${this.digCount}`);

                // 破壊したブロックからアイテムを取得
                if (blockType) {
                    if (blockType.name.includes('Fruit') || blockType.name === 'FRUIT') {
                        this.inventory[0] = 'FRUIT_ITEM';
                        this.updateCarriedItemAppearance('FRUIT_ITEM');
                        this.carriedItemMesh.visible = true;
                        this.log(`✅ Fruit item acquired! inventory=[${this.inventory[0]}] hunger=${this.needs.hunger.toFixed(1)}`);
                    } else if (blockType.name.includes('Stone')) {
                        // 石は直接使用するか、道具作成に使用
                        this.showActionIcon('🗿💥', 2.0);
                        this.log('Destroyed stone block');
                    } else if (blockType.name.includes('Dirt')) {
                        this.showActionIcon('🟫💨', 1.5);
                        this.log('Destroyed dirt block');
                    } else {
                        this.showActionIcon('✅⛏️', 1.5);
                        this.log('Destroyed unknown block:', blockType.name);
                    }
                } else {
                    this.showActionIcon('✅⛏️', 1.5);
                }

                // 破壊したブロックの種類に基づいて異なるエフェクト
                if (blockType) {
                    if (blockType.name.includes('Stone')) {
                        this.showActionIcon('🗿💥', 2.0);
                    } else if (blockType.name.includes('Dirt')) {
                        this.showActionIcon('🟫💨', 1.5);
                    } else {
                        this.showActionIcon('✅⛏️', 1.5);
                    }
                }

                this.log('Successfully destroyed block', { x, y, z });

        // 地下シェルター建設チェック
        if (this._diggingShelter && this._shelterLocation) {
            const shelterKey = `${this._shelterLocation.x},${this._shelterLocation.y},${this._shelterLocation.z}`;
            const targetKey = `${x},${y},${z}`;
            if (shelterKey === targetKey) {
                // 地下シェルター完成（共通化メソッド呼び出し）
                this.completeHomeBuild('underground', this._shelterLocation);
            }
        }

        // 石の家建設チェック
        if (this._buildingStoneHome && this._stoneHomeLocation) {
            const stoneKey = `${this._stoneHomeLocation.x},${this._stoneHomeLocation.y},${this._stoneHomeLocation.z}`;
            const targetKey = `${x},${y},${z}`;
            if (stoneKey === targetKey) {
                // 石の家完成（共通化メソッド呼び出し）
                this.completeHomeBuild('stone', this._stoneHomeLocation);
            }
        }

                this._diggingProgress = 0;
                this._diggingStage = 0;
                this.state = 'idle';
                this.action = null;
                this.actionCooldown = 1.0;
            }
            return;
        }

        this.log('DESTROY_BLOCK: target block not found');
        this.state = 'idle';
        this.action = null;
        this.actionCooldown = 1.0;
    }

    craftTool() {
        // 段階的な道具作成アニメーション
        if (!this._craftingProgress) {
            this._craftingProgress = 0;
            this._craftingStage = 0;
            this.log('CRAFT_TOOL: crafting started');
        }

        // 材料チェック: 木材と石が必要
        const hasWood = this.inventory.some(item => item === 'WOOD_LOG');
        const hasStone = this.hasStoneNearby();

        if (!hasWood) {
            this.log('CRAFT_TOOL: Need wood log to craft tool');
            this.state = 'idle';
            this.action = null;
            this.actionCooldown = 1.0;
            return;
        }

        if (!hasStone) {
            this.log('CRAFT_TOOL: Need stone nearby to craft tool');
            // 石を探しに行く
            const stonePos = this.findClosestStone();
            if (stonePos) {
                this.setNextAction('CHOP_WOOD', stonePos, stonePos); // CHOP_WOODを流用して石を取りに行く
                return;
            }
            this.state = 'idle';
            this.action = null;
            this.actionCooldown = 1.0;
            return;
        }

        // 段階的な制作プロセス
        this._craftingProgress += 1;

        const stages = ['🔨', '🪚', '⚒️', '🛠️', '✨🔧'];
        const currentStage = Math.floor(this._craftingProgress / 4) % stages.length;

        if (currentStage !== this._craftingStage) {
            this.showActionIcon(stages[currentStage], 1.0);
            this._craftingStage = currentStage;
            this.log(`Crafting progress: ${this._craftingProgress}/20 [stage ${currentStage}]`);
        }

        // 完了判定（35→20に短縮で道具作成を高速化）
        if (this._craftingProgress >= 20) {
            // 材料を消費して道具作成
            // 木材を消費
            const woodIndex = this.inventory.findIndex(item => item === 'WOOD_LOG');
            if (woodIndex !== -1) {
                this.inventory[woodIndex] = 'STONE_TOOL';
                this.log('Consumed wood to craft tool');
            } else {
                // 空きスロットに道具を作成
                const emptyIndex = this.inventory.findIndex(item => item === null);
                if (emptyIndex !== -1) {
                    this.inventory[emptyIndex] = 'STONE_TOOL';
                }
            }

            this.updateCarriedItemAppearance('STONE_TOOL'); // グレーに変更
            this.carriedItemMesh.visible = true;
            this.showActionIcon('🎉⚒️', 2.5);
            this.log('Tool crafting complete!', 'STONE_TOOL');

            this._craftingProgress = 0;
            this._craftingStage = 0;
            this.state = 'idle';
            this.action = null;
            this.actionCooldown = 3.0; // 作成時間を長くする
        }
    }

    buildHome() {
        // 段階的な建築アニメーション
        if (!this._buildingProgress) {
            this._buildingProgress = 0;
            this._buildingStage = 0;
            this.log('BUILD_HOME: construction started');
        }

        // 家建設の処理 - 木材の在庫数をチェック
        const woodCount = this.inventory.filter(item => item === 'WOOD_LOG').length;

        if (woodCount > 0) {
            // より慎重な建築進行（+1）
            this._buildingProgress += 1;

            // 段階的な建築アイコン表示
            const stages = ['🔨', '🏗️', '🧱', '🏠', '✨🏡'];
            const currentStage = Math.floor(this._buildingProgress / 3) % stages.length;

            if (currentStage !== this._buildingStage) {
                this.showActionIcon(stages[currentStage], 1.0);
                this._buildingStage = currentStage;
                this.log(`Build progress: ${this._buildingProgress}/15 [stage ${currentStage}] wood: ${woodCount}`);
            }

            // 15進捗で木材を1つ消費（木材1個で家完成）
            if (this._buildingProgress >= 15 && woodCount > 0) {
                // 木材を1つ削除
                const woodIndex = this.inventory.findIndex(item => item === 'WOOD_LOG');
                if (woodIndex !== -1) {
                    this.inventory[woodIndex] = null;
                    this.log(`Used 1 wood (remaining: ${woodCount - 1})`);

                    // インベントリの表示を更新（10スロット対応）
                    const nextItem = this.inventory.find(item => item !== null);
                    if (nextItem) {
                        this.updateCarriedItemAppearance(nextItem);
                        this.carriedItemMesh.visible = true;
                    } else {
                        this.carriedItemMesh.visible = false;
                    }
                }
            }

            // 完了判定（必要進捗を15に変更、より長い建設時間）
            if (this._buildingProgress >= 15) {
                // 建設アイコンを表示
                this.showActionIcon('🏠', 3.0);

                // 残りの木材を全部消費
                for (let i = 0; i < this.inventory.length; i++) {
                    if (this.inventory[i] === 'WOOD_LOG') {
                        this.inventory[i] = null;
                    }
                }
                // インベントリに何か残っていれば表示、なければ非表示
                const remainingItem = this.inventory.find(item => item !== null);
                if (remainingItem) {
                    this.updateCarriedItemAppearance(remainingItem);
                    this.carriedItemMesh.visible = true;
                } else {
                    this.carriedItemMesh.visible = false;
                }

                // 共通化メソッドで家完成処理
                const bedPos = { ...this.gridPos };
                this.completeHomeBuild('wood', bedPos);

                // ベッドを設置したら1マス隣に移動（壁を避ける）
                const directions = [
                    {dx: 2, dz: 0}, {dx: -2, dz: 0},
                    {dx: 0, dz: 2}, {dx: 0, dz: -2},
                    {dx: 1, dz: 0}, {dx: -1, dz: 0},
                    {dx: 0, dz: 1}, {dx: 0, dz: -1}
                ];
                for (const dir of directions) {
                    const newX = this.gridPos.x + dir.dx;
                    const newZ = this.gridPos.z + dir.dz;
                    const newY = this.gridPos.y;
                    const key = `${newX},${newY},${newZ}`;
                    const below = `${newX},${newY-1},${newZ}`;

                    // 移動先が空いていて足場があるかチェック
                    if (!worldData.has(key) && worldData.has(below)) {
                        this.gridPos = { x: newX, y: newY, z: newZ };
                        this.updateWorldPosFromGrid();
                        break;
                    }
                }

                this._buildingProgress = 0;
                this._buildingStage = 0;
                this.state = 'idle';
                this.action = null;
                this.actionCooldown = 12.0; // 建設後は非常に長い休憩（8→12秒）
            }
            return;
        }

        this.log('BUILD_HOME: no wood available');
        this.state = 'idle';
        this.action = null;
        this.actionCooldown = 3.0;
    }

    seekShelter() {
        // シェルター到達時の処理
        this.log('Reached shelter');
        this.state = 'resting';
        this.action = null;
    }

    setNextAction(type, target = null, moveTo = null, item = null) {
        // Record timestamp for important actions
        if (['BUILD_HOME', 'CHOP_WOOD', 'DESTROY_BLOCK'].includes(type)) {
            this._lastActionTime = Date.now();
            this._lastImportantActionTime = this._lastActionTime;
            this.log(`⚡ Setting important action: ${type} (protected for 1 second)`);
        }

        // 行動履歴を記録
        if (!this.actionHistory) this.actionHistory = [];
        this.actionHistory.push(type);
        if (this.actionHistory.length > 20) this.actionHistory.shift();

        // Prefer bounded-rational movement: bias wandering toward higher-opportunity districts,
        // but keep each actual step local and reachable so behavior stays legible.
        if (type === 'WANDER' && !moveTo) {
            const districtIntent = pickDistrictMoveTargetForCharacter(this);
            const socialAnchor = this.getPreferredSupportTarget ? this.getPreferredSupportTarget() : null;
            const { nearbyRadius } = this.getSupportModelParams();
            const candidateRange = districtIntent ? 4 : (socialAnchor ? Math.max(2, nearbyRadius) : 2);
            const candidates = this._getReachableGridCandidates(candidateRange, true, districtIntent ? 18 : (socialAnchor ? 14 : 10));
            if (candidates.length > 0) {
                let selectedMoveTo = candidates[Math.floor(Math.random() * candidates.length)];
                if (districtIntent?.targetPos || socialAnchor?.targetPos) {
                    const ranked = candidates
                        .map(candidate => {
                            let score = Math.random() * 1.35;
                            if (districtIntent?.targetPos) {
                                score +=
                                    Math.abs(candidate.x - districtIntent.targetPos.x) +
                                    Math.abs(candidate.y - districtIntent.targetPos.y) +
                                    Math.abs(candidate.z - districtIntent.targetPos.z);
                            }
                            if (socialAnchor?.targetPos) {
                                const pullWeight = Math.max(0.2, 1 - Number(socialAnchor.pullStrength || 0));
                                score += (
                                    Math.abs(candidate.x - socialAnchor.targetPos.x) +
                                    Math.abs(candidate.y - socialAnchor.targetPos.y) +
                                    Math.abs(candidate.z - socialAnchor.targetPos.z)
                                ) * pullWeight;
                            }
                            return { candidate, score };
                        })
                        .sort((a, b) => a.score - b.score);
                    const pool = ranked.slice(0, Math.min(socialAnchor ? 6 : 4, ranked.length));
                    selectedMoveTo = (pool[Math.floor(Math.random() * pool.length)] || ranked[0]).candidate;
                    if (districtIntent) {
                        this._lastDistrictChoice = {
                            districtIndex: districtIntent.districtIndex,
                            utility: Number(districtIntent.utility || 0),
                            commitment: Number(districtIntent.commitment || 0),
                            at: Date.now()
                        };
                    }
                }
                this.action = { type, target, item };
                this.setNavigationTarget(selectedMoveTo);
                this.state = 'moving';
                return;
            }
            // Fall through if there are no reachable candidates.
        }

        // Reservation and failed-target avoidance: if the target is a grid position, check reservations and failure counts
        if (target && target.x !== undefined && target.y !== undefined && target.z !== undefined) {
            const tkey = `${target.x},${target.y},${target.z}`;
            // If this target is known to have repeated failures, skip it
            // Check temporary blacklist first
            if (Character.isBlacklisted(tkey)) {
                this.log('Skipping blacklisted target:', tkey);
                this.setNextAction('WANDER');
                return;
            }
            const failCount = Character.getFailedCount(tkey) || 0;
            if (failCount >= 3) {
                this.log('Skipping frequently failing target:', tkey, 'failCount=', failCount);
                // Fallback to wander
                this.setNextAction('WANDER');
                return;
            }

            // Use reservation utility which performs TTL cleanup
            const existing = Character.getReservation(tkey);
            if (existing && existing.owner !== this.id) {
                this.log('Target reserved by another, falling back to WANDER:', tkey);
                this.setNextAction('WANDER');
                return;
            }

            // Try to reserve; if reservation fails (race), fallback
            const reserved = Character.reserveTarget(tkey, this.id, 3000);
            if (!reserved) {
                this.log('Failed to reserve target (race), falling back to WANDER:', tkey);
                this.setNextAction('WANDER');
                return;
            }
        }

        this.action = { type, target, item };
        if (moveTo && type !== 'SOCIALIZE') {
            this.setNavigationTarget(moveTo);
            this.state = 'moving';
        } else if (type === 'SOCIALIZE' && moveTo) {
            // SOCIALIZE should approach a reachable adjacent spot, not the partner's occupied tile.
            const partnerPos = target?.gridPos || moveTo;
            const dist = Math.abs(this.gridPos.x - partnerPos.x) + Math.abs(this.gridPos.y - partnerPos.y) + Math.abs(this.gridPos.z - partnerPos.z);
            if (dist <= 1) {
                this.performAction();
            } else {
                const socialSpot = this.findAdjacentSpot(partnerPos) || moveTo;
                this.setNavigationTarget(socialSpot);
                this.state = 'moving';
            }
        } else {
            // moveTo が null または undefined の場合は移動不要
            // targetPos をクリアして即座にアクション実行
            this.clearNavigationTarget();
            this.performAction();
        }
    }

// Duplicate class declaration removed
    // --- 失敗ターゲット記憶用: 食料採集失敗時に同じ座標を避ける (TTL 90s) ---
    static failedFoodTargets = new Map(); // key → timestamp; auto-expires after 90s
    // --- 汎用失敗ターゲットカウント: 失敗回数をカウントして一時的にブラックリスト化 ---
    static failedTargetCounts = new Map();

    // --- Failed target counter with TTL/decay ---
    // Stores entries as key -> { count, lastFailTs }
    static incrFailedTarget(key) {
        const now = Date.now();
        const prev = Character.failedTargetCounts.get(key) || { count: 0, lastFailTs: 0 };
        const decayInterval = (typeof window !== 'undefined' && window.failedDecayIntervalMs) ? window.failedDecayIntervalMs : 30000;
        const delta = (now - (prev.lastFailTs || 0));
        // If last failure was long ago, decay the count
        let base = prev.count || 0;
        if (delta > decayInterval) {
            base = Math.max(0, base - Math.floor(delta / decayInterval));
        }
        const next = { count: base + 1, lastFailTs: now };
        Character.failedTargetCounts.set(key, next);
        // If threshold reached, mark temporary blacklist
    const threshold = (typeof window !== 'undefined' && window.failedTargetThreshold) ? window.failedTargetThreshold : 3;
    const blacklistMs = (typeof window !== 'undefined' && window.failedTargetBlacklistMs) ? window.failedTargetBlacklistMs : 30000;
        if (next.count >= threshold) {
            // attach blacklistUntil to entry
            next.blacklistUntil = now + blacklistMs;
            Character.failedTargetCounts.set(key, next);
            // store in separate quick lookup if desired (we keep it on same entry)
            return -1; // signal that blacklist was set
        }
        return next.count;
    }

    static getFailedCount(key) {
        const entry = Character.failedTargetCounts.get(key);
        if (!entry) return 0;
        // Apply decay on read
        const now = Date.now();
        const decayInterval = (typeof window !== 'undefined' && window.failedDecayIntervalMs) ? window.failedDecayIntervalMs : 30000;
        const delta = now - entry.lastFailTs;
        let count = entry.count;
        if (delta > decayInterval) {
            count = Math.max(0, count - Math.floor(delta / decayInterval));
        }
        return count;
    }

    static clearFailedTarget(key) {
        Character.failedTargetCounts.delete(key);
    }

    // --- Blacklist helpers ---
    static isBlacklisted(key) {
        const entry = Character.failedTargetCounts.get(key);
        if (!entry) return false;
        if (entry.blacklistUntil && Date.now() < entry.blacklistUntil) return true;
        // expired? remove blacklistUntil
        if (entry.blacklistUntil && Date.now() >= entry.blacklistUntil) {
            delete entry.blacklistUntil;
            // optionally decay count a bit
            entry.count = Math.max(0, entry.count - 1);
            Character.failedTargetCounts.set(key, entry);
            return false;
        }
        return false;
    }

    static clearBlacklist(key) {
        const entry = Character.failedTargetCounts.get(key);
        if (!entry) return;
        delete entry.blacklistUntil;
        Character.failedTargetCounts.set(key, entry);
    }

    // --- Reservation utilities (global lightweight reservation system) ---
    // Reservations are stored in window.worldReservations as key -> { owner, ts, ttl }
    static reserveTarget(key, owner, ttl) {
        if (typeof window === 'undefined') return false;
        if (!window.worldReservations) window.worldReservations = new Map();
        // allow runtime override of default TTL
        if (ttl === undefined) ttl = (typeof window !== 'undefined' && window.worldReservationTTL) ? window.worldReservationTTL : 3000;
        // cleanup expired before reserving
        Character.cleanupReservations();
        const existing = window.worldReservations.get(key);
        if (existing && (Date.now() - existing.ts) < (existing.ttl || 0) && existing.owner !== owner) {
            return false; // already reserved by someone else
        }
        window.worldReservations.set(key, { owner, ts: Date.now(), ttl });
        return true;
    }

    static getReservation(key) {
        if (typeof window === 'undefined' || !window.worldReservations) return null;
        const r = window.worldReservations.get(key);
        if (!r) return null;
        if (Date.now() - r.ts > (r.ttl || 0)) {
            window.worldReservations.delete(key);
            return null;
        }
        return r;
    }

    static isReserved(key) {
        return !!Character.getReservation(key);
    }

    static releaseReservation(key, owner) {
        if (typeof window === 'undefined' || !window.worldReservations) return;
        const r = window.worldReservations.get(key);
        if (!r) return;
        // Only owner can release to avoid accidental deletions; allow release if owner matches
        if (!owner || r.owner === owner) {
            window.worldReservations.delete(key);
        }
    }

    static cleanupReservations() {
        if (typeof window === 'undefined' || !window.worldReservations) return;
        const now = Date.now();
        for (const [k, v] of Array.from(window.worldReservations.entries())) {
            if (!v || (v.ttl && (now - v.ts > v.ttl))) {
                window.worldReservations.delete(k);
            }
        }
    }
    // Instance helper: release any sidestep reservation this character currently holds
    releaseReservedSidestep() {
        try {
            if (this._reservedSidestepKey) {
                Character.releaseReservation(this._reservedSidestepKey, this.id);
                this._reservedSidestepKey = null;
            }
        } catch (e) { /* ignore */ }
    }

    // Try to reserve a block for digging, remove it if reserved, and release reservation.
    // Returns true if a block was actually removed, false otherwise.
    reserveAndRemoveBlock(x, y, z, opts = {}) {
        try {
            // Protect bottom layer from general deletion, but allow an explicit rescue override
            if (y <= 0 && !(opts && opts.allowBottomRescue)) {
                this.log('reserveAndRemoveBlock: prevented removal at bottom layer', {x, y, z});
                return false;
            }

            const key = `${x},${y},${z}`;
            // Ensure recent-dig map exists
            if (typeof window !== 'undefined' && !window._recentlyDug) window._recentlyDug = new Map();
            const recentMs = (typeof window !== 'undefined' && window.recentDigCooldownMs !== undefined) ? window.recentDigCooldownMs : 10000;
            const lastT = window._recentlyDug.get(key) || 0;
            if (Date.now() - lastT < recentMs) {
                this.log('Skip digging: recently attempted', key);
                // small cooldown to avoid busy loop
                this.actionCooldown = (typeof window !== 'undefined' && window.digActionCooldown !== undefined) ? window.digActionCooldown / 1000.0 : 1.5;
                return false;
            }

            // Try to reserve the target
            const ttl = (opts.ttl !== undefined) ? opts.ttl : ((typeof window !== 'undefined' && window.worldReservationTTL) ? window.worldReservationTTL : 5000);
            const reserved = Character.reserveTarget(key, this.id, ttl);
            if (!reserved) {
                this.log('reserveAndRemoveBlock: target reserved by other, skipping', key);
                try {
                    if (typeof window !== 'undefined') {
                        if (!window._digBlockFailCounts) window._digBlockFailCounts = new Map();
                        // mark failed attempt with a future-until timestamp (backoff) so others avoid retrying immediately
                        const backoff = (typeof window !== 'undefined' && window.digFailSkipMs !== undefined) ? Number(window.digFailSkipMs) : 4000;
                        window._digBlockFailCounts.set(key, Date.now() + backoff);
                    }
                } catch (e) {}
                this.actionCooldown = 1.0;
                return false;
            }

            // Double-check the block still exists and is diggable
            const blockId = worldData.get(key);
            if (!blockId) {
                this.log('reserveAndRemoveBlock: block already gone', key);
                Character.releaseReservation(key, this.id);
                return false;
            }
            const blockType = Object.values(BLOCK_TYPES).find(t => t.id === blockId);
            if (blockType && blockType.diggable) {
                // Perform the removal
                removeBlock && removeBlock(x, y, z);
                // Mark recent dig timestamp
                window._recentlyDug.set(key, Date.now());
                // clear any transient failed-dig mark for this block since it's now removed
                try { if (typeof window !== 'undefined' && window._digBlockFailCounts) window._digBlockFailCounts.delete(key); } catch (e) {}
                // Release reservation (only if we still own it)
                Character.releaseReservation(key, this.id);
                this.log('reserveAndRemoveBlock: removed block', {x, y, z});
                return true;
            }

            // Not diggable: release and return
            Character.releaseReservation(key, this.id);
            this.log('reserveAndRemoveBlock: block not diggable', key);
            return false;
        } catch (e) {
            try { Character.releaseReservation(`${x},${y},${z}`, this.id); } catch (e2) {}
            return false;
        }
    }
    // Schedule a short BFS retry window with per-character growth and jitter
    _scheduleShortBfsRetry() {
        try {
            if (!this._bfsShortRetryCount) this._bfsShortRetryCount = 0;
            this._bfsShortRetryCount = Math.min(8, (this._bfsShortRetryCount || 0) + 1);
            const base = (typeof window !== 'undefined' && window.bfsRetryBaseMs !== undefined) ? Number(window.bfsRetryBaseMs) : 150;
            const per = (typeof window !== 'undefined' && window.bfsShortRetryGrowthMs !== undefined) ? Number(window.bfsShortRetryGrowthMs) : 80;
            const jitterMax = (typeof window !== 'undefined' && window.bfsShortRetryJitterMs !== undefined) ? Number(window.bfsShortRetryJitterMs) : 200;
            const extra = Math.min(1000, this._bfsShortRetryCount * per);
            const jitter = Math.floor(Math.random() * jitterMax);
            this._bfsRetryUntil = Date.now() + base + extra + jitter;
        } catch (e) {
            try { this._bfsRetryUntil = Date.now() + 250; } catch (e2) {}
        }
    }
    // --- Personality trait distance (0 = identical, 1 = opposite extremes) ---
    // Uses the 6-trait vector; missing traits default to 1.0.
    static computeTraitDistance(p1, p2) {
        const TRAITS = ['bravery', 'diligence', 'sociality', 'curiosity', 'resourcefulness', 'resilience'];
        const TRAIT_RANGE = 1.4; // max possible difference per trait (0.3 to 1.7)
        let sumSq = 0;
        for (const t of TRAITS) {
            const a = p1[t] ?? 1.0;
            const b = p2[t] ?? 1.0;
            const d = (a - b) / TRAIT_RANGE;
            sumSq += d * d;
        }
        // Normalize to [0, 1]: max sumSq is TRAITS.length when all traits are at opposite extremes
        return Math.min(1, Math.sqrt(sumSq / TRAITS.length));
    }

    // --- Group detection and per-group leader election ---
    // Call this after any event that may change the social network (e.g., after death, reproduction, or periodically)
    static detectGroupsAndElectLeaders(characters) {
        if (!characters || characters.length === 0) return;
        // 1. Build affinity graph (affinity >= threshold)
        const affinityTh = (typeof window !== 'undefined' && window.groupAffinityThreshold !== undefined)
            ? window.groupAffinityThreshold : 50;
        const visited = new Set();
        let groupIdCounter = 1;
        for (const char of characters) {
            char.groupId = null;
            char.role = 'worker';
        }
        for (const char of characters) {
            if (char.groupId) continue;
            // BFS to find all connected by affinity >= threshold
            const queue = [char];
            char.groupId = groupIdCounter;
            let groupMembers = [char];
            while (queue.length > 0) {
                const current = queue.shift();
                for (const [otherId, affinity] of current.relationships.entries()) {
                    if (affinity < affinityTh) continue;
                    const other = characters.find(c => c.id === otherId);
                    if (other && !other.groupId) {
                        other.groupId = groupIdCounter;
                        queue.push(other);
                        groupMembers.push(other);
                    }
                }
            }
            // 2. Elect leader in this group
            if (groupMembers.length === 1) {
                // 1人グループはgroupIdもroleも外す
                groupMembers[0].groupId = null;
                groupMembers[0].role = 'worker';
            } else if (groupMembers.length > 1) {
                Character.electLeaderInGroup(groupMembers);
                groupIdCounter++;
            }
        }
        // --- グループ合併処理 ---
        Character.mergeGroupsIfPossible(characters);
        // --- デバッグ: 各キャラクターのグループIDと役割を出力 ---
        // for (const char of characters) {
        //     console.log(`Character ${char.id}: groupId=${char.groupId}, role=${char.role}`);
        // }
    }

    // グループ合併: リーダー同士が近く友好度が高い場合グループ統合
    static mergeGroupsIfPossible(characters) {
        // すべてのリーダーを抽出
        const leaders = characters.filter(c => c.role === 'leader');
        for (let i = 0; i < leaders.length; i++) {
            for (let j = i + 1; j < leaders.length; j++) {
                const a = leaders[i], b = leaders[j];
                // 近距離かつ友好度高い場合
                const dist = Math.abs(a.gridPos.x - b.gridPos.x) + Math.abs(a.gridPos.y - b.gridPos.y) + Math.abs(a.gridPos.z - b.gridPos.z);
                const affinity = a.relationships.get(b.id) || 0;
                if (dist <= 3 && affinity >= 70 && a.groupId !== b.groupId) {
                    // 小さいgroupIdに統一
                    const minId = Math.min(a.groupId, b.groupId);
                    const maxId = Math.max(a.groupId, b.groupId);
                    for (const char of characters) {
                        if (char.groupId === maxId) char.groupId = minId;
                    }
                    // 再選出
                    const merged = characters.filter(c => c.groupId === minId);
                    Character.electLeaderInGroup(merged);
                }
            }
        }
    }

    // Elect leader within a group (list of Character)
    static electLeaderInGroup(groupMembers) {
        // グループが1人だけならリーダーにしない
        if (groupMembers.length === 1) {
            groupMembers[0].role = 'worker';
            return;
        }
        let maxFriends = -1;
        let candidates = [];
        for (const char of groupMembers) {
            let friendCount = 0;
            for (const affinity of char.relationships.values()) {
                if (affinity >= 50) friendCount++;
            }
            if (friendCount > maxFriends) {
                maxFriends = friendCount;
                candidates = [char];
            } else if (friendCount === maxFriends) {
                candidates.push(char);
            }
        }
        // candidatesが空なら、強制的に最初の1人をリーダー候補に
        if (candidates.length === 0) {
            candidates = [groupMembers[0]];
        }
        // If tie, pick the one with highest total affinity
        let leader = candidates[0];
        let maxAffinity = -Infinity;
        for (const char of candidates) {
            let totalAffinity = 0;
            for (const affinity of char.relationships.values()) {
                totalAffinity += affinity;
            }
            if (totalAffinity > maxAffinity) {
                maxAffinity = totalAffinity;
                leader = char;
            }
        }
        // Assign roles in group
        for (const char of groupMembers) {
            char.role = (char === leader) ? 'leader' : 'worker';
        }
    }
    // --- Affinity-based leader election ---
    // Call this after any event that may change the social network (e.g., after death, reproduction, or periodically)
    // (Deprecated: use detectGroupsAndElectLeaders instead)
    static electLeader() {}
    // --- Visualize owned land: tint ground block under owned tiles ---
    visualizeOwnedLand() {
        // Only tint if three.js mesh exists and worldData/blockMaterials is available
        if (!this.ownedLand || !blockMaterials) return;
        for (const key of this.ownedLand) {
            const [x, y, z] = key.split(',').map(Number);
            // Find ground block just below y (if any)
            const belowKey = `${x},${y-1},${z}`;
            const blockId = worldData.get(belowKey);
            if (blockId && blockMaterials.has(blockId)) {
                let mat = blockMaterials.get(blockId);
                // --- マテリアルが共有されている場合は複製 ---
                if (mat && (!mat._isClonedForLand || !mat._ownerId || mat._ownerId !== this.id)) {
                    // 新しいマテリアルを作成し、色を設定
                    const clonedMat = mat.clone();
                    clonedMat._isClonedForLand = true;
                    clonedMat._ownerId = this.id;
                    // Tint by role: leader=blue, worker=green
                    if (this.role === 'leader') clonedMat.color.setRGB(0.3, 0.3, 0.8);
                    else clonedMat.color.setRGB(0.2, 0.7, 0.2);
                    // 対象のメッシュを探してマテリアルを差し替え
                    if (mat.meshes && mat.meshes.length > 0) {
                        for (const mesh of mat.meshes) {
                            if (mesh.position.x === x + 0.5 && mesh.position.y === y - 1 && mesh.position.z === z + 0.5) {
                                mesh.material = clonedMat;
                            }
                        }
                    }
                    // blockMaterialsにも登録（必要なら）
                    // blockMaterials.set(blockId, clonedMat); // ←全体差し替えはしない
                } else if (mat) {
                    // 既にクローン済みなら色だけ再設定
                    if (this.role === 'leader') mat.color.setRGB(0.3, 0.3, 0.8);
                    else mat.color.setRGB(0.2, 0.7, 0.2);
                }
            }
        }
    }
    // --- Land ownership: claim current position ---
    claimCurrentLand() {
        const key = `${this.gridPos.x},${this.gridPos.y},${this.gridPos.z}`;
        this.ownedLand.add(key);
    }

    // --- Check if a position is owned by another character ---
    isLandOwnedByOther(pos) {
        const key = `${pos.x},${pos.y},${pos.z}`;
        const chars = (typeof window !== 'undefined' && window.characters) ? window.characters : (typeof characters !== 'undefined' ? characters : []);
        for (const char of chars) {
            if (char.id !== this.id && char.ownedLand && char.ownedLand.has(key)) {
                return char;
            }
        }
        return null;
    }

    // --- Land contest: simple win/lose based on personality and needs ---
    contestLand(otherChar) {
        // Simple: higher bravery + energy wins
        const myScore = (this.personality.bravery * 0.7 + this.needs.energy * 0.3);
        const otherScore = (otherChar.personality.bravery * 0.7 + otherChar.needs.energy * 0.3);
        if (myScore > otherScore) {
            // Take over land
            for (const key of otherChar.ownedLand) {
                this.ownedLand.add(key);
            }
            otherChar.ownedLand.clear();
            // this.log('Won land contest against', otherChar.id);
        } else {
            // Retreat (wander)
            // this.log('Lost land contest against', otherChar.id);
            this.setNextAction('WANDER');
        }
    }

    // --- 指定座標に他キャラがいるか判定 ---
    isOccupiedByOther(x, y, z) {
        const chars = (typeof window !== 'undefined' && window.characters) ? window.characters : (typeof characters !== 'undefined' ? characters : []);
        for (const char of chars) {
            if (char.id !== this.id && char.gridPos.x === x && char.gridPos.y === y && char.gridPos.z === z) {
                return true;
            }
        }
        return false;
    }

    // --- BFSパスファインディング（超簡素化・必ず成功版）---
    // --- 移動候補列挙関数 ---
    _getMovableGridCandidates(range = 2, includeVertical = true) {
        const candidates = [];
        for (let dx = -range; dx <= range; dx++) {
            for (let dz = -range; dz <= range; dz++) {
                const dyRange = includeVertical ? [-1, 0, 1] : [0];
                for (const dy of dyRange) {
                    if (dx === 0 && dz === 0 && dy === 0) continue;
                    const x = this.gridPos.x + dx;
                    const y = this.gridPos.y + dy;
                    const z = this.gridPos.z + dz;

                    if (y < 0 || y > maxHeight) continue;

                    const key = `${x},${y},${z}`;
                    const below = `${x},${y-1},${z}`;

                    // 空きマスで、かつ足場がある場所
                    if (!worldData.has(key) && worldData.has(below)) {
                        candidates.push({x, y, z});
                    }
                }
            }
        }
        return candidates;
    }

    // --- 到達可能な移動候補のみ取得 ---
    _getReachableGridCandidates(range = 2, includeVertical = true, maxPathLength = 10) {
        const candidates = this._getMovableGridCandidates(range, includeVertical);
        const reachable = [];

        for (const candidate of candidates) {
            const path = this.bfsPath(this.gridPos, candidate, maxPathLength);
            if (path && path.length > 0) {
                reachable.push(candidate);
            }
        }
        return reachable;
    }

    // --- 移動方向を設定に基づいて構築 ---
    _getMovementDirections(allowDiagonal = true, allowVertical = true) {
        const dirs = [
            // 基本4方向（水平）
            {dx:1,dy:0,dz:0},{dx:-1,dy:0,dz:0},{dx:0,dy:0,dz:1},{dx:0,dy:0,dz:-1}
        ];

        // 垂直移動を許可する場合
        if (allowVertical) {
            dirs.push({dx:0,dy:1,dz:0},{dx:0,dy:-1,dz:0});
        }

        // 斜め移動を許可する場合
        if (allowDiagonal) {
            dirs.push(
                {dx:1,dy:0,dz:1},{dx:1,dy:0,dz:-1},{dx:-1,dy:0,dz:1},{dx:-1,dy:0,dz:-1}
            );

            // 垂直斜め移動
            if (allowVertical) {
                dirs.push(
                    {dx:1,dy:1,dz:0},{dx:-1,dy:1,dz:0},{dx:0,dy:1,dz:1},{dx:0,dy:1,dz:-1},
                    {dx:1,dy:-1,dz:0},{dx:-1,dy:-1,dz:0},{dx:0,dy:-1,dz:1},{dx:0,dy:-1,dz:-1}
                );
            }
        }

        return dirs;
    }

    // --- 当たり判定ヘルパーメソッド ---
    // Normalize stored worldData values to an id number (handles cave-air objects)
    _normalizeBlockVal(val) {
        if (val === undefined || val === null) return val;
        if (typeof val === 'object' && val.id !== undefined) return val.id;
        return val;
    }

    isBlockPassable(blockVal) {
        const blockId = this._normalizeBlockVal(blockVal);
        if (blockId === undefined || blockId === null) return true;

        const blockType = Object.values(BLOCK_TYPES).find(t => t.id === blockId);
        if (!blockType) return true;

        // Wood trunks are solid — characters must path around them, not through them.
        // Leaf blocks remain passable (visually thin, and blocking them causes BFS failures
        // in dense canopy where no clear route exists).
        const passableBlocks = ['Air', 'Leaf', 'Fruit'];
        return passableBlocks.includes(blockType.name) ||
               blockType.isBed ||
               blockId === BLOCK_TYPES.AIR?.id;
    }

    // --- 移動可能性チェック（当たり判定＋頭上チェック） ---
    canMoveToPosition(x, y, z) {
        // 移動先の障害物チェック
        const blockId = worldData.get(`${x},${y},${z}`);
        if (!this.isBlockPassable(blockId)) {
            return { canMove: false, reason: 'blocked_by_solid' };
        }

        // 頭上チェック（キャラクターの高さを考慮）
        const aboveBlockId = worldData.get(`${x},${y + 1},${z}`);
        if (!this.isBlockPassable(aboveBlockId)) {
            return { canMove: false, reason: 'blocked_by_ceiling' };
        }

        // Allow stepping up by 1 block if footing exists at destination or one below
        const dy = y - this.gridPos.y;
        if (dy > 1) return { canMove: false, reason: 'too_high' };
        if (dy === 1) {
            // require that destination has footing (block under it) or it's ground level
            const belowDest = `${x},${y-1},${z}`;
            if (!worldData.has(belowDest) && y !== 0) {
                return { canMove: false, reason: 'no_footing_for_step' };
            }
        }

        // Prevent walking into unsupported mid-air cells: require footing under destination
        // unless the destination itself is cave air or ground level
        const belowKey = `${x},${y-1},${z}`;
        const destVal = worldData.get(`${x},${y},${z}`);
        const destIsCave = destVal && typeof destVal === 'object' && destVal.cave;
        if (y > 0 && !worldData.has(belowKey) && !destIsCave) {
            return { canMove: false, reason: 'no_footing' };
        }

        // Don't step into a cell occupied by another character
        if (this.isOccupiedByOther(x, y, z)) return { canMove: false, reason: 'occupied_by_char' };

        return { canMove: true };
    }

    // Check only static solid collisions along a world-space segment.
    // Dynamic occupancy is intentionally ignored here to avoid congestion jitter.
    canTraverseWorldSegment(fromWorldPos, toWorldPos) {
        if (!fromWorldPos || !toWorldPos) return { canMove: true };
        const segment = toWorldPos.clone().sub(fromWorldPos);
        const length = segment.length();
        if (length <= 0.0001) return { canMove: true };

        const dir = segment.clone().normalize();
        // Sample every ~0.25 voxel to prevent tunneling through thin corners.
        const samples = Math.max(1, Math.ceil(length / 0.25));
        for (let i = 1; i <= samples; i++) {
            const t = i / samples;
            const sample = fromWorldPos.clone().add(dir.clone().multiplyScalar(length * t));
            const gx = Math.floor(sample.x);
            const gy = Math.floor(sample.y);
            const gz = Math.floor(sample.z);

            const bodyVal = worldData.get(`${gx},${gy},${gz}`);
            if (!this.isBlockPassable(bodyVal)) {
                return { canMove: false, reason: 'segment_blocked_by_solid', at: { x: gx, y: gy, z: gz } };
            }

            const headVal = worldData.get(`${gx},${gy + 1},${gz}`);
            if (!this.isBlockPassable(headVal)) {
                return { canMove: false, reason: 'segment_blocked_by_ceiling', at: { x: gx, y: gy + 1, z: gz } };
            }
        }

        return { canMove: true };
    }

    // When forward movement is blocked by static geometry, try sliding along one axis.
    // This keeps movement feeling less sticky around corners without allowing wall clipping.
    tryWallSlideMove(direction, moveDistance) {
        if (!direction || moveDistance <= 0) return null;

        const from = this.mesh?.position?.clone?.();
        if (!from) return null;

        const absX = Math.abs(direction.x || 0);
        const absZ = Math.abs(direction.z || 0);
        if (absX < 0.0001 && absZ < 0.0001) return null;

        const primaryAxis = absX >= absZ ? 'x' : 'z';
        const secondaryAxis = primaryAxis === 'x' ? 'z' : 'x';
        const axes = [primaryAxis, secondaryAxis];

        for (const axis of axes) {
            const axisDir = direction[axis] || 0;
            if (Math.abs(axisDir) < 0.0001) continue;

            const candidate = from.clone();
            candidate[axis] += Math.sign(axisDir) * moveDistance;

            const traverse = this.canTraverseWorldSegment(from, candidate);
            if (!traverse.canMove) continue;

            // Ensure the candidate cell itself is still a valid standing/moving cell.
            const gx = Math.floor(candidate.x);
            const gy = Math.floor(candidate.y);
            const gz = Math.floor(candidate.z);
            const check = this.canMoveToPosition(gx, gy, gz);
            if (!check.canMove) continue;

            return candidate;
        }

        return null;
    }

    // --- 統一された経路探索システム ---
    findPathTo(destination, options = {}) {
        const {
            maxSteps = 128,
            allowDiagonal = true,
            allowVertical = true,
            directMoveThreshold = 3
        } = options;

        return this.bfsPath(this.gridPos, destination, maxSteps, allowDiagonal, allowVertical, directMoveThreshold);
    }

    // --- BFS経路探索（統合版） ---
    bfsPath(start, goal, maxStep = 128, allowDiagonal = true, allowVertical = true, directMoveThreshold = 3) {
        // Greedy best-first search using heuristic (Manhattan). This is a small, low-risk change
        // that focuses exploration toward the goal and generally yields shorter, more natural paths
        // without full A* bookkeeping.
        const directDist = Math.abs(start.x - goal.x) + Math.abs(start.y - goal.y) + Math.abs(start.z - goal.z);
        if (directDist <= 1) return [goal];

        const key = (p) => `${p.x},${p.y},${p.z}`;
        const open = [{ pos: start, parent: null }];
        const parent = new Map();
        const visited = new Set();
        visited.add(key(start));
        let steps = 0;
        let bestCandidate = start;

        const heuristic = (p) => Math.abs(p.x - goal.x) + Math.abs(p.y - goal.y) + Math.abs(p.z - goal.z);

        while (open.length > 0 && steps < maxStep) {
            // sort by heuristic ascending (closest to goal first)
            open.sort((a, b) => heuristic(a.pos) - heuristic(b.pos));
            const node = open.shift();
            const cur = node.pos;
            steps++;
            const curKey = key(cur);

            const curH = heuristic(cur);
            if (curH < heuristic(bestCandidate)) bestCandidate = cur;

            if (cur.x === goal.x && cur.y === goal.y && cur.z === goal.z) {
                // reached goal
                const path = [];
                let c = cur;
                while (c && (c.x !== start.x || c.y !== start.y || c.z !== start.z)) {
                    path.push(c);
                    c = parent.get(key(c));
                }
                path.reverse();
                return path;
            }

            // expand neighbors
            const dirs = this._getMovementDirections(allowDiagonal, allowVertical);
            for (const d of dirs) {
                const nx = cur.x + d.dx, ny = cur.y + d.dy, nz = cur.z + d.dz;
                if (ny < 0 || ny > maxHeight) continue;
                const nkey = `${nx},${ny},${nz}`;
                if (visited.has(nkey)) continue;

                // basic filters same as before
                const blockId = worldData.get(nkey);
                if (!this.isBlockPassable(blockId)) continue;
                if (ny > 0) {
                    const below = `${nx},${ny-1},${nz}`;
                    const hasFooting = worldData.has(below);
                    if (!hasFooting && ny > 1) continue;
                }
                const aboveBlockId = worldData.get(`${nx},${ny+1},${nz}`);
                if (!this.isBlockPassable(aboveBlockId)) continue;
                if (d.dy > 0 && Math.abs(ny - cur.y) > 2) continue;
                // avoid stepping into a cell occupied by other characters
                if (this.isOccupiedByOther(nx, ny, nz)) continue;
                // diagonal corner check
                if (this._isDiagonalCornerMoveBlocked(cur, {x:nx,y:ny,z:nz})) continue;

                visited.add(nkey);
                parent.set(nkey, cur);
                open.push({ pos: { x: nx, y: ny, z: nz }, parent: cur });
            }
        }

        // no path found: try to return best candidate toward goal
        if (bestCandidate && (bestCandidate.x !== start.x || bestCandidate.y !== start.y || bestCandidate.z !== start.z)) {
            const path = [];
            let c = bestCandidate;
            while (c && (c.x !== start.x || c.y !== start.y || c.z !== start.z)) {
                path.push(c);
                c = parent.get(key(c));
            }
            path.reverse();
            return path.length > 0 ? path : null;
        }

        return null;
    }

    // --- シェルター探索（bak_game.js準拠）---
    findShelter(isNight) {
        // Look for empty spots with cover above, or cave air
        for (let dy = 0; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
                for (let dz = -2; dz <= 2; dz++) {
                    const x = this.gridPos.x + dx, y = this.gridPos.y + dy, z = this.gridPos.z + dz;
                    const key = `${x},${y},${z}`;
                    const val = worldData.get(key);
                    // Recognize cave air as shelter
                    if (val && typeof val === 'object' && val.cave) return {x, y, z};
                    if (!val) {
                        // 上にブロックがあるか
                        let covered = false;
                        for (let i = 1; i <= 2; i++) {
                            const above = worldData.get(`${x},${y+i},${z}`);
                            if (above && ((typeof above === 'object' && above.cave) || (typeof above === 'number' && above !== BLOCK_TYPES.AIR.id))) covered = true;
                        }
                        if (covered) return {x, y, z};
                    }
                }
            }
        }
        return null;
    }

    // --- 掘れる避難場所探索 ---
    findDiggableShelterSpot() {
        // 周囲の掘れるブロックで、上に空間があるもの
        for (let dy = 0; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
                for (let dz = -2; dz <= 2; dz++) {
                    const x = this.gridPos.x + dx, y = this.gridPos.y + dy, z = this.gridPos.z + dz;
                    const key = `${x},${y},${z}`;
                    const rawVal = worldData.get(key);
                    const blockId = this._normalizeBlockVal(rawVal);
                    const blockType = Object.values(BLOCK_TYPES).find(t => t.id === blockId);
                    if (blockType && blockType.diggable) {
                        // 上に空間
                        let air = true;
                        for (let i = 1; i <= 2; i++) {
                            if (worldData.has(`${x},${y+i},${z}`)) air = false;
                        }
                        if (air) return {x, y, z};
                    }
                }
            }
        }
        return null;
   }

    createMorphologyProfile(sourceTraits = this.appearanceProfile || this.personality) {
        const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
        const traits = sourceTraits || {};
        const bravery = traits.bravery ?? 1.0;
        const diligence = traits.diligence ?? 1.0;
        const sociality = traits.sociality ?? 1.0;
        const curiosity = traits.curiosity ?? 1.0;
        const resourcefulness = traits.resourcefulness ?? 1.0;
        const resilience = traits.resilience ?? 1.0;

        const bodyHeight = clamp(0.92 + (diligence - 1.0) * 0.26 + (resilience - 1.0) * 0.18, 0.74, 1.24);
        const bodyTopRadius = clamp(0.19 + (sociality - 1.0) * 0.03 - (resourcefulness - 1.0) * 0.02, 0.15, 0.25);
        const bodyBottomRadius = clamp(0.25 + (resilience - 1.0) * 0.05 + (bravery - 1.0) * 0.03, 0.20, 0.35);
        const headRadiusTop = clamp(0.16 + (curiosity - 1.0) * 0.04 + (sociality - 1.0) * 0.02, 0.12, 0.25);
        const headRadiusBottom = clamp(headRadiusTop + 0.02 + (resourcefulness - 1.0) * -0.01, 0.14, 0.28);
        const headHeight = clamp(0.28 + (sociality - 1.0) * 0.05 + (curiosity - 1.0) * 0.05, 0.22, 0.40);
        const neckGap = clamp(0.08 + (bravery - 1.0) * 0.02, 0.05, 0.12);
        const eyeRadius = clamp(headRadiusBottom * 0.14, 0.018, 0.035);
        const eyeSpacing = clamp(0.05 + (sociality - 1.0) * 0.02 + (curiosity - 1.0) * 0.01, 0.035, 0.09);
        const eyeY = clamp(headHeight * 0.16 + (sociality - 1.0) * 0.01, 0.02, 0.10);
        const faceZ = clamp(headRadiusBottom * 0.88, 0.11, 0.24);
        const mouthRadius = clamp(0.035 + (sociality - 1.0) * 0.012, 0.025, 0.055);
        const mouthY = clamp(-headHeight * 0.14, -0.08, -0.02);
        const armLoopRadius = clamp(0.12 + (resourcefulness - 1.0) * 0.03 + (bravery - 1.0) * 0.01, 0.09, 0.17);
        const armThickness = clamp(0.024 + (resilience - 1.0) * 0.006, 0.018, 0.034);
        const armOffsetX = clamp(bodyBottomRadius * 0.92 + armThickness * 0.5, 0.18, 0.34);
        const armY = clamp(bodyHeight * 0.64 + (diligence - 1.0) * 0.03, 0.45, 0.92);
        const carriedItemSize = clamp(0.44 + (resourcefulness - 1.0) * 0.08, 0.34, 0.56);
        const carriedItemY = clamp(bodyHeight * 0.78 + headHeight * 0.40, 0.72, 1.30);
        const carriedItemZ = clamp(bodyBottomRadius + 0.05, 0.20, 0.42);
        const shadowRadius = clamp(bodyBottomRadius + headRadiusBottom * 0.38, 0.26, 0.42);

        return {
            bodyHeight,
            bodyTopRadius,
            bodyBottomRadius,
            headRadiusTop,
            headRadiusBottom,
            headHeight,
            neckGap,
            eyeRadius,
            eyeSpacing,
            eyeY,
            faceZ,
            mouthRadius,
            mouthY,
            armLoopRadius,
            armThickness,
            armOffsetX,
            armY,
            carriedItemSize,
            carriedItemY,
            carriedItemZ,
            shadowRadius,
        };
    }

    applyMorphologyToMeshes() {
        if (!this.morphology || !this.body || !this.head) return;
        const m = this.morphology;

        this.body.position.y = m.bodyHeight / 2;
        this.head.position.y = m.bodyHeight + m.neckGap + (m.headHeight / 2);

        if (this.iconAnchor) {
            this.iconAnchor.position.set(0, m.headHeight * 0.70, 0);
        }
        if (this.leftEye) {
            this.leftEye.position.set(-m.eyeSpacing, m.eyeY, m.faceZ);
        }
        if (this.rightEye) {
            this.rightEye.position.set(m.eyeSpacing, m.eyeY, m.faceZ);
        }
        if (this.mouth) {
            this.mouth.position.set(0, m.mouthY, m.faceZ);
        }
        if (this.leftArm) {
            this.leftArm.position.set(-m.armOffsetX, m.armY, 0);
        }
        if (this.rightArm) {
            this.rightArm.position.set(m.armOffsetX, m.armY, 0);
        }
        if (this.carriedItemMesh) {
            this.carriedItemMesh.position.set(0, m.carriedItemY, m.carriedItemZ);
        }
        if (this.shadowMesh) {
            if (this.shadowMesh.geometry) this.shadowMesh.geometry.dispose();
            this.shadowMesh.geometry = new THREE.CircleGeometry(m.shadowRadius, 32);
        }
    }

// ...existing code...
    constructor(scene, startPos, id, genes = null) {
        this.log('Character constructed', { id, startPos, genes });
        this.id = id;
        this.scene = scene;
        this.mesh = new THREE.Group();
        this.mesh.name = 'Character_' + id;
        this.scene.add(this.mesh);

        // --- 行動カウント系 ---
        this.childCount = 0;
        this.digCount = 0;
        this.buildCount = 0;
        this.eatCount = 0;
        this.children = [];
        // --- 移動距離カウント ---
        this.moveDistance = 0;
        // --- 年齢・世代 ---
        this.age = 0; // seconds lived (incremented for all characters, not just children)
        this.generation = 0;
        // Slight lifespan variance prevents cohort-wide synchronized old-age collapse.
        this._lifespanMultiplier = 0.9 + Math.random() * 0.2; // ~90% to ~110%
        // --- Love timer for heart mark ---
        this.loveTimer = 0;
        this.lovePhase = null; // 'showing', 'completed', null

        // --- Social role assignment ---
        this.role = 'worker'; // All start as worker; leader emerges via group detection
        this.groupId = null; // Will be set by group detection
        // --- Owned land (set of grid keys) ---
        this.ownedLand = new Set();

        // AI & State
        this.gridPos = startPos;
        this.homePosition = null; this.provisionalHome = null;
        this.inventory = [null, null, null, null, null, null, null, null, null, null]; // 10スロットに拡張
        this.needs = {
            hunger: 80 + Math.random() * 10,
            energy: 80 + Math.random() * 10,
            safety: 100,
            social: 80 + Math.random() * 10
        };
        // needsが0以下なら強制回復
        for (const k of ['hunger','energy','safety','social']) {
            if (this.needs[k] === undefined || this.needs[k] <= 0) {
                this.needs[k] = 80 + Math.random()*10;
            }
        }
        const _defaultTraits = {
            bravery:         0.5 + Math.random() * 0.5,
            diligence:       0.5 + Math.random() * 0.5,
            // --- pseudo-evolution traits (added for Anlife-like drift) ---
            sociality:       0.5 + Math.random() * 0.5, // seeks social earlier; modulates socialThreshold
            curiosity:       0.5 + Math.random() * 0.5, // drives exploration probability
            resourcefulness: 0.5 + Math.random() * 0.5, // proactive foraging threshold
            resilience:      0.5 + Math.random() * 0.5, // energy stress tolerance
        };
        // Merge: genes values override defaults; missing keys fall back to random defaults.
        this.personality = genes ? { ..._defaultTraits, ...genes } : _defaultTraits;
        // Short/mid-term adaptive tendencies (learned during lifetime, not inherited directly).
        this.adaptiveTendencies = {
            forage: 0,
            rest: 0,
            social: 0,
            explore: 0,
        };
        this._learningTick = 0;
        this._knownFoodSpots = new Map(); // "x,y,z" → timestamp; experienced chars remember food locations (TTL 60s)
        this.appearanceProfile = { ...this.personality };
        this.morphology = this.createMorphologyProfile(this.appearanceProfile);
        this.state = 'idle';
        this.action = null;
        this.targetPos = null;
        this.movementSpeed = 1.5;
        this.actionCooldown = Math.random() * 3 + 1;
        this.bobTime = Math.random() * 100;
        this.actionAnim = { active: false, timer: 0, duration: 0.4 };
        this.relationships = new Map();
        this.bfsFailCount = 0;

        // Visuals (haniwa style)
        // Clay-like color
        this.bodyMaterial = new THREE.MeshLambertMaterial({ color: 0xc68642 }); // haniwa clay color
        this.bodyMaterial.gradientMap = null;
        // Tall cylindrical body (haniwa)
        this.body = new THREE.Mesh(new THREE.CylinderGeometry(this.morphology.bodyTopRadius, this.morphology.bodyBottomRadius, this.morphology.bodyHeight, 32), this.bodyMaterial);
        this.body.castShadow = true;
        this.body.receiveShadow = true;
        this.mesh.add(this.body);
        // Simple head (slightly smaller cylinder)
        this.head = new THREE.Mesh(new THREE.CylinderGeometry(this.morphology.headRadiusTop, this.morphology.headRadiusBottom, this.morphology.headHeight, 24), this.bodyMaterial);
        this.head.castShadow = true;
        this.head.receiveShadow = true;
        this.mesh.add(this.head);
        // Icon anchor (above head)
        this.iconAnchor = new THREE.Object3D();
        this.head.add(this.iconAnchor);
        // Simple face: two holes (black circles) for eyes
        this.eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x222222 });
        const eyeGeometry = new THREE.CylinderGeometry(this.morphology.eyeRadius, this.morphology.eyeRadius, 0.01, 12);
        this.leftEye = new THREE.Mesh(eyeGeometry, this.eyeMaterial); this.leftEye.rotation.x = Math.PI/2; this.head.add(this.leftEye);
        this.rightEye = new THREE.Mesh(eyeGeometry, this.eyeMaterial); this.rightEye.rotation.x = Math.PI/2; this.head.add(this.rightEye);
        this.eyeMeshes = [this.leftEye, this.rightEye];
        // Simple mouth: small horizontal hole
        const mouthGeometry = new THREE.CylinderGeometry(this.morphology.mouthRadius, this.morphology.mouthRadius, 0.01, 12);
        this.mouth = new THREE.Mesh(mouthGeometry, this.eyeMaterial);
        this.mouth.rotation.x = Math.PI/2;
        this.head.add(this.mouth);
        // Arm loops (torus)
        const armMaterial = new THREE.MeshLambertMaterial({ color: 0xc68642 });
        const armGeometry = new THREE.TorusGeometry(this.morphology.armLoopRadius, this.morphology.armThickness, 10, 24, Math.PI*1.2);
        this.leftArm = new THREE.Mesh(armGeometry, armMaterial); this.leftArm.rotation.z = Math.PI/2.2; this.body.add(this.leftArm);
        this.rightArm = new THREE.Mesh(armGeometry, armMaterial); this.rightArm.rotation.z = -Math.PI/2.2; this.body.add(this.rightArm);
        // Carried item
        const carriedItemMaterial = new THREE.MeshLambertMaterial({ color: 0x8B4513 }); // Brown color
        this.carriedItemMesh = new THREE.Mesh(new THREE.BoxGeometry(this.morphology.carriedItemSize, this.morphology.carriedItemSize, this.morphology.carriedItemSize), carriedItemMaterial); this.carriedItemMesh.visible = false; this.mesh.add(this.carriedItemMesh);
        // Shadow
        const shadowGeometry = new THREE.CircleGeometry(this.morphology.shadowRadius, 32);
        const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 });
        this.shadowMesh = new THREE.Mesh(shadowGeometry, shadowMaterial);
        this.shadowMesh.position.set(0, 0.01, 0);
        this.shadowMesh.rotation.x = -Math.PI / 2;
        this.mesh.add(this.shadowMesh);
        // Thought bubble
        this.thoughtBubble = document.createElement('div');
        this.thoughtBubble.className = 'thought-bubble';
        this.thoughtBubble.setAttribute('data-aos', 'zoom-in');
        this.thoughtBubble.setAttribute('data-aos-duration', '300');
        document.body.appendChild(this.thoughtBubble);

        this.applyMorphologyToMeshes();
        this.updateColorFromPersonality();
        this.updateWorldPosFromGrid();

    // --- Liveliness: breathing and glance state ---
    this._breathPhase = Math.random() * Math.PI * 2;
    this._breathRate = 0.6 + Math.random() * 0.8; // slow cycle
    this._breathAmp = 0.02 + Math.random() * 0.03; // small scale amplitude
    this._lookTargetPos = null; // {x,y,z} or null
    this._lookLerp = 0.12; // smoothing for head turns
    this._idleGlanceTimer = Math.random() * 6 + 2;
    this._idleGlanceInterval = 4 + Math.random() * 6;
    this._lookHoldTimer = 0;
    this._randomHeadOffset = 0;
    // --- Step / gait state (for foot-bob & arm sync) ---
    this._stepPhase = Math.random() * Math.PI * 2;
    this._stepOffset = Math.random() * Math.PI * 2;
    this._stepFreqBase = 6.0; // base step freq multiplier for movement
    this._stepAmp = 0.10; // vertical bob amplitude (grid units)
    this._swayAmp = 0.06; // lateral sway amplitude
    this._lastMoveProgressTime = Date.now();

        // --- Action icon (for action effect) ---
        this.actionIconDiv = document.createElement('div');
        this.actionIconDiv.className = 'action-icon';
        this.actionIconDiv.style.position = 'fixed';
        this.actionIconDiv.style.zIndex = 1000;
        this.actionIconDiv.style.fontSize = '2em';
        this.actionIconDiv.style.pointerEvents = 'none';
        this.actionIconDiv.style.transition = 'opacity 0.3s, transform 0.3s';
        this.actionIconDiv.style.opacity = 0;
        document.body.appendChild(this.actionIconDiv);

        // Ensure a global lightweight reservation map exists to avoid duplicate targets
        if (typeof window !== 'undefined') {
            if (!window.worldReservations) window.worldReservations = new Map();
        }
    }

    // --- 全キャラクターのrelationshipsを一括初期化 ---
    static initializeAllRelationships(characters) {
        if (!characters || characters.length === 0) return;
    const affinityMin = (typeof window !== 'undefined' && window.initialAffinityMin !== undefined) ? window.initialAffinityMin : 20;
    let affinityMax = (typeof window !== 'undefined' && window.initialAffinityMax !== undefined) ? window.initialAffinityMax : 40;
    const globalMaxAffinity = (typeof window !== 'undefined' && window.maxAffinity !== undefined) ? window.maxAffinity : 100;
    if (affinityMax > globalMaxAffinity) affinityMax = globalMaxAffinity;
        for (let i = 0; i < characters.length; i++) {
            const a = characters[i];
            for (let j = i + 1; j < characters.length; j++) {
                const b = characters[j];
                if (a.id !== b.id) {
                    const val = affinityMin + Math.random() * (affinityMax - affinityMin);
                    a.relationships.set(b.id, val);
                    b.relationships.set(a.id, val);
                }
            }
        }
    }

    // --- キャラ削除時のクリーンアップ ---
    dispose() {
        // 頭上アイコン・吹き出しをDOMから除去
        if (this.thoughtBubble && this.thoughtBubble.parentNode) {
            this.thoughtBubble.parentNode.removeChild(this.thoughtBubble);
        }
        if (this.actionIconDiv && this.actionIconDiv.parentNode) {
            this.actionIconDiv.parentNode.removeChild(this.actionIconDiv);
        }
        // 3Dオブジェクトも念のためdispose
        if (this.mesh && this.mesh.parent) {
            this.mesh.parent.remove(this.mesh);
        }
        // メッシュのメモリ解放
        if (this.body) {
            this.body.geometry && this.body.geometry.dispose();
            this.body.material && this.body.material.dispose();
        }
        if (this.head) {
            this.head.geometry && this.head.geometry.dispose();
            this.head.material && this.head.material.dispose();
        }
        if (this.leftArm) {
            this.leftArm.geometry && this.leftArm.geometry.dispose();
            this.leftArm.material && this.leftArm.material.dispose();
        }
        if (this.rightArm) {
            this.rightArm.geometry && this.rightArm.geometry.dispose();
            this.rightArm.material && this.rightArm.material.dispose();
        }
        if (this.leftEye) {
            this.leftEye.geometry && this.leftEye.geometry.dispose();
            this.leftEye.material && this.leftEye.material.dispose();
        }
        if (this.rightEye) {
            this.rightEye.geometry && this.rightEye.geometry.dispose();
            this.rightEye.material && this.rightEye.material.dispose();
        }
        if (this.mouth) {
            this.mouth.geometry && this.mouth.geometry.dispose();
            this.mouth.material && this.mouth.material.dispose();
        }
        if (this.shadowMesh) {
            this.shadowMesh.geometry && this.shadowMesh.geometry.dispose();
            this.shadowMesh.material && this.shadowMesh.material.dispose();
        }
        if (this.carriedItemMesh) {
            this.carriedItemMesh.geometry && this.carriedItemMesh.geometry.dispose();
            this.carriedItemMesh.material && this.carriedItemMesh.material.dispose();
        }
    }
    // --- AI & Action Methods ---
    findClosestPartner() {
        let best = null;
        let bestScore = -Infinity;
        const chars = (typeof window !== 'undefined' && window.characters) ? window.characters : (typeof characters !== 'undefined' ? characters : []);
        const baseRange = (typeof window !== 'undefined' && window.perceptionRange !== undefined) ? Number(window.perceptionRange) : 3;
        const sociality = Math.max(0, Math.min(1.5, Number(this.personality?.sociality || 0.7)));
        const { nearbyRadius } = this.getSupportModelParams();
        const searchRange = Math.max(baseRange, nearbyRadius, 2 + Math.round(sociality * 2));

        const preferred = this.getPreferredSupportTarget(searchRange);
        if (preferred?.char) return preferred.char;

        for (const char of chars) {
            if (!char || char.id === this.id || char.state === 'dead') continue;
            const dist = Math.abs(this.gridPos.x - char.gridPos.x) + Math.abs(this.gridPos.y - char.gridPos.y) + Math.abs(this.gridPos.z - char.gridPos.z);
            if (dist <= 0 || dist > searchRange) continue;
            const affinity = Number(this.relationships.get(char.id) || 0);
            const sameGroupBonus = (this.groupId && char.groupId && this.groupId === char.groupId) ? 8 : 0;
            const score = affinity + sameGroupBonus - (dist * 9) + (Math.random() * 1.5);
            if (score > bestScore) {
                bestScore = score;
                best = char;
            }
        }
        return best;
    }

    getPreferredSupportTarget(maxDistance = null) {
        const chars = (typeof window !== 'undefined' && window.characters) ? window.characters : (typeof characters !== 'undefined' ? characters : []);
        const { nearbyRadius, groupBonus, allyPresenceBonus } = this.getSupportModelParams();
        const searchRange = Math.max(2, Number.isFinite(Number(maxDistance)) ? Number(maxDistance) : (nearbyRadius * 2));
        let best = null;
        let bestScore = -Infinity;

        for (const char of chars) {
            if (!char || char.id === this.id || char.state === 'dead' || !char.gridPos) continue;
            const dist = Math.abs(this.gridPos.x - char.gridPos.x) + Math.abs(this.gridPos.y - char.gridPos.y) + Math.abs(this.gridPos.z - char.gridPos.z);
            if (dist <= 0 || dist > searchRange) continue;

            const affinity = Number(this.relationships.get(char.id) || 0);
            const relationClass = this.getRelationshipClass(char.id);
            const sameGroup = !!this.groupId && !!char.groupId && this.groupId === char.groupId;
            const strongTie = relationClass === 'ally' || relationClass === 'bonded';
            const anchored = String(this._socialAnchorId || '') === String(char.id);
            if (!sameGroup && !strongTie && !anchored) continue;

            const tieStrength = Math.max(0, Math.min(1,
                (affinity / 100) +
                (sameGroup ? groupBonus : 0) +
                (strongTie ? allyPresenceBonus : 0) +
                (anchored ? allyPresenceBonus : 0)
            ));
            const normalizedDistance = dist / Math.max(1, searchRange);
            const score = tieStrength - normalizedDistance + (Math.random() * 0.05);
            if (score > bestScore) {
                const adjacent = this.findAdjacentSpot(char.gridPos);
                bestScore = score;
                best = {
                    char,
                    targetPos: adjacent || char.gridPos,
                    pullStrength: tieStrength,
                    distance: dist,
                    relationClass
                };
            }
        }

        return best;
    }

    findClosestFood() {
        // Expire stale spatial-memory entries (TTL 60s = approximate fruit respawn window)
        if (this._knownFoodSpots && this._knownFoodSpots.size > 0) {
            const now = Date.now();
            for (const [k, ts] of this._knownFoodSpots) {
                if (now - ts > 60000) this._knownFoodSpots.delete(k);
            }
        }

        let minScore = Infinity, closest = null;
        for (const [key, id] of worldData.entries()) {
            // Skip positions that recently failed BFS — but auto-expire after 90s (fruit respawn window)
            const _failTs = Character.failedFoodTargets.get(key);
            if (_failTs !== undefined) {
                if (Date.now() - _failTs < 90000) continue;
                Character.failedFoodTargets.delete(key); // expired, worth retrying
            }
            const rawBlockVal = typeof id === 'object' && id !== null && id.id !== undefined ? id.id : id;
            const type = Object.values(BLOCK_TYPES).find(t => t.id === rawBlockVal);
            if (type && type.isEdible) {
                const [x, y, z] = key.split(',').map(Number);
                const dist = Math.abs(this.gridPos.x - x) + Math.abs(this.gridPos.y - y) + Math.abs(this.gridPos.z - z);
                // Known food spawn locations get a 50% scoring bonus — experienced characters head there first
                const score = this._knownFoodSpots?.has(key) ? dist * 0.5 : dist;
                if (score < minScore) {
                    minScore = score;
                    closest = { x, y, z };
                }
            }
        }

        // On-miss invalidation: purge remembered spots that no longer have food
        if (this._knownFoodSpots) {
            for (const k of this._knownFoodSpots.keys()) {
                if (!worldData.has(k)) this._knownFoodSpots.delete(k);
            }
        }

        return closest;
    }

    findClosestWood() {
        let minDist = Infinity, closest = null;
        // 認識範囲を元に戻す（5→4に調整）
        const searchRange = 4;
        for (const [key, id] of worldData.entries()) {
            const type = Object.values(BLOCK_TYPES).find(t => t.id === id);
            // 木ブロックまたは葉ブロックを検索対象に
            if (type && type.diggable && (type.name === 'Wood' || type.name === 'Leaf')) {
                const [x, y, z] = key.split(',').map(Number);
                const dist = Math.abs(this.gridPos.x - x) + Math.abs(this.gridPos.y - y) + Math.abs(this.gridPos.z - z);
                if (dist < minDist && dist <= searchRange) {
                    minDist = dist;
                    closest = {x, y, z};
                }
            }
        }

        return closest;
    }

    findClosestStone() {
        let minDist = Infinity, closest = null;
        for (const [key, id] of worldData.entries()) {
            const type = Object.values(BLOCK_TYPES).find(t => t.id === id);
            if (type && type.diggable && (type.name === 'Stone' || type.name.includes('Stone') || type.name === 'STONE')) {
                const [x, y, z] = key.split(',').map(Number);
                const dist = Math.abs(this.gridPos.x - x) + Math.abs(this.gridPos.y - y) + Math.abs(this.gridPos.z - z);
                if (dist < minDist) { minDist = dist; closest = {x, y, z}; }
            }
        }
        return closest;
    }

    // 周囲に石があるかチェック
    hasStoneNearby() {
        for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -2; dz <= 2; dz++) {
                    const x = this.gridPos.x + dx;
                    const y = this.gridPos.y + dy;
                    const z = this.gridPos.z + dz;
                    const key = `${x},${y},${z}`;
                    const blockId = worldData.get(key);
                    if (blockId) {
                        const type = Object.values(BLOCK_TYPES).find(t => t.id === blockId);
                        if (type && type.diggable && (type.name === 'Stone' || type.name.includes('Stone') || type.name === 'STONE')) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }

    findDiggableBlock() {
        let minDist = Infinity, closest = null;
        for (const [key, id] of worldData.entries()) {
            const type = Object.values(BLOCK_TYPES).find(t => t.id === id);
            if (type && type.diggable) {
                const [x, y, z] = key.split(',').map(Number);
                const dist = Math.abs(this.gridPos.x - x) + Math.abs(this.gridPos.y - y) + Math.abs(this.gridPos.z - z);
                if (dist < minDist) { minDist = dist; closest = {x, y, z}; }
            }
        }
        return closest;
    }

    findAdjacentSpot(target) {
        // Y座標も考慮し、段差・落下・ジャンプ可能な隣接スポットを返す（bak_game.jsロジック準拠）
        const directions = [
            {dx:1, dy:0, dz:0}, {dx:-1, dy:0, dz:0}, {dx:0, dy:0, dz:1}, {dx:0, dy:0, dz:-1},
            {dx:0, dy:1, dz:0}, {dx:0, dy:-1, dz:0}
        ];
        for (const dir of directions) {
            const x = target.x + dir.dx;
            const y = target.y + dir.dy;
            const z = target.z + dir.dz;
            if (y < 0 || y > maxHeight) continue;
            const key = `${x},${y},${z}`;
            // 足場チェック: 下にブロックがあり、今の高さに空間がある
            const below = `${x},${y-1},${z}`;
            if (!worldData.has(below)) continue;
            if (worldData.has(key)) continue;
            // 段差・ジャンプ: 1段上までOK
            if (Math.abs(y - target.y) > 1) continue;
            return {x, y, z};
        }
        return null;
    }

    canDigDown() {
        const blockBelowPos = { x: this.gridPos.x, y: this.gridPos.y - 1, z: this.gridPos.z };
        const rawVal = worldData.get(`${blockBelowPos.x},${blockBelowPos.y},${blockBelowPos.z}`);
        const blockId = this._normalizeBlockVal(rawVal);
        const blockType = Object.values(BLOCK_TYPES).find(t => t.id === blockId);
        return blockType && blockType.diggable;
    }

    getRelationshipThresholds() {
        const floor = (typeof window !== 'undefined' && window.affinityFloor !== undefined) ? Number(window.affinityFloor) : 5;
        const acquaintanceRaw = (typeof window !== 'undefined' && window.acquaintanceAffinityThreshold !== undefined) ? Number(window.acquaintanceAffinityThreshold) : 30;
        const allyRaw = (typeof window !== 'undefined' && window.allyAffinityThreshold !== undefined) ? Number(window.allyAffinityThreshold) : 60;
        const bondedRaw = (typeof window !== 'undefined' && window.bondedAffinityThreshold !== undefined) ? Number(window.bondedAffinityThreshold) : 80;
        const acquaintance = Math.max(floor + 1, acquaintanceRaw);
        const ally = Math.max(acquaintance + 1, allyRaw);
        const bonded = Math.max(ally + 1, bondedRaw);
        return { floor, acquaintance, ally, bonded };
    }

    getSupportModelParams() {
        const clampWeight = (value, fallback) => {
            const numeric = Number.isFinite(Number(value)) ? Number(value) : fallback;
            return Math.max(0, Math.min(1, numeric));
        };
        return {
            nearbyRadius: Math.max(1, Math.min(10, Number((typeof window !== 'undefined' && window.nearbySupportRadius !== undefined) ? window.nearbySupportRadius : 4))),
            groupBonus: clampWeight((typeof window !== 'undefined' && window.supportGroupBonus !== undefined) ? window.supportGroupBonus : 0.26, 0.26),
            allyPresenceBonus: clampWeight((typeof window !== 'undefined' && window.supportAllyPresenceBonus !== undefined) ? window.supportAllyPresenceBonus : 0.22, 0.22),
            comfortRecoveryRate: Math.max(0, Math.min(8, Number((typeof window !== 'undefined' && window.supportComfortRecoveryRate !== undefined) ? window.supportComfortRecoveryRate : 3))),
            groupComfortScale: Math.max(0, Math.min(2, Number((typeof window !== 'undefined' && window.supportGroupComfortScale !== undefined) ? window.supportGroupComfortScale : 0.5))),
            nightSafetyAllyBonus: Math.max(0, Math.min(6, Number((typeof window !== 'undefined' && window.supportNightSafetyAllyBonus !== undefined) ? window.supportNightSafetyAllyBonus : 1.5))),
            nightSafetyBondedBonus: Math.max(0, Math.min(8, Number((typeof window !== 'undefined' && window.supportNightSafetyBondedBonus !== undefined) ? window.supportNightSafetyBondedBonus : 3))),
            bondedWeight: clampWeight((typeof window !== 'undefined' && window.supportBondedWeight !== undefined) ? window.supportBondedWeight : 0.24, 0.24),
            allyWeight: clampWeight((typeof window !== 'undefined' && window.supportAllyWeight !== undefined) ? window.supportAllyWeight : 0.12, 0.12),
            nearbyWeight: clampWeight((typeof window !== 'undefined' && window.supportNearbyWeight !== undefined) ? window.supportNearbyWeight : 0.10, 0.10),
            topAffinityWeight: clampWeight((typeof window !== 'undefined' && window.supportTopAffinityWeight !== undefined) ? window.supportTopAffinityWeight : 0.22, 0.22)
        };
    }

    // Derived from affinity float — parameterized for experiments.
    getRelationshipClass(otherId) {
        const aff = this.relationships.get(otherId) ?? 0;
        const { floor, acquaintance, ally, bonded } = this.getRelationshipThresholds();
        if (aff >= bonded) return 'bonded';
        if (aff >= ally) return 'ally';
        if (aff >= acquaintance) return 'acquaintance';
        if (aff > floor + 3) return 'stranger';
        return 'rival';
    }

    getRelationshipSnapshot(limit = 5) {
        const chars = (typeof window !== 'undefined' && Array.isArray(window.characters))
            ? window.characters
            : ((typeof characters !== 'undefined' && Array.isArray(characters)) ? characters : []);
        const ties = this.relationships instanceof Map
            ? Array.from(this.relationships.entries())
                .map(([otherId, rawAffinity]) => {
                    const other = chars.find(c => String(c?.id) === String(otherId) && c?.state !== 'dead');
                    if (!other?.gridPos) return null;
                    const affinity = Number(rawAffinity || 0);
                    const relationshipClass = this.getRelationshipClass(otherId);
                    const distance = Math.abs(this.gridPos.x - other.gridPos.x) + Math.abs(this.gridPos.y - other.gridPos.y) + Math.abs(this.gridPos.z - other.gridPos.z);
                    return {
                        other,
                        otherId,
                        affinity,
                        relationshipClass,
                        distance,
                        isNearbySupport: false,
                        inSameGroup: !!this.groupId && !!other.groupId && this.groupId === other.groupId
                    };
                })
                .filter(Boolean)
                .sort((a, b) => (b.affinity - a.affinity) || (a.distance - b.distance))
            : [];

        const { nearbyRadius, groupBonus, allyPresenceBonus, bondedWeight, allyWeight, nearbyWeight, topAffinityWeight } = this.getSupportModelParams();
        ties.forEach(t => {
            t.isNearbySupport = t.distance <= nearbyRadius && (t.relationshipClass === 'bonded' || t.relationshipClass === 'ally');
        });
        const bondedCount = ties.filter(t => t.relationshipClass === 'bonded').length;
        const allyCount = ties.filter(t => t.relationshipClass === 'ally').length;
        const nearbySupport = ties.filter(t => t.distance <= nearbyRadius && (t.relationshipClass === 'bonded' || t.relationshipClass === 'ally')).length;
        const hasStrongTie = ties.some(t => t.relationshipClass === 'bonded' || t.relationshipClass === 'ally');
        const supportScore = Math.max(0, Math.min(1,
            (bondedCount * bondedWeight) +
            (allyCount * allyWeight) +
            (nearbySupport * nearbyWeight) +
            (this.groupId ? groupBonus : 0) +
            (hasStrongTie ? allyPresenceBonus : 0) +
            (ties.length > 0 ? Math.min(topAffinityWeight, (ties[0].affinity / 100) * topAffinityWeight) : 0)
        ));

        return {
            networkSize: ties.length,
            bondedCount,
            allyCount,
            nearbySupport,
            supportRadius: nearbyRadius,
            supportScore: Math.round(supportScore * 100) / 100,
            ties: ties.slice(0, Math.max(1, Number(limit) || 5))
        };
    }

    getEffectiveLifespan() {
        const baseLifespan = (typeof window !== 'undefined' && window.characterLifespan !== undefined)
            ? Number(window.characterLifespan) : 240;
        return Math.max(60, baseLifespan * (this._lifespanMultiplier || 1.0));
    }

    getLifeRatio() {
        const effectiveLifespan = this.getEffectiveLifespan();
        return Math.max(0, Math.min(1.5, Number(this.age || 0) / Math.max(1, effectiveLifespan)));
    }

    getLifeStage() {
        const lifeRatio = this.getLifeRatio();
        const minAgeRatio = (typeof window !== 'undefined' && window.minReproductionAgeRatio !== undefined)
            ? Number(window.minReproductionAgeRatio) : 0.2;
        const maturityAge = (typeof window !== 'undefined' && window.childMaturitySeconds !== undefined)
            ? Number(window.childMaturitySeconds) : (this.maturityAge || 60);
        const childMax = Math.max(0.12, Math.min(0.22, minAgeRatio));
        const youngByAge = Number(this.age || 0) < Math.max(1, maturityAge);
        if (youngByAge || lifeRatio < childMax) return 'child';
        if (lifeRatio < 0.38) return 'young';
        if (lifeRatio < 0.72) return 'adult';
        return 'elder';
    }

    getAgingProfile() {
        const lifeRatio = this.getLifeRatio();
        const stage = this.getLifeStage();
        const late = Math.max(0, Math.min(1, (lifeRatio - 0.65) / 0.35));
        const smoothLate = late * late * (3 - 2 * late);

        const stageBase = {
            child: { mobilityMul: 0.88, exploreMul: 0.92, socialMul: 1.12, workMul: 0.55, restThresholdBonus: 4, fertilityBase: 0.0 },
            young: { mobilityMul: 1.08, exploreMul: 1.12, socialMul: 1.06, workMul: 0.96, restThresholdBonus: -2, fertilityBase: 1.05 },
            adult: { mobilityMul: 1.00, exploreMul: 0.98, socialMul: 1.00, workMul: 1.08, restThresholdBonus: 0, fertilityBase: 1.00 },
            elder: { mobilityMul: 0.94, exploreMul: 0.88, socialMul: 0.96, workMul: 0.78, restThresholdBonus: 10, fertilityBase: 0.55 }
        }[stage] || { mobilityMul: 1.0, exploreMul: 1.0, socialMul: 1.0, workMul: 1.0, restThresholdBonus: 0, fertilityBase: 1.0 };

        const lateMobility = 1.0 - (0.22 * smoothLate);
        const lateExplore = 1.0 - (0.40 * smoothLate);
        const lateFertility = lifeRatio <= 0.55 ? 1.0 : Math.max(0, 1.0 - ((lifeRatio - 0.55) / 0.35));

        return {
            stage,
            lifeRatio,
            mobilityMul: stageBase.mobilityMul * lateMobility,
            exploreMul: stageBase.exploreMul * lateExplore,
            socialMul: stageBase.socialMul,
            workMul: stageBase.workMul,
            restThresholdBonus: stageBase.restThresholdBonus,
            // Soft demographic weighting: no rigid scripting except the child reproduction gate.
            fertilityMul: stageBase.fertilityBase * lateFertility
        };
    }

    // --- Learning logic (bak_game.js準拠) ---
    learn(outcome) {
        const clampTrait = (v) => Math.max(0.3, Math.min(1.7, v));
        const clampBias = (v) => Math.max(-1.0, Math.min(1.0, v));
        const adapt = this.adaptiveTendencies || (this.adaptiveTendencies = { forage: 0, rest: 0, social: 0, explore: 0 });

        if (outcome.type === 'SAFETY_DECREASE') {
            this.personality.bravery = clampTrait(this.personality.bravery - 0.04);
            adapt.explore = clampBias(adapt.explore - 0.04);
        }
        else if (outcome.type === 'ATE_FOOD') {
            this.personality.resourcefulness = clampTrait(this.personality.resourcefulness + 0.015);
            if (outcome.inDanger) this.personality.bravery = clampTrait(this.personality.bravery + 0.05);
            adapt.forage = clampBias(adapt.forage - 0.08);
            adapt.explore = clampBias(adapt.explore + 0.02);
        }
        else if (outcome.type === 'BUILT_HOME') {
            this.personality.diligence = clampTrait(this.personality.diligence + 0.05);
            adapt.rest = clampBias(adapt.rest + 0.02);
        }
        else if (outcome.type === 'FOUND_SHELTER') {
            this.personality.diligence = clampTrait(this.personality.diligence + 0.02);
            this.personality.resilience = clampTrait(this.personality.resilience + 0.015);
            adapt.rest = clampBias(adapt.rest - 0.06);
        }
        else if (outcome.type === 'HUNGER_STRESS') {
            this.personality.resourcefulness = clampTrait(this.personality.resourcefulness + 0.01);
            this.personality.curiosity = clampTrait(this.personality.curiosity - 0.006);
            adapt.forage = clampBias(adapt.forage + 0.08);
            adapt.explore = clampBias(adapt.explore - 0.05);
            adapt.social = clampBias(adapt.social - 0.02);
        }
        else if (outcome.type === 'ENERGY_STRESS') {
            this.personality.resilience = clampTrait(this.personality.resilience + 0.01);
            this.personality.curiosity = clampTrait(this.personality.curiosity - 0.004);
            adapt.rest = clampBias(adapt.rest + 0.08);
            adapt.explore = clampBias(adapt.explore - 0.04);
        }
        else if (outcome.type === 'SOCIAL_SUCCESS') {
            this.personality.sociality = clampTrait(this.personality.sociality + 0.01);
            adapt.social = clampBias(adapt.social + 0.06);
        }

        // Slow decay toward neutral so tendencies reflect recent context.
        adapt.forage *= 0.995;
        adapt.rest *= 0.995;
        adapt.social *= 0.995;
        adapt.explore *= 0.995;

        this.updateColorFromPersonality();
    }

    // 周囲に壁を作るスポットを探す（空気の場所のみ）
    findWallSpots() {
        const spots = [];
        const directions = [
            {dx:1, dz:0}, {dx:-1, dz:0}, {dx:0, dz:1}, {dx:0, dz:-1}
        ];
        for (const dir of directions) {
            const x = this.gridPos.x + dir.dx;
            const z = this.gridPos.z + dir.dz;
            const y = this.gridPos.y;
            const key = `${x},${y},${z}`;
            if (!worldData.has(key)) {
                spots.push({x, y, z});
            }
        }
        return spots;
    }

    // mood is derived from state + needs — no stored field needed
    get mood() {
        if (this.state === 'dead')         return 'dead';
        if (this.state === 'resting')      return 'tired';
        if (this.state === 'socializing' && this.needs.social > 80) return 'happy';
        if (this.needs.hunger < 20)        return 'hungry';
        if (this.needs.safety < 20)        return 'scared';
        if (this.needs.energy < 20)        return 'tired';
        if (this.needs.social < 20)        return 'lonely';
        if (this.state === 'meeting')      return 'excited';
        if (this.state === 'confused')     return 'confused';
        return 'neutral';
    }

    get currentAction() {
        if (this.action && this.action.type) return this.action.type;
        return '-';
    }

    getDistrictSocialContext() {
        const fallback = {
            index: this.districtIndex ?? 0,
            foodPressure: 0,
            housingPressure: 0,
            timeStress: 0,
            supportAccess: 0,
            relationshipStability: 0,
            socialPressure: 0
        };
        try {
            if (typeof window !== 'undefined' && typeof window.getDistrictSocialContextForPosition === 'function') {
                return {
                    ...fallback,
                    ...(window.getDistrictSocialContextForPosition(this.gridPos) || {})
                };
            }
        } catch (e) {
            // ignore helper lookup issues
        }
        return fallback;
    }

    getReproductionModelParams() {
        const getNum = (key, fallback, min = 0, max = 1) => {
            const raw = (typeof window !== 'undefined' && window[key] !== undefined) ? Number(window[key]) : fallback;
            const numeric = Number.isFinite(raw) ? raw : fallback;
            return Math.max(min, Math.min(max, numeric));
        };
        return {
            readinessThreshold: getNum('reproductionReadinessThreshold', 0.52, 0, 1),
            anxietyCohesionBonus: getNum('reproductionAnxietyCohesionBonus', 0.08, 0, 0.4),
            pressurePenalty: getNum('reproductionPressurePenalty', 0.18, 0, 0.6)
        };
    }

    getReproductionReadiness(partner) {
        const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
        const ctx = this.getDistrictSocialContext();
        const params = this.getReproductionModelParams();
        const affinity = Number(this.relationships.get(partner?.id) || 0);
        const thresholds = (typeof this.getRelationshipThresholds === 'function')
            ? this.getRelationshipThresholds()
            : { ally: 60, bonded: 78 };
        const networkSnapshot = (typeof this.getRelationshipSnapshot === 'function')
            ? this.getRelationshipSnapshot(6)
            : null;

        const bondStrength = clamp01(affinity / 100);
        const support = clamp01(ctx.supportAccess ?? ctx.supportDensity ?? 0);
        const stability = clamp01(ctx.relationshipStability ?? 0);
        const foodPressure = clamp01(ctx.foodPressure ?? 0);
        const housingPressure = clamp01(ctx.housingPressure ?? 0);
        const timeStress = clamp01(ctx.timeStress ?? 0);
        const socialPressure = clamp01(ctx.socialPressure ?? 0);
        const nearbySupport = clamp01(networkSnapshot?.supportScore ?? 0);

        const pairBond = clamp01(
            (bondStrength * 0.68) +
            (affinity >= thresholds.ally ? 0.14 : 0) +
            (affinity >= thresholds.bonded ? 0.18 : 0) +
            ((partner && this._lovePartnerId === partner.id) ? 0.06 : 0)
        );

        const localSupport = clamp01(
            (support * 0.50) +
            (nearbySupport * 0.25) +
            (stability * 0.15) +
            (this.homePosition ? 0.05 : 0) +
            (partner?.homePosition ? 0.05 : 0)
        );

        const selfNeedMargin = clamp01(
            (Number(this.needs?.hunger || 0) / 100) * 0.35 +
            (Number(this.needs?.energy || 0) / 100) * 0.35 +
            (Number(this.needs?.safety || 0) / 100) * 0.30
        );
        const partnerNeedMargin = clamp01(
            (Number(partner?.needs?.hunger || 0) / 100) * 0.35 +
            (Number(partner?.needs?.energy || 0) / 100) * 0.35 +
            (Number(partner?.needs?.safety || 0) / 100) * 0.30
        );

        const livelihoodViability = clamp01(
            ((1 - foodPressure) * 0.26) +
            ((1 - housingPressure) * 0.24) +
            ((1 - timeStress) * 0.18) +
            (selfNeedMargin * 0.16) +
            (partnerNeedMargin * 0.16)
        );

        const moderateThreatCohesion = clamp01(1 - (Math.abs(socialPressure - 0.35) / 0.35));
        const futureExpectation = clamp01(
            (livelihoodViability * 0.55) +
            (localSupport * 0.20) +
            (pairBond * 0.15) +
            (moderateThreatCohesion * params.anxietyCohesionBonus) -
            (socialPressure * params.pressurePenalty)
        );

        const readiness = clamp01(
            (pairBond * 0.30) +
            (localSupport * 0.24) +
            (livelihoodViability * 0.26) +
            (futureExpectation * 0.20)
        );

        return {
            ...ctx,
            affinity,
            pairBond: Math.round(pairBond * 100) / 100,
            localSupport: Math.round(localSupport * 100) / 100,
            livelihoodViability: Math.round(livelihoodViability * 100) / 100,
            futureExpectation: Math.round(futureExpectation * 100) / 100,
            moderateThreatCohesion: Math.round(moderateThreatCohesion * 100) / 100,
            readiness: Math.round(readiness * 100) / 100
        };
    }

    shouldAttemptReproductionWith(partner) {
        const ctx = this.getReproductionReadiness(partner);
        this._lastReproductionBlockInfo = ctx;
        const threshold = this.getReproductionModelParams().readinessThreshold;
        return ctx.readiness >= threshold || (ctx.pairBond >= 0.78 && ctx.futureExpectation >= Math.max(0.45, threshold - 0.04));
    }

    update(deltaTime, isNight, camera) {
        const districtRuntime = (typeof window !== 'undefined' && typeof window.getDistrictRuntime === 'function')
            ? window.getDistrictRuntime(this.gridPos)
            : { index: 0, isActive: true, shouldRender: true, updateInterval: 0 };
        this.districtIndex = districtRuntime.index ?? 0;
        const shouldRender = districtRuntime.shouldRender !== false;
        if (this.mesh) this.mesh.visible = shouldRender;
        if (!shouldRender) {
            if (this.thoughtBubble) {
                this.thoughtBubble.setAttribute('data-show', 'false');
                this.thoughtBubble.style.display = 'none';
            }
            if (this.actionIconDiv) {
                this.actionIconDiv.style.opacity = 0;
            }
        }
        if (!districtRuntime.isActive && Number(districtRuntime.updateInterval || 0) > 0) {
            this._districtUpdateAccumulator = (this._districtUpdateAccumulator || 0) + deltaTime;
            if (this._districtUpdateAccumulator < districtRuntime.updateInterval) {
                return;
            }
            deltaTime = this._districtUpdateAccumulator;
            this._districtUpdateAccumulator = 0;
        } else {
            this._districtUpdateAccumulator = 0;
        }

        // 死亡以外のstateになったら目・口の色を黒にリセット
        if (this.state !== 'dead') {
            if (this.eyeMeshL && this.eyeMeshR) {
                this.eyeMeshL.material.color.setRGB(0,0,0);
                this.eyeMeshR.material.color.setRGB(0,0,0);
            }
            if (this.mouthMesh) {
                this.mouthMesh.material.color.setRGB(0,0,0);
            }
            this._skullShown = false;
        }
        // 死亡中は常にドクロマークを表示（3秒経過後にだけ非表示）
        if (this.state === 'dead') {
            if (this.thoughtBubble) {
                this.thoughtBubble.textContent = '💀';
                this.thoughtBubble.setAttribute('data-show', 'true');
                this.thoughtBubble.style.display = '';
                if (!this._skullTimeout) {
                    this._skullTimeout = setTimeout(() => {
                        if (this.thoughtBubble && this.state === 'dead') {
                            this.thoughtBubble.setAttribute('data-show', 'false');
                            this.thoughtBubble.style.display = 'none';
                        }
                        this._skullTimeout = null;
                    }, 3000);
                }
            }
        } else {
            if (this.thoughtBubble && this.thoughtBubble.textContent === '💀') {
                this.thoughtBubble.setAttribute('data-show', 'false');
                this.thoughtBubble.style.display = 'none';
            }
            if (this._skullTimeout) {
                clearTimeout(this._skullTimeout);
                this._skullTimeout = null;
            }
        }
        // --- 社交needs回復イベント: idle中に近くに他キャラがいれば少し回復 ---
        if (this.state === 'idle' && this.needs && this.needs.social < 100) {
            const chars = (typeof window !== 'undefined' && window.characters) ? window.characters : (typeof characters !== 'undefined' ? characters : []);
            let foundNearby = false;
            const perceptionRange = (typeof window !== 'undefined' && window.perceptionRange !== undefined) ? window.perceptionRange : 2;
            const socialRecoveryMul = (typeof window !== 'undefined' && window.socialNeedRecovery !== undefined) ? Number(window.socialNeedRecovery) : 1.0;
            for (const char of chars) {
                if (char.id === this.id) continue;
                const dist = Math.abs(this.gridPos.x - char.gridPos.x) + Math.abs(this.gridPos.y - char.gridPos.y) + Math.abs(this.gridPos.z - char.gridPos.z);
                if (dist > 0 && dist <= perceptionRange) { foundNearby = true; break; }
            }
            if (foundNearby) {
                this.needs.social = Math.min(100, this.needs.social + deltaTime * 5 * socialRecoveryMul);
            }
        }
        // --- 空中スタック救済: 下にブロックがなければ強制落下 ---
        if (!worldData.has(`${this.gridPos.x},${this.gridPos.y-1},${this.gridPos.z}`)) {
            this._airTime = (this._airTime || 0) + deltaTime;
            if (this._airTime > 1.0) { // 1秒以上空中なら
                // 1段下に強制移動（地面が見つかるまで）
                let fallY = this.gridPos.y - 1;
                while (fallY > 0 && !worldData.has(`${this.gridPos.x},${fallY-1},${this.gridPos.z}`)) {
                    fallY--;
                }
                if (fallY >= 0) {
                    this.gridPos.y = fallY;
                    this.updateWorldPosFromGrid();
                    this._airTime = 0;
                    this.log('Rescued from air: forced drop to ground', {y: fallY});
                }
            }
        } else {
            this._airTime = 0;
        }

        // --- 汎用スタック判定＋救助（最適化版：頻度制限付き）---
        if (!this._stuckCheckCooldown) this._stuckCheckCooldown = 0;
        this._stuckCheckCooldown -= deltaTime;

        if (this._stuckCheckCooldown <= 0) {
            const stuckInfo = this.isStuck();
            this.rescueStuck(stuckInfo, deltaTime);
            this._stuckCheckCooldown = 0.3; // 0.3秒ごとにチェック
        }

        // this.log('update called', { deltaTime, isNight, state: this.state, gridPos: this.gridPos, targetPos: this.targetPos }); // コメントアウト
        // Claim land underfoot every update
        this.claimCurrentLand();

        // --- サバイバル本能: needsが0なら自動で少し回復（死亡防止） ---
        if (this.needs) {
            let revived = false;
            let allAboveThreshold = true;
            for (const k of ['hunger','energy','safety','social']) {
                if (this.needs[k] !== undefined && this.needs[k] <= 0) {
                    this.needs[k] = 5 + Math.random()*5; // 5〜10回復
                    revived = true;
                }
                if (this.needs[k] === undefined || this.needs[k] < 5) allAboveThreshold = false;
            }
            // needsが全て5以上なら必ず復帰
            if ((revived || allAboveThreshold) && this.state === 'dead' && allAboveThreshold) {
                this.state = 'idle';
                this.action = null;
                this.actionCooldown = 0.01;
                this._skullShown = false;
                if (this.eyeMeshL && this.eyeMeshR) {
                    this.eyeMeshL.material.color.setRGB(0,0,0);
                    this.eyeMeshR.material.color.setRGB(0,0,0);
                }
                if (this.mouthMesh) {
                    this.mouthMesh.material.color.setRGB(0,0,0);
                }
                // AI行動決定を即時実行
                if (typeof this.decideNextAction === 'function') {
                    setTimeout(() => { this.decideNextAction(isNight); }, 0);
                }
            }
        }

        // --- 完全閉じ込め救済: 周囲8方向すべてブロックで埋まっている場合、強制的に1つ壊す ---
        let surrounded = true;
        let breakable = null;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                if (dx === 0 && dz === 0) continue;
                const x = this.gridPos.x + dx, y = this.gridPos.y, z = this.gridPos.z + dz;
                const key = `${x},${y},${z}`;
                const blockId = worldData.get(key);
                if (blockId === undefined || blockId === null || blockId === BLOCK_TYPES.AIR.id) {
                    surrounded = false;
                } else if (!breakable) {
                    // AIRやBED以外なら壊せる
                    if (blockId !== BLOCK_TYPES.BED.id) breakable = {x, y, z};
                }
            }
        }
        if (surrounded && breakable) {
            // Use reservation-based removal to avoid races
            this.reserveAndRemoveBlock(breakable.x, breakable.y, breakable.z);
            this.log('Break out: forcibly removed block to escape enclosure (reserved)', breakable);
        }
        // Visualize owned land
        this.visualizeOwnedLand();
        // Check for land competition if standing on other's land
        const otherOwner = this.isLandOwnedByOther(this.gridPos);
        if (otherOwner) {
            this.contestLand(otherOwner);
        }
        // Death timer for revival
        if (this.state === 'dead') {
            if (!this.deathTimer) this.deathTimer = 0;
            this.deathTimer += deltaTime;
            if (this.deathTimer > 10) {
                this.revive();
            }
            this.updateThoughtBubble(isNight, camera);
            return;
        }
        // --- meeting状態のとき、actionCooldownが切れたらidleに戻す ---
        if (this.state === 'meeting') {
            this.actionCooldown -= deltaTime;
            if (this.actionCooldown <= 0) {
                this.state = 'idle';
                this.action = null;
            }
            this.updateThoughtBubble(isNight, camera);
            return;
        }

        // --- working状態での段階的処理継続 ---
        if (this.state === 'working' && this.action) {
            this.log(`⚡ continuing processing in working state: ${this.action.type}`, this.action);
            if (!this.runWorkAction(this.action.type)) {
                this.log(`Unhandled working action: ${this.action.type}`);
                this.setIdleState({ clearAction: true });
            }
            this.updateThoughtBubble(isNight, camera);
            return;
        }
        // --- Needs decay (bak_game.js準拠) ---
        const oldSafety = this.needs.safety;
        const hungerDecayRate = (typeof window !== 'undefined' && window.hungerDecayRate !== undefined) ? Number(window.hungerDecayRate) : 0.7;
        const activeEnergyDrainRate = (typeof window !== 'undefined' && window.activeEnergyDrainRate !== undefined) ? Number(window.activeEnergyDrainRate) : 2;
        const unsafeNightSafetyDecayRate = (typeof window !== 'undefined' && window.unsafeNightSafetyDecayRate !== undefined) ? Number(window.unsafeNightSafetyDecayRate) : 5;
        const daytimeSafetyRecoveryRate = (typeof window !== 'undefined' && window.daytimeSafetyRecoveryRate !== undefined) ? Number(window.daytimeSafetyRecoveryRate) : 16;
        this.needs.hunger -= deltaTime * hungerDecayRate * this.personality.diligence;
        const socialNeedDecayRate = (typeof window !== 'undefined' && window.socialNeedDecayRate !== undefined) ? Number(window.socialNeedDecayRate) : 1.5;
        this.needs.social -= deltaTime * socialNeedDecayRate;
        if (this.state === 'moving' || this.state === 'working') {
            this.needs.energy -= deltaTime * activeEnergyDrainRate;
        }
        if (isNight && !this.isSafe(isNight)) {
            this.needs.safety -= deltaTime * unsafeNightSafetyDecayRate;
        } else if (!isNight) {
            this.needs.safety = Math.min(100, this.needs.safety + deltaTime * daytimeSafetyRecoveryRate);
        }
        // --- needsの下限を0にクリップ ---
        this.needs.hunger = Math.max(this.needs.hunger, 0);
        this.needs.social = Math.max(this.needs.social, 0);
        this.needs.energy = Math.max(this.needs.energy, 0);
        this.needs.safety = Math.max(this.needs.safety, 0);

        // --- Support comfort: nearby trusted ties reduce social depletion and improve night safety ---
        if (this.relationships && this.relationships.size > 0) {
            const _supportChars = (typeof window !== 'undefined' && window.characters) ? window.characters : [];
            const { ally, bonded } = this.getRelationshipThresholds();
            const { nearbyRadius, groupBonus, allyPresenceBonus, comfortRecoveryRate, groupComfortScale, nightSafetyAllyBonus, nightSafetyBondedBonus } = this.getSupportModelParams();
            let hasNearbyTrustedTie = false;
            for (const [otherId, aff] of this.relationships.entries()) {
                if (aff < ally) continue;
                const other = _supportChars.find(c => c.id === otherId && c.state !== 'dead');
                if (!other?.gridPos) continue;
                const d = Math.abs(this.gridPos.x - other.gridPos.x) + Math.abs(this.gridPos.z - other.gridPos.z);
                if (d <= nearbyRadius) {
                    hasNearbyTrustedTie = true;
                    this._socialAnchorId = other.id;
                    if (isNight) {
                        const bonus = aff >= bonded ? nightSafetyBondedBonus : nightSafetyAllyBonus;
                        this.needs.safety = Math.min(100, this.needs.safety + deltaTime * bonus);
                    }
                    break;
                }
            }
            if (hasNearbyTrustedTie || this.groupId) {
                const passiveSupport = (hasNearbyTrustedTie ? allyPresenceBonus : 0) + (this.groupId ? (groupBonus * groupComfortScale) : 0);
                if (passiveSupport > 0) {
                    this.needs.social = Math.min(100, this.needs.social + (deltaTime * comfortRecoveryRate * passiveSupport));
                }
            }
        }

        if (isNight && oldSafety > this.needs.safety) {
            this.learn && this.learn({ type: 'SAFETY_DECREASE' });
        }

        // --- 飢餓死判定: hunger=0 が続いた秒数が閾値を超えたら starvation 死 ---
        if (this.needs.hunger <= 0) {
            this._starvationTimer = (this._starvationTimer || 0) + deltaTime;
            const starvDelay = (typeof window !== 'undefined' && window.starvationDeathDelaySeconds !== undefined) ? window.starvationDeathDelaySeconds : 10;
            if (this._starvationTimer >= starvDelay) {
                this.die('starvation');
                this.updateThoughtBubble(isNight, camera);
                return;
            }
        } else {
            this._starvationTimer = 0;
        }

        // --- 孤立コスト: グループに属さないキャラはsafetyが追加で減衰する ---
        // isolationPenalty=0 → 無効。isolationPenalty=1 → 夜の屋外と同程度の追加圧力。
        {
            const penalty = (typeof window !== 'undefined' && window.isolationPenalty !== undefined) ? Number(window.isolationPenalty) : 0.4;
            if (penalty > 0 && !this.groupId) {
                this.needs.safety = Math.max(0, this.needs.safety - deltaTime * 5 * penalty);
            }
        }

        // Recovery
        if (this.state === 'resting') {
            const restEnergyRecoveryRate = (typeof window !== 'undefined' && window.restEnergyRecoveryRate !== undefined) ? Number(window.restEnergyRecoveryRate) : 18;
            this.needs.energy = Math.min(100, this.needs.energy + deltaTime * restEnergyRecoveryRate);
            if (this.needs.energy >= 100) {
                this.state = 'idle';
                this.learn && this.learn({ type: 'FOUND_SHELTER' });
                if (this.provisionalHome === null) {
                    this.provisionalHome = this.gridPos;
                }
            }
        }

        // Natural adaptation from prolonged stress (sampled at low frequency).
        this._learningTick = (this._learningTick || 0) + deltaTime;
        if (this._learningTick >= 2.0) {
            this._learningTick = 0;
            const hungerEmergency = (typeof window !== 'undefined' && window.hungerEmergencyThreshold !== undefined) ? Number(window.hungerEmergencyThreshold) : 5;
            const energyEmergency = (typeof window !== 'undefined' && window.energyEmergencyThreshold !== undefined) ? Number(window.energyEmergencyThreshold) : 20;
            if (this.needs.hunger <= hungerEmergency + 8) this.learn && this.learn({ type: 'HUNGER_STRESS' });
            if (this.needs.energy <= energyEmergency + 8) this.learn && this.learn({ type: 'ENERGY_STRESS' });
            if (this.state === 'socializing' && this.needs.social > 80) this.learn && this.learn({ type: 'SOCIAL_SUCCESS' });

            // 近接敵フラグを2秒ごとに更新 (O(n) max = relationships.size)
            this._nearEnemy = false;
            if (this.relationships && this.relationships.size > 0) {
                const _floor = (typeof window !== 'undefined' && window.affinityFloor !== undefined) ? Number(window.affinityFloor) : 5;
                const _chars = (typeof window !== 'undefined' && window.characters) ? window.characters : [];
                for (const [otherId, aff] of this.relationships.entries()) {
                    if (aff <= _floor + 3) {
                        const other = _chars.find(c => c.id === otherId && c.state !== 'dead');
                        if (other) {
                            const dx = Math.abs(this.gridPos.x - other.gridPos.x);
                            const dz = Math.abs(this.gridPos.z - other.gridPos.z);
                            if (dx + dz <= 5) { this._nearEnemy = true; break; }
                        }
                    }
                }

                // Food donation: well-fed ally/bonded shares food with nearby hungry partner (every 2s tick)
                if (this.needs.hunger > 70) {
                    const _donateChars = _chars;
                    const { ally } = this.getRelationshipThresholds();
                    const { nearbyRadius } = this.getSupportModelParams();
                    for (const [otherId, aff] of this.relationships.entries()) {
                        if (aff >= ally) {
                            const other = _donateChars.find(c => c.id === otherId && c.state !== 'dead');
                            if (other && other.needs.hunger < 40) {
                                const d = Math.abs(this.gridPos.x - other.gridPos.x) + Math.abs(this.gridPos.z - other.gridPos.z);
                                if (d <= nearbyRadius) {
                                    const donation = Math.min(20, this.needs.hunger - 50); // never drop below 50
                                    if (donation > 0) {
                                        this.needs.hunger -= donation;
                                        other.needs.hunger = Math.min(100, other.needs.hunger + donation);
                                        this.log(`Donated ${donation.toFixed(1)} food to ${this.getRelationshipClass(otherId)} #${otherId} (aff=${aff.toFixed(0)})`);
                                        this.showActionIcon('🤝', 1.5);
                                    }
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
        // --- Affinity decay: slowly reduce affinity over time to stabilize long-term behavior ---
        try {
            const decayRate = (typeof window !== 'undefined' && window.affinityDecayRate !== undefined) ? Number(window.affinityDecayRate) : 0;
            const bondPersistence = (typeof window !== 'undefined' && window.bondPersistence !== undefined) ? Number(window.bondPersistence) : 1.0;
            const effectiveDecayRate = decayRate / Math.max(0.25, bondPersistence);
            if (decayRate > 0 && this.relationships && this.relationships.size > 0) {
                const keysToRemove = [];
                for (const [otherId, aff] of this.relationships.entries()) {
                    let newAff = aff - effectiveDecayRate * deltaTime;
                    // clamp and removal
                    if (newAff <= 0) {
                        // floor: keep relationship as low-affinity tension rather than erasing it
                        const affinityFloor = (typeof window !== 'undefined' && window.affinityFloor !== undefined) ? Number(window.affinityFloor) : 5;
                        this.relationships.set(otherId, affinityFloor);
                    } else {
                        const maxAffinity = (typeof window !== 'undefined' && window.maxAffinity !== undefined) ? window.maxAffinity : 100;
                        if (newAff > maxAffinity) newAff = maxAffinity;
                        this.relationships.set(otherId, newAff);
                    }
                }
                // keysToRemove is now unused (floor replaces delete), but keep for safety
                for (const k of keysToRemove) {
                    this.relationships.delete(k);
                }
            }
        } catch (e) { /* non-fatal */ }
        if (this.state === 'socializing') {
            const partner = this.action?.target;
            const hungerEmergency = (typeof window !== 'undefined' && window.hungerEmergencyThreshold !== undefined) ? Number(window.hungerEmergencyThreshold) : 5;
            const energyEmergency = (typeof window !== 'undefined' && window.energyEmergencyThreshold !== undefined) ? Number(window.energyEmergencyThreshold) : 20;
            const { bonded: socializeCompletionAffinity } = this.getRelationshipThresholds();
            const { nearbyRadius } = this.getSupportModelParams();

            if (partner && partner.state === 'socializing') {
                // 双方の緊急ニーズをチェック（中断条件）
                const myCritical = (this.needs.hunger <= hungerEmergency || this.needs.energy <= energyEmergency);
                const partnerCritical = (partner.needs?.hunger <= hungerEmergency || partner.needs?.energy <= energyEmergency);

                if (myCritical || partnerCritical) {
                    this.state = 'idle';
                    this.action = null;
                    this.actionCooldown = 0.1;
                    partner.state = 'idle';
                    partner.action = null;
                    partner.actionCooldown = 0.1;
                    return;
                }

                // needs.social回復速度を調整
                const socialRecoveryMul = (typeof window !== 'undefined' && window.socialNeedRecovery !== undefined) ? Number(window.socialNeedRecovery) : 1.0;
                this.needs.social = Math.min(100, this.needs.social + deltaTime * 8 * socialRecoveryMul);
                // affinity上昇速度をパラメータ化（sidebar.jsで調整可能）
                const affinityRate = (typeof window !== 'undefined' && window.affinityIncreaseRate !== undefined) ? window.affinityIncreaseRate : 10;
                let affinity = this.relationships.get(partner.id) || 0;
                affinity += deltaTime * affinityRate;
                // clamp affinity: personality trait distance lowers the ceiling
                const maxAffinity = (typeof window !== 'undefined' && window.maxAffinity !== undefined) ? window.maxAffinity : 100;
                const capReduction = (typeof window !== 'undefined' && window.traitAffinityCapReduction !== undefined) ? window.traitAffinityCapReduction : 0.6;
                const traitDist = Character.computeTraitDistance(this.personality, partner.personality);
                // affinityCap: at traitDist=0 (identical) → maxAffinity; at traitDist=1 (opposite) → maxAffinity*(1-capReduction)
                const affinityCap = maxAffinity * (1.0 - capReduction * traitDist);
                if (affinity > affinityCap) affinity = affinityCap;
                this.relationships.set(partner.id, affinity);
                // --- ハート表示 & reproduction logic ---
                // 両者が距離1以内＆友好度60以上でハート表示。もし既にlovePhaseが'showing'かつ
                // loveTimerが<=0ならreproduceを先に実行する（timerリセットを防ぐため）。
                const dist = Math.abs(this.gridPos.x - partner.gridPos.x) + Math.abs(this.gridPos.y - partner.gridPos.y) + Math.abs(this.gridPos.z - partner.gridPos.z);

                const loveAffinityThreshold = (typeof window !== 'undefined' && window.reproduceAffinityThreshold !== undefined)
                    ? Number(window.reproduceAffinityThreshold)
                    : 60;

                // If timer expired while still in socializing and conditions met, reproduce first
                if (this.loveTimer <= 0 && this.lovePhase === 'showing' && affinity >= loveAffinityThreshold &&
                    this.needs.hunger > 15 && partner.needs.hunger > 15) {
                    const pressureGateOpen = this.shouldAttemptReproductionWith(partner);
                    // per-pair cooldown check (only gate — no permanent one-child-per-pair lock)
                    const _pairKey2 = `${Math.min(this.id, partner.id)}-${Math.max(this.id, partner.id)}`;
                    if (!window._pairReproTimestamps) window._pairReproTimestamps = new Map();
                    const _pairLast2 = window._pairReproTimestamps.get(_pairKey2) || 0;
                    const _pairNow2 = Date.now() / 1000;
                    const _cooldown2 = window.pairReproductionCooldownSeconds || 60;
                    if (pressureGateOpen && (_pairLast2 === 0 || (_pairNow2 - _pairLast2) >= _cooldown2)) {
                        // 繁殖年齢ウィンドウ: 寿命の minReproductionAgeRatio 未満なら繁殖不可
                        const _minAgeRatio = (typeof window !== 'undefined' && window.minReproductionAgeRatio !== undefined) ? window.minReproductionAgeRatio : 0.2;
                        const _lifespan = this.lifespan || (typeof window !== 'undefined' && window.characterLifespan) || 240;
                        const _partnerLifespan = partner.lifespan || _lifespan;
                        if ((this.age / _lifespan) < _minAgeRatio || (partner.age / _partnerLifespan) < _minAgeRatio) {
                            // too young — skip silently
                        } else {
                        try { console.log(`[LOVE] ${this.id} loveTimer expired, reproducing with ${partner.id}, affinity=${(affinity||0).toFixed ? affinity.toFixed(1) : affinity}`); } catch(e){}
                        this.reproduceWith && this.reproduceWith(partner);
                        window._pairReproTimestamps.set(_pairKey2, _pairNow2);
                        const resetVal = (typeof window !== 'undefined' && window.affinityResetAfterReproduce !== undefined) ? window.affinityResetAfterReproduce : 42;
                        this.relationships.set(partner.id, resetVal);
                        partner.relationships.set(this.id, resetVal);
                        this.lovePhase = 'completed';
                        partner.lovePhase = 'completed';
                        } // end age gate
                    }
                }

                if (dist <= Math.max(1, nearbyRadius) && affinity >= socializeCompletionAffinity) {
                    this._socialAnchorId = partner.id;
                    partner._socialAnchorId = this.id;
                }

                // Set or refresh heart display if in proximity and affinity high enough
                if (dist <= 1 && affinity >= loveAffinityThreshold) {
                    // Only start the timer if it's not currently 'showing'
                    if (this.loveTimer <= 0 && this.lovePhase !== 'showing') {
                        this.loveTimer = 3.0; // 3 seconds showing
                        this.lovePhase = 'showing';
                        // persist partner id so expiry logic can find the partner even if action cleared
                        this._lovePartnerId = partner.id;
                        try { console.log(`[LOVE] ${this.id} started loveTimer with partner ${partner.id}, affinity=${(affinity||0).toFixed ? affinity.toFixed(1) : affinity}`); } catch(e){}
                    }
                    if (partner.loveTimer <= 0 && partner.lovePhase !== 'showing') {
                        partner.loveTimer = 3.0;
                        partner.lovePhase = 'showing';
                        partner._lovePartnerId = this.id;
                        try { console.log(`[LOVE] ${partner.id} started loveTimer with partner ${this.id}, affinity=${(affinity||0).toFixed ? affinity.toFixed(1) : affinity}`); } catch(e){}
                    }
                }
            } else if (partner) {
                this.state = 'idle';
                this.action = null;
            } else {
                this.state = 'idle';
                this.action = null;
            }
            // Let strong conversations continue until the tie reaches the bonded tier.
            const currentAffinity = this.relationships.get(partner?.id) || 0;
            if(this.needs.social >= 100 && currentAffinity >= socializeCompletionAffinity) {
                this.state = 'idle';
            }
        }
        // Death condition (旧: hunger <= -10 はclipにより到達不能だったため上部のstarvationTimerに移行)
        // starvation death is now handled above via _starvationTimer
        // --- 行動決定 ---
        if (this.state === 'idle') {
            this.actionCooldown -= deltaTime;
            if (this.actionCooldown <= 0) this.decideNextAction && this.decideNextAction(isNight);
        }
        // moving状態でも定期的にactionCooldownを減少させ、必要に応じて新しいアクションを決定
        else if (this.state === 'moving') {
            this.actionCooldown -= deltaTime;
            if (this.actionCooldown <= 0) {
                const hungerEmergency = (typeof window !== 'undefined' && window.hungerEmergencyThreshold !== undefined) ? Number(window.hungerEmergencyThreshold) : 5;
                const energyEmergency = (typeof window !== 'undefined' && window.energyEmergencyThreshold !== undefined) ? Number(window.energyEmergencyThreshold) : 20;
                const urgentNeeds = (this.needs.hunger <= (hungerEmergency + 6) || this.needs.energy <= (energyEmergency + 6));
                const interruptibleMove = !this.action || ['WANDER', 'SOCIALIZE'].includes(this.action.type);
                if (urgentNeeds && interruptibleMove) {
                    this.clearNavigationState();
                    this.state = 'idle';
                    this.action = null;
                    this.actionCooldown = 0.2;
                    this.decideNextAction && this.decideNextAction(isNight);
                }

                // 重要なアクション実行中は新しいアクション決定を控える
                const now = Date.now();
                const isImportantActionProtected = this._lastImportantActionTime && (now - this._lastImportantActionTime < 3000); // 3秒間保護
                const stallMs = (typeof window !== 'undefined' && window.movingReplanStallMs !== undefined) ? Number(window.movingReplanStallMs) : 2500;
                const noRecentProgress = !this._lastMoveProgressTime || (now - this._lastMoveProgressTime) > stallMs;
                if (this.state === 'moving' && !isImportantActionProtected && noRecentProgress) {
                    // Move replan only when stalled, otherwise keep current target to avoid tremble.
                    this.actionCooldown = 1.2;
                    this.decideNextAction && this.decideNextAction(isNight);
                } else if (this.state === 'moving') {
                    this.actionCooldown = 1.0;
                }
            }
        }
        // working状態では作業完了まで新しいアクション決定を控える
        else if (this.state === 'working') {
            this.actionCooldown -= deltaTime;
            if (this.actionCooldown <= 0) {
                // 作業状態では頻繁にAI呼び出しをしない（5秒間隔）
                this.actionCooldown = 5.0;
                // 重要なアクションが進行中でなければ新しいアクションを決定
                if (!this.action || !['BUILD_HOME', 'CHOP_WOOD', 'DESTROY_BLOCK'].includes(this.action.type)) {
                    this.decideNextAction && this.decideNextAction(isNight);
                }
            }
        }
        // SOCIALIZE状態中は、極端に緊急でない限りAI上書きを防ぐ
        else if (this.state === 'socializing') {
            // 餓死寸前（hunger <= 5）または極度の疲労（energy <= 5）の場合のみ中断
            const hungerEmergency = (typeof window !== 'undefined' && window.hungerEmergencyThreshold !== undefined) ? Number(window.hungerEmergencyThreshold) : 5;
            const energyEmergency = (typeof window !== 'undefined' && window.energyEmergencyThreshold !== undefined) ? Number(window.energyEmergencyThreshold) : 20;
            if (this.needs.hunger <= hungerEmergency || this.needs.energy <= energyEmergency) {
                this.state = 'idle';
                this.action = null;
                this.actionCooldown = 0.1;
                // パートナーにも中断を通知
                const partner = this.action?.target;
                if (partner && partner.state === 'socializing') {
                    partner.state = 'idle';
                    partner.action = null;
                    partner.actionCooldown = 0.1;
                }
            }
        }
        if (this.state === 'moving') this.updateMovement(deltaTime);
        this.updateAnimations(deltaTime);
        // Age all characters (used for both maturity and lifespan)
        this.age += deltaTime;
        // Child aging: mature when reaching maturityAge
        if (this.isChild) {
            if (this.age >= (this.maturityAge || 60)) {
                // mature: restore movement, scale, and clear child flag
                this.isChild = false;
                if (typeof this._preChildMovementSpeed === 'number') this.movementSpeed = this._preChildMovementSpeed;
                if (this.mesh && this.mesh.scale) this.mesh.scale.set(1,1,1);
                if (this.body && this.body.scale) this.body.scale.set(1,1,1);
                if (this.head && this.head.scale) this.head.scale.set(1,1,1);
                if (this.shadowMesh && this.shadowMesh.scale) this.shadowMesh.scale.multiplyScalar(1.3333);
                try { console.log(`[GROW] ${this.id} matured after ${Math.round(this.age)}s`); } catch(e){}
            }
        }
        // Natural lifespan: adults die of old age, making room for offspring
        if (!this.isChild && this.state !== 'dead') {
            const lifespan = this.getEffectiveLifespan();
            if (this.age >= lifespan) {
                try { console.log(`[LIFESPAN] ${this.id} died of old age (${Math.round(this.age)}s, gen=${this.generation})`); } catch(e){}
                this.die('old_age');
                return;
            }
        }
        // --- loveTimer減少 ---
        if (this.loveTimer > 0) {
            const prev = this.loveTimer;
            this.loveTimer -= deltaTime;
            if (this.loveTimer < 0) {
                this.loveTimer = 0;
                // debug: loveTimer expired — print context to diagnose reproduction issues
                try {
                    // prefer persisted partner id but fallback to current action target
                    const partnerId = this._lovePartnerId || (this.action && this.action.target ? this.action.target.id : null);
                    const affinity = partnerId ? (this.relationships.get(partnerId) || 0) : null;
                    console.log(`[LOVE-TIMER] ${this.id} expired (prev=${prev.toFixed(2)}). lovePhase=${this.lovePhase} state=${this.state} partner=${partnerId} affinity=${affinity}`);

                    // Attempt reproduction if conditions met and partner still exists
                    if (partnerId && affinity >= ((typeof window !== 'undefined' && window.reproduceAffinityThreshold !== undefined) ? window.reproduceAffinityThreshold : 60)) {
                        const chars = (typeof window !== 'undefined' && window.characters) ? window.characters : (typeof characters !== 'undefined' ? characters : []);
                        const partner = chars.find(c => c.id === partnerId);
                        if (partner) {
                            // allow reproduction if partner is socializing OR still showing love OR physically adjacent
                            const prox = Math.abs(this.gridPos.x - partner.gridPos.x) + Math.abs(this.gridPos.y - partner.gridPos.y) + Math.abs(this.gridPos.z - partner.gridPos.z);
                            const partnerShowingLove = (partner.lovePhase === 'showing' || (partner.loveTimer && partner.loveTimer > 0));
                            if (partner.state === 'socializing' || partnerShowingLove || prox <= 1) {
                                // per-pair cooldown — only gate, no permanent one-child lock
                                if (!window._pairReproTimestamps) window._pairReproTimestamps = new Map();
                                if (window.pairReproductionCooldownSeconds === undefined) window.pairReproductionCooldownSeconds = 60;
                                const a = Math.min(this.id, partner.id);
                                const b = Math.max(this.id, partner.id);
                                const key = `${a}-${b}`;
                                const last = window._pairReproTimestamps.get(key) || 0;
                                const now = Date.now() / 1000;
                                const left = Math.max(0, Math.ceil(window.pairReproductionCooldownSeconds - (now - last)));
                                if (last > 0 && (now - last) < window.pairReproductionCooldownSeconds) {
                                    console.log(`[REPRO-PAIR] ${this.id}-${partner.id} blocked: cooldown active (${left}s left)`);
                                } else {
                                    // 繁殖年齢ウィンドウ
                                    const _minAgeRatio2 = (typeof window !== 'undefined' && window.minReproductionAgeRatio !== undefined) ? window.minReproductionAgeRatio : 0.2;
                                    const _ls2 = this.lifespan || (typeof window !== 'undefined' && window.characterLifespan) || 240;
                                    const _pls2 = partner.lifespan || _ls2;
                                    if ((this.age / _ls2) < _minAgeRatio2 || (partner.age / _pls2) < _minAgeRatio2) {
                                        console.log(`[LOVE-TIMER] ${this.id} reproduce skipped: too young (ageRatio=${(this.age/_ls2).toFixed(2)} partnerRatio=${(partner.age/_pls2).toFixed(2)} min=${_minAgeRatio2})`);
                                    } else if (this.needs.hunger <= 15 || partner.needs.hunger <= 15) {
                                        console.log(`[LOVE-TIMER] ${this.id} reproduce skipped: hunger crisis (self=${this.needs.hunger.toFixed(1)} partner=${partner.needs.hunger.toFixed(1)})`);
                                    } else if (!this.shouldAttemptReproductionWith(partner)) {
                                        const ctx = this._lastReproductionBlockInfo || this.getReproductionReadiness(partner);
                                        console.log(`[LOVE-TIMER] ${this.id} reproduce skipped: district pressure high (pressure=${(ctx.socialPressure || 0).toFixed(2)} readiness=${(ctx.readiness || 0).toFixed(2)})`);
                                    } else {
                                    console.log(`[LOVE-TIMER] ${this.id} attempting reproduceWith partner ${partner.id} (prox=${prox} state=${partner.state} partnerLove=${partner.lovePhase})`);
                                    this.reproduceWith && this.reproduceWith(partner);
                                    window._pairReproTimestamps.set(key, now);
                                    const resetVal = (typeof window !== 'undefined' && window.affinityResetAfterReproduce !== undefined) ? window.affinityResetAfterReproduce : 42;
                                    this.relationships.set(partner.id, resetVal);
                                    partner.relationships.set(this.id, resetVal);
                                    this.lovePhase = 'completed';
                                    partner.lovePhase = 'completed';
                                    } // end age gate
                                }
                            } else {
                                console.log(`[LOVE-TIMER] ${this.id} reproduce skipped: partner exists but not socializing/nearby (state=${partner.state} prox=${prox} lovePhase=${partner.lovePhase})`);
                            }
                        } else {
                            console.log(`[LOVE-TIMER] ${this.id} reproduce skipped: partner not found or not socializing`);
                        }
                    }
                } catch (e) {}
                // SOCIALIZE状態終了時にlovePhaseをリセット
                if (this.state !== 'socializing') {
                    this.lovePhase = null;
                }
            }
        }
        this.updateThoughtBubble(isNight, camera);

        // --- Stall detection and optional auto-recovery ---
        try {
            // config via window for runtime tuning
            const maxCooldown = (typeof window !== 'undefined' && window.maxActionCooldown !== undefined) ? window.maxActionCooldown : 8;
            const recoverCooldown = (typeof window !== 'undefined' && window.recoverActionCooldown !== undefined) ? window.recoverActionCooldown : 0.5;
            const autoRecover = (typeof window !== 'undefined' && window.autoRecoverStall !== undefined) ? window.autoRecoverStall : true;

            if (!this._stallState) this._stallState = { logged: false, cooldownLogged: false };

            // Only treat long cooldowns as stalls when the character isn't intentionally in a long-blocking state
            // e.g., working / meeting / resting are expected to have longer actionCooldown values
            const stallEligibleStates = new Set(['idle', 'moving', 'socializing', 'confused']);
            const isEligibleForStall = stallEligibleStates.has(this.state);

            // Diagnostic: if actionCooldown is very large, log once to help track where it's coming from
            const bigThreshold = maxCooldown * 2;
            if (this.actionCooldown && this.actionCooldown > bigThreshold && !this._stallState.cooldownLogged) {
                console.warn(`[ACTION-COOLDOWN] Char ${this.id} unusually large actionCooldown=${(this.actionCooldown||0).toFixed(2)} state=${this.state} action=${this.action?this.action.type:'-'} pathLen=${this.path?this.path.length:0}`);
                this._stallState.cooldownLogged = true;
            }
            if (this.actionCooldown && this.actionCooldown <= maxCooldown && this._stallState.cooldownLogged) {
                // reset the one-time diagnostic when cooldown returns to normal
                this._stallState.cooldownLogged = false;
            }

            if ((this.actionCooldown && this.actionCooldown > maxCooldown && isEligibleForStall) || (this._microPauseTimer && this._microPauseTimer > 1.2)) {
                if (!this._stallState.logged) {
                    console.warn(`[STALL] Char ${this.id} appears stalled: state=${this.state} actionCooldown=${(this.actionCooldown||0).toFixed(2)} microPause=${(this._microPauseTimer||0).toFixed(2)} pathLen=${this.path?this.path.length:0}`);
                    try {
                        if (typeof window !== 'undefined' && window.simTestMode && window.__simTelemetry && typeof window.__simTelemetry.addEvent === 'function') {
                            window.__simTelemetry.addEvent({
                                t: Date.now(),
                                id: this.id,
                                kind: 'stall-detected',
                                state: this.state,
                                action: this.action ? this.action.type : null,
                                actionCooldown: Number(this.actionCooldown || 0),
                                microPause: Number(this._microPauseTimer || 0),
                                pathLen: this.path ? this.path.length : 0,
                                needs: {
                                    hunger: Number(this.needs?.hunger || 0),
                                    energy: Number(this.needs?.energy || 0),
                                    safety: Number(this.needs?.safety || 0),
                                    social: Number(this.needs?.social || 0)
                                }
                            });
                        }
                    } catch (e) {}
                    this._stallState.logged = true;
                }
                if (autoRecover && isEligibleForStall) {
                    // nudge recovery: lower cooldown and force AI decision
                    this.actionCooldown = recoverCooldown;
                    // clear micro pause so movement can resume
                    this._microPauseTimer = 0;
                    // reset some stuck counters to allow rescue logic to operate again
                    this.bfsFailCount = 0;
                    if (this.state !== 'dead') {
                        try { this.decideNextAction && this.decideNextAction(isNight); } catch (e) {}
                    }
                }
            } else if (this._stallState.logged) {
                console.log(`[STALL] Char ${this.id} recovered: actionCooldown=${(this.actionCooldown||0).toFixed(2)}`);
                try {
                    if (typeof window !== 'undefined' && window.simTestMode && window.__simTelemetry && typeof window.__simTelemetry.addEvent === 'function') {
                        window.__simTelemetry.addEvent({
                            t: Date.now(),
                            id: this.id,
                            kind: 'stall-recovered',
                            state: this.state,
                            action: this.action ? this.action.type : null,
                            actionCooldown: Number(this.actionCooldown || 0),
                            microPause: Number(this._microPauseTimer || 0)
                        });
                    }
                } catch (e) {}
                this._stallState.logged = false;
            }
        } catch (e) {}

        // Telemetry sampling for reproducible jitter/stall analysis
        try {
            if (typeof window !== 'undefined' && window.simTestMode && window.__simTelemetry && typeof window.__simTelemetry.addSample === 'function') {
                const intervalMs = (window.simTelemetryConfig && window.simTelemetryConfig.sampleIntervalMs) ? Number(window.simTelemetryConfig.sampleIntervalMs) : 1000;
                const now = Date.now();
                const hungerEmergency = (typeof window !== 'undefined' && window.hungerEmergencyThreshold !== undefined) ? Number(window.hungerEmergencyThreshold) : 5;
                const energyEmergency = (typeof window !== 'undefined' && window.energyEmergencyThreshold !== undefined) ? Number(window.energyEmergencyThreshold) : 20;
                const maxActionCooldown = (typeof window !== 'undefined' && window.maxActionCooldown !== undefined) ? Number(window.maxActionCooldown) : 8;
                const actionType = this.action ? this.action.type : null;
                // Keep transitions semantic (state/action changes) to avoid per-step coordinate event floods.
                const actionKey = `${this.state}|${actionType || '-'}`;
                if (this._telemetryLastActionKey !== actionKey) {
                    window.__simTelemetry.addEvent({
                        t: now,
                        id: this.id,
                        kind: 'action-transition',
                        from: this._telemetryLastActionKey || null,
                        to: actionKey,
                        state: this.state,
                        action: actionType,
                        target: this.targetPos ? { x: this.targetPos.x, y: this.targetPos.y, z: this.targetPos.z } : null,
                        needs: {
                            hunger: Number(this.needs?.hunger || 0),
                            energy: Number(this.needs?.energy || 0),
                            safety: Number(this.needs?.safety || 0),
                            social: Number(this.needs?.social || 0)
                        }
                    });
                    this._telemetryLastActionKey = actionKey;
                }
                if (!this._telemetryNextAt) this._telemetryNextAt = now;
                if (now >= this._telemetryNextAt) {
                    const lifespan = this.getEffectiveLifespan();
                    const inventoryCount = Array.isArray(this.inventory) ? this.inventory.filter(Boolean).length : 0;
                    const telemetryBucket = Math.floor(now / Math.max(200, intervalMs));
                    if (window.__telemetryAliveByIdBucket !== telemetryBucket) {
                        window.__telemetryAliveByIdBucket = telemetryBucket;
                        window.__telemetryAliveById = new Map(
                            (Array.isArray(window.characters) ? window.characters : [])
                                .filter(c => c && c.state !== 'dead')
                                .map(c => [String(c.id), c])
                        );
                    }
                    const telemetryAliveById = window.__telemetryAliveById instanceof Map
                        ? window.__telemetryAliveById
                        : new Map();
                    const homeDistance = this.homePosition
                        ? (Math.abs((this.gridPos?.x || 0) - this.homePosition.x)
                            + Math.abs((this.gridPos?.y || 0) - this.homePosition.y)
                            + Math.abs((this.gridPos?.z || 0) - this.homePosition.z))
                        : null;
                    window.__simTelemetry.addSample({
                        t: now,
                        id: this.id,
                        state: this.state,
                        mood: this.mood,
                        role: this.role || 'worker',
                        groupId: this.groupId || null,
                        generation: Number(this.generation || 0),
                        isChild: !!this.isChild,
                        lifeStage: this.getLifeStage ? this.getLifeStage() : (!!this.isChild ? 'child' : 'adult'),
                        age: Number(this.age || 0),
                        lifespan: lifespan,
                        lifeRatio: Number(this.getLifeRatio().toFixed(4)),
                        action: actionType,
                        pos: { x: this.gridPos.x, y: this.gridPos.y, z: this.gridPos.z },
                        target: this.targetPos ? { x: this.targetPos.x, y: this.targetPos.y, z: this.targetPos.z } : null,
                        pathLen: this.path ? this.path.length : 0,
                        actionCooldown: Number(this.actionCooldown || 0),
                        microPause: Number(this._microPauseTimer || 0),
                        blockedRetry: Number(this._blockedRetryCount || 0),
                        bfsFailCount: Number(this.bfsFailCount || 0),
                        moveDistance: Number(this.moveDistance || 0),
                        needs: {
                            hunger: Number(this.needs?.hunger || 0),
                            energy: Number(this.needs?.energy || 0),
                            safety: Number(this.needs?.safety || 0),
                            social: Number(this.needs?.social || 0)
                        },
                        personality: {
                            bravery:          Number(this.personality?.bravery          || 0),
                            diligence:        Number(this.personality?.diligence        || 0),
                            sociality:        Number(this.personality?.sociality        || 0),
                            curiosity:        Number(this.personality?.curiosity        || 0),
                            resourcefulness:  Number(this.personality?.resourcefulness  || 0),
                            resilience:       Number(this.personality?.resilience       || 0)
                        },
                        social: (() => {
                            const rels = this.relationships;
                            const gId = this.groupId || null;
                            const gSize = gId && Array.isArray(window.characters)
                                ? window.characters.filter(c => c.groupId === gId && c.state !== 'dead').length
                                : 1;
                            if (!(rels instanceof Map) || rels.size === 0) {
                                return {
                                    relationshipCount: 0,
                                    avgAffinity: 0,
                                    groupSize: gSize,
                                    bondedCount: 0,
                                    allyCount: 0,
                                    nearbySupport: 0,
                                    supportScore: 0
                                };
                            }
                            const values = Array.from(rels.values()).map(Number).filter(Number.isFinite);
                            const avg = values.reduce((s, v) => s + v, 0) / Math.max(1, values.length);
                            const allyThreshold = (typeof window !== 'undefined' && window.allyAffinityThreshold !== undefined) ? Number(window.allyAffinityThreshold) : 60;
                            const bondedThreshold = (typeof window !== 'undefined' && window.bondedAffinityThreshold !== undefined) ? Number(window.bondedAffinityThreshold) : 80;
                            const nearbyRadius = (typeof window !== 'undefined' && window.nearbySupportRadius !== undefined) ? Number(window.nearbySupportRadius) : 3;
                            const bondedWeight = (typeof window !== 'undefined' && window.supportBondedWeight !== undefined) ? Number(window.supportBondedWeight) : 0.24;
                            const allyWeight = (typeof window !== 'undefined' && window.supportAllyWeight !== undefined) ? Number(window.supportAllyWeight) : 0.12;
                            const nearbyWeight = (typeof window !== 'undefined' && window.supportNearbyWeight !== undefined) ? Number(window.supportNearbyWeight) : 0.10;
                            const topAffinityWeight = (typeof window !== 'undefined' && window.supportTopAffinityWeight !== undefined) ? Number(window.supportTopAffinityWeight) : 0.22;
                            let nearbySupport = 0;
                            for (const [otherId, rawAffinity] of rels.entries()) {
                                const affinity = Number(rawAffinity || 0);
                                if (affinity < allyThreshold) continue;
                                const other = telemetryAliveById.get(String(otherId));
                                if (!other?.gridPos || !this.gridPos) continue;
                                const dist = Math.abs(this.gridPos.x - other.gridPos.x) + Math.abs(this.gridPos.y - other.gridPos.y) + Math.abs(this.gridPos.z - other.gridPos.z);
                                if (dist <= nearbyRadius) nearbySupport += 1;
                            }
                            const bondedCount = values.filter(v => v >= bondedThreshold).length;
                            const allyCount = values.filter(v => v >= allyThreshold).length;
                            const topAffinity = values.length ? Math.max(...values) : 0;
                            const supportScore = Math.max(0, Math.min(1,
                                (bondedCount * bondedWeight) +
                                (allyCount * allyWeight) +
                                (nearbySupport * nearbyWeight) +
                                Math.min(topAffinityWeight, (topAffinity / 100) * topAffinityWeight)
                            ));
                            return {
                                relationshipCount: values.length,
                                avgAffinity: Number(avg.toFixed(2)),
                                groupSize: gSize,
                                bondedCount,
                                allyCount,
                                nearbySupport,
                                supportScore: Number(supportScore.toFixed(2))
                            };
                        })(),
                        home: {
                            hasHome: !!this.homePosition,
                            provisional: !!this.provisionalHome,
                            distance: homeDistance
                        },
                        nearEnemy: !!this._nearEnemy,
                        inventory: {
                            count: inventoryCount,
                            hasTool: Array.isArray(this.inventory) ? this.inventory.includes('STONE_TOOL') : false,
                            hasWood: Array.isArray(this.inventory) ? this.inventory.includes('WOOD_LOG') : false
                        },
                        decisionPressure: {
                            hungerEmergency,
                            energyEmergency,
                            lowHunger: Number(this.needs?.hunger || 0) <= hungerEmergency,
                            lowEnergy: Number(this.needs?.energy || 0) <= energyEmergency,
                            stallLike: (Number(this.actionCooldown || 0) > maxActionCooldown) || (Number(this._microPauseTimer || 0) > 1.2)
                        }
                    });
                    this._telemetryNextAt = now + Math.max(200, intervalMs);
                }
            }
        } catch (e) {}

    }

    die(cause = 'unknown') {
        try {
            if (typeof window !== 'undefined' && typeof window.recordPopulationDeath === 'function') {
                window.recordPopulationDeath({
                    id: this.id,
                    cause,
                    age: Number(this.age || 0),
                    generation: Number(this.generation || 0),
                    wasChild: !!this.isChild
                });
            }
            if (typeof window !== 'undefined' && window.simTestMode && window.__simTelemetry && typeof window.__simTelemetry.addEvent === 'function') {
                window.__simTelemetry.addEvent({
                    t: Date.now(),
                    id: this.id,
                    kind: 'death',
                    cause,
                    state: this.state,
                    action: this.action ? this.action.type : null,
                    generation: Number(this.generation || 0),
                    age: Number(this.age || 0),
                    needs: {
                        hunger: Number(this.needs?.hunger || 0),
                        energy: Number(this.needs?.energy || 0),
                        safety: Number(this.needs?.safety || 0),
                        social: Number(this.needs?.social || 0)
                    }
                });
            }
        } catch (e) {}

        // --- Death Record tombstone: persist lightweight snapshot before instance is discarded ---
        try {
            if (typeof window !== 'undefined') {
                if (!window.__deathRecords) window.__deathRecords = [];
                window.__deathRecords.push({
                    id: this.id,
                    generation: Number(this.generation || 0),
                    ageAtDeath: Number(this.age || 0),
                    lifespan: Number(this.getEffectiveLifespan ? this.getEffectiveLifespan() : 240),
                    cause,
                    traits: this.personality ? { ...this.personality } : {},
                    childCount: Number(this.childCount || 0),
                    parentIds: this.parentIds ?? null,
                    groupIdAtDeath: this.groupId ?? null,
                    finalNeeds: {
                        hunger: Number(this.needs?.hunger ?? 0),
                        energy: Number(this.needs?.energy ?? 0),
                        safety: Number(this.needs?.safety ?? 0),
                        social: Number(this.needs?.social ?? 0)
                    }
                });
                // Cap at 200 records (oldest dropped first)
                if (window.__deathRecords.length > 200) window.__deathRecords.shift();
            }
        } catch (e) {}

        // 死亡時に持ち物をワールドにドロップ
        if (this.inventory && this.inventory[0]) {
            const dropPos = { x: this.gridPos.x, y: this.gridPos.y - 1, z: this.gridPos.z };
            let dropBlock = null;
            if (this.inventory[0] === 'STONE_TOOL' && BLOCK_TYPES.STONE) {
                dropBlock = BLOCK_TYPES.STONE;
            } else if (this.inventory.some(item => item === 'WOOD_LOG') && BLOCK_TYPES.WOOD) {
                dropBlock = BLOCK_TYPES.WOOD;
            } else if (this.inventory[0] === 'FRUIT_ITEM' && BLOCK_TYPES.FRUIT) {
                dropBlock = BLOCK_TYPES.FRUIT;
            }
            if (dropBlock) {
                addBlock(dropPos.x, dropPos.y, dropPos.z, dropBlock);
            }
            this.inventory[0] = null;
            this.carriedItemMesh.visible = false;
        }
        // シーンから削除
        if (this.scene && this.mesh) {
            this.scene.remove(this.mesh);
        }
        // 吹き出し削除
        if (this.thoughtBubble && this.thoughtBubble.parentNode) {
            this.thoughtBubble.parentNode.removeChild(this.thoughtBubble);
        }
        // キャラクター配列から削除
        if (typeof window !== 'undefined' && window.characters) {
            const idx = window.characters.findIndex(c => c.id === this.id);
            if (idx !== -1) window.characters.splice(idx, 1);
            // --- Group/leader re-detection after death ---
            Character.handleLeaderDeath(this, window.characters);
        } else if (typeof characters !== 'undefined') {
            const idx = characters.findIndex(c => c.id === this.id);
            if (idx !== -1) characters.splice(idx, 1);
            // --- Group/leader re-detection after death ---
            Character.handleLeaderDeath(this, characters);
        }
        this.state = 'dead';
        this.log('Character died and removed', { id: this.id, cause });
    }

    // リーダー死亡時の混乱: グループ全員をconfused状態にし一定時間後に再選出
    static handleLeaderDeath(deadChar, characters) {
        if (deadChar.role !== 'leader' || !deadChar.groupId) {
            Character.detectGroupsAndElectLeaders(characters);
            return;
        }
        // グループ全員をconfused状態に
        const group = characters.filter(c => c.groupId === deadChar.groupId);
        for (const char of group) {
            char.state = 'confused';
            char.actionCooldown = 2.5 + Math.random() * 2;
        }
        // 一定時間後にリーダー再選出
        setTimeout(() => {
            Character.detectGroupsAndElectLeaders(characters);
            for (const char of group) {
                if (char.state === 'confused') char.state = 'idle';
            }
        }, 2500 + Math.random() * 2000);
    }

    // 死亡時に消滅する仕様のため、revive()は無効化
    revive() {}

    // --- 移動実行の一元化 ---
    moveToGridPos(newGridPos, updateMesh = true) {
        if (!newGridPos) return false;

        // 座標検証
        if (typeof newGridPos.x !== 'number' || typeof newGridPos.y !== 'number' || typeof newGridPos.z !== 'number') {
            this.log('Invalid grid position:', newGridPos);
            return false;
        }

        // 移動可能性チェック
        const key = `${newGridPos.x},${newGridPos.y},${newGridPos.z}`;
        if (worldData.has(key)) {
            this.log('Cannot move to occupied position:', newGridPos);
            return false;
        }

        // 座標更新
        const oldPos = { ...this.gridPos };
        this.gridPos = { ...newGridPos };

        // メッシュ位置更新
        if (updateMesh && this.mesh) {
            this.updateWorldPosFromGrid();
        }

        // 移動距離記録
        if (typeof this.moveDistance === 'number') {
            this.moveDistance += Math.abs(newGridPos.x - oldPos.x) +
                               Math.abs(newGridPos.y - oldPos.y) +
                               Math.abs(newGridPos.z - oldPos.z);
        }

        this.log('Moved from', oldPos, 'to', newGridPos);
        return true;
    }

    // Validate a computed path step-by-step for current passability and corner-cutting
    validatePath(path) {
        if (!path || path.length === 0) return false;
        // configurable lookahead: only validate the first N steps strictly
        const lookahead = (typeof window !== 'undefined' && window.pathValidateLookahead !== undefined) ? Number(window.pathValidateLookahead) : 8;
        const occupancyLookahead = (typeof window !== 'undefined' && window.pathOccupancyLookahead !== undefined) ? Number(window.pathOccupancyLookahead) : 2;
        let from = { ...this.gridPos };
        const stepsToCheck = Math.min(path.length, Math.max(1, lookahead));
        for (let i = 0; i < stepsToCheck; i++) {
            const step = path[i];
            // occupancy / passability check: consider block type passability rather than raw presence
            const key = `${step.x},${step.y},${step.z}`;
            const stepBlockId = worldData.get(key);
            if (!this.isBlockPassable(stepBlockId)) {
                try { if (typeof window !== 'undefined') {
                    window.pathInvalidationStats = window.pathInvalidationStats || { worldBlocked:0, occupied:0, cannotMove:0, cornerBlocked:0 };
                    window.pathInvalidationStats.worldBlocked++;
                }} catch(e){}
                return false;
            }

            // Avoid stepping into a cell occupied by another character/entity
            // Treat dynamic character occupancy as a near-term constraint only.
            // Checking too far ahead causes repath jitter when others are moving.
            if (i < occupancyLookahead && this.isOccupiedByOther(step.x, step.y, step.z)) {
                try { if (typeof window !== 'undefined') { window.pathInvalidationStats = window.pathInvalidationStats || { worldBlocked:0, occupied:0, cannotMove:0, cornerBlocked:0 }; window.pathInvalidationStats.occupied++; } } catch(e){}
                return false;
            }

            // basic can-move check
            const check = this.canMoveToPosition(step.x, step.y, step.z);
            if (!check.canMove) {
                try { if (typeof window !== 'undefined') { window.pathInvalidationStats = window.pathInvalidationStats || { worldBlocked:0, occupied:0, cannotMove:0, cornerBlocked:0 }; window.pathInvalidationStats.cannotMove++; } } catch(e){}
                return false;
            }

            // diagonal corner cutting: prevent moving diagonally between two blocked orthogonals
            if (this._isDiagonalCornerMoveBlocked(from, step)) {
                try { if (typeof window !== 'undefined') { window.pathInvalidationStats = window.pathInvalidationStats || { worldBlocked:0, occupied:0, cannotMove:0, cornerBlocked:0 }; window.pathInvalidationStats.cornerBlocked++; } } catch(e){}
                return false;
            }

            from = { x: step.x, y: step.y, z: step.z };
        }

        // For steps beyond lookahead, assume they'll be checked later during movement.
        return true;
    }

    // Detect diagonal corner moves that would cut through solid corners
    _isDiagonalCornerMoveBlocked(from, to) {
        const dx = to.x - from.x;
        const dz = to.z - from.z;
        // only consider pure horizontal diagonal (no vertical)
        if (Math.abs(dx) === 1 && Math.abs(dz) === 1 && to.y === from.y) {
            // orthogonal neighbours
            const key1 = `${from.x + dx},${from.y},${from.z}`;
            const key2 = `${from.x},${from.y},${from.z + dz}`;
            const b1Raw = worldData.get(key1);
            const b2Raw = worldData.get(key2);
            const blocked1 = (!this.isBlockPassable(b1Raw)) || this.isOccupiedByOther(from.x + dx, from.y, from.z);
            const blocked2 = (!this.isBlockPassable(b2Raw)) || this.isOccupiedByOther(from.x, from.y, from.z + dz);
            // if both orthogonals blocked, diagonal should be blocked
            if (blocked1 && blocked2) return true;
        }
        return false;
    }

    updateMovement(deltaTime) {
        // this.log('updateMovement', { targetPos: this.targetPos, gridPos: this.gridPos }); // コメントアウト
        if (!this.targetPos) { this.state = 'idle'; return; }
        if (!this._blockedRetryCount) this._blockedRetryCount = 0;
        // --- small "alive" movement tweaks ---
        // variable speed (updated intermittently), micro-pauses (hesitation), and short arrival delay
        if (!this._speedTicker) {
            this._speedTicker = 0;
            this._nextSpeedChange = 0.8 + Math.random() * 1.7;
            this._speedMultiplier = 1.0;
        }
        this._speedTicker += deltaTime;
        if (this._speedTicker > this._nextSpeedChange) {
            this._speedMultiplier = 0.92 + Math.random() * 0.16; // between ~0.92 and ~1.08
            this._speedTicker = 0;
            this._nextSpeedChange = 0.8 + Math.random() * 2.0;
        }

        // arrival delay processing: if waiting to perform action after arriving
        if (this._arrivalDelay && this._arrivalDelay > 0) {
            this._arrivalDelay -= deltaTime;
            if (this._arrivalDelay <= 0) {
                this._arrivalDelay = 0;
                this.executeAction && this.executeAction();
            }
            return; // pause movement while thinking/performing arrival delay
        }

        // micro-pause timer decrement (hesitation while moving)
        if (this._microPauseTimer && this._microPauseTimer > 0) {
            this._microPauseTimer -= deltaTime;
            if (this._microPauseTimer > 0) return;
            this._microPauseTimer = 0;
        }
        // --- BFS経路探索（新システム使用） ---
        if (!this.path || this.path.length === 0 || !this.lastTargetPos ||
            this.lastTargetPos.x !== this.targetPos.x || this.lastTargetPos.y !== this.targetPos.y || this.lastTargetPos.z !== this.targetPos.z) {

            // 新しい統一された経路探索システムを使用
            this.path = this.findPathTo(this.targetPos, {
                maxSteps: 128,
                allowDiagonal: true,
                allowVertical: true,
                directMoveThreshold: 3
            });

            // stamp the world state when we computed this path to avoid needless recompute
            try { if (typeof window !== 'undefined') { this._pathWorldStamp = window.worldChangeCounter || 0; } } catch (e) { this._pathWorldStamp = undefined; }

            this.lastTargetPos = { ...this.targetPos };
            // Validate path immediately after computation to avoid outdated/blocked routes
            if (!this.path || this.path.length === 0 || !this.validatePath(this.path)) {
                // try fallback to bfsPath (older but sometimes more permissive)
                if (this._bfsRetryUntil && Date.now() < this._bfsRetryUntil) {
                    this.log('Delaying BFS fallback due to recent failures', {until: this._bfsRetryUntil});
                    this.path = null;
                } else {
                    if (this._bfsRetryUntil && Date.now() < this._bfsRetryUntil) {
                        this.log('Delaying corner-break BFS due to recent failures', {until: this._bfsRetryUntil});
                        this.path = null;
                    } else {
                        this.path = this.bfsPath(this.gridPos, this.targetPos);
                    }
                }
            }

            // If we obtained a valid path, reset invalidation counter
            if (this.path && this.path.length > 0 && this.validatePath(this.path)) {
                this._pathInvalidationCount = 0;
            }

            if (!this.path || this.path.length === 0 || !this.validatePath(this.path)) {
                // --- CHOP_WOOD特化: 木材収集失敗時の積極的対処 ---
                if (this.action && this.action.type === 'CHOP_WOOD') {
                    this.log('CHOP_WOOD pathfinding failed, trying alternative approach');

                    // 近くの木材を再検索（範囲を拡大）
                    const alternativeWood = this.findClosestWood();
                    if (alternativeWood && alternativeWood !== this.action.target) {
                        this.log('Found alternative wood target, switching');
                        this.action.target = alternativeWood;
                        this.setNavigationTarget(alternativeWood);
                        this.path = this.bfsPath(this.gridPos, this.targetPos);
                        if (this.path && this.path.length > 0) {
                            this.bfsFailCount = 0;
                            return; // 成功した場合は続行
                        }
                    }

                    // それでも失敗した場合、近距離なら強制実行
                    const currentTarget = this.action.target || alternativeWood;
                    if (currentTarget) {
                        const dist = Math.abs(this.gridPos.x - currentTarget.x) +
                                    Math.abs(this.gridPos.y - currentTarget.y) +
                                    Math.abs(this.gridPos.z - currentTarget.z);
                        if (dist <= 3) { // 3ブロック以内なら強制実行
                            this.log('CHOP_WOOD: Force execution within 3 blocks, distance:', dist);
                            this.state = 'working';
                            this.clearNavigationState();
                            this.executeAction();
                            return;
                        }
                    }
                }

                // --- 追加: COLLECT_FOOD時はターゲットを失敗リストに追加 ---
                if (this.action && this.action.type === 'COLLECT_FOOD' && this.action.target) {
                    const {x, y, z} = this.action.target;
                    Character.failedFoodTargets.set(`${x},${y},${z}`, Date.now());
                    this.log('Added unreachable food target to failedFoodTargets (TTL 90s)', {x, y, z});
                }
                this.bfsFailCount = (this.bfsFailCount || 0) + 1;
                this.log('BFS failed, incrementing bfsFailCount', this.bfsFailCount);
                // set a small retry cooldown proportional to bfsFailCount to avoid tight loops
                try {
                    const baseMs = (typeof window !== 'undefined' && window.bfsRetryBaseMs !== undefined) ? Number(window.bfsRetryBaseMs) : 300;
                    const perFailMs = (typeof window !== 'undefined' && window.bfsRetryBackoffMs !== undefined) ? Number(window.bfsRetryBackoffMs) : 200;
                    const extra = Math.min(2000, (this.bfsFailCount || 0) * perFailMs);
                    // add some jitter so many characters don't retry in sync
                    const jitter = Math.floor(Math.random() * Math.min(400, Math.max(100, perFailMs)));
                    this._bfsRetryUntil = Date.now() + baseMs + extra + jitter;
                } catch (e) {}
                // --- 経路が見つからないとき: 近くの壊せるブロックを壊して道を作る ---
                let brokeBlock = false;
                const directions = [
                    {dx:1, dy:0, dz:0}, {dx:-1, dy:0, dz:0}, {dx:0, dy:0, dz:1}, {dx:0, dy:0, dz:-1},
                    {dx:0, dy:1, dz:0}, {dx:0, dy:-1, dz:0}
                ];
                for (const dir of directions) {
                    const x = this.gridPos.x + dir.dx;
                    const y = this.gridPos.y + dir.dy;
                    const z = this.gridPos.z + dir.dz;
                    const key = `${x},${y},${z}`;
                    const blockId = worldData.get(key);
                    const blockType = Object.values(BLOCK_TYPES).find(t => t.id === blockId);
                    // 掘る前に落下先が安全か判定
                    if (blockType && blockType.diggable) {
                        // Avoid repeatedly digging the same block: keep a recent-dig map with TTL
                        try {
                            if (typeof window !== 'undefined') {
                                if (!window._recentlyDug) window._recentlyDug = new Map();
                            }
                            const digKey = `${x},${y},${z}`;
                            // If another char recently failed to dig this reserved block, skip it briefly
                            const failMap = (typeof window !== 'undefined') ? window._digBlockFailCounts : null;
                            const failT = failMap ? failMap.get(digKey) : null;
                            const failSkipMs = (typeof window !== 'undefined' && window.digFailSkipMs !== undefined) ? Number(window.digFailSkipMs) : 4000;
                            if (failT) {
                                // failT may be a past timestamp (last fail) or a future-until timestamp (backoff until)
                                const nowT = Date.now();
                                if (failT > nowT) {
                                    // stored as future-until timestamp -> skip until then
                                    // add a small cooldown to avoid immediate retry loops
                                    this.actionCooldown = Math.max(this.actionCooldown || 0, 0.6 + Math.random() * 0.6);
                                    try { this._scheduleShortBfsRetry(); } catch(e){}
                                    continue;
                                }
                                if ((nowT - failT) < failSkipMs) {
                                    // recent failure within TTL
                                    // add a small cooldown to avoid immediate retry loops
                                    this.actionCooldown = Math.max(this.actionCooldown || 0, 0.6 + Math.random() * 0.6);
                                    try { this._scheduleShortBfsRetry(); } catch(e){}
                                    continue;
                                }
                            }
                            const now = Date.now();
                            const recentMs = (typeof window !== 'undefined' && window.recentDigCooldownMs !== undefined) ? window.recentDigCooldownMs : 10000;
                            const lastAttempt = (typeof window !== 'undefined' && window._recentlyDug) ? window._recentlyDug.get(digKey) : null;
                            // allow override of recent-dig throttle when we've repeatedly failed to find a path
                            // but require a fraction of the cooldown to have passed so override isn't too aggressive
                            const allowOverrideAfterFails = (typeof window !== 'undefined' && window.recentDigAllowAfterBfsFailCount !== undefined) ? Number(window.recentDigAllowAfterBfsFailCount) : 1;
                            const overrideMinFraction = (typeof window !== 'undefined' && window.digOverrideMinFraction !== undefined) ? Number(window.digOverrideMinFraction) : 0.6;
                            const shouldOverride = (this.bfsFailCount && this.bfsFailCount > allowOverrideAfterFails && (!lastAttempt || (now - lastAttempt) > (recentMs * overrideMinFraction)));
                            if (lastAttempt && (now - lastAttempt) < recentMs && !shouldOverride) {
                                this.log('Skip digging: recently attempted', digKey);
                                // small cooldown so this char doesn't immediately retry and cause visual jitter
                                this.actionCooldown = Math.max(this.actionCooldown || 0, 0.6 + Math.random() * 0.6);
                                try { this._bfsRetryUntil = Date.now() + 150 + Math.floor(Math.random() * 250); } catch(e){}
                                continue;
                            }
                                if (lastAttempt && (now - lastAttempt) < recentMs && shouldOverride) {
                                // When overriding, add a small randomized backoff so multiple chars do not all retry simultaneously
                                const extraBackoff = 200 + Math.floor(Math.random() * 800); // 200-1000ms
                                const failMap2 = (typeof window !== 'undefined') ? window._digBlockFailCounts : null;
                                try {
                                    if (failMap2) failMap2.set(digKey, Date.now() + extraBackoff);
                                } catch (e) {}
                                this.log('Override recent-dig throttle due to repeated BFS failures (with backoff)', digKey, {bfsFailCount: this.bfsFailCount, backoffMs: extraBackoff});
                                }
                        } catch (e) { /* ignore */ }

                        let fallY = y;
                        // 掘ったら落下する場合は下まで落ちる
                        while (fallY > 0 && !worldData.has(`${x},${fallY-1},${z}`)) fallY--;
                        if (this.isSafeToFallOrDig(x, fallY, z)) {
                            // use reservation-based removal and only treat as success if it actually removed
                            const removed = this.reserveAndRemoveBlock(x, y, z, { allowBottomRescue: true });
                            if (removed) {
                                // record recent dig attempt to avoid repetition
                                try {
                                    if (typeof window !== 'undefined' && window._recentlyDug) {
                                        window._recentlyDug.set(`${x},${y},${z}`, Date.now());
                                    }
                                } catch (e) {}
                                this.log('Rescue: destroyed nearby diggable block to create path (safe)', {x, y, z, fallY});
                                brokeBlock = true;
                                // Give more time after rescue digging so other chars/world update
                                const digCooldown = (typeof window !== 'undefined' && window.digActionCooldown !== undefined) ? window.digActionCooldown : 2200;
                                this.actionCooldown = (digCooldown / 1000) + Math.random() * 0.5;
                                break;
                            } else {
                                this.log('Rescue attempt did not remove block (reserved/protected), continuing', {x, y, z, fallY});
                            }
                        } else {
                            this.log('Skip digging: fall destination not safe', {x, y, z, fallY});
                        }
                    }
                }
                // --- 一定回数失敗したら: ランダムな方向に強制掘削（安全な落下先のみ） ---
                if (!brokeBlock && this.bfsFailCount > 2) {
                    const digDirs = directions.filter(d => {
                        const x = this.gridPos.x + d.dx;
                        const y = this.gridPos.y + d.dy;
                        const z = this.gridPos.z + d.dz;
                        const key = `${x},${y},${z}`;
                        const blockId = worldData.get(key);
                        // 強制掘削も安全な落下先のみ許可
                        const normBlockId = this._normalizeBlockVal(blockId);
                        if (normBlockId !== undefined && normBlockId !== null && normBlockId !== BLOCK_TYPES.AIR.id) {
                            let fallY = y;
                            while (fallY > 0 && !worldData.has(`${x},${fallY-1},${z}`)) fallY--;
                            return this.isSafeToFallOrDig(x, fallY, z);
                        }
                        return false;
                    });
                    if (digDirs.length > 0) {
                        const randDir = digDirs[Math.floor(Math.random() * digDirs.length)];
                        const x = this.gridPos.x + randDir.dx;
                        const y = this.gridPos.y + randDir.dy;
                        const z = this.gridPos.z + randDir.dz;
                        // use reservation-based removal and only treat as success if actually removed
                        const removed = this.reserveAndRemoveBlock(x, y, z, { allowBottomRescue: true });
                        if (removed) {
                            this.log('Rescue: forcibly dug random direction after multiple path fails', {x, y, z});
                            this.bfsFailCount = 0; // リセット
                            this.actionCooldown = 2.0; // Give time for the change to take effect
                            this.state = 'idle';
                            return;
                        } else {
                            this.log('Forced-dig attempt did not remove block (reserved/protected), skipping', {x, y, z});
                        }
                    }
                }
                if (this.bfsFailCount > 2) {
                    const tpos = this.action?.target;
                    this.log(`BFS: too many failures, giving up [action=${this.action?.type} target=${tpos ? `${tpos.x},${tpos.y},${tpos.z}` : 'none'}]`);

                        this.clearNavigationState();
                    this.state = 'idle';
                    this.bfsFailCount = 0;
                    this.actionCooldown = 2.0; // Longer cooldown when giving up
                    // Release reservation for this target if we reserved it and increment failure count
                    if (this.action && this.action.target) {
                        const tx = this.action.target.x, ty = this.action.target.y, tz = this.action.target.z;
                        const tkey = `${tx},${ty},${tz}`;
                        Character.releaseReservation(tkey, this.id);
                        const res = Character.incrFailedTarget(tkey);
                        if (res === -1) {
                            this.log('Target reached blacklist threshold, blacklisting until TTL:', tkey);
                        }
                    }
                    // release any sidestep reservation held by this character
                    this.releaseReservedSidestep && this.releaseReservedSidestep();
                    return;
                }
                this.log(`BFS: path failed, retrying [action=${this.action?.type} fail#${this.bfsFailCount}]`);

                this.actionCooldown = brokeBlock ? 2.0 : 1.0; // Longer cooldown if we dug a block
                this.state = 'idle';
                return;
            }
            this.bfsFailCount = 0;
        }
        // 1マスずつ進む
        const next = this.path[0];
            if (!next) {
            // clear any sidestep reservation when path emptied
            this.releaseReservedSidestep && this.releaseReservedSidestep();
            this.state = 'idle';
            this.clearNavigationState();
            this.log(`Arrived [action=${this.action?.type} pos=${this.gridPos.x},${this.gridPos.y},${this.gridPos.z}]`);
            this.performAction && this.performAction();
            return;
        }
        // If the next cell is occupied by another character, try a local avoidance sidestep
        if (this.isOccupiedByOther(next.x, next.y, next.z)) {
            const sidestep = this.tryLocalAvoidance(next);
            if (sidestep) {
                // Prepend sidestep to path so we move there first
                this.path.unshift(sidestep);
                this._blockedRetryCount = 0;
            } else {
                // Temporary congestion: wait briefly before giving up to avoid stop-jitter.
                this._blockedRetryCount += 1;
                this._microPauseTimer = Math.max(this._microPauseTimer || 0, 0.12 + Math.random() * 0.18);
                if (this._blockedRetryCount < 6) {
                    return;
                }
                // Prolonged block: then force a recompute.
                this.releaseReservedSidestep && this.releaseReservedSidestep();
                this.clearNavigationState({ clearTarget: false, resetBlockedRetry: true });
                this.state = 'idle';
                this.actionCooldown = 0.6 + Math.random() * 0.3;
                return;
            }
        }
        // Re-validate remaining path in case world changed while moving
        // Check if world changed since we computed the path; if not, proceed to validate.
        const currentWorldStamp = (typeof window !== 'undefined') ? (window.worldChangeCounter || 0) : 0;
        if (this._pathWorldStamp !== undefined && this._pathWorldStamp === currentWorldStamp) {
            if (!this.validatePath(this.path)) {
                this.log('Path invalidated mid-move, clearing and will recompute');
                this.releaseReservedSidestep && this.releaseReservedSidestep();
                this.clearNavigationState({ clearTarget: false });
            } else {
                // path still valid under same world stamp
            }
        } else {
            // world changed since path was computed -> be conservative: revalidate fully
            if (!this.validatePath(this.path)) {
                this.log('World changed since path computed; path invalid, clearing');
                this.releaseReservedSidestep && this.releaseReservedSidestep();
                this.clearNavigationState({ clearTarget: false });
            }
        }
        if (!this.path || this.path.length === 0) {
            this.state = 'idle';
            // path invalidation backoff: avoid immediate recompute loops (tunable)
            if (!this._pathInvalidationCount) this._pathInvalidationCount = 0;
            this._pathInvalidationCount++;
            const factor = 0.2;
            const maxExtra = 2.0;
            const extra = Math.min(maxExtra, factor * this._pathInvalidationCount);
            this.actionCooldown = 0.4 + extra + Math.random() * 0.2;
            // if we've had many invalidations recently, reset counters and add longer cooldown
            if (this._pathInvalidationCount > 6) {
                this._pathInvalidationCount = 0;
                this.actionCooldown += 0.8 + Math.random() * 0.8;
            }
            return;
        }
        // --- 落下先が安全か判定してから移動 ---
        if (next.y < this.gridPos.y) {
            // 下に降りる場合、落下先が安全か判定
            if (!this.isSafeToFallOrDig(next.x, next.y, next.z)) {
                this.log('Skip move: fall destination not safe', {from: this.gridPos, to: next});
                this.state = 'idle';
                this.clearNavigationState({ clearTarget: false });
                this.actionCooldown = 0.5;
                return;
            }
        }
        const prevGridPos = { ...this.gridPos };
        const targetWorldPos = new THREE.Vector3(next.x + 0.5, next.y + 0.5, next.z + 0.5);
        const direction = targetWorldPos.clone().sub(this.mesh.position);
        // 顔の向き（body/headのrotation.y）を移動方向に合わせる
        if (direction.lengthSq() > 0.0001) {
            const desired = Math.atan2(direction.x, direction.z);
            if (this._bodyYaw === undefined) this._bodyYaw = this.body.rotation.y || 0;
            let delta = desired - this._bodyYaw;
            while (delta > Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            const maxTurnRate = (typeof window !== 'undefined' && window.characterTurnRateRad !== undefined) ? Number(window.characterTurnRateRad) : 8.0;
            const maxTurn = Math.max(0.05, maxTurnRate * deltaTime);
            const turn = Math.max(-maxTurn, Math.min(maxTurn, delta));
            this._bodyYaw += turn;
            this.body.rotation.y = this._bodyYaw;
            this.head.rotation.y += (this._bodyYaw - this.head.rotation.y) * 0.35;
        }
    // apply speed multiplier for slight variation
    const aging = this.getAgingProfile ? this.getAgingProfile() : { mobilityMul: 1.0 };
    const effectiveSpeed = (this.movementSpeed || 1.0) * (this._speedMultiplier || 1.0) * (aging.mobilityMul || 1.0);
    const moveDistance = effectiveSpeed * deltaTime;
        if (direction.length() < moveDistance) {
            // 移動実行前の最終当たり判定チェック
            const moveCheck = this.canMoveToPosition(next.x, next.y, next.z);
            if (!moveCheck.canMove) {
                this.log(`Movement blocked: ${moveCheck.reason} at target position:`, next);
                // Transient block should not immediately collapse movement state.
                this._blockedRetryCount += 1;
                this._microPauseTimer = Math.max(this._microPauseTimer || 0, 0.1 + Math.random() * 0.2);
                if (this._blockedRetryCount >= 4) {
                    this.clearNavigationState({ clearTarget: false, resetBlockedRetry: true });
                    this.state = 'idle';
                    this.actionCooldown = 0.5 + Math.random() * 0.3;
                }
                return;
            }

                this.mesh.position.copy(targetWorldPos);
            this.gridPos = {x: next.x, y: next.y, z: next.z};
            this._lastMoveProgressTime = Date.now();
            this._blockedRetryCount = 0;
            // --- ここで移動距離を加算 ---
            const dist = Math.abs(prevGridPos.x - next.x) + Math.abs(prevGridPos.y - next.y) + Math.abs(prevGridPos.z - next.z);
            if (dist > 0) this.moveDistance += dist;
            this.path.shift();
            // If we moved into a reserved sidestep position we held, clear that reservation now
            if (this._reservedSidestepKey) {
                const arrivedKey = `${this.gridPos.x},${this.gridPos.y},${this.gridPos.z}`;
                if (arrivedKey === this._reservedSidestepKey) {
                    this.releaseReservedSidestep && this.releaseReservedSidestep();
                }
            }
            if (this.path.length === 0) {
                // arrived: short thinking pause before action to feel alive
                this._arrivalDelay = 0.12 + Math.random() * 0.22; // 120-340ms
                return;
            }
        } else {
            direction.normalize();
            const nextWorldPos = this.mesh.position.clone().add(direction.clone().multiplyScalar(moveDistance));
            const traverse = this.canTraverseWorldSegment(this.mesh.position, nextWorldPos);
            if (!traverse.canMove) {
                const slideTarget = this.tryWallSlideMove(direction, moveDistance);
                if (slideTarget) {
                    this.mesh.position.copy(slideTarget);
                    this._lastMoveProgressTime = Date.now();
                    this._blockedRetryCount = Math.max(0, (this._blockedRetryCount || 0) - 1);
                    return;
                }
                this._blockedRetryCount += 1;
                this._microPauseTimer = Math.max(this._microPauseTimer || 0, 0.08 + Math.random() * 0.16);
                if (this._blockedRetryCount >= 4) {
                    this.log(`Movement segment blocked: ${traverse.reason}`, traverse.at || {});
                    this.clearNavigationState({ clearTarget: false, resetBlockedRetry: true });
                    this.state = 'idle';
                    this.actionCooldown = 0.45 + Math.random() * 0.25;
                }
                return;
            }
            this.mesh.position.copy(nextWorldPos);
        }
        // --- 汎用スタック判定＋救助（移動中も呼ぶ） ---
        const stuckInfo = this.isStuck();
        this.rescueStuck(stuckInfo, deltaTime);
        // --- 角スタック救済ロジック ---
        // 1. 角スタック検出: 周囲2方向が壁で進めない（L字型や角）
        // 2. 一定時間（例: 1.5秒）動けなければ強制的に1つ壊す
        if (!this._cornerStuckTimer) this._cornerStuckTimer = 0;
        let isCornerStuck = false;
        let wallCount = 0;
        let wallPos = null;
        const directions = [
            {dx:1, dz:0}, {dx:-1, dz:0}, {dx:0, dz:1}, {dx:0, dz:-1}
        ];
        for (const dir of directions) {
            const x = this.gridPos.x + dir.dx;
            const z = this.gridPos.z + dir.dz;
            const y = this.gridPos.y;
            const key = `${x},${y},${z}`;
            const blockId = worldData.get(key);
            const normBlockId2 = this._normalizeBlockVal(blockId);
            if (normBlockId2 && normBlockId2 !== BLOCK_TYPES.AIR.id) {
                wallCount++;
                if (!wallPos) wallPos = {x, y, z};
            }
        }
        // 2方向以上が壁なら角スタックの可能性
        if (wallCount >= 2) {
            // 進行方向が壁で進めない場合のみ
            if (this.state === 'moving' && direction.length() < 0.01) {
                isCornerStuck = true;
            }
        }
        if (isCornerStuck) {
            this._cornerStuckTimer += deltaTime;
            if (this._cornerStuckTimer > 1.5 && wallPos) {
                // 強制的に壁を壊して脱出
                // use reservation-based removal for wall break
                const removed = this.reserveAndRemoveBlock(wallPos.x, wallPos.y, wallPos.z);
                if (removed) {
                    this.log('Break out: forcibly destroyed block to escape corner deadlock', wallPos);
                    this._cornerStuckTimer = 0;
                    // 経路再探索
                    this.path = this.bfsPath(this.gridPos, this.targetPos);
                } else {
                    this.log('Corner-break attempt failed (reserved/protected), will retry later', wallPos);
                }
            }
        } else {
            this._cornerStuckTimer = 0;
        }
    }

    // Try a very small local avoidance: look for adjacent free tile (same y) that's not occupied
    tryLocalAvoidance(target) {
    // prefer sidesteps perpendicular to direction to target; if target is higher, prefer upward step
    const dirX = Math.sign(target.x - this.gridPos.x);
    const dirZ = Math.sign(target.z - this.gridPos.z);
    const preferUp = target.y > this.gridPos.y;
    const lateral = [];
    if (dirX !== 0) lateral.push({dx:0,dy:0,dz:1}, {dx:0,dy:0,dz:-1});
    if (dirZ !== 0) lateral.push({dx:1,dy:0,dz:0}, {dx:-1,dy:0,dz:0});
    // fallback sequence
    const candidates = [...lateral, {dx: -dirX, dy:0, dz: -dirZ}, {dx: dirX, dy:0, dz: dirZ}];
    if (preferUp) candidates.unshift({dx:0,dy:1,dz:0});

    for (const c of candidates) {
            const nx = this.gridPos.x + c.dx;
            const ny = this.gridPos.y + c.dy;
            const nz = this.gridPos.z + c.dz;
            if (ny < 0 || ny > maxHeight) continue;
            const posKey = `${nx},${ny},${nz}`;
            if (worldData.has(posKey)) continue;
            if (this.isOccupiedByOther(nx, ny, nz)) continue;
            // ensure footing
            const below = `${nx},${ny-1},${nz}`;
            if (ny > 0 && !worldData.has(below)) continue;
            // attempt to reserve this sidestep to avoid races
            const sidestepKey = posKey;
            const reserved = Character.reserveTarget(sidestepKey, this.id, (typeof window !== 'undefined' && window.sidestepReserveMs) ? window.sidestepReserveMs : 2000);
            if (reserved) {
                // remember reserved sidestep to release later if needed
                this._reservedSidestepKey = sidestepKey;
                return { x: nx, y: ny, z: nz };
            }
        }
        return null;
    }

    updateAnimations(deltaTime) {
        // --- Enhanced Blinking logic ---
        if (!this.blinkTimer) this.blinkTimer = 0;
        if (!this.blinkInterval) this.blinkInterval = 1.5 + Math.random() * 2; // More varied intervals
        this.blinkTimer += deltaTime;

        // State-based blinking frequency
        let blinkModifier = 1.0;
        if (this.state === 'socializing') blinkModifier = 0.7; // More frequent when social
        else if (this.state === 'resting') blinkModifier = 3.0; // Less frequent when resting
        else if (this.needs && this.needs.energy < 30) blinkModifier = 0.5; // Very frequent when tired

        if (this.blinkTimer > this.blinkInterval * blinkModifier) {
            this.eyeMeshes.forEach(e => e.visible = false);
            if (!this.blinking) {
                this.blinking = true;
                // Varied blink duration based on state
                const blinkDuration = this.state === 'resting' ? 0.3 : 0.12;
                this.blinkEnd = this.blinkTimer + blinkDuration;
            }
        }
        if (this.blinking && this.blinkTimer > this.blinkEnd) {
            this.eyeMeshes.forEach(e => e.visible = true);
            this.blinking = false;
            this.blinkInterval = 1.5 + Math.random() * 2;
            this.blinkTimer = 0;
        }

        // --- Breathing (subtle body scale) ---
        if (!this._breathPhase) this._breathPhase = Math.random() * Math.PI * 2;
    this._breathPhase += deltaTime * (this._breathRate || 0.8);
    const breathMul = (typeof window !== 'undefined' && window.breathAmpMultiplier) ? window.breathAmpMultiplier : 1.0;
    const breathScale = 1 + ((this._breathAmp || 0.025) * breathMul) * Math.sin(this._breathPhase);
        // Slightly squash/stretch on Y and compensate X/Z
        if (this.body) {
            this.body.scale.set(1 / Math.sqrt(breathScale), breathScale, 1 / Math.sqrt(breathScale));
        }

        // --- Head look smoothing and idle glances ---
        // Decide look target: prioritize action target, then nearest interesting object (food/char)
        if (!this._lookTargetPos || (this.state === 'idle' && this._idleGlanceTimer <= 0)) {
            if (this.action && this.action.target && this.action.target.x !== undefined) {
                this._lookTargetPos = { ...this.action.target };
            } else if (this.state === 'idle') {
                // idle glance: occasionally look at a nearby char or food
                if (this._idleGlanceTimer <= 0) {
                    // find nearby char or food
                    let found = null;
                    const chars = (typeof window !== 'undefined' && window.characters) ? window.characters : (typeof characters !== 'undefined' ? characters : []);
                    for (const c of chars) {
                        if (c.id === this.id) continue;
                        const dist = Math.abs(this.gridPos.x - c.gridPos.x) + Math.abs(this.gridPos.y - c.gridPos.y) + Math.abs(this.gridPos.z - c.gridPos.z);
                        if (dist <= 4) { found = c; break; }
                    }
                    if (found) this._lookTargetPos = { ...found.gridPos };
                    else {
                        // look at random nearby offset
                        const rx = this.gridPos.x + (Math.random() * 3 - 1.5);
                        const rz = this.gridPos.z + (Math.random() * 3 - 1.5);
                        this._lookTargetPos = { x: rx, y: this.gridPos.y, z: rz };
                    }
                    this._lookHoldTimer = 0.6 + Math.random() * 1.2;
                    this._idleGlanceTimer = this._idleGlanceInterval;
                }
            }
        }

        // decrement idle timer
        this._idleGlanceTimer -= deltaTime;

        // Smoothly lerp head rotation toward look target if present
        if (this._lookTargetPos && this.head) {
            // compute desired angle on Y axis
            const worldTarget = new THREE.Vector3(this._lookTargetPos.x + 0.5, (this._lookTargetPos.y || this.gridPos.y) + 0.5, this._lookTargetPos.z + 0.5);
            const headWorldPos = new THREE.Vector3();
            this.head.getWorldPosition(headWorldPos);
            const dir = worldTarget.clone().sub(headWorldPos);
            if (dir.lengthSq() > 0.0001) {
                let desired = Math.atan2(dir.x, dir.z);
                // lerp angle
                let current = this.head.rotation.y;
                // normalize
                while (desired - current > Math.PI) desired -= Math.PI * 2;
                while (current - desired > Math.PI) desired += Math.PI * 2;
                // apply look lerp multiplier (live-tunable)
                const lookMul = (typeof window !== 'undefined' && window.lookLerpMultiplier) ? window.lookLerpMultiplier : 1.0;
                const lerp = (this._lookLerp || 0.12) * Math.min(2.0, Math.max(0.1, lookMul));
                current = current + (desired - current) * lerp;
                this.head.rotation.y = current;

                // Head pitch: look up/down based on vertical component
                const maxPitch = 0.45; // radians (~26deg)
                const horizDist = Math.sqrt(dir.x * dir.x + dir.z * dir.z) + 1e-6;
                let desiredPitch = -Math.atan2(dir.y, horizDist) * 0.8; // invert for natural tilt
                desiredPitch = Math.max(-maxPitch, Math.min(maxPitch, desiredPitch));
                // lerp pitch a bit slower
                const pitchLerp = 0.06 * Math.min(2.0, Math.max(0.2, lookMul));
                this.head.rotation.x += (desiredPitch - this.head.rotation.x) * pitchLerp;

                // Eye micro-tracking: lazy-init base positions, then offset slightly toward target
                try {
                    if (this.leftEye && this.rightEye) {
                        if (!this._eyeBaseLeftPos) this._eyeBaseLeftPos = this.leftEye.position.clone();
                        if (!this._eyeBaseRightPos) this._eyeBaseRightPos = this.rightEye.position.clone();
                        const eyeMul = (typeof window !== 'undefined' && window.eyeAmpMultiplier) ? window.eyeAmpMultiplier : 1.0;
                        const ex = Math.max(-0.035, Math.min(0.035, dir.x * 0.02)) * eyeMul;
                        const ey = Math.max(-0.02, Math.min(0.02, dir.y * 0.02)) * eyeMul;
                        this.leftEye.position.x = this._eyeBaseLeftPos.x + ex;
                        this.rightEye.position.x = this._eyeBaseRightPos.x + ex;
                        this.leftEye.position.y = this._eyeBaseLeftPos.y + ey;
                        this.rightEye.position.y = this._eyeBaseRightPos.y + ey;
                    }
                } catch (e) {
                    // ignore eye adjustment errors
                }
            }
            // hold time countdown
            if (this._lookHoldTimer > 0) {
                this._lookHoldTimer -= deltaTime;
            } else {
                // release look after hold
                this._lookTargetPos = null;
            }
        }

        // Shadow scaling based on bob / height
        if (this.shadowMesh) {
            const shadowBase = (typeof window !== 'undefined' && window.shadowBaseScale) ? window.shadowBaseScale : 1.0;
            const h = (this.body && this.body.position) ? this.body.position.y : 0.25;
            const scale = Math.max(0.6, 1.0 - (h - 0.25) * 0.8) * shadowBase;
            this.shadowMesh.scale.set(scale, scale, scale);
            try {
                if (this.shadowMesh.material && this.shadowMesh.material.opacity !== undefined) {
                    this.shadowMesh.material.opacity = Math.max(0.08, Math.min(0.5, 0.25 * scale));
                }
            } catch (e) {}
        }

        // --- Enhanced Facial expression (eyes/mouth color/shape) ---
        if (this.state === 'dead') {
            this.eyeMaterial.color.set(0x888888);
        } else if (this.state === 'resting') {
            this.eyeMaterial.color.set(0x2222ff);
            // Sleepy eye effect - slightly smaller
            this.leftEye.scale.y = 0.7 + Math.sin(this.bobTime * 0.5) * 0.1;
            this.rightEye.scale.y = 0.7 + Math.sin(this.bobTime * 0.5) * 0.1;
        } else if (this.state === 'socializing') {
            this.eyeMaterial.color.set(0xff33cc);
            // Excited eyes - slightly larger
            this.leftEye.scale.set(1.2, 1.2, 1.2);
            this.rightEye.scale.set(1.2, 1.2, 1.2);
        } else if (this.needs && this.needs.hunger < 30) {
            this.eyeMaterial.color.set(0xff0000);
            // Tired/hungry eyes
            this.leftEye.scale.y = 0.8;
            this.rightEye.scale.y = 0.8;
        } else if (this.needs && this.needs.energy < 30) {
            this.eyeMaterial.color.set(0x00aaff);
            // Very tired eyes
            this.leftEye.scale.y = 0.6 + Math.sin(this.bobTime) * 0.1;
            this.rightEye.scale.y = 0.6 + Math.sin(this.bobTime) * 0.1;
        } else if (this.needs && this.needs.social < 30) {
            this.eyeMaterial.color.set(0x00ff00);
            // Lonely eyes
            this.leftEye.scale.set(0.9, 0.9, 0.9);
            this.rightEye.scale.set(0.9, 0.9, 0.9);
        } else if (this._nearEnemy) {
            // 近接敵: オレンジ目 + 眉をしかめた形 (Y方向に引き伸ばして睨み顔)
            this.eyeMaterial.color.set(0xff6600);
            this.leftEye.scale.set(1.0, 1.4, 1.0);
            this.rightEye.scale.set(1.0, 1.4, 1.0);
        } else if (!this.groupId && this.needs && this.needs.safety < 60) {
            // 孤立: 薄紫の目 + 少し小さく (不安感)
            this.eyeMaterial.color.set(0x9988bb);
            this.leftEye.scale.set(0.82, 0.82, 0.82);
            this.rightEye.scale.set(0.82, 0.82, 0.82);
        } else {
            this.eyeMaterial.color.set(0x000000);
            // Normal eyes
            this.leftEye.scale.set(1.0, 1.0, 1.0);
            this.rightEye.scale.set(1.0, 1.0, 1.0);
        }
        // Enhanced Mouth color/shape with subtle animation
        if (this.state === 'dead') {
            this.mouth.material.color.set(0x888888);
            this.mouth.rotation.z = Math.PI; // frown
        } else if (this.state === 'resting') {
            this.mouth.material.color.set(0x2222ff);
            this.mouth.rotation.z = Math.sin(this.bobTime * 0.3) * 0.1; // Subtle breathing
        } else if (this.state === 'socializing') {
            this.mouth.material.color.set(0xff33cc);
            this.mouth.rotation.z = Math.sin(this.bobTime * 2) * 0.2; // Talking animation
            this.mouth.scale.x = 1.0 + Math.sin(this.bobTime * 3) * 0.1; // Mouth movement
        } else if (this.needs && this.needs.hunger < 30) {
            this.mouth.material.color.set(0xff0000);
            this.mouth.rotation.z = Math.PI * 0.7 + Math.sin(this.bobTime) * 0.1; // Sad with slight movement
        } else if (this.needs && this.needs.energy < 30) {
            this.mouth.material.color.set(0x00aaff);
            this.mouth.rotation.z = Math.PI * 0.5;
            this.mouth.scale.y = 0.8; // Tired mouth
        } else if (this.needs && this.needs.social < 30) {
            this.mouth.material.color.set(0x00ff00);
            this.mouth.rotation.z = Math.PI * 0.2 + Math.sin(this.bobTime * 0.5) * 0.05;
        } else {
            this.mouth.material.color.set(0x222222);
            this.mouth.rotation.z = Math.sin(this.bobTime * 0.2) * 0.02; // Very subtle default movement
            this.mouth.scale.set(1.0, 1.0, 1.0); // Reset scale
        }

        // --- Body animation: more charming/expressive ---
        if (this.state === 'idle') {
            // Bouncier idle bob and subtle wiggle
            this.bobTime += deltaTime * 2.5;
            const bob = Math.sin(this.bobTime) * 0.06 + Math.sin(this.bobTime * 0.5) * 0.02;
            const wiggle = Math.sin(this.bobTime * 0.7) * 0.08;
            this.body.position.y = 0.25 + bob;
            this.head.position.y = 0.75 + Math.sin(this.bobTime + 1) * 0.03;
            this.mesh.rotation.z = wiggle * 0.5;
            // Arms: gentle sway
            this.leftArm.rotation.x = Math.sin(this.bobTime * 0.7) * 0.2;
            this.rightArm.rotation.x = -Math.sin(this.bobTime * 0.7) * 0.2;
            // Head: slight tilt
            this.head.rotation.z = Math.sin(this.bobTime * 0.5) * 0.08;
        } else if (this.state === 'moving') {
            // Step-synced walk bob and arm swing
            const globalStepFreq = (typeof window !== 'undefined' && window.stepFreqMultiplier) ? (window.stepFreqMultiplier) : 1.0;
            const breathMul = (typeof window !== 'undefined' && window.breathAmpMultiplier) ? (window.breathAmpMultiplier) : 1.0;
            const lookMul = (typeof window !== 'undefined' && window.lookLerpMultiplier) ? (window.lookLerpMultiplier) : 1.0;
            // advance step phase proportional to movement speed
            const speed = Math.min(1.5, Math.max(0.0, this.movementSpeed || 1.0));
            const stepAdvance = deltaTime * (this._stepFreqBase * globalStepFreq) * (speed / 1.5);
            this._stepPhase += stepAdvance;
            const step = Math.sin(this._stepPhase + this._stepOffset);
            // vertical bob and lateral sway
            const walkBob = Math.abs(step) * (this._stepAmp || 0.1);
            const sway = Math.sin(this._stepPhase * 0.5) * (this._swayAmp || 0.06);
            this.body.position.y = 0.25 + walkBob;
            this.head.position.y = 0.75 + Math.sin(this._stepPhase + 1) * 0.04;
            this.mesh.rotation.z = sway;
            // arms swing opposite phase
            this.leftArm.rotation.x = (Math.sin(this._stepPhase) * 0.9) * 0.7;
            this.rightArm.rotation.x = (Math.sin(this._stepPhase + Math.PI) * 0.9) * 0.7;
            // Head: slight energetic tilt
            this.head.rotation.z = Math.sin(this._stepPhase * 0.7) * 0.13;
        } else {
            // Smoothly return to neutral pose
            this.mesh.rotation.z *= 0.85;
            this.leftArm.rotation.x *= 0.85;
            this.rightArm.rotation.x *= 0.85;
            this.body.position.y += (0.25 - this.body.position.y) * 0.2;
            this.head.position.y += (0.75 - this.head.position.y) * 0.2;
            this.head.rotation.z *= 0.85;
        }

        // Action squash/stretch
        if (this.actionAnim && this.actionAnim.active) {
            this.actionAnim.timer -= deltaTime;
            const phase = 1.0 - (this.actionAnim.timer / this.actionAnim.duration);
            const scale = 1.0 - Math.sin(phase * Math.PI) * 0.3;
            this.body.scale.set(1 + (1 - scale) * 0.5, scale, 1 + (1 - scale) * 0.5);
            if (this.actionAnim.timer <= 0) { this.actionAnim.active = false; this.body.scale.set(1, 1, 1); }
        }

        // State-specific body animations
        if (this.state === 'resting') {
            // Sleeping pose: lowered body, closed eyes occasionally
            this.body.scale.y = 0.6;
            this.head.rotation.x = Math.sin(this.bobTime * 0.5) * 0.1;
            // Slow, deep breathing
            const breathe = Math.sin(this.bobTime * 0.8) * 0.03;
            this.body.scale.x = 1.0 + breathe;
            this.body.scale.z = 1.0 + breathe;
        } else if (this.state === 'socializing') {
            // Excited, bouncy animation
            this.bobTime += deltaTime * 4;
            const excitement = Math.sin(this.bobTime) * 0.08;
            this.body.position.y = 0.25 + Math.abs(excitement);
            this.head.position.y = 0.75 + Math.abs(excitement) * 1.2;
            // Head nodding
            this.head.rotation.x = Math.sin(this.bobTime * 2) * 0.15;
            // Happy arm movements
            this.leftArm.rotation.y = Math.sin(this.bobTime * 1.5) * 0.3;
            this.rightArm.rotation.y = -Math.sin(this.bobTime * 1.5) * 0.3;
            if (!this.actionAnim.active) this.body.scale.y = 1.0;
        } else if (this.state === 'working') {
            // Focused work animation
            this.bobTime += deltaTime * 3;
            const workBob = Math.sin(this.bobTime) * 0.04;
            this.body.position.y = 0.25 + workBob;
            this.head.position.y = 0.75 + workBob;
            // Concentrated head tilt
            this.head.rotation.z = Math.sin(this.bobTime * 0.3) * 0.05;
            this.head.rotation.x = -0.1; // Looking down
            if (!this.actionAnim.active) this.body.scale.y = 1.0;
        } else if (this.needs && this.needs.hunger < 20) {
            // Weak, tired animation
            this.bobTime += deltaTime * 1.5;
            const weakness = Math.sin(this.bobTime * 0.5) * 0.02;
            this.body.position.y = 0.22 + weakness; // Lower stance
            this.head.position.y = 0.72 + weakness;
            this.mesh.rotation.z = Math.sin(this.bobTime * 0.3) * 0.03; // Slight swaying
            if (!this.actionAnim.active) this.body.scale.y = 0.95; // Slightly compressed
        } else if (!this.actionAnim.active) {
            this.body.scale.set(1.0, 1.0, 1.0); // Reset scale for other states
        }

        // Personality-based micro-animations
        if (this.personality) {
            // Brave characters stand taller
            if (this.personality.bravery > 1.0) {
                this.body.scale.y *= 1.05;
                this.head.position.y += 0.02;
            }
            // Diligent characters have more controlled movements
            if (this.personality.diligence > 1.0) {
                const control = 0.8; // Reduce randomness
                this.mesh.rotation.z *= control;
                this.head.rotation.z *= control;
            }
        }
    }


    updateThoughtBubble(isNight, camera) {
        if (!this.thoughtBubble) return;
        const hideBubble = () => {
            this.thoughtBubble.setAttribute('data-show', 'false');
            this.thoughtBubble.style.display = 'none';
        };
        if (!this.mesh || this.mesh.visible === false || !camera || !this.iconAnchor) {
            hideBubble();
            return;
        }
        // --- ハートマーク優先表示 ---
        if (this.loveTimer > 0) {
            const canvas = document.getElementById('gameCanvas');
            const pos = toScreenPosition(this.iconAnchor, camera, canvas);
            if (!pos) {
                hideBubble();
                return;
            }
            this.thoughtBubble.textContent = '❤️';
            this.thoughtBubble.setAttribute('data-show', 'true');
            this.thoughtBubble.style.display = '';
            this.thoughtBubble.style.background = 'rgba(255,220,235,0.96)';
            this.thoughtBubble.style.borderColor = '#f9a8d4';
            this.thoughtBubble.style.left = `${pos.x - 18}px`;
            this.thoughtBubble.style.top = `${pos.y - 48}px`;
            this.thoughtBubble.style.position = 'fixed';
            return;
        }
        let html = '';
        if (this.groupId) {
            const groupColors = [
                '#fbbf24', '#60a5fa', '#34d399', '#f472b6', '#a78bfa', '#f87171', '#38bdf8', '#facc15', '#4ade80', '#c084fc'
            ];
            const color = groupColors[(this.groupId-1)%groupColors.length] || '#bbb';
            html += `<span style="display:inline-block;min-width:22px;padding:1.5px 6px 1.5px 6px;border-radius:11px;background:${color};color:#fff;font-size:0.92em;font-weight:bold;box-shadow:0 1px 4px #0002;vertical-align:middle;letter-spacing:0.5px;line-height:1.2;">G${this.groupId}`;
            if (this.role === 'leader') {
                html += ` <span style=\"font-size:1.05em;vertical-align:middle;filter:drop-shadow(0 1px 2px #eab30888);\">👑</span>`;
            }
            html += '</span>';
        }
        // --- sidebar.jsの状態アイコンロジックを完全コピー ---
        let icons = [];
        if (this.state === 'dead') icons.push('💀');
        else if (this.state === 'resting') icons.push('🛏️');
        else if (this.state === 'socializing') icons.push('💬');
        else if (this.state === 'moving' || this.state === 'active') icons.push('🚶');
        // COLLECT_FOOD中は必ず🍎を表示
        if (this.currentAction === 'COLLECT_FOOD' && !icons.includes('🍎')) icons.push('🍎');
        else if (this.needs && this.needs.hunger < 30 && !icons.includes('🍎')) icons.push('🍎');
        if (this.needs && this.needs.energy < 30) icons.push('💤');
        if (this.needs && this.needs.social < 30) icons.push('👥');
        // --- 孤立・争いの視覚インジケーター ---
        if (this._nearEnemy) icons.push('💢');               // 近くに敵がいる
        else if (!this.groupId && this.needs && this.needs.safety < 60) icons.push('😶'); // 孤立+safety低下
        if (icons.length === 0) icons.push('🙂');
        html += icons.map(ic => ` <span style="font-size:0.98em;vertical-align:middle;font-family:'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif;">${ic}</span>`).join('');
        if (html) {
            const canvas = document.getElementById('gameCanvas');
            const screenPos = toScreenPosition(this.iconAnchor, camera, canvas);
            if (!screenPos) {
                hideBubble();
                return;
            }
            this.thoughtBubble.innerHTML = html;
            this.thoughtBubble.setAttribute('data-show', 'true');
            this.thoughtBubble.style.left = `${screenPos.x - 14}px`;
            this.thoughtBubble.style.top = `${screenPos.y - 50}px`;
            this.thoughtBubble.style.position = 'fixed';
            this.thoughtBubble.style.display = 'block';
            // バブル背景: 争い=赤, 孤立=グレー, 平常=白
            if (this._nearEnemy) {
                this.thoughtBubble.style.background = 'rgba(255,90,80,0.93)';
                this.thoughtBubble.style.border = '1.5px solid #f87171';
                this.thoughtBubble.style.color = '#fff';
            } else if (!this.groupId && this.needs && this.needs.safety < 60) {
                this.thoughtBubble.style.background = 'rgba(180,170,200,0.93)';
                this.thoughtBubble.style.border = '1.2px solid #a78bfa';
                this.thoughtBubble.style.color = '#fff';
            } else {
                this.thoughtBubble.style.background = 'rgba(255,255,255,0.92)';
                this.thoughtBubble.style.border = '1.2px solid #eee';
                this.thoughtBubble.style.color = '#333';
            }
            this.thoughtBubble.style.borderRadius = '16px';
            this.thoughtBubble.style.boxShadow = '0 2px 8px #0001';
            this.thoughtBubble.style.padding = '2px 8px';
            this.thoughtBubble.style.fontSize = '1.08em';
        } else {
            hideBubble();
        }
    }

    reproduceWith(partner) {
        // Prevent children from reproducing
        if (this.isChild || (partner && partner.isChild)) {
            this.log('Attempted reproduction blocked because one partner is a child', {self: this.id, partner: partner && partner.id});
            try { console.log(`[REPRO] reproduction blocked: ${this.id} or ${partner && partner.id} is a child`); } catch(e){}
            return;
        }

        const readinessCtx = this.getReproductionReadiness(partner);
        if (!(readinessCtx.readiness >= 0.52 || (readinessCtx.affinity >= 82 && readinessCtx.relationshipStability >= 0.45))) {
            try { console.log(`[REPRO] ${this.id} reproduction blocked by district pressure (pressure=${readinessCtx.socialPressure.toFixed(2)} readiness=${readinessCtx.readiness.toFixed(2)})`); } catch(e){}
            return;
        }

        const myFertility = this.getAgingProfile ? this.getAgingProfile().fertilityMul : 1.0;
        const partnerFertility = (partner && partner.getAgingProfile) ? partner.getAgingProfile().fertilityMul : 1.0;
        const fertilityChance = Math.max(0, Math.min(1, myFertility * partnerFertility));
        if (Math.random() > fertilityChance) {
            try { console.log(`[REPRO] reproduction skipped due to age-related fertility decline (chance=${fertilityChance.toFixed(2)})`); } catch(e){}
            return;
        }

        // Create child with mixed color and inherited personality
        this.log('Reproducing with', partner.id);
        // reproduction cooldown per parent to avoid rapid repeated births
        const cooldownSec = (typeof window !== 'undefined' && window.reproductionCooldownSeconds !== undefined) ? window.reproductionCooldownSeconds : 10;
        if (this._lastReproductionTime && (Date.now() - this._lastReproductionTime) < cooldownSec * 1000) {
            try { console.log(`[REPRO] ${this.id} reproduction aborted: cooldown active (${Math.round((cooldownSec*1000 - (Date.now()-this._lastReproductionTime))/1000)}s left)`); } catch(e){}
            return;
        }
        if (partner && partner._lastReproductionTime && (Date.now() - partner._lastReproductionTime) < cooldownSec * 1000) {
            try { console.log(`[REPRO] ${this.id} reproduction aborted: partner ${partner.id} cooldown active`); } catch(e){}
            return;
        }
        // Mix colors
        const c1 = this.bodyMaterial.color;
        const c2 = partner.bodyMaterial.color;
        const childColor = {
            r: (c1.r + c2.r) / 2,
            g: (c1.g + c2.g) / 2,
            b: (c1.b + c2.b) / 2
        };
        // Mix personality — inherit average of parents + small noise; 5% chance of larger mutation per trait
        const _blendTrait = (a, b) => {
            const base = (a + b) / 2 + (Math.random() - 0.5) * 0.12;
            const mutRate = (typeof window !== 'undefined' && window.mutationRate !== undefined) ? window.mutationRate : 0.05;
            const mutated = Math.random() < mutRate ? base + (Math.random() - 0.5) * 0.5 : base;
            return Math.max(0.3, Math.min(1.7, mutated));
        };
        const p = this.personality, q = partner.personality;
        const childGenes = {
            bravery:         _blendTrait(p.bravery,         q.bravery),
            diligence:       _blendTrait(p.diligence,       q.diligence),
            sociality:       _blendTrait(p.sociality        ?? 1.0, q.sociality        ?? 1.0),
            curiosity:       _blendTrait(p.curiosity        ?? 1.0, q.curiosity        ?? 1.0),
            resourcefulness: _blendTrait(p.resourcefulness  ?? 1.0, q.resourcefulness  ?? 1.0),
            resilience:      _blendTrait(p.resilience       ?? 1.0, q.resilience       ?? 1.0),
        };
        // Find spawn position near parents (prefer free adjacent spot)
        let spawnPos = null;
        const trySpots = [this.gridPos, partner.gridPos];
        for (const base of trySpots) {
            const spot = this.findAdjacentSpot ? this.findAdjacentSpot(base) : null;
            if (spot) { spawnPos = spot; break; }
        }
        if (!spawnPos) spawnPos = this.gridPos;
    // Spawn child
    try { console.log(`[REPRO] ${this.id} calling spawnCharacter at`, spawnPos, 'genes=', childGenes); } catch(e){}
    const child = spawnCharacter(spawnPos, childGenes);
        // Set child color and initial needs after spawn
        if (child && child.bodyMaterial && child.bodyMaterial.color) {
            child.bodyMaterial.color.setRGB(childColor.r, childColor.g, childColor.b);
            child.needs = {
                hunger: 80 + Math.random()*10,
                energy: 80 + Math.random()*10,
                safety: 100,
                social: 80 + Math.random()*10
            };
            child.updateColorFromPersonality && child.updateColorFromPersonality();
            child.updateWorldPosFromGrid && child.updateWorldPosFromGrid();
            // --- Group/leader re-detection after birth ---
            if (typeof window !== 'undefined' && window.characters) {
                Character.detectGroupsAndElectLeaders(window.characters);
            } else if (typeof characters !== 'undefined') {
                Character.detectGroupsAndElectLeaders(characters);
            }
            // --- 子供カウント ---
            if (Array.isArray(this.children)) this.children.push(child.id);
            if (Array.isArray(partner.children)) partner.children.push(child.id);
            if (typeof this.childCount === 'number') this.childCount++;
            if (typeof partner.childCount === 'number') partner.childCount++;
            // --- Mark as child and apply lightweight visual/behavior tweaks ---
            try {
                child.isChild = true;
                // record parent references for follow behavior
                child.parentIds = [this.id, partner.id];
                // generation counter: max of parents + 1
                child.generation = Math.max(this.generation || 0, partner.generation || 0) + 1;
                // prevent immediate group/role assignment - keep child as a neutral worker until maturity
                child.groupId = null;
                child.role = 'worker';
                // optional age fields for growth system
                child.age = 0;
                child.maturityAge = (typeof window !== 'undefined' && window.childMaturitySeconds !== undefined) ? window.childMaturitySeconds : 60;
                // store pre-child movement speed so we can restore on maturity
                if (typeof child.movementSpeed === 'number') child._preChildMovementSpeed = child.movementSpeed;
                // shrink overall mesh and main body/head to look like a child
                if (child.mesh && child.mesh.scale) child.mesh.scale.set(0.72, 0.72, 0.72);
                if (child.body && child.body.scale) child.body.scale.set(0.72, 0.72, 0.72);
                if (child.head && child.head.scale) child.head.scale.set(0.72, 0.72, 0.72);
                // smaller shadow
                if (child.shadowMesh && child.shadowMesh.scale) child.shadowMesh.scale.multiplyScalar(0.75);
                // slightly slower movement/less bob for child feel
                if (typeof child.movementSpeed === 'number') child.movementSpeed *= 0.88;
                if (child._stepAmp) child._stepAmp *= 0.6;
                // record last reproduction time for both parents
                this._lastReproductionTime = Date.now();
                partner._lastReproductionTime = Date.now();
                if (typeof window !== 'undefined' && typeof window.recordPopulationBirth === 'function') {
                    window.recordPopulationBirth({
                        childId: child.id,
                        generation: Number(child.generation || 0),
                        parentIds: [this.id, partner.id]
                    });
                }
                if (typeof window !== 'undefined' && window.simTestMode && window.__simTelemetry && typeof window.__simTelemetry.addEvent === 'function') {
                    window.__simTelemetry.addEvent({
                        t: Date.now(),
                        kind: 'birth',
                        childId: child.id,
                        generation: Number(child.generation || 0),
                        parents: [this.id, partner.id],
                        pos: { x: child.gridPos.x, y: child.gridPos.y, z: child.gridPos.z }
                    });
                }
                try { console.log(`[REPRO] ${this.id} spawned child ${child.id} at ${JSON.stringify(spawnPos)} parents=${JSON.stringify(child.parentIds)}`); } catch(e){}
            } catch (e) { /* ignore visual tweak errors */ }
        }
    }

    decideNextAction(isNight) {
        const hungerEmergency = (typeof window !== 'undefined' && window.hungerEmergencyThreshold !== undefined) ? Number(window.hungerEmergencyThreshold) : 5;
        const energyEmergency = (typeof window !== 'undefined' && window.energyEmergencyThreshold !== undefined) ? Number(window.energyEmergencyThreshold) : 5;
        // Child-specific behavior: simpler decision-making and no adult tasks
        if (this.isChild) {
            // If parents exist, attempt to stay near them or follow briefly
            const chars = (typeof window !== 'undefined' && window.characters) ? window.characters : (typeof characters !== 'undefined' ? characters : []);
            if (this.parentIds && this.parentIds.length > 0) {
                let nearestParent = null;
                let pdist = 1e9;
                for (const pid of this.parentIds) {
                    const p = chars.find(c => c.id === pid);
                    if (p) {
                        const d = Math.abs(this.gridPos.x - p.gridPos.x) + Math.abs(this.gridPos.y - p.gridPos.y) + Math.abs(this.gridPos.z - p.gridPos.z);
                        if (d < pdist) { pdist = d; nearestParent = p; }
                    }
                }
                if (nearestParent) {
                    if (pdist > 3) {
                        // move closer to parent
                        this.setNextAction('MOVE', nearestParent, nearestParent.gridPos);
                        return;
                    } else if (Math.random() < 0.4) {
                        // sometimes play or wander nearby
                        this.setNextAction('WANDER');
                        return;
                    } else {
                        this.setNextAction('REST');
                        return;
                    }
                }
            }
            // No parents or can't find them: idle/wander/play
            if (Math.random() < 0.5) { this.setNextAction('WANDER'); return; }
            this.setNextAction('REST');
            return;
        }
        // === IMPORTANT ACTION PROTECTION ===
        // Don't interrupt important actions that were just set
        if (this.action && ['BUILD_HOME', 'CHOP_WOOD', 'DESTROY_BLOCK'].includes(this.action.type)) {
            if (!this._lastActionTime || (Date.now() - this._lastActionTime) < 1000) {
                this.log(`⚡ Protecting important action: ${this.action.type} (recently set)`);
                return;
            }
        }

        // === EMERGENCY SURVIVAL ONLY (Life or Death) ===

        // Critical hunger: immediate food collection or die
        if (this.needs.hunger <= hungerEmergency) {
            this.log('🚨 EMERGENCY: Critical hunger, forcing immediate food collection');
            const food = this.findClosestFood();
            if (food) {
                this.setNextAction('COLLECT_FOOD', food, food);
                return;
            }
            this.setNextAction('WANDER'); // Search for food
            return;
        }

        // Critical energy: immediate rest or collapse
        if (this.needs.energy <= energyEmergency) {
            this.log('🚨 EMERGENCY: Critical energy, forcing immediate rest');
            this.setNextAction('REST');
            return;
        }

        // Emergency: If completely stuck without home and no wood, try basic wood collection (respecting UI priority)
        // より厳しい条件: 空腹度が50以下かつ5回以上WANDERした場合のみ
        if (!this.homePosition && !this.inventory.includes('WOOD_LOG') && this.needs.hunger <= 50) {
            // カウンターがなければ初期化
            if (!this._wanderCount) this._wanderCount = 0;
            if (this.action && this.action.type === 'WANDER') {
                this._wanderCount++;
            }

            // 5回以上WANDERしてもまだ家がない場合のみ緊急処理
            if (this._wanderCount >= 5) {
                // Home building priority controls emergency wood collection probability.
                const buildPriority = (typeof window !== 'undefined' && window.homeBuildingPriority !== undefined) ? Number(window.homeBuildingPriority) : 80;
                const shouldCollectWood = Math.random() * 100 < (buildPriority * 0.5); // Keep conservative half-chance behavior.

                const wood = this.findClosestWood();
                if (wood && !this._lastWoodAttempt && shouldCollectWood) {
                    this.log(`🚨 EMERGENCY: No home, no wood, low hunger - attempting basic collection (priority: ${buildPriority * 0.5}%)`);
                    this._lastWoodAttempt = Date.now();
                    this._wanderCount = 0; // リセット
                    this.setNextAction('CHOP_WOOD', wood, wood);
                    return;
                } else if (wood && !shouldCollectWood) {
                    this.log(`🚨 EMERGENCY: No home, no wood - but home building priority too low (${buildPriority * 0.5}%)`);
                }
            }

            // Clear emergency flag after 15 seconds (10→15秒に延長)
            if (this._lastWoodAttempt && Date.now() - this._lastWoodAttempt > 15000) {
                this._lastWoodAttempt = null;
                this._wanderCount = 0;
            }
        } else if (this.homePosition || this.inventory.includes('WOOD_LOG')) {
            // 家があるか木材を持っている場合はカウンターリセット
            this._wanderCount = 0;
        }        // === DELEGATE TO AI SYSTEMS ===

        if (typeof window !== 'undefined' && window.aiMode === 'utility') {
            decideNextAction_utility(this, isNight);
        } else {
            decideNextAction_rulebase(this, isNight);
        }

        // Fallback safety
        if (!this.action || this.action === null) {
            // Avoid immediately falling back to WANDER repeatedly (causes trembling)
            const now = Date.now();
            const fallbackBackoffMs = 1500;
            if (!this._lastFallbackTime || (now - this._lastFallbackTime) > fallbackBackoffMs) {
                // Prefer collecting nearby food first, then chopping wood, before defaulting to WANDER
                const food = this.findClosestFood ? this.findClosestFood() : null;
                if (food) {
                    this.log('Fallback: found nearby food, switching to COLLECT_FOOD');
                    this.setNextAction('COLLECT_FOOD', food, food);
                    this._lastFallbackTime = now;
                } else {
                    const wood = this.findClosestWood ? this.findClosestWood() : null;
                    if (wood) {
                        this.log('Fallback: found nearby wood, switching to CHOP_WOOD');
                        this.setNextAction('CHOP_WOOD', wood, wood);
                        this._lastFallbackTime = now;
                    } else {
                        this.log('⚠️ No action chosen by AI, falling back to WANDER');
                        this.setNextAction('WANDER');
                        this._lastFallbackTime = now;
                    }
                }
            } else {
                // small idle cooldown to prevent tight loop
                this.actionCooldown = Math.max(this.actionCooldown, 0.6 + Math.random() * 0.6);
            }
        }
    }

    updateColorFromPersonality() {
        const r = Math.max(0, Math.min(1, 0.2 + (this.personality.bravery - 0.5)));
        const g = Math.max(0, Math.min(1, 0.2 + (this.personality.diligence - 0.5)));
        const b = 0.3;
        this.bodyMaterial.color.setRGB(r, g, b);
    }

    updateWorldPosFromGrid() {
        // ブロックとキャラクターの座標系を一致させる
        // ブロックは (x+0.5, y+0.5, z+0.5) に配置されているため、
        // キャラクターも同じ基準で配置する
        this.mesh.position.set(this.gridPos.x + 0.5, this.gridPos.y + 0.5, this.gridPos.z + 0.5);
    }

    log(message, ...args) {
        let debug = false;
        try {
            if (typeof window !== 'undefined' && typeof window.getDEBUG_MODE === 'function') {
                debug = window.getDEBUG_MODE();
            } else if (typeof getDEBUG_MODE === 'function') {
                debug = getDEBUG_MODE();
            } else if (typeof window !== 'undefined' && typeof window.DEBUG_MODE !== 'undefined') {
                debug = window.DEBUG_MODE;
            } else if (typeof DEBUG_MODE !== 'undefined') {
                debug = DEBUG_MODE;
            }
        } catch (e) { debug = false; }
        if (debug) {
            const color = (this.bodyMaterial && this.bodyMaterial.color)
                ? `#${this.bodyMaterial.color.getHexString()}`
                : '#888';
            console.log(`%c[Char ${this.id}]`, `color: ${color}`, message, ...args);
        }
    }

    // 落下先や掘削先が安全か判定する
    isSafeToFallOrDig(x, y, z) {
        // y座標が範囲外ならNG
        if (y < 0 || y > maxHeight) return false;

        // Ground level (y=0) is always safe as it's the bedrock level
        if (y === 0) return true;

        // 落下先の下にブロックがあるか
        let belowY = y - 1;
        while (belowY >= 0 && !worldData.has(`${x},${belowY},${z}`)) {
            belowY--;
        }
        // 地面がなければNG (but allow if we reach bedrock level)
        if (belowY < 0 && y > 0) return false;

        // 落下距離が大きすぎる場合はNG（例: 3段以上の落下禁止）
        if (y - belowY > 3) return false;

        // 落下先に他キャラがいないか
        const chars = (typeof window !== 'undefined' && window.characters) ? window.characters : (typeof characters !== 'undefined' ? characters : []);
        for (const char of chars) {
            if (char !== this && char.gridPos.x === x && char.gridPos.y === y && char.gridPos.z === z) {
                return false;
            }
        }
        return true;
    }

    // --- 汎用スタック判定（改良版：パフォーマンス最適化付き）---
    isStuck() {
        // キャッシュで頻繁なチェックを避ける
        if (!this._stuckCheckTimer) this._stuckCheckTimer = 0;
        if (this._stuckCheckTimer < 0.5) return this._lastStuckInfo;
        this._stuckCheckTimer = 0;

        // 空中スタック（優先度高）
        if (!worldData.has(`${this.gridPos.x},${this.gridPos.y-1},${this.gridPos.z}`)) {
            this._lastStuckInfo = { type: 'air', pos: { ...this.gridPos } };
            return this._lastStuckInfo;
        }
        // 移動スタック: 同じ位置に長時間いる場合
        if (!this._positionHistory) this._positionHistory = [];
        const currentPosKey = `${this.gridPos.x},${this.gridPos.y},${this.gridPos.z}`;
        this._positionHistory.push(currentPosKey);
        if (this._positionHistory.length > 10) this._positionHistory.shift();

        if (this._positionHistory.length >= 8) {
            const uniquePositions = new Set(this._positionHistory);
            if (uniquePositions.size <= 2) {
                this._lastStuckInfo = { type: 'movement', pos: { ...this.gridPos } };
                return this._lastStuckInfo;
            }
        }

        // 角スタック: 斜め方向に進めない場合（改良版）
        let openSpaces = 0;
        let diagonalBlocked = 0;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                if (dx === 0 && dz === 0) continue;
                const x = this.gridPos.x + dx, y = this.gridPos.y, z = this.gridPos.z + dz;
                const key = `${x},${y},${z}`;
                if (!worldData.has(key) && !this.isOccupiedByOther(x, y, z)) {
                    openSpaces++;
                } else if (Math.abs(dx) + Math.abs(dz) === 2) { // 斜め方向
                    diagonalBlocked++;
                }
            }
        }

        if (openSpaces <= 2 && diagonalBlocked >= 2) {
            this._lastStuckInfo = { type: 'corner', pos: { ...this.gridPos }, openSpaces };
            return this._lastStuckInfo;
        }
        // 完全囲い込み（垂直方向も考慮した改良版）
        let surrounded = true;
        let breakable = null;
        let escapeRoutes = [];

        // 水平方向チェック
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                if (dx === 0 && dz === 0) continue;
                const x = this.gridPos.x + dx, y = this.gridPos.y, z = this.gridPos.z + dz;
                const key = `${x},${y},${z}`;
                const blockId = worldData.get(key);
                if (blockId === undefined || blockId === null || blockId === BLOCK_TYPES.AIR.id) {
                    surrounded = false;
                    escapeRoutes.push({x, y, z, type: 'horizontal'});
                } else if (!this.isOccupiedByOther(x, y, z)) {
                    const blockType = Object.values(BLOCK_TYPES).find(t => t.id === blockId);
                    if (blockType && blockType.diggable && blockId !== BLOCK_TYPES.BED?.id) {
                        if (!breakable) breakable = {x, y, z, priority: blockType.name === 'Dirt' ? 1 : 2};
                    }
                }
            }
        }

        // 垂直方向の脱出ルートもチェック
        const upKey = `${this.gridPos.x},${this.gridPos.y+1},${this.gridPos.z}`;
        const downKey = `${this.gridPos.x},${this.gridPos.y-1},${this.gridPos.z}`;
        if (!worldData.has(upKey)) {
            escapeRoutes.push({x: this.gridPos.x, y: this.gridPos.y+1, z: this.gridPos.z, type: 'up'});
            surrounded = false;
        }
        if (this.canDigDown() && this.isSafeToFallOrDig(this.gridPos.x, this.gridPos.y-2, this.gridPos.z)) {
            escapeRoutes.push({x: this.gridPos.x, y: this.gridPos.y-2, z: this.gridPos.z, type: 'down'});
            surrounded = false;
        }

        if (surrounded && breakable) {
            this._lastStuckInfo = {
                type: 'enclosure',
                pos: { ...this.gridPos },
                breakable,
                escapeRoutes: escapeRoutes.length
            };
            return this._lastStuckInfo;
        }

        this._lastStuckInfo = null;
        return null;
    }

    // --- 汎用スタック救助（改良版：段階的救助）---
    rescueStuck(stuckInfo, deltaTime) {
        // スタックチェックタイマーを更新
        if (this._stuckCheckTimer !== undefined) {
            this._stuckCheckTimer += deltaTime;
        }

        if (!stuckInfo) {
            // スタックしていない場合は救助カウンターをリセット
            this._airTime = 0;
            this._cornerStuckTimer = 0;
            this._movementStuckTimer = 0;
            return;
        }

        // 空中スタック救助（既存＋改良）
        if (stuckInfo.type === 'air') {
            this._airTime = (this._airTime || 0) + deltaTime;
            if (this._airTime > 0.8) { // より早く救助
                let fallY = this.gridPos.y - 1;
                while (fallY > 0 && !worldData.has(`${this.gridPos.x},${fallY-1},${this.gridPos.z}`)) {
                    fallY--;
                }
                if (fallY >= 0 && this.isSafeToFallOrDig(this.gridPos.x, fallY, this.gridPos.z)) {
                    this.gridPos.y = fallY;
                    this.updateWorldPosFromGrid();
                    this._airTime = 0;
                    this.log('Rescued from air: forced drop to ground', {y: fallY});
                }
            }
            return;
        }

        // 移動スタック救助（新規）
        if (stuckInfo.type === 'movement') {
            this._movementStuckTimer = (this._movementStuckTimer || 0) + deltaTime;
            if (this._movementStuckTimer > 2.0) {
                // 強制的にランダムな方向に移動を試す
                const directions = [
                    {dx:1, dy:0, dz:0}, {dx:-1, dy:0, dz:0},
                    {dx:0, dy:0, dz:1}, {dx:0, dy:0, dz:-1},
                    {dx:0, dy:1, dz:0} // 上方向も試す
                ];

                for (const dir of directions) {
                    const x = this.gridPos.x + dir.dx;
                    const y = this.gridPos.y + dir.dy;
                    const z = this.gridPos.z + dir.dz;
                    const key = `${x},${y},${z}`;

                    if (!worldData.has(key) && !this.isOccupiedByOther(x, y, z) && y >= 0) {
                        // 足場チェック
                        const below = `${x},${y-1},${z}`;
                        if (worldData.has(below) || y === 0) {
                            this.gridPos.x = x;
                            this.gridPos.y = y;
                            this.gridPos.z = z;
                this.updateWorldPosFromGrid();
                            this._movementStuckTimer = 0;
                            this._positionHistory = []; // 履歴をクリア
                            this.log('Rescued from movement stuck: teleported to', {x, y, z});
                            return;
                        }
                    }
                }
            }
            return;
        }
        // 角スタック救助（改良版：優先順位付き）
        if (stuckInfo.type === 'corner') {
            this._cornerStuckTimer = (this._cornerStuckTimer || 0) + deltaTime;

            // 段階1: 1秒待機後、最適な脱出ルートを探す
            if (this._cornerStuckTimer > 1.0) {
                const escapeOptions = [];

                // 水平方向の脱出オプション
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dz = -1; dz <= 1; dz++) {
                        if (dx === 0 && dz === 0) continue;
                        const x = this.gridPos.x + dx;
                        const z = this.gridPos.z + dz;
                        const y = this.gridPos.y;
                        const key = `${x},${y},${z}`;

                        if (!worldData.has(key) && !this.isOccupiedByOther(x, y, z)) {
                            // 足場チェック
                            const below = `${x},${y-1},${z}`;
                            if (worldData.has(below)) {
                                escapeOptions.push({
                                    x, y, z,
                                    priority: (Math.abs(dx) + Math.abs(dz) === 1) ? 1 : 2, // 直進方向を優先
                                    type: 'move'
                                });
                            }
                        }
                    }
                }

                // 上方向への脱出
                const upKey = `${this.gridPos.x},${this.gridPos.y+1},${this.gridPos.z}`;
                if (!worldData.has(upKey)) {
                    escapeOptions.push({
                        x: this.gridPos.x, y: this.gridPos.y+1, z: this.gridPos.z,
                        priority: 3, type: 'jump'
                    });
                }

                // 最優先オプションで脱出
                if (escapeOptions.length > 0) {
                    escapeOptions.sort((a, b) => a.priority - b.priority);
                    const escape = escapeOptions[0];

                    this.gridPos.x = escape.x;
                    this.gridPos.y = escape.y;
                    this.gridPos.z = escape.z;
            this.updateWorldPosFromGrid();
                    this._cornerStuckTimer = 0;
                    this.log(`Rescued from corner via ${escape.type}:`, {x: escape.x, y: escape.y, z: escape.z});
                    return;
                }
            }

            // 段階2: 2.5秒後、ブロックを破壊して脱出
            if (this._cornerStuckTimer > 2.5) {
                const breakableBlocks = [];

                for (let dx = -1; dx <= 1; dx++) {
                    for (let dz = -1; dz <= 1; dz++) {
                        if (dx === 0 && dz === 0) continue;
                        const x = this.gridPos.x + dx;
                        const z = this.gridPos.z + dz;
                        const y = this.gridPos.y;
                        const key = `${x},${y},${z}`;
                        const blockId = worldData.get(key);

                        if (blockId && blockId !== BLOCK_TYPES.BED?.id) {
                            const blockType = Object.values(BLOCK_TYPES).find(t => t.id === blockId);
                            if (blockType && blockType.diggable) {
                                breakableBlocks.push({
                                    x, y, z,
                                    priority: blockType.name === 'Dirt' ? 1 : 2,
                                    distance: Math.abs(dx) + Math.abs(dz)
                                });
                            }
                        }
                    }
                }

                if (breakableBlocks.length > 0) {
                    // 優先度と距離でソート
                    breakableBlocks.sort((a, b) => a.priority - b.priority || a.distance - b.distance);
                    const toBreak = breakableBlocks[0];

                    // Reservation-based removal
                    this.reserveAndRemoveBlock(toBreak.x, toBreak.y, toBreak.z);
                    this._cornerStuckTimer = 0;
                    this.log('Rescued from corner: removed block (reserved)', toBreak);
                }
            }
            return;
        }
        // 完全囲い込み救助（改良版：緊急テレポート機能付き）
        if (stuckInfo.type === 'enclosure') {
            this._enclosureTimer = (this._enclosureTimer || 0) + deltaTime;

            // 段階1: 最適なブロックを破壊
            if (this._enclosureTimer > 1.5 && stuckInfo.breakable) {
                // Reservation-based removal to avoid races
                this.reserveAndRemoveBlock(stuckInfo.breakable.x, stuckInfo.breakable.y, stuckInfo.breakable.z);
                this._enclosureTimer = 0;
                this.log('Rescued from enclosure: removed priority block (reserved)', stuckInfo.breakable);
                return;
            }

            // 段階2: 緊急テレポート（最後の手段）
            if (this._enclosureTimer > 5.0) {
                // 安全な場所を探してテレポート
                const safeSpots = [];
                const searchRadius = 5;

                for (let dx = -searchRadius; dx <= searchRadius; dx++) {
                    for (let dz = -searchRadius; dz <= searchRadius; dz++) {
                        for (let dy = -2; dy <= 2; dy++) {
                            const x = this.gridPos.x + dx;
                            const y = this.gridPos.y + dy;
                            const z = this.gridPos.z + dz;

                            if (y < 0) continue;

                            const key = `${x},${y},${z}`;
                            const below = `${x},${y-1},${z}`;

                            // 空きスペースで足場があり、他キャラがいない
                            if (!worldData.has(key) && worldData.has(below) && !this.isOccupiedByOther(x, y, z)) {
                                const distance = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
                                safeSpots.push({x, y, z, distance});
                            }
                        }
                    }
                }

                if (safeSpots.length > 0) {
                    // 最も近い安全な場所にテレポート
                    safeSpots.sort((a, b) => a.distance - b.distance);
                    const safe = safeSpots[0];

                    this.gridPos.x = safe.x;
                    this.gridPos.y = safe.y;
                    this.gridPos.z = safe.z;
            this.updateWorldPosFromGrid();
                    this._enclosureTimer = 0;
                    this.log('Emergency teleport from enclosure to', safe);

                    // 少しエネルギーを消費（ペナルティ）
                    if (this.needs && this.needs.energy) {
                        this.needs.energy = Math.max(10, this.needs.energy - 20);
                    }
                } else {
                    // 本当に最後の手段：真上にテレポート
                    let upY = this.gridPos.y + 1;
                    while (upY < maxHeight && worldData.has(`${this.gridPos.x},${upY},${this.gridPos.z}`)) {
                        upY++;
                    }
                    if (upY < maxHeight) {
                        this.gridPos.y = upY;
                        this.updateWorldPosFromGrid();
                        this._enclosureTimer = 0;
                        this.log('Last resort: teleported upward to', {y: upY});
                    }
                }
            }
        }
    }

}

export { Character };
