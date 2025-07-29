
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
// ...existing code...

class Character {
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
        // 周囲の空きブロックのうち、上にブロックがある場所を優先
        for (let dy = 0; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
                for (let dz = -2; dz <= 2; dz++) {
                    const x = this.gridPos.x + dx, y = this.gridPos.y + dy, z = this.gridPos.z + dz;
                    const key = `${x},${y},${z}`;
                    if (!worldData.has(key)) {
                        // 上にブロックがあるか
                        let covered = false;
                        for (let i = 1; i <= 2; i++) {
                            if (worldData.has(`${x},${y+i},${z}`)) covered = true;
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
        this.scene.add(this.mesh);

        // AI & State
        this.gridPos = startPos;
        this.homePosition = null; this.provisionalHome = null;
        this.inventory = [null];
        this.needs = {
            hunger: 30 + Math.random() * 20,
            energy: 30 + Math.random() * 20,
            safety: 100,
            social: 30 + Math.random() * 20
        };
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
    }
    // --- AI & Action Methods ---
    findClosestPartner() {
        let closest = null;
        let minDist = Infinity;
        // Use global characters array (browser global or fallback)
        const chars = (typeof window !== 'undefined' && window.characters) ? window.characters : (typeof characters !== 'undefined' ? characters : []);
        for (const char of chars) {
            if (char.id === this.id) continue;
            const dist = Math.abs(this.gridPos.x - char.gridPos.x) + Math.abs(this.gridPos.y - char.gridPos.y) + Math.abs(this.gridPos.z - char.gridPos.z);
            if (dist < minDist) {
                minDist = dist;
                closest = char;
            }
        }
        return closest;
    }

    findClosestFood() {
        let minDist = Infinity, closest = null;
        for (const [key, id] of worldData.entries()) {
            const type = Object.values(BLOCK_TYPES).find(t => t.id === id);
            if (type && type.isEdible) {
                const [x, y, z] = key.split(',').map(Number);
                const dist = Math.abs(this.gridPos.x - x) + Math.abs(this.gridPos.y - y) + Math.abs(this.gridPos.z - z);
                if (dist < minDist) { minDist = dist; closest = {x, y, z}; }
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
        this.log('update called', { deltaTime, isNight, state: this.state, gridPos: this.gridPos, targetPos: this.targetPos });
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
        // --- Needs decay (bak_game.js準拠) ---
        const oldSafety = this.needs.safety;
        this.needs.hunger -= deltaTime * 1.5 * this.personality.diligence;
        this.needs.social -= deltaTime * 1;
        if (this.state === 'moving' || this.state === 'working') {
            this.needs.energy -= deltaTime * 2;
        }
        if (isNight && !this.isSafe(isNight)) {
            this.needs.safety -= deltaTime * 5;
        } else if (!isNight) {
            this.needs.safety = Math.min(100, this.needs.safety + deltaTime * 10);
        }
        if (isNight && oldSafety > this.needs.safety) {
            this.learn && this.learn({ type: 'SAFETY_DECREASE' });
        }
        // Recovery
        if (this.state === 'resting') {
            this.needs.energy = Math.min(100, this.needs.energy + deltaTime * 10);
            if (this.needs.energy >= 100) {
                this.state = 'idle';
                if (this.provisionalHome === null) { this.provisionalHome = this.gridPos; this.learn && this.learn({ type: 'FOUND_SHELTER' }); }
            }
        }
        if (this.state === 'socializing') {
            const partner = this.action?.target;
            if (partner && partner.state === 'socializing') {
                this.needs.social = Math.min(100, this.needs.social + deltaTime * 15);
                let affinity = this.relationships.get(partner.id) || 0;
                affinity += deltaTime * 5;
                this.relationships.set(partner.id, affinity);
                // --- ハートアイコン表示 ---
                if (affinity > 30) {
                    this.thoughtBubble.textContent = '❤️';
                    this.thoughtBubble.setAttribute('data-show', 'true');
                }
                if (affinity >= 50) {
                    this.reproduceWith && this.reproduceWith(partner);
                    this.relationships.set(partner.id, 0);
                    partner.relationships.set(this.id, 0);
                }
            }
            if(this.needs.social >= 100) this.state = 'idle';
        }
        // Death condition
        if (this.needs.hunger <= 0) {
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
    }
    die() {
        this.state = 'dead';
        this.deathTimer = 0;
        this.log('Character died', { id: this.id });
    }

    revive() {
        this.state = 'idle';
        this.deathTimer = 0;
        // needsリセット（bak_game.js風）
        this.needs = {
            hunger: 50 + Math.random() * 30,
            energy: 50 + Math.random() * 30,
            safety: 100,
            social: 50 + Math.random() * 30
        };
        this.log('Character revived', { id: this.id });
    }

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
                this.bfsFailCount = (this.bfsFailCount || 0) + 1;
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
        // --- 表情変化（needs/stateに応じて目・口の色や形を変える）---
        // 目の色
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
        // 口の色・形状
        if (this.state === 'dead') {
            this.mouth.material.color.set(0x888888);
            this.mouth.rotation.z = Math.PI; // への字
        } else if (this.state === 'resting') {
            this.mouth.material.color.set(0x2222ff);
            this.mouth.rotation.z = 0;
        } else if (this.state === 'socializing') {
            this.mouth.material.color.set(0xff33cc);
            this.mouth.rotation.z = 0;
        } else if (this.needs.hunger < 30) {
            this.mouth.material.color.set(0xff0000);
            this.mouth.rotation.z = Math.PI * 0.7; // しょんぼり
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
        // --- 体のアニメーション ---
        if (this.state === 'idle') {
            this.bobTime += deltaTime * 2.5;
            this.body.position.y = 0.25 + Math.sin(this.bobTime) * 0.03;
            this.head.position.y = 0.75 + Math.sin(this.bobTime + 1) * 0.02;
        } else if (this.state === 'moving') {
            this.bobTime += deltaTime * 8;
            const walkCycleAngle = Math.sin(this.bobTime) * 0.8;
            this.leftArm.rotation.x = walkCycleAngle; this.rightArm.rotation.x = -walkCycleAngle;
            this.mesh.rotation.z = Math.cos(this.bobTime) * 0.2;
            this.body.position.y = 0.25;
            this.head.position.y = 0.75;
        } else {
            this.mesh.rotation.z *= 0.9; this.leftArm.rotation.x *= 0.9; this.rightArm.rotation.x *= 0.9;
            this.body.position.y = 0.25;
            this.head.position.y = 0.75;
        }
        if (this.actionAnim && this.actionAnim.active) {
            this.actionAnim.timer -= deltaTime;
            const phase = 1.0 - (this.actionAnim.timer / this.actionAnim.duration);
            const scale = 1.0 - Math.sin(phase * Math.PI) * 0.3;
            this.body.scale.set(1 + (1 - scale) * 0.5, scale, 1 + (1 - scale) * 0.5);
            if (this.actionAnim.timer <= 0) { this.actionAnim.active = false; this.body.scale.set(1, 1, 1); }
        }
        if (this.state === 'resting') { this.body.scale.y = 0.6; } else if (!this.actionAnim.active) { this.body.scale.y = 1.0; }
    }


    updateThoughtBubble(isNight, camera) {
        // Show emotion icon above head based on needs/state (bak_game.js準拠)
        if (!this.thoughtBubble) return;
        let icon = null;
        if (this.state === 'dead') icon = '💀';
        else if (this.state === 'resting') icon = '🛏️';
        else if (this.state === 'socializing') {
            if (this.thoughtBubble.textContent === '❤️') {
                icon = '❤️';
            } else {
                icon = '💬';
            }
        }
        else if (this.needs.hunger < 30) icon = '🍎';
        else if (isNight && !this.isSafe(isNight)) icon = '😱';
        else if (this.needs.energy < 30) icon = '💤';
        else if (this.needs.social < 30) icon = '👥';
        else if (this.state === 'moving') icon = '🚶';
        else icon = null;

        if (icon) {
            this.thoughtBubble.textContent = icon;
            this.thoughtBubble.setAttribute('data-show', 'true');
            // canvasを取得し、正しいスクリーン座標で配置
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
        }
    }

    decideNextAction(isNight) {
        this.log('decideNextAction', { needs: this.needs, state: this.state, personality: this.personality });
        // --- bak_game.js準拠の優先順位AI + BUILD_WALL拡張 ---
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
        if (this.needs.hunger < 70) {
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
        if (this.needs.social < 70) {
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
        this.setNextAction('WANDER');
    }

    setNextAction(type, target = null, moveTo = null, item = null) {
        this.log(`Action chosen: ${type}`, {target, moveTo});
        this.action = { type, target, item };
        if (moveTo) { this.targetPos = moveTo; this.state = 'moving'; }
        else { this.performAction(); }
    }

    performAction() {
        if (!this.action) { this.state = 'idle'; this.actionCooldown = 1; return; }
        this.log(`Performing action: ${this.action.type}`);
        if(this.action.type !== 'REST' && this.action.type.indexOf('SEEK_SHELTER') === -1) { this.actionAnim.active = true; this.actionAnim.timer = this.actionAnim.duration; }

        switch (this.action.type) {
            case 'BUILD_WALL': {
                // 周囲の空きスポットにDIRTまたはSTONEで壁を作る（50%ずつの確率）
                const wallSpots = this.action.target;
                for (const spot of wallSpots) {
                    // 50%でDIRT, 50%でSTONE
                    const blockType = Math.random() < 0.5 ? BLOCK_TYPES.DIRT : BLOCK_TYPES.STONE;
                    addBlock(spot.x, spot.y, spot.z, blockType);
                }
                this.actionCooldown = 2.0;
                break;
            }
            case 'CREATE_SHELTER': {
                const {x, y, z} = this.action.target;
                removeBlock(x, y, z);
                addBlock(x, y, z, BLOCK_TYPES.BED);
                this.homePosition = {x, y, z};
                this.actionCooldown = 2.5;
                break;
            }
            case 'EAT': {
                const {x, y, z} = this.action.target;
                const blockId = worldData.get(`${x},${y},${z}`);
                const blockType = Object.values(BLOCK_TYPES).find(t => t.id === blockId);
                if (blockType && blockType.isEdible) {
                    const wasInDanger = this.needs.safety < 70;
                    this.needs.hunger = Math.min(100, this.needs.hunger + blockType.foodValue);
                    removeBlock(x, y, z);
                    this.learn && this.learn({ type: 'ATE_FOOD', inDanger: wasInDanger });
                }
                this.actionCooldown = 1.2;
                break;
            }
            case 'COLLECT_FOOD':
            case 'COLLECT_FOR_STORAGE': {
                const {x, y, z} = this.action.target;
                const key = `${x},${y},${z}`;
                const blockId = worldData.get(key);
                const blockType = Object.values(BLOCK_TYPES).find(t => t.id === blockId);
                if (blockType && blockType.isEdible && this.inventory[0] === null) {
                    removeBlock(x, y, z);
                    this.inventory[0] = ITEM_TYPES.FRUIT_ITEM;
                    this.carriedItemMesh.material = blockMaterials.get(BLOCK_TYPES.FRUIT.id);
                    this.carriedItemMesh.visible = true;
                }
                this.actionCooldown = 1.5;
                break;
            }
            case 'REST': {
                this.state = 'resting';
                this.actionCooldown = 2.5;
                this.carriedItemMesh.visible = false;
                break;
            }
            case 'SOCIALIZE': {
                this.state = 'socializing';
                this.actionCooldown = 2.5;
                break;
            }
            case 'SEEK_SHELTER': {
                this.state = 'resting';
                this.actionCooldown = 2.5;
                break;
            }
            case 'DIG_SHELTER': {
                const {x, y, z} = this.action.target;
                removeBlock(x, y, z);
                this.actionCooldown = 1.5;
                break;
            }
            case 'BUILD_HOME': {
                const {x, y, z} = this.action.target;
                addBlock(x, y, z, BLOCK_TYPES.BED);
                this.homePosition = {x, y, z};
                this.inventory[0] = null;
                this.actionCooldown = 2.5;
                break;
            }
            case 'CHOP_WOOD': {
                const {x, y, z} = this.action.target;
                const key = `${x},${y},${z}`;
                const blockId = worldData.get(key);
                const blockType = Object.values(BLOCK_TYPES).find(t => t.id === blockId);
                if (blockType && blockType.diggable && blockType.name === '木' && this.inventory[0] === null) {
                    removeBlock(x, y, z);
                    this.inventory[0] = ITEM_TYPES.WOOD_LOG;
                    this.carriedItemMesh.material = blockMaterials.get(BLOCK_TYPES.WOOD.id);
                    this.carriedItemMesh.visible = true;
                }
                this.actionCooldown = 1.5;
                break;
            }
            case 'WANDER': {
                const dx = Math.floor(Math.random() * 3) - 1;
                const dz = Math.floor(Math.random() * 3) - 1;
                const x = Math.max(0, Math.min(gridSize - 1, this.gridPos.x + dx));
                const z = Math.max(0, Math.min(gridSize - 1, this.gridPos.z + dz));
                const y = findGroundY(x, z) + 1;
                this.targetPos = {x, y, z};
                this.state = 'moving';
                this.actionCooldown = 1.2;
                break;
            }
            default: {
                this.state = 'idle';
                this.actionCooldown = 1.0;
                break;
            }
        }
    }

    isSafe(isNight) {
        // 簡易安全判定
        if (!isNight) return true;
        // 周囲にブロックがあるか
        for (let i = 1; i < 4; i++) {
            if (worldData.has(`${this.gridPos.x},${this.gridPos.y+i},${this.gridPos.z}`)) return true;
        }
        return false;
    }

    // (Removed duplicate/empty learn method; the real one is above)

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
}

export { Character };
