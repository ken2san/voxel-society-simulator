// --- 落下先が安全か（抜け出せるか）判定 ---

import * as THREE from 'three';
import { worldData, BLOCK_TYPES, ITEM_TYPES, blockMaterials, gridSize, findGroundY, addBlock, removeBlock, spawnCharacter, maxHeight } from './world.js';

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


class Character {
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
        if (!this.action || !this.action.type) {
            this.state = 'idle';
            return;
        }
        switch (this.action.type) {
            case 'WANDER':
                // ランダムな方向に移動
                this.state = 'moving';
                // 近くの空きマスを探して移動
                const dirs = [
                    {dx:1,dy:0,dz:0},{dx:-1,dy:0,dz:0},{dx:0,dy:0,dz:1},{dx:0,dy:0,dz:-1},
                    {dx:0,dy:1,dz:0},{dx:0,dy:-1,dz:0}
                ];
                let found = false;
                for (let i = 0; i < dirs.length; i++) {
                    const d = dirs[Math.floor(Math.random() * dirs.length)];
                    const x = this.gridPos.x + d.dx;
                    const y = this.gridPos.y + d.dy;
                    const z = this.gridPos.z + d.dz;
                    const key = `${x},${y},${z}`;
                    const below = `${x},${y-1},${z}`;
                    if (!worldData.has(key) && worldData.has(below)) {
                        this.targetPos = {x, y, z};
                        this.state = 'moving';
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    this.state = 'idle';
                }
                break;
            case 'SOCIALIZE':
                // 社交状態に遷移
                this.state = 'socializing';
                // パートナーも同時に社交状態にする
                const partner = this.action.target;
                if (partner && partner !== this && partner.state !== 'socializing') {
                    partner.setNextAction && partner.setNextAction('SOCIALIZE', this, this.gridPos);
                }
                break;
            // 必要に応じて他のアクションタイプも追加
            default:
                this.state = 'idle';
                break;
        }
    }
    setNextAction(type, target = null, moveTo = null, item = null) {
        // 行動履歴を記録
        if (!this.actionHistory) this.actionHistory = [];
        this.actionHistory.push(type);
        if (this.actionHistory.length > 20) this.actionHistory.shift();
        this.log(`Action chosen: ${type}`, {target, moveTo});
        if (type === 'SOCIALIZE') {
            this.log('SOCIALIZE action selected', { id: this.id, target: target?.id, pos: this.gridPos });
        }
        this.action = { type, target, item };
        if (moveTo) { this.targetPos = moveTo; this.state = 'moving'; }
        else { this.performAction(); }
    }

// Duplicate class declaration removed
    // --- 失敗ターゲット記憶用: 食料採集失敗時に同じ座標を避ける ---
    static failedFoodTargets = new Set();
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
        for (const char of characters) {
            console.log(`Character ${char.id}: groupId=${char.groupId}, role=${char.role}`);
        }
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
            this.log('Won land contest against', otherChar.id);
        } else {
            // Retreat (wander)
            this.log('Lost land contest against', otherChar.id);
            this.setNextAction('WANDER');
        }
    }

    // ...existing code...
    // --- BFSパスファインディング（bak_game.js準拠）---
    bfsPath(start, goal, maxStep = 32) {
        // 3DグリッドでのBFS経路探索。段差・落下・ジャンプも考慮。
        const queue = [];
        const visited = new Set();
        const parent = new Map();
        const key = (p) => `${p.x},${p.y},${p.z}`;
        queue.push(start);
        visited.add(key(start));
        let found = false;
        let final = null;
        while (queue.length > 0 && !found) {
            const cur = queue.shift();
            if (cur.x === goal.x && cur.y === goal.y && cur.z === goal.z) {
                found = true; final = cur; break;
            }
            // 6方向+段差考慮
            const dirs = [
                {dx:1,dy:0,dz:0},{dx:-1,dy:0,dz:0},{dx:0,dy:0,dz:1},{dx:0,dy:0,dz:-1},
                {dx:0,dy:1,dz:0},{dx:0,dy:-1,dz:0}
            ];
            for (const d of dirs) {
                let nx = cur.x + d.dx, ny = cur.y + d.dy, nz = cur.z + d.dz;
                if (ny < 0 || ny > maxHeight) continue;
                const nkey = `${nx},${ny},${nz}`;
                if (visited.has(nkey)) continue;
                // 足場チェック: 下にブロックがある or 今いる場所が地面
                const below = `${nx},${ny-1},${nz}`;
                const curBelow = `${cur.x},${cur.y-1},${cur.z}`;
                if (!worldData.has(below) && !worldData.has(curBelow)) continue;
                if (worldData.has(nkey)) continue;
                // 段差・ジャンプ: 1段上までOK
                if (Math.abs(ny - cur.y) > 1) continue;
                queue.push({x:nx,y:ny,z:nz});
                visited.add(nkey);
                parent.set(nkey, cur);
            }
        }
        if (!found) return null;
        // 経路復元
        const path = [];
        let cur = final;
        while (cur && (cur.x !== start.x || cur.y !== start.y || cur.z !== start.z)) {
            path.push(cur);
            cur = parent.get(key(cur));
        }
        path.reverse();
        return path;
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

        // --- Social role assignment ---
        this.role = 'worker'; // All start as worker; leader emerges via group detection
        this.groupId = null; // Will be set by group detection
        // --- Owned land (set of grid keys) ---
        this.ownedLand = new Set();

        // AI & State
        this.gridPos = startPos;
        this.homePosition = null; this.provisionalHome = null;
        this.inventory = [null];
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
        this.carriedItemMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5)); this.carriedItemMesh.position.set(0, 1.0, 0.3); this.carriedItemMesh.visible = false; this.mesh.add(this.carriedItemMesh);
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
        for (const [key, id] of worldData.entries()) {
            const type = Object.values(BLOCK_TYPES).find(t => t.id === id);
            if (type && type.diggable && type.name === '木') {
                const [x, y, z] = key.split(',').map(Number);
                const dist = Math.abs(this.gridPos.x - x) + Math.abs(this.gridPos.y - y) + Math.abs(this.gridPos.z - z);
                if (dist < minDist) { minDist = dist; closest = {x, y, z}; }
            }
        }
        return closest;
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
                    this.mesh.position.y = fallY;
                    this._airTime = 0;
                    this.log('Rescued from air: forced drop to ground', {y: fallY});
                }
            }
        } else {
            this._airTime = 0;
        }

        this.log('update called', { deltaTime, isNight, state: this.state, gridPos: this.gridPos, targetPos: this.targetPos });
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
        // --- Needs decay (bak_game.js準拠) ---
        const oldSafety = this.needs.safety;
        this.needs.hunger -= deltaTime * 0.7 * this.personality.diligence; // 減少速度を半分に
        this.needs.social -= deltaTime * 1;
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
                // needs.social回復速度を半分に
                this.needs.social = Math.min(100, this.needs.social + deltaTime * 11);
                // affinity上昇速度をパラメータ化
                const affinityRate = (typeof window !== 'undefined' && window.affinityIncreaseRate !== undefined) ? window.affinityIncreaseRate : 10;
                let affinity = this.relationships.get(partner.id) || 0;
                affinity += deltaTime * affinityRate;
                this.relationships.set(partner.id, affinity);
                // --- ハートアイコン表示 ---
                if (affinity > 30) {
                    this.thoughtBubble.textContent = '❤️';
                    this.thoughtBubble.setAttribute('data-show', 'true');
                }
                if (affinity >= 50) {
                    this.reproduceWith && this.reproduceWith(partner);
                    // 友好度リセット値をパラメータ化（デフォルト10）
                    const resetVal = (typeof window !== 'undefined' && window.affinityResetAfterReproduce !== undefined) ? window.affinityResetAfterReproduce : 10;
                    this.relationships.set(partner.id, resetVal);
                    partner.relationships.set(this.id, resetVal);
                }
            }
            if(this.needs.social >= 100) this.state = 'idle';
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
        if (this.state === 'moving') this.updateMovement(deltaTime);
        this.updateAnimations(deltaTime);
        this.updateThoughtBubble(isNight, camera);

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
            } else if (this.inventory[0] === 'WOOD_LOG' && BLOCK_TYPES.WOOD) {
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

    updateMovement(deltaTime) {
        this.log('updateMovement', { targetPos: this.targetPos, gridPos: this.gridPos });
        if (!this.targetPos) { this.state = 'idle'; return; }
        // --- BFS経路探索 ---
        if (!this.path || this.path.length === 0 || !this.lastTargetPos ||
            this.lastTargetPos.x !== this.targetPos.x || this.lastTargetPos.y !== this.targetPos.y || this.lastTargetPos.z !== this.targetPos.z) {
            // 新しい目的地 or 経路消失時は再探索
            this.path = this.bfsPath(this.gridPos, this.targetPos);
            this.lastTargetPos = { ...this.targetPos };
            if (!this.path || this.path.length === 0) {
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
                        while (fallY > 0 && !worldData.has(`${x},${fallY-1},${z}`)) fallY--;
                        if (this.isSafeToFallOrDig(x, fallY, z)) {
                            removeBlock(x, y, z);
                            this.log('Rescue: destroyed nearby diggable block to create path (safe)', {x, y, z, fallY});
                            brokeBlock = true;
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
                    }
                }
                if (this.bfsFailCount > 2) {
                    this.log('BFS pathfinding failed multiple times, giving up.');
                    this.state = 'idle';
                    this.bfsFailCount = 0;
                    this.actionCooldown = 1.0;
                    return;
                }
                this.log('BFS pathfinding failed, will retry.');
                this.actionCooldown = 0.5;
                this.state = 'idle';
                return;
            }
            this.bfsFailCount = 0;
        }
        // 1マスずつ進む
        const next = this.path[0];
        if (!next) {
            this.state = 'idle';
            this.path = [];
            this.performAction && this.performAction();
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
        const targetWorldPos = new THREE.Vector3(next.x + 0.5, next.y, next.z + 0.5);
        const direction = targetWorldPos.clone().sub(this.mesh.position);
        // 顔の向き（body/headのrotation.y）を移動方向に合わせる
        if (direction.lengthSq() > 0.0001) {
            const angle = Math.atan2(direction.x, direction.z);
            this.body.rotation.y = angle;
            this.head.rotation.y = angle;
        }
        const moveDistance = this.movementSpeed * deltaTime;
        if (direction.length() < moveDistance) {
            this.mesh.position.copy(targetWorldPos);
            this.gridPos = {x: next.x, y: next.y, z: next.z};
            // --- ここで移動距離を加算 ---
            const dist = Math.abs(prevGridPos.x - next.x) + Math.abs(prevGridPos.y - next.y) + Math.abs(prevGridPos.z - next.z);
            if (dist > 0) this.moveDistance += dist;
            this.path.shift();
            if (this.path.length === 0) {
                this.state = 'idle';
                this.performAction && this.performAction();
            }
        } else {
            direction.normalize();
            this.mesh.position.add(direction.multiplyScalar(moveDistance));
        }
    }

    updateAnimations(deltaTime) {
        // --- Blinking logic ---
        if (!this.blinkTimer) this.blinkTimer = 0;
        if (!this.blinkInterval) this.blinkInterval = 1.5 + Math.random();
        this.blinkTimer += deltaTime;
        if (this.blinkTimer > this.blinkInterval) {
            this.eyeMeshes.forEach(e => e.visible = false);
            if (!this.blinking) {
                this.blinking = true;
                this.blinkEnd = this.blinkTimer + 0.12;
            }
        }
        if (this.blinking && this.blinkTimer > this.blinkEnd) {
            this.eyeMeshes.forEach(e => e.visible = true);
            this.blinking = false;
            this.blinkInterval = 1.5 + Math.random();
            this.blinkTimer = 0;
        }

        // --- Facial expression (eyes/mouth color/shape) ---
        if (this.state === 'dead') {
            this.eyeMaterial.color.set(0x888888);
        } else if (this.state === 'resting') {
            this.eyeMaterial.color.set(0x2222ff);
        } else if (this.state === 'socializing') {
            this.eyeMaterial.color.set(0xff33cc);
        } else if (this.needs.hunger < 30) {
            this.eyeMaterial.color.set(0xff0000);
        } else if (this.needs.energy < 30) {
            this.eyeMaterial.color.set(0x00aaff);
        } else if (this.needs.social < 30) {
            this.eyeMaterial.color.set(0x00ff00);
        } else {
            this.eyeMaterial.color.set(0x000000);
        }
        // Mouth color/shape
        if (this.state === 'dead') {
            this.mouth.material.color.set(0x888888);
            this.mouth.rotation.z = Math.PI; // frown
        } else if (this.state === 'resting') {
            this.mouth.material.color.set(0x2222ff);
            this.mouth.rotation.z = 0;
        } else if (this.state === 'socializing') {
            this.mouth.material.color.set(0xff33cc);
            this.mouth.rotation.z = 0;
        } else if (this.needs.hunger < 30) {
            this.mouth.material.color.set(0xff0000);
            this.mouth.rotation.z = Math.PI * 0.7; // sad
        } else if (this.needs.energy < 30) {
            this.mouth.material.color.set(0x00aaff);
            this.mouth.rotation.z = Math.PI * 0.5;
        } else if (this.needs.social < 30) {
            this.mouth.material.color.set(0x00ff00);
            this.mouth.rotation.z = Math.PI * 0.2;
        } else {
            this.mouth.material.color.set(0x222222);
            this.mouth.rotation.z = 0;
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
            // More pronounced walk bob, tilt, and arm swing
            this.bobTime += deltaTime * 8;
            const walkBob = Math.abs(Math.sin(this.bobTime)) * 0.10 + Math.sin(this.bobTime * 0.5) * 0.02;
            const walkTilt = Math.cos(this.bobTime) * 0.25;
            const armSwing = Math.sin(this.bobTime) * 1.0;
            this.body.position.y = 0.25 + walkBob;
            this.head.position.y = 0.75 + Math.sin(this.bobTime + 1) * 0.04;
            this.mesh.rotation.z = walkTilt;
            this.leftArm.rotation.x = armSwing * 0.7;
            this.rightArm.rotation.x = -armSwing * 0.7;
            // Head: more energetic tilt
            this.head.rotation.z = Math.sin(this.bobTime * 0.7) * 0.13;
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
        if (this.state === 'resting') {
            this.body.scale.y = 0.6;
        } else if (!this.actionAnim.active) {
            this.body.scale.y = 1.0;
        }
    }


    updateThoughtBubble(isNight, camera) {
        // 頭上アイコン: 役割＋状態＋グループID
        if (!this.thoughtBubble) return;
        let icon = '';
        let rolePrefix = '';
        if (this.role === 'leader') rolePrefix = '👑';

        // --- moodに応じたアイコン ---
        switch (this.mood) {
            case 'dead': icon = '💀'; break;
            case 'tired': icon = '🛏️'; break;
            case 'happy': icon = '😊'; break;
            case 'social': icon = '💬'; break;
            case 'hungry': icon = '🍎'; break;
            case 'scared': icon = '😱'; break;
            case 'lonely': icon = '😢'; break;
            case 'excited': icon = '🎉'; break;
            case 'confused': icon = '❓'; break;
            case 'active': icon = '🚶'; break;
            case 'neutral': icon = ''; break;
            default: icon = ''; break;
        }
        // socializing時のハート優先
        if (this.state === 'socializing' && this.thoughtBubble.textContent === '❤️') {
            icon = '❤️';
        }

        let groupStr = '';
        // idle状態のときはグループIDを表示しない
        if (this.groupId && this.state !== 'idle') groupStr = `G${this.groupId}`;

        if (rolePrefix || icon || groupStr) {
            this.thoughtBubble.textContent = `${rolePrefix}${icon}${groupStr}`;
            this.thoughtBubble.setAttribute('data-show', 'true');
            const canvas = document.getElementById('gameCanvas');
            const screenPos = toScreenPosition(this.iconAnchor, camera, canvas);
            this.thoughtBubble.style.left = `${screenPos.x - 14}px`;
            this.thoughtBubble.style.top = `${screenPos.y - 50}px`;
            this.thoughtBubble.style.position = 'fixed';
            this.thoughtBubble.style.display = 'block';
        } else {
            this.thoughtBubble.setAttribute('data-show', 'false');
            this.thoughtBubble.style.display = 'none';
        }
    }

    reproduceWith(partner) {
        // Create child with mixed color and inherited personality
        this.log('Reproducing with', partner.id);
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
        }
    }

    decideNextAction(isNight) {
        // --- 10%の確率で強制的にWANDERまたはSOCIALIZEを選ぶ（ダイナミックな試行錯誤） ---
        if (Math.random() < 0.10) {
            const chars = (typeof window !== 'undefined' && window.characters) ? window.characters : (typeof characters !== 'undefined' ? characters : []);
            let nearbyPartner = null;
            for (const char of chars) {
                if (char.id === this.id) continue;
                const dist = Math.abs(this.gridPos.x - char.gridPos.x) + Math.abs(this.gridPos.y - char.gridPos.y) + Math.abs(this.gridPos.z - char.gridPos.z);
                if (dist <= 2) { nearbyPartner = char; break; }
            }
            if (nearbyPartner) {
                this.setNextAction('SOCIALIZE', nearbyPartner, nearbyPartner.gridPos); return;
            } else {
                this.setNextAction('WANDER'); return;
            }
        }
        // --- Emergency: If needs are critically low, always prioritize survival actions ---
        if (this.needs.hunger <= 10) {
            // 1. まずインベントリ内の食料を食べる
            const foodIdx = this.inventory.findIndex(item => item === 'FRUIT_ITEM' || item === 'FRUIT');
            if (foodIdx !== -1) {
                // 食べる処理
                this.inventory[foodIdx] = null;
                this.carriedItemMesh.visible = false;
                this.needs.hunger = Math.min(100, this.needs.hunger + 40 + Math.random() * 20);
                this.eatCount = (this.eatCount || 0) + 1;
                this.log('Ate food from inventory');
                // 食べたらidleに戻る
                this.state = 'idle';
                this.action = null;
                this.actionCooldown = 0.5;
                return;
            }
            // 2. 近くのキャラから食料を奪う
            const chars = (typeof window !== 'undefined' && window.characters) ? window.characters : (typeof characters !== 'undefined' ? characters : []);
            let stealTarget = null;
            for (const char of chars) {
                if (char.id === this.id) continue;
                const dist = Math.abs(this.gridPos.x - char.gridPos.x) + Math.abs(this.gridPos.y - char.gridPos.y) + Math.abs(this.gridPos.z - char.gridPos.z);
                if (dist <= 1 && char.inventory && (char.inventory.includes('FRUIT_ITEM') || char.inventory.includes('FRUIT'))) {
                    stealTarget = char;
                    break;
                }
            }
            if (stealTarget) {
                // 奪う処理
                const idx = stealTarget.inventory.findIndex(item => item === 'FRUIT_ITEM' || item === 'FRUIT');
                if (idx !== -1) {
                    const stolen = stealTarget.inventory[idx];
                    stealTarget.inventory[idx] = null;
                    this.inventory[0] = stolen;
                    this.carriedItemMesh.visible = true;
                    this.log('Stole food from character', stealTarget.id);
                    // すぐ食べる
                    this.inventory[0] = null;
                    this.carriedItemMesh.visible = false;
                    this.needs.hunger = Math.min(100, this.needs.hunger + 40 + Math.random() * 20);
                    this.eatCount = (this.eatCount || 0) + 1;
                    this.log('Ate stolen food');
                    this.state = 'idle';
                    this.action = null;
                    this.actionCooldown = 0.5;
                    return;
                }
            }
            // 3. ワールド上の食料を探す
            const foodPos = this.findClosestFood && this.findClosestFood();
            if (foodPos) {
                const adjacentSpot = this.findAdjacentSpot && this.findAdjacentSpot(foodPos);
                if (adjacentSpot) {
                    this.setNextAction('EAT', foodPos, adjacentSpot); return;
                }
            }
            // fallback: wander to search for food
            this.setNextAction('WANDER'); return;
        }
        if (this.needs.energy <= 10) {
            if (this.isSafe && this.isSafe(isNight)) {
                this.setNextAction('REST'); return;
            }
            const shelterPos = this.findShelter && this.findShelter(isNight);
            if (shelterPos) {
                const adjacentSpot = this.findAdjacentSpot && this.findAdjacentSpot(shelterPos);
                if (adjacentSpot) {
                    this.setNextAction('SEEK_SHELTER_TO_REST', shelterPos, adjacentSpot); return;
                }
            }
            this.setNextAction('WANDER'); return;
        }
        if (this.needs.social <= 30) {
            const partner = this.findClosestPartner && this.findClosestPartner();
            if (partner) {
                this.setNextAction('SOCIALIZE', partner, partner.gridPos); return;
            }
            this.setNextAction('WANDER'); return;
        }
        this.log('decideNextAction', { needs: this.needs, state: this.state, personality: this.personality, role: this.role });
        // --- Role-based AI priority (強化) ---
        if (this.role === 'leader') {
            // --- New: Leader can call a meeting with group members ---
            if (Math.random() < 0.18) { // 18%の確率で集会を開く
                this.setNextAction('MEETING');
                // グループメンバーを自分の近くに呼ぶ
                const chars = (typeof window !== 'undefined' && window.characters) ? window.characters : (typeof characters !== 'undefined' ? characters : []);
                const myGroup = chars.filter(c => c.groupId === this.groupId && c.id !== this.id);
                for (const member of myGroup) {
                    // 近くの空きスポットを探す
                    const spot = this.findAdjacentSpot ? this.findAdjacentSpot(this.gridPos) : null;
                    if (spot) {
                        member.setNextAction && member.setNextAction('GO_TO_MEETING', this, spot);
                    }
                }
                return;
            }
            // Leader: prioritize expanding land (従来の行動)
            for (let dx = -1; dx <= 1; dx++) {
                for (let dz = -1; dz <= 1; dz++) {
                    if (dx === 0 && dz === 0) continue;
                    const x = this.gridPos.x + dx, y = this.gridPos.y, z = this.gridPos.z + dz;
                    const key = `${x},${y},${z}`;
                    if (!this.ownedLand.has(key) && !this.isLandOwnedByOther({x, y, z})) {
                        this.setNextAction('WANDER', null, {x, y, z});
                        return;
                    }
                }
            }
        } else if (this.role === 'worker') {
            // Worker: prioritize resource gathering/storage
            if (this.inventory[0] === null) {
                const foodPos = this.findClosestFood();
                if (foodPos) {
                    const adjacentSpot = this.findAdjacentSpot(foodPos);
                    if(adjacentSpot){
                        this.setNextAction('COLLECT_FOOD', foodPos, adjacentSpot); return;
                    }
                }
                const woodPos = this.findClosestWood();
                if (woodPos) {
                    const adjacentSpot = this.findAdjacentSpot(woodPos);
                    if(adjacentSpot){
                        this.setNextAction('CHOP_WOOD', woodPos, adjacentSpot); return;
                    }
                }
            } else {
                if (this.homePosition) {
                    const storageSpot = this.findStorageSpot && this.findStorageSpot();
                    if (storageSpot) {
                        this.setNextAction('STORE_ITEM', storageSpot, this.findAdjacentSpot(storageSpot) || this.gridPos, BLOCK_TYPES.FRUIT); return;
                    }
                }
            }
        }
        // --- bak_game.js準拠の優先順位AI + BUILD_WALL拡張 ---
        // Step 3: Tool crafting (if no tool, try to craft one from nearby stone)
        if (!this.inventory.includes('STONE_TOOL')) {
            // Look for adjacent STONE block
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dz = -1; dz <= 1; dz++) {
                        if (dx === 0 && dy === 0 && dz === 0) continue;
                        const x = this.gridPos.x + dx, y = this.gridPos.y + dy, z = this.gridPos.z + dz;
                        const key = `${x},${y},${z}`;
                        let blockId = worldData.get(key);
                        if (typeof blockId === 'object' && blockId.id !== undefined) blockId = blockId.id;
                        if (blockId === BLOCK_TYPES.STONE.id) {
                            this.setNextAction('CRAFT_TOOL', {x, y, z}, this.gridPos);
                            return;
                        }
                    }
                }
            }
        }

        if (this.needs.safety < 50 * this.personality.bravery && isNight) {
            const shelterPos = this.findShelter(isNight);
            if (shelterPos) {
                this.setNextAction('SEEK_SHELTER', shelterPos, shelterPos); return;
            }
            // --- 壁を作るアクションを追加 ---
            const wallSpots = this.findWallSpots && this.findWallSpots();
            if (wallSpots && wallSpots.length > 0) {
                this.setNextAction('BUILD_WALL', wallSpots, this.gridPos); return;
            }
            const digWallTarget = this.findDiggableShelterSpot && this.findDiggableShelterSpot();
            if (digWallTarget) {
                const adjacentSpot = this.findAdjacentSpot(digWallTarget);
                if (adjacentSpot) {
                    this.setNextAction('CREATE_SHELTER', digWallTarget, adjacentSpot); return;
                }
            }
            if (this.canDigDown && this.canDigDown()) {
                const digDownTarget = { x: this.gridPos.x, y: this.gridPos.y - 1, z: this.gridPos.z };
                const adjacentSpot = this.findAdjacentSpot && this.findAdjacentSpot(this.gridPos);
                if (adjacentSpot) {
                    this.setNextAction('CREATE_SHELTER', digDownTarget, adjacentSpot); return;
                }
            }
        }
        if (this.needs.energy < 70 * this.personality.bravery) {
            if (this.isSafe(isNight)) {
                this.setNextAction('REST'); return;
            }
            const shelterPos = this.findShelter(isNight) || (this.findDiggableShelterSpot && this.findDiggableShelterSpot());
            if (shelterPos) {
                const adjacentSpot = this.findAdjacentSpot(shelterPos) || shelterPos;
                if (adjacentSpot) {
                    this.setNextAction('SEEK_SHELTER_TO_REST', shelterPos, adjacentSpot); return;
                }
            }
        }
        if (this.needs.hunger < 90) { // 食料探索の閾値を90に
            const foodPos = this.findClosestFood();
            if (foodPos) {
                const adjacentSpot = this.findAdjacentSpot(foodPos);
                if(adjacentSpot){
                    this.setNextAction('EAT', foodPos, adjacentSpot); return;
                }
            }
            const digTarget = this.findDiggableBlock();
            if (digTarget) {
                const adjacentSpot = this.findAdjacentSpot(digTarget);
                if (adjacentSpot) {
                    this.setNextAction('DESTROY_BLOCK', digTarget, adjacentSpot); return;
                }
            }
        }
        // --- 社交行動の優先度を上げる: needs.social < 90でSOCIALIZEを優先 ---
        if (this.needs.social < 90) {
            const partner = this.findClosestPartner();
            if (partner) {
                this.setNextAction('SOCIALIZE', partner, partner.gridPos); return;
            } else {
                this.setNextAction('WANDER'); return;
            }
        }
        const diligentRand = Math.random();
        if (diligentRand < this.personality.diligence - 0.5) {
            if (this.inventory[0] !== null) {
                const item = ITEM_TYPES[this.inventory[0]];
                if (item && item.isStorable && this.homePosition) {
                    const storageSpot = this.findStorageSpot && this.findStorageSpot();
                    if (storageSpot) {
                        this.setNextAction('STORE_ITEM', storageSpot, this.findAdjacentSpot(storageSpot) || this.gridPos, BLOCK_TYPES.FRUIT); return;
                    }
                } else if (this.inventory[0] === 'WOOD_LOG' && this.provisionalHome && !this.homePosition) {
                    this.setNextAction('BUILD_HOME', this.provisionalHome, this.provisionalHome); return;
                }
            } else {
                if (this.needs.hunger > 90 && this.homePosition) {
                    const foodPos = this.findClosestFood();
                    if (foodPos) {
                        const adjacentSpot = this.findAdjacentSpot(foodPos);
                        if(adjacentSpot){
                            this.setNextAction('COLLECT_FOR_STORAGE', foodPos, adjacentSpot); return;
                        }
                    }
                }
                if (this.provisionalHome && !this.homePosition) {
                    const woodPos = this.findClosestWood();
                    if (woodPos) {
                        const adjacentSpot = this.findAdjacentSpot(woodPos);
                        if(adjacentSpot){
                            this.setNextAction('CHOP_WOOD', woodPos, adjacentSpot); return;
                        }
                    }
                }
            }
        }
        // --- WANDER時は周囲の空きスポットからランダムに移動先を選ぶ ---
        // --- WANDER分岐の前に: 近くにキャラがいればSOCIALIZEを優先 ---
        const chars = (typeof window !== 'undefined' && window.characters) ? window.characters : (typeof characters !== 'undefined' ? characters : []);
        let nearbyPartner = null;
        for (const char of chars) {
            if (char.id === this.id) continue;
            const dist = Math.abs(this.gridPos.x - char.gridPos.x) + Math.abs(this.gridPos.y - char.gridPos.y) + Math.abs(this.gridPos.z - char.gridPos.z);
            if (dist <= 2) { // 2マス以内に他キャラがいれば
                nearbyPartner = char;
                break;
            }
        }
        if (nearbyPartner) {
            this.setNextAction('SOCIALIZE', nearbyPartner, nearbyPartner.gridPos); return;
        }
        // --- 通常のWANDER分岐 ---
        const wanderSpots = [];
        for (let dx = -2; dx <= 2; dx++) {
            for (let dz = -2; dz <= 2; dz++) {
                for (let dy = -1; dy <= 1; dy++) { // ±1段の上下も候補
                    if (dx === 0 && dz === 0 && dy === 0) continue;
                    const x = this.gridPos.x + dx, y = this.gridPos.y + dy, z = this.gridPos.z + dz;
                    if (y < 0 || y > maxHeight) continue;
                    const key = `${x},${y},${z}`;
                    const below = `${x},${y-1},${z}`;
                    // 足場チェック: 下にブロックがある or 今いる場所が地面
                    if (!worldData.has(key) && worldData.has(below)) {
                        wanderSpots.push({x, y, z});
                    }
                }
            }
        }
        let moveTo = null;
        if (wanderSpots.length > 0) {
            moveTo = wanderSpots[Math.floor(Math.random() * wanderSpots.length)];
            this.setNextAction('WANDER', null, moveTo);
        } else {
            // 周囲の壊せるブロックを探す
            let destroyable = null;
            for (let dx = -1; dx <= 1; dx++) {
                for (let dz = -1; dz <= 1; dz++) {
                    if (dx === 0 && dz === 0) continue;
                    const x = this.gridPos.x + dx, y = this.gridPos.y, z = this.gridPos.z + dz;
                    const key = `${x},${y},${z}`;
                    const blockId = worldData.get(key);
                    // AIRやBED以外なら壊せるとみなす
                    if (blockId !== undefined && blockId !== null && blockId !== BLOCK_TYPES.AIR.id && blockId !== BLOCK_TYPES.BED.id) {
                        destroyable = {x, y, z};
                        break;
                    }
                }
                if (destroyable) break;
            }
            if (destroyable) {
                const adjacentSpot = this.findAdjacentSpot ? this.findAdjacentSpot(destroyable) : this.gridPos;
                this.setNextAction('DESTROY_BLOCK', destroyable, adjacentSpot);
            } else {
                // さらに抜け道: 周囲のどこかに1歩move（地形無視で強制）
                let foundMove = false;
                for (let dx = -1; dx <= 1 && !foundMove; dx++) {
                    for (let dy = -1; dy <= 1 && !foundMove; dy++) {
                        for (let dz = -1; dz <= 1 && !foundMove; dz++) {
                            if (dx === 0 && dy === 0 && dz === 0) continue;
                            const x = this.gridPos.x + dx, y = this.gridPos.y + dy, z = this.gridPos.z + dz;
                            if (y < 0 || y > maxHeight) continue;
                            this.setNextAction('WANDER', null, {x, y, z});
                            foundMove = true;
                        }
                    }
                }
                if (!foundMove) {
                    // それでも無理なら行動不能フラグ＋デバッグログ
                    this.log('NO_ACTION_POSSIBLE: Character is completely stuck', {id: this.id, gridPos: this.gridPos, state: this.state});
                    this.actionCooldown = 1.0;
                }
            }
            // さらに、次のAI判定を早めるためactionCooldownを短く
            this.actionCooldown = 0.5;
        }
    }

    updateColorFromPersonality() {
        const r = Math.max(0, Math.min(1, 0.2 + (this.personality.bravery - 0.5)));
        const g = Math.max(0, Math.min(1, 0.2 + (this.personality.diligence - 0.5)));
        const b = 0.3;
        this.bodyMaterial.color.setRGB(r, g, b);
    }

    updateWorldPosFromGrid() {
        this.mesh.position.set(this.gridPos.x * 1 + 0.5, this.gridPos.y, this.gridPos.z * 1 + 0.5);
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
        // 落下先の下にブロックがあるか
        let belowY = y - 1;
        while (belowY >= 0 && !worldData.has(`${x},${belowY},${z}`)) {
            belowY--;
        }
        // 地面がなければNG
        if (belowY < 0) return false;
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
}
export { Character };
