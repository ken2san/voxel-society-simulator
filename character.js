// --- 落下先が安全か（抜け出せるか）判定 ---

import * as THREE from 'three';
import { worldData, BLOCK_TYPES, ITEM_TYPES, blockMaterials, gridSize, findGroundY, addBlock, removeBlock, spawnCharacter, maxHeight } from './world.js';
import { decideNextAction_rulebase } from './AI_rulebase.js';
import { decideNextAction_utility } from './AI_utility.js';
import { chooseClosestTarget, simpleNeedsPriority } from './character_ai.js';

// --- Helper: 3Dオブジェクトのワールド座標をスクリーン座標に変換 ---
function toScreenPosition(obj, camera, canvas = null) {
    // obj: THREE.Object3D, camera: THREE.Camera, canvas: HTMLCanvasElement
    const vector = new THREE.Vector3();
    obj.updateMatrixWorld();
    vector.setFromMatrixPosition(obj.matrixWorld);
    vector.project(camera);
    let rect = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    if (!canvas) {
        canvas = document.getElementById('gameCanvas');
    }
    if (canvas && typeof canvas.getBoundingClientRect === 'function') {
        rect = canvas.getBoundingClientRect();
    }
    const x = (vector.x + 1) / 2 * rect.width + rect.left;
    const y = (1 - vector.y) / 2 * rect.height + rect.top;
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
        this.log(`建築完了！ type=${type} buildCount=${this.buildCount || 0}`, this.homePosition);
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
    // --- 現在のアクションを実行する ---
    performAction() {
        this.log('⚡ performAction called:', this.action?.type);
        if (!this.action || !this.action.type) {
            this.state = 'idle';
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
                    const partnerCritical = (partner.needs?.hunger <= 10 || partner.needs?.energy <= 10);
                    if (partnerCritical) {
                        this.state = 'idle';
                        this.action = null;
                        this.actionCooldown = 1.0;
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
                this.state = 'idle';
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
            this.state = 'idle';
            return;
        }

        this.log('Executing action:', this.action.type, this.action);

        switch (this.action.type) {
            case 'WANDER':
                // WANDER action is completed by reaching the destination
                this.state = 'idle';
                this.action = null;
                this.actionCooldown = 0.5;
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
                this.log('⚡ BUILD_HOME実行開始');
                this.buildHome();
                break;
            case 'CRAFT_TOOL':
                this.log('⚡ CRAFT_TOOL実行開始');
                this.craftTool();
                break;
            case 'DESTROY_BLOCK':
                this.log('⚡ DESTROY_BLOCK実行開始');
                this.destroyBlock();
                break;
            case 'SEEK_SHELTER':
                this.seekShelter();
                break;
            case 'REST':
                this.state = 'resting';
                break;
            default:
                this.log('No execution handler for action:', this.action.type);
                this.state = 'idle';
                this.action = null;
                this.actionCooldown = 0.5;
                break;
        }
    }

    // --- 個別のアクション実行メソッド ---

    // アクションアイコンを表示
    showActionIcon(iconText, duration = 2.0) {
        if (!this.actionIconDiv) return;

        this.actionIconDiv.textContent = iconText;
        this.actionIconDiv.style.opacity = 1;
        this.actionIconDiv.style.transform = 'scale(1.2)'; // 少し大きく表示
        this.actionIconDiv.style.filter = 'drop-shadow(2px 2px 4px rgba(0,0,0,0.3))';

        // キャラクターの頭上に配置
        const screenPos = this.getScreenPosition();
        if (screenPos) {
            this.actionIconDiv.style.left = (screenPos.x - 20) + 'px';
            this.actionIconDiv.style.top = (screenPos.y - 60) + 'px';
        }

        // バウンスアニメーション
        this.actionIconDiv.style.animation = 'bounce 0.6s ease-out';

        // 指定時間後にフェードアウト
        setTimeout(() => {
            if (this.actionIconDiv) {
                this.actionIconDiv.style.opacity = 0;
                this.actionIconDiv.style.transform = 'scale(0.8) translateY(-10px)';
                this.actionIconDiv.style.animation = '';
            }
        }, duration * 1000);
    }

    // スクリーン座標を取得
    getScreenPosition() {
        if (!this.mesh || !window.camera || !window.renderer) return null;

        const vector = new THREE.Vector3();
        vector.setFromMatrixPosition(this.mesh.matrixWorld);
        vector.project(window.camera);

        const widthHalf = window.renderer.domElement.clientWidth / 2;
        const heightHalf = window.renderer.domElement.clientHeight / 2;

        return {
            x: (vector.x * widthHalf) + widthHalf,
            y: -(vector.y * heightHalf) + heightHalf
        };
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
                removeBlock && removeBlock(x, y, z);

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
                    this.needs.hunger = Math.min(100, this.needs.hunger + 40 + Math.random() * 20);
                    this.eatCount = (this.eatCount || 0) + 1;
                    this.log(`食事完了！ eatCount=${this.eatCount}, hunger=${this.needs.hunger.toFixed(1)}`);

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
        this.log('EAT_FOOD: 食事開始');
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
            if (blockType && (blockType.name === '木' || blockType.name === '葉')) {
                this._choppingProgress += 1;

                // 段階的なアイコン表示（ブロックタイプに応じて変更）
                let stages;
                if (blockType.name === '葉') {
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
                removeBlock && removeBlock(x, y, z);

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
                    if (blockType.name === '葉') {
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
            this.log('DESTROY_BLOCK: 採掘開始');
        }

        const { x, y, z } = this.action.target;
        const key = `${x},${y},${z}`;
        const blockId = worldData.get(key);

        if (blockId) {
            this._diggingProgress += 1;
            this.log(`採掘進行: ${this._diggingProgress}/18`);

            // 段階的なアイコン表示とエフェクト
            const stages = ['⛏️', '💪⛏️', '💥⛏️', '🔥⛏️', '✨💎'];
            const currentStage = Math.floor(this._diggingProgress / 4) % stages.length;
            if (currentStage !== this._diggingStage) {
                this.showActionIcon(stages[currentStage], 0.6);
                this._diggingStage = currentStage;
            }

            // 完了判定
            if (this._diggingProgress >= 18) {
                const blockType = Object.values(BLOCK_TYPES).find(t => t.id === blockId);

                removeBlock && removeBlock(x, y, z);
                this.digCount = (this.digCount || 0) + 1;
                this.log(`採掘完了！ digCount=${this.digCount}`);

                // 破壊したブロックからアイテムを取得
                if (blockType) {
                    if (blockType.name.includes('果実') || blockType.name === 'FRUIT') {
                        this.inventory[0] = 'FRUIT_ITEM';
                        this.updateCarriedItemAppearance('FRUIT_ITEM');
                        this.carriedItemMesh.visible = true;
                        this.log(`✅ 果実アイテム取得！ inventory=[${this.inventory[0]}] hunger=${this.needs.hunger.toFixed(1)}`);
                    } else if (blockType.name.includes('石')) {
                        // 石は直接使用するか、道具作成に使用
                        this.showActionIcon('🗿💥', 2.0);
                        this.log('Destroyed stone block');
                    } else if (blockType.name.includes('土')) {
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
                    if (blockType.name.includes('石')) {
                        this.showActionIcon('🗿💥', 2.0);
                    } else if (blockType.name.includes('土')) {
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

        this.log('DESTROY_BLOCK: ターゲットブロックが見つからない');
        this.state = 'idle';
        this.action = null;
        this.actionCooldown = 1.0;
    }

    craftTool() {
        // 段階的な道具作成アニメーション
        if (!this._craftingProgress) {
            this._craftingProgress = 0;
            this._craftingStage = 0;
            this.log('CRAFT_TOOL: 道具作成開始');
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
        this.log(`作成進行: ${this._craftingProgress}/20`);

        const stages = ['🔨', '🪚', '⚒️', '🛠️', '✨🔧'];
        const messages = ['材料準備中...', '切削中...', '組み立て中...', '調整中...', '完成！'];
        const currentStage = Math.floor(this._craftingProgress / 4) % stages.length;

        if (currentStage !== this._craftingStage) {
            this.showActionIcon(stages[currentStage], 1.0);
            this._craftingStage = currentStage;
        }

        // 完了判定（35→20に短縮で道具作成を高速化）
        if (this._craftingProgress >= 20) {
            // 材料を消費して道具作成
            // 木材を消費
            const woodIndex = this.inventory.findIndex(item => item === 'WOOD_LOG');
            if (woodIndex !== -1) {
                this.inventory[woodIndex] = 'STONE_TOOL';
                this.log('木材を消費して道具を作成');
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
            this.log('道具作成完了！', 'STONE_TOOL');

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
            this.log('BUILD_HOME: 建築開始');
        }

        // 家建設の処理 - 木材の在庫数をチェック
        const woodCount = this.inventory.filter(item => item === 'WOOD_LOG').length;

        if (woodCount > 0) {
            // より慎重な建築進行（+1）
            this._buildingProgress += 1;
            this.log(`建築進行: ${this._buildingProgress}/15 (木材: ${woodCount}個)`);

            // 段階的な建築アイコン表示
            const stages = ['🔨', '🏗️', '🧱', '🏠', '✨🏡'];
            const messages = ['設計中...', '基礎工事中...', '壁を作成中...', '屋根を設置中...', '完成！'];
            const currentStage = Math.floor(this._buildingProgress / 3) % stages.length;

            if (currentStage !== this._buildingStage) {
                this.showActionIcon(stages[currentStage], 1.0);
                this._buildingStage = currentStage;
            }

            // 15進捗で木材を1つ消費（木材1個で家完成）
            if (this._buildingProgress >= 15 && woodCount > 0) {
                // 木材を1つ削除
                const woodIndex = this.inventory.findIndex(item => item === 'WOOD_LOG');
                if (woodIndex !== -1) {
                    this.inventory[woodIndex] = null;
                    this.log(`木材を1個使用 (残り: ${woodCount - 1}個)`);

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

        this.log('BUILD_HOME: 木材がない');
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
            this.log(`⚡ Setting important action: ${type} (protected for 1 second)`);
        }

        // 行動履歴を記録
        if (!this.actionHistory) this.actionHistory = [];
        this.actionHistory.push(type);
        if (this.actionHistory.length > 20) this.actionHistory.shift();

        // --- WANDER時は到達可能な候補のみ選ぶ（新システム使用） ---
        if (type === 'WANDER' && !moveTo) {
            const candidates = this._getReachableGridCandidates(2, true, 10);
            if (candidates.length > 0) {
                const selectedMoveTo = candidates[Math.floor(Math.random() * candidates.length)];
                this.action = { type, target, item };
                this.targetPos = selectedMoveTo;
                this.state = 'moving';
                return;
            }
            // 到達可能な候補がなければ従来通り
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
            this.targetPos = moveTo;
            this.state = 'moving';
        } else if (type === 'SOCIALIZE' && moveTo) {
            // SOCIALIZE の場合は距離をチェック
            const dist = Math.abs(this.gridPos.x - moveTo.x) + Math.abs(this.gridPos.y - moveTo.y) + Math.abs(this.gridPos.z - moveTo.z);
            if (dist <= 1) {
                // 隣接していれば即座に実行
                this.performAction();
            } else {
                // 遠い場合は移動
                this.targetPos = moveTo;
                this.state = 'moving';
            }
        } else {
            // moveTo が null または undefined の場合は移動不要
            // targetPos をクリアして即座にアクション実行
            this.targetPos = null;
            this.performAction();
        }
    }

// Duplicate class declaration removed
    // --- 失敗ターゲット記憶用: 食料採集失敗時に同じ座標を避ける ---
    static failedFoodTargets = new Set();
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
    isBlockPassable(blockId) {
        if (blockId === undefined || blockId === null) return true;

        const blockType = Object.values(BLOCK_TYPES).find(t => t.id === blockId);
        if (!blockType) return true;

        const passableBlocks = ['空気', '木', '葉', '果実'];
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
        if (directDist <= directMoveThreshold) return [goal];

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
                    const blockId = worldData.get(key);
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
        // stateがdeadならidleにリセット
        if (this.state === 'dead') {
            this.state = 'idle';
            this.action = null;
        }
        // --- Mood（感情状態）---
        this.mood = 'neutral'; // 'happy', 'sad', 'angry', 'lonely', 'scared', etc.
        this.personality = genes ? genes : {
            bravery: 0.5 + Math.random() * 0.2,
            diligence: 0.5 + Math.random() * 0.2
        };
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
        this.body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 1.0, 32), this.bodyMaterial);
        this.body.position.y = 0.5;
        this.body.castShadow = true;
        this.body.receiveShadow = true;
        this.mesh.add(this.body);
        // Simple head (slightly smaller cylinder)
        this.head = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.20, 0.32, 24), this.bodyMaterial);
        this.head.position.y = 1.08;
        this.head.castShadow = true;
        this.head.receiveShadow = true;
        this.mesh.add(this.head);
        // Icon anchor (above head)
        this.iconAnchor = new THREE.Object3D();
        this.iconAnchor.position.set(0, 0.22, 0); // above head
        this.head.add(this.iconAnchor);
        // Simple face: two holes (black circles) for eyes
        this.eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x222222 });
        const eyeGeometry = new THREE.CylinderGeometry(0.025, 0.025, 0.01, 12);
        this.leftEye = new THREE.Mesh(eyeGeometry, this.eyeMaterial); this.leftEye.position.set(-0.06, 0.05, 0.17); this.leftEye.rotation.x = Math.PI/2; this.head.add(this.leftEye);
        this.rightEye = new THREE.Mesh(eyeGeometry, this.eyeMaterial); this.rightEye.position.set(0.06, 0.05, 0.17); this.rightEye.rotation.x = Math.PI/2; this.head.add(this.rightEye);
        this.eyeMeshes = [this.leftEye, this.rightEye];
        // Simple mouth: small horizontal hole
        const mouthGeometry = new THREE.CylinderGeometry(0.04, 0.04, 0.01, 12);
        this.mouth = new THREE.Mesh(mouthGeometry, this.eyeMaterial);
        this.mouth.position.set(0, -0.04, 0.17);
        this.mouth.rotation.x = Math.PI/2;
        this.head.add(this.mouth);
        // Arm loops (torus)
        const armMaterial = new THREE.MeshLambertMaterial({ color: 0xc68642 });
        const armGeometry = new THREE.TorusGeometry(0.13, 0.025, 10, 24, Math.PI*1.2);
        this.leftArm = new THREE.Mesh(armGeometry, armMaterial); this.leftArm.position.set(-0.22, 0.65, 0); this.leftArm.rotation.z = Math.PI/2.2; this.body.add(this.leftArm);
        this.rightArm = new THREE.Mesh(armGeometry, armMaterial); this.rightArm.position.set(0.22, 0.65, 0); this.rightArm.rotation.z = -Math.PI/2.2; this.body.add(this.rightArm);
        // Carried item
        const carriedItemMaterial = new THREE.MeshLambertMaterial({ color: 0x8B4513 }); // Brown color
        this.carriedItemMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), carriedItemMaterial); this.carriedItemMesh.position.set(0, 1.0, 0.3); this.carriedItemMesh.visible = false; this.mesh.add(this.carriedItemMesh);
        // Shadow
        const shadowGeometry = new THREE.CircleGeometry(0.32, 32);
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
        const affinityMax = (typeof window !== 'undefined' && window.initialAffinityMax !== undefined) ? window.initialAffinityMax : 40;
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
        let closest = null;
        let minDist = Infinity;
        // Use global characters array (browser global or fallback)
        const chars = (typeof window !== 'undefined' && window.characters) ? window.characters : (typeof characters !== 'undefined' ? characters : []);
        // Use global perception range if set, else default to 2
        const perceptionRange = (typeof window !== 'undefined' && window.perceptionRange !== undefined) ? window.perceptionRange : 2;
        for (const char of chars) {
            if (char.id === this.id) continue;
            const dist = Math.abs(this.gridPos.x - char.gridPos.x) + Math.abs(this.gridPos.y - char.gridPos.y) + Math.abs(this.gridPos.z - char.gridPos.z);
            if (dist < minDist && dist <= perceptionRange) { // perceptionRangeマス以内のみ対象
                minDist = dist;
                closest = char;
            }
        }
        return closest;
    }

    findClosestFood() {
        let minDist = Infinity, closest = null;
        for (const [key, id] of worldData.entries()) {
            if (Character.failedFoodTargets.has(key)) continue; // 失敗ターゲットは除外
            const type = Object.values(BLOCK_TYPES).find(t => t.id === id);
            if (type && type.isEdible) {
                const [x, y, z] = key.split(',').map(Number);
                const dist = Math.abs(this.gridPos.x - x) + Math.abs(this.gridPos.y - y) + Math.abs(this.gridPos.z - z);
                if (dist < minDist) {
                    minDist = dist;
                    closest = { x, y, z };
                }
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
            if (type && type.diggable && (type.name === '木' || type.name === '葉')) {
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
            if (type && type.diggable && (type.name === '石' || type.name.includes('石') || type.name === 'STONE')) {
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
                        if (type && type.diggable && (type.name === '石' || type.name.includes('石') || type.name === 'STONE')) {
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
        const blockId = worldData.get(`${blockBelowPos.x},${blockBelowPos.y},${blockBelowPos.z}`);
        const blockType = Object.values(BLOCK_TYPES).find(t => t.id === blockId);
        return blockType && blockType.diggable;
    }

    // --- Learning logic (bak_game.js準拠) ---
    learn(outcome) {
        if (outcome.type === 'SAFETY_DECREASE') { this.personality.bravery = Math.max(0.5, this.personality.bravery - 0.05); }
        else if (outcome.type === 'ATE_FOOD' && outcome.inDanger) { this.personality.bravery = Math.min(1.5, this.personality.bravery + 0.1); }
        else if (outcome.type === 'BUILT_HOME') { this.personality.diligence = Math.min(1.5, this.personality.diligence + 0.2); }
        else if (outcome.type === 'FOUND_SHELTER') { this.personality.diligence = Math.min(1.5, this.personality.diligence + 0.05); }
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

    update(deltaTime, isNight, camera) {
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
            for (const char of chars) {
                if (char.id === this.id) continue;
                const dist = Math.abs(this.gridPos.x - char.gridPos.x) + Math.abs(this.gridPos.y - char.gridPos.y) + Math.abs(this.gridPos.z - char.gridPos.z);
                if (dist > 0 && dist <= perceptionRange) { foundNearby = true; break; }
            }
            if (foundNearby) {
                this.needs.social = Math.min(100, this.needs.social + deltaTime * 5);
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
            removeBlock(breakable.x, breakable.y, breakable.z);
            this.log('Break out: forcibly destroyed block to escape enclosure', breakable);
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
            this.log(`⚡ working状態で処理継続: ${this.action.type}`, this.action);
            switch (this.action.type) {
                case 'BUILD_HOME':
                    this.log('⚡ Calling buildHome() from working state');
                    this.buildHome();
                    break;
                case 'CRAFT_TOOL':
                    this.craftTool();
                    break;
                case 'DESTROY_BLOCK':
                    this.destroyBlock();
                    break;
                default:
                    this.log(`未対応のworking action: ${this.action.type}`);
                    this.state = 'idle';
                    this.action = null;
                    break;
            }
            this.updateThoughtBubble(isNight, camera);
            return;
        }
        // --- Needs decay (bak_game.js準拠) ---
        const oldSafety = this.needs.safety;
        this.needs.hunger -= deltaTime * 0.7 * this.personality.diligence; // 減少速度を半分に
        this.needs.social -= deltaTime * 1.5; // 社交ニーズの減少を速めて頻繁に交流するように
        if (this.state === 'moving' || this.state === 'working') {
            this.needs.energy -= deltaTime * 2;
        }
        if (isNight && !this.isSafe(isNight)) {
            this.needs.safety -= deltaTime * 5;
        } else if (!isNight) {
            this.needs.safety = Math.min(100, this.needs.safety + deltaTime * 16);
        }
        // --- needsの下限を0にクリップ ---
        this.needs.hunger = Math.max(this.needs.hunger, 0);
        this.needs.social = Math.max(this.needs.social, 0);
        this.needs.energy = Math.max(this.needs.energy, 0);
        this.needs.safety = Math.max(this.needs.safety, 0);
        if (isNight && oldSafety > this.needs.safety) {
            this.learn && this.learn({ type: 'SAFETY_DECREASE' });
        }

        // --- Mood（感情状態）の更新 ---
        // シンプルなルールでmoodを決定
        if (this.state === 'dead') {
            this.mood = 'dead';
        } else if (this.state === 'resting') {
            this.mood = 'tired';
        } else if (this.state === 'socializing') {
            if (this.needs.social > 80) this.mood = 'happy';
            else this.mood = 'social';
        } else if (this.needs.hunger < 20) {
            this.mood = 'hungry';
        } else if (this.needs.safety < 20) {
            this.mood = 'scared';
        } else if (this.needs.energy < 20) {
            this.mood = 'tired';
        } else if (this.needs.social < 20) {
            this.mood = 'lonely';
        } else if (this.state === 'meeting') {
            this.mood = 'excited';
        } else if (this.state === 'confused') {
            this.mood = 'confused';
        } else if (this.state === 'moving') {
            this.mood = 'active';
        } else {
            this.mood = 'neutral';
        }
        // Recovery
        if (this.state === 'resting') {
            this.needs.energy = Math.min(100, this.needs.energy + deltaTime * 18);
            if (this.needs.energy >= 100) {
                this.state = 'idle';
                if (this.provisionalHome === null) {
                    this.provisionalHome = this.gridPos;
                    this.learn && this.learn({ type: 'FOUND_SHELTER' });
                }
            }
        }
        if (this.state === 'socializing') {
            const partner = this.action?.target;

            if (partner && partner.state === 'socializing') {
                // 双方の緊急ニーズをチェック（中断条件）
                const myCritical = (this.needs.hunger <= 5 || this.needs.energy <= 5);
                const partnerCritical = (partner.needs?.hunger <= 5 || partner.needs?.energy <= 5);

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
                this.needs.social = Math.min(100, this.needs.social + deltaTime * 8);
                // affinity上昇速度をパラメータ化（sidebar.jsで調整可能）
                const affinityRate = (typeof window !== 'undefined' && window.affinityIncreaseRate !== undefined) ? window.affinityIncreaseRate : 10;
                let affinity = this.relationships.get(partner.id) || 0;
                affinity += deltaTime * affinityRate;
                this.relationships.set(partner.id, affinity);
                // --- ハート表示 & reproduction logic ---
                // 両者が距離1以内＆友好度60以上でハート表示。もし既にlovePhaseが'showing'かつ
                // loveTimerが<=0ならreproduceを先に実行する（timerリセットを防ぐため）。
                const dist = Math.abs(this.gridPos.x - partner.gridPos.x) + Math.abs(this.gridPos.y - partner.gridPos.y) + Math.abs(this.gridPos.z - partner.gridPos.z);

                // If timer expired while still in socializing and conditions met, reproduce first
                if (this.loveTimer <= 0 && this.lovePhase === 'showing' && affinity >= 60) {
                    if (!this._childCreatedWith || this._childCreatedWith !== partner.id) {
                        try { console.log(`[LOVE] ${this.id} loveTimer expired, reproducing with ${partner.id}, affinity=${(affinity||0).toFixed ? affinity.toFixed(1) : affinity}`); } catch(e){}
                        this.reproduceWith && this.reproduceWith(partner);
                        const resetVal = (typeof window !== 'undefined' && window.affinityResetAfterReproduce !== undefined) ? window.affinityResetAfterReproduce : 30;
                        this.relationships.set(partner.id, resetVal);
                        partner.relationships.set(this.id, resetVal);
                        this._childCreatedWith = partner.id;
                        partner._childCreatedWith = this.id;
                        this.lovePhase = 'completed';
                        partner.lovePhase = 'completed';
                    }
                }

                // Set or refresh heart display if in proximity and affinity high enough
                if (dist <= 1 && affinity >= 60) {
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
            // SOCIALIZE終了条件を緩和：socialニーズが高くても続行（親密度60到達まで優先）
            const currentAffinity = this.relationships.get(partner?.id) || 0;
            if(this.needs.social >= 100 && currentAffinity >= 60) {
                this.state = 'idle';
            }
        }
        // Death condition（猶予を-10まで）
        if (this.needs.hunger <= -10) {
            this.die();
            this.updateThoughtBubble(isNight, camera);
            return;
        }
        // --- 行動決定 ---
        if (this.state === 'idle') {
            this.actionCooldown -= deltaTime;
            if (this.actionCooldown <= 0) this.decideNextAction && this.decideNextAction(isNight);
        }
        // moving状態でも定期的にactionCooldownを減少させ、必要に応じて新しいアクションを決定
        else if (this.state === 'moving') {
            this.actionCooldown -= deltaTime;
            if (this.actionCooldown <= 0) {
                // 重要なアクション実行中は新しいアクション決定を控える
                const now = Date.now();
                const isImportantActionProtected = this._lastImportantActionTime && (now - this._lastImportantActionTime < 3000); // 3秒間保護
                if (!isImportantActionProtected) {
                    // 移動中でも定期的に新しいアクションを決定（より頻繁に）
                    this.actionCooldown = 2.0;  // 2秒後に再チェック
                    this.decideNextAction && this.decideNextAction(isNight);
                } else {
                    this.log('⚡ Moving state: Skipping AI decision due to important action protection');
                    this.actionCooldown = 1.0;  // 1秒後に再チェック
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
            if (this.needs.hunger <= 5 || this.needs.energy <= 5) {
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
        // Child aging: increase age and mature when reaching maturityAge
        if (this.isChild) {
            if (typeof this.age !== 'number') this.age = 0;
            this.age += deltaTime;
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
                                if (!this._childCreatedWith || this._childCreatedWith !== partner.id) {
                                    console.log(`[LOVE-TIMER] ${this.id} attempting reproduceWith partner ${partner.id} (prox=${prox} state=${partner.state} partnerLove=${partner.lovePhase})`);
                                    this.reproduceWith && this.reproduceWith(partner);
                                    const resetVal = (typeof window !== 'undefined' && window.affinityResetAfterReproduce !== undefined) ? window.affinityResetAfterReproduce : 30;
                                    this.relationships.set(partner.id, resetVal);
                                    partner.relationships.set(this.id, resetVal);
                                    this._childCreatedWith = partner.id;
                                    partner._childCreatedWith = this.id;
                                    this.lovePhase = 'completed';
                                    partner.lovePhase = 'completed';
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
                this._stallState.logged = false;
            }
        } catch (e) {}

        // --- UI用: 現在のアクション名をwindow.characters配列に同期 ---
        if (typeof window !== 'undefined' && window.characters) {
            const idx = window.characters.findIndex(c => c.id === this.id);
            if (idx !== -1) {
                window.characters[idx].currentAction = this.action ? this.action.type : (this.state === 'idle' ? 'IDLE' : (this.state || '-'));
            }
        }
    }
    die() {
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
        this.log('Character died and removed', { id: this.id });
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

    // --- 経路に沿った移動実行（安全判定付き） ---
    moveAlongPath() {
        if (!this.path || this.path.length === 0) return false;

        const nextPos = this.path[0];
        if (!nextPos) return false;

        // 落下先が安全か判定してから移動
        if (nextPos.y < this.gridPos.y) {
            // 下に降りる場合、落下先が安全か判定
            if (!this.isSafeToFallOrDig(nextPos.x, nextPos.y, nextPos.z)) {
                this.log('Skip move: fall destination not safe', {from: this.gridPos, to: nextPos});
                return false;
            }
        }

        // 移動実行
        const success = this.moveToGridPos(nextPos);
        if (success) {
            this.path.shift(); // パスから次の位置を削除
        }

        return success;
    }

    // Validate a computed path step-by-step for current passability and corner-cutting
    validatePath(path) {
        if (!path || path.length === 0) return false;
        let from = { ...this.gridPos };
        for (const step of path) {
            // occupancy check
            const key = `${step.x},${step.y},${step.z}`;
            if (worldData.has(key)) return false;

            // Avoid stepping into a cell occupied by another character/entity
            if (this.isOccupiedByOther(step.x, step.y, step.z)) return false;

            // basic can-move check
            const check = this.canMoveToPosition(step.x, step.y, step.z);
            if (!check.canMove) return false;

            // diagonal corner cutting: prevent moving diagonally between two blocked orthogonals
            if (this._isDiagonalCornerMoveBlocked(from, step)) return false;

            from = { x: step.x, y: step.y, z: step.z };
        }
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
            const blocked1 = (worldData.has(key1) && worldData.get(key1) !== BLOCK_TYPES.AIR.id) || this.isOccupiedByOther(from.x + dx, from.y, from.z);
            const blocked2 = (worldData.has(key2) && worldData.get(key2) !== BLOCK_TYPES.AIR.id) || this.isOccupiedByOther(from.x, from.y, from.z + dz);
            // if both orthogonals blocked, diagonal should be blocked
            if (blocked1 && blocked2) return true;
        }
        return false;
    }

    updateMovement(deltaTime) {
        // this.log('updateMovement', { targetPos: this.targetPos, gridPos: this.gridPos }); // コメントアウト
        if (!this.targetPos) { this.state = 'idle'; return; }
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

            this.lastTargetPos = { ...this.targetPos };
            // Validate path immediately after computation to avoid outdated/blocked routes
            if (!this.path || this.path.length === 0 || !this.validatePath(this.path)) {
                // try fallback to bfsPath (older but sometimes more permissive)
                this.path = this.bfsPath(this.gridPos, this.targetPos);
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
                        this.targetPos = alternativeWood;
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
                            this.targetPos = null;
                            this.path = null;
                            this.executeAction();
                            return;
                        }
                    }
                }

                // --- 追加: COLLECT_FOOD時はターゲットを失敗リストに追加 ---
                if (this.action && this.action.type === 'COLLECT_FOOD' && this.action.target) {
                    const {x, y, z} = this.action.target;
                    Character.failedFoodTargets.add(`${x},${y},${z}`);
                    this.log('Added unreachable food target to failedFoodTargets', {x, y, z});
                }
                this.bfsFailCount = (this.bfsFailCount || 0) + 1;
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
                        let fallY = y;
                        // 掘ったら落下する場合は下まで落ちる
                        while (fallY > 0 && !worldData.has(`${x},${fallY-1},${this.gridPos.z}`)) fallY--;
                        if (this.isSafeToFallOrDig(x, fallY, z)) {
                            removeBlock(x, y, z);
                            this.log('Rescue: destroyed nearby diggable block to create path (safe)', {x, y, z, fallY});
                            brokeBlock = true;
                            // Give more time after rescue digging
                            this.actionCooldown = 2.0;
                            break;
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
                        if (blockId !== undefined && blockId !== null && blockId !== BLOCK_TYPES.AIR.id) {
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
                        removeBlock(x, y, z);
                        this.log('Rescue: forcibly dug random direction after multiple path fails', {x, y, z});
                        this.bfsFailCount = 0; // リセット
                        this.actionCooldown = 2.0; // Give time for the change to take effect
                        this.state = 'idle';
                        return;
                    }
                }
                if (this.bfsFailCount > 2) {
                    this.log('BFS pathfinding failed multiple times, giving up.');

                    // If this was a wood collection action, increment AI failure counter
                    if (this.action && this.action.type === 'CHOP_WOOD') {
                        if (!this._woodFailureCount) this._woodFailureCount = 0;
                        this._woodFailureCount++;
                        const woodPos = this.action.target;
                        this._lastWoodTarget = woodPos ? `${woodPos.x},${woodPos.y},${woodPos.z}` : null;
                        this.log(`AI: Pathfinding failed for wood collection (${this._woodFailureCount} total failures)`);
                    }

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
                this.log('BFS pathfinding failed, will retry.');

                // If this was a wood collection action, increment AI failure counter on first retry too
                if (this.action && this.action.type === 'CHOP_WOOD' && this.bfsFailCount === 1) {
                    if (!this._woodFailureCount) this._woodFailureCount = 0;
                    this._woodFailureCount++;
                    const woodPos = this.action.target;
                    this._lastWoodTarget = woodPos ? `${woodPos.x},${woodPos.y},${woodPos.z}` : null;
                    this.log(`AI: Early pathfinding failure for wood collection (${this._woodFailureCount} total failures)`);
                }

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
            this.path = [];
            this.performAction && this.performAction();
            return;
        }
        // If the next cell is occupied by another character, try a local avoidance sidestep
        if (this.isOccupiedByOther(next.x, next.y, next.z)) {
            const sidestep = this.tryLocalAvoidance(next);
            if (sidestep) {
                // Prepend sidestep to path so we move there first
                this.path.unshift(sidestep);
            } else {
                // Can't avoid locally: clear path to force recompute
                this.releaseReservedSidestep && this.releaseReservedSidestep();
                this.path = [];
                this.state = 'idle';
                this.actionCooldown = 0.4;
                return;
            }
        }
        // Re-validate remaining path in case world changed while moving
        if (!this.validatePath(this.path)) {
            this.log('Path invalidated mid-move, clearing and will recompute');
            this.releaseReservedSidestep && this.releaseReservedSidestep();
            this.path = [];
            this.state = 'idle';
            this.actionCooldown = 0.4;
            return;
        }
        // --- 落下先が安全か判定してから移動 ---
        if (next.y < this.gridPos.y) {
            // 下に降りる場合、落下先が安全か判定
            if (!this.isSafeToFallOrDig(next.x, next.y, next.z)) {
                this.log('Skip move: fall destination not safe', {from: this.gridPos, to: next});
                this.state = 'idle';
                this.path = [];
                this.actionCooldown = 0.5;
                return;
            }
        }
        const prevGridPos = { ...this.gridPos };
        const targetWorldPos = new THREE.Vector3(next.x + 0.5, next.y + 0.5, next.z + 0.5);
        const direction = targetWorldPos.clone().sub(this.mesh.position);
        // 顔の向き（body/headのrotation.y）を移動方向に合わせる
        if (direction.lengthSq() > 0.0001) {
            const angle = Math.atan2(direction.x, direction.z);
            this.body.rotation.y = angle;
            this.head.rotation.y = angle;
        }
    // apply speed multiplier for slight variation
    const effectiveSpeed = (this.movementSpeed || 1.0) * (this._speedMultiplier || 1.0);
    const moveDistance = effectiveSpeed * deltaTime;
        if (direction.length() < moveDistance) {
            // 移動実行前の最終当たり判定チェック
            const moveCheck = this.canMoveToPosition(next.x, next.y, next.z);
            if (!moveCheck.canMove) {
                this.log(`Movement blocked: ${moveCheck.reason} at target position:`, next);
                this.path = []; // パスをクリアして再計算を促す
                this.state = 'idle';
                this.actionCooldown = 0.5;
                return;
            }

                this.mesh.position.copy(targetWorldPos);
            this.gridPos = {x: next.x, y: next.y, z: next.z};
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
            this.mesh.position.add(direction.multiplyScalar(moveDistance));
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
            if (blockId && blockId !== BLOCK_TYPES.AIR.id) {
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
                removeBlock(wallPos.x, wallPos.y, wallPos.z);
                this.log('Break out: forcibly destroyed block to escape corner deadlock', wallPos);
                this._cornerStuckTimer = 0;
                // 経路再探索
                this.path = this.bfsPath(this.gridPos, this.targetPos);
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
        // --- ハートマーク優先表示 ---
        if (this.loveTimer > 0) {
            this.thoughtBubble.textContent = '❤️';
            this.thoughtBubble.setAttribute('data-show', 'true');
            this.thoughtBubble.style.display = '';
            // 位置更新
            if (camera && this.iconAnchor) {
                const canvas = document.getElementById('gameCanvas');
                const pos = toScreenPosition(this.iconAnchor, camera, canvas);
                this.thoughtBubble.style.left = `${pos.x - 18}px`;
                this.thoughtBubble.style.top = `${pos.y - 48}px`;
                this.thoughtBubble.style.position = 'fixed';
            }
            return;
        }
        if (!this.thoughtBubble) return;
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
        if (icons.length === 0) icons.push('🙂');
        html += icons.map(ic => ` <span style="font-size:0.98em;vertical-align:middle;font-family:'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif;">${ic}</span>`).join('');
        if (html) {
            this.thoughtBubble.innerHTML = html;
            this.thoughtBubble.setAttribute('data-show', 'true');
            const canvas = document.getElementById('gameCanvas');
            const screenPos = toScreenPosition(this.iconAnchor, camera, canvas);
            this.thoughtBubble.style.left = `${screenPos.x - 14}px`;
            this.thoughtBubble.style.top = `${screenPos.y - 50}px`;
            this.thoughtBubble.style.position = 'fixed';
            this.thoughtBubble.style.display = 'block';
            this.thoughtBubble.style.background = 'rgba(255,255,255,0.92)';
            this.thoughtBubble.style.border = '1.2px solid #eee';
            this.thoughtBubble.style.borderRadius = '16px';
            this.thoughtBubble.style.boxShadow = '0 2px 8px #0001';
            this.thoughtBubble.style.padding = '2px 8px';
            this.thoughtBubble.style.color = '#333';
            this.thoughtBubble.style.fontSize = '1.08em';
        } else {
            this.thoughtBubble.setAttribute('data-show', 'false');
            this.thoughtBubble.style.display = 'none';
        }
    }

    reproduceWith(partner) {
        // Prevent children from reproducing
        if (this.isChild || (partner && partner.isChild)) {
            this.log('Attempted reproduction blocked because one partner is a child', {self: this.id, partner: partner && partner.id});
            try { console.log(`[REPRO] reproduction blocked: ${this.id} or ${partner && partner.id} is a child`); } catch(e){}
            return;
        }

        // Create child with mixed color and inherited personality
        this.log('Reproducing with', partner.id);
        // reproduction cooldown per parent to avoid rapid repeated births
        const cooldownSec = (typeof window !== 'undefined' && window.reproductionCooldownSeconds !== undefined) ? window.reproductionCooldownSeconds : 20;
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
        // Mix personality
        const childGenes = {
            bravery: Math.max(0.5, Math.min(1.5, (this.personality.bravery + partner.personality.bravery) / 2 + (Math.random()-0.5)*0.1)),
            diligence: Math.max(0.5, Math.min(1.5, (this.personality.diligence + partner.personality.diligence) / 2 + (Math.random()-0.5)*0.1))
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
    spawnCharacter(spawnPos, childGenes);
        // Set child color and initial needs after spawn
        const child = typeof characters !== 'undefined' ? characters[characters.length-1] : null;
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
                try { console.log(`[REPRO] ${this.id} spawned child ${child.id} at ${JSON.stringify(spawnPos)} parents=${JSON.stringify(child.parentIds)}`); } catch(e){}
            } catch (e) { /* ignore visual tweak errors */ }
        }
    }

    decideNextAction(isNight) {
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
        if (this.needs.hunger <= 5) {
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
        if (this.needs.energy <= 5) {
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
                // UI優先度設定をチェック（さらに低い確率で実行）
                const woodPriority = (typeof window !== 'undefined' && window.woodCollectionPriority) ? window.woodCollectionPriority : 50;
                const shouldCollectWood = Math.random() * 100 < (woodPriority * 0.5); // 確率を半分に

                const wood = this.findClosestWood();
                if (wood && !this._lastWoodAttempt && shouldCollectWood) {
                    this.log(`🚨 EMERGENCY: No home, no wood, low hunger - attempting basic collection (priority: ${woodPriority * 0.5}%)`);
                    this._lastWoodAttempt = Date.now();
                    this._wanderCount = 0; // リセット
                    this.setNextAction('CHOP_WOOD', wood, wood);
                    return;
                } else if (wood && !shouldCollectWood) {
                    this.log(`🚨 EMERGENCY: No home, no wood - but wood collection priority too low (${woodPriority * 0.5}%)`);
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
            this.log('⚠️ No action chosen by AI, falling back to WANDER');
            this.setNextAction('WANDER');
        }
    }    updateColorFromPersonality() {
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
                        if (!breakable) breakable = {x, y, z, priority: blockType.name === '土' ? 1 : 2};
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
                                    priority: blockType.name === '土' ? 1 : 2,
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

                    removeBlock(toBreak.x, toBreak.y, toBreak.z);
                    this._cornerStuckTimer = 0;
                    this.log('Rescued from corner: broke block', toBreak);
                }
            }
            return;
        }
        // 完全囲い込み救助（改良版：緊急テレポート機能付き）
        if (stuckInfo.type === 'enclosure') {
            this._enclosureTimer = (this._enclosureTimer || 0) + deltaTime;

            // 段階1: 最適なブロックを破壊
            if (this._enclosureTimer > 1.5 && stuckInfo.breakable) {
                removeBlock(stuckInfo.breakable.x, stuckInfo.breakable.y, stuckInfo.breakable.z);
                this._enclosureTimer = 0;
                this.log('Rescued from enclosure: broke priority block', stuckInfo.breakable);
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

    // デバッグログメソッド
    log(...args) {
        if (typeof window !== 'undefined' && window.DEBUG_MODE) {
            console.log(`[Char ${this.id}]`, ...args);
        }
    }
}

export { Character };
