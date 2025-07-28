// --- Voxel Society Simulator Main JS ---
// All logic from <script> in index.html will be moved here.
// This file should be loaded after three.js and OrbitControls.js
// --- Voxel Society Simulator Main JS ---
// All logic from <script> in index.html will be moved here.
// This file should be loaded after three.js and OrbitControls.js

// Voxel Society Simulator main game logic
// Migrated from index.html

// Initialize AOS (Animate On Scroll)
document.addEventListener('DOMContentLoaded', function() { AOS.init({ once: true }); });
// --- Perlin Noise Generator ---
const PerlinNoise = new function() {
    this.p = new Uint8Array(512);
    this.seed = (s) => {
        for (let i = 0; i < 256; i++) this.p[i] = i;
        for (let i = 255; i > 0; i--) { const n = Math.floor((i + 1) * s()); const t = this.p[i]; this.p[i] = this.p[n]; this.p[n] = t; }
        for (let i = 0; i < 256; i++) this.p[i + 256] = this.p[i];
    };
    const grad3 = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
    const dot = (g, x, y) => g[0] * x + g[1] * y;
    this.simplex2 = (x, y) => {
        const F2 = 0.5 * (Math.sqrt(3.0) - 1.0), G2 = (3.0 - Math.sqrt(3.0)) / 6.0;
        const s = (x + y) * F2;
        const i = Math.floor(x + s), j = Math.floor(y + s);
        const t = (i + j) * G2;
        const X0 = i - t, Y0 = j - t;
        const x0 = x - X0, y0 = y - Y0;
        let i1, j1;
        if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
        const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
        const x2 = x0 - 1.0 + 2.0 * G2, y2 = y0 - 1.0 + 2.0 * G2;
        const ii = i & 255, jj = j & 255;
        let n0, n1, n2;
        let t0 = 0.5 - x0 * x0 - y0 * y0;
        if (t0 < 0) n0 = 0.0; else { t0 *= t0; n0 = t0 * t0 * dot(grad3[this.p[ii + this.p[jj]] % 12], x0, y0); }
        let t1 = 0.5 - x1 * x1 - y1 * y1;
        if (t1 < 0) n1 = 0.0; else { t1 *= t1; n1 = t1 * t1 * dot(grad3[this.p[ii + i1 + this.p[jj + j1]] % 12], x1, y1); }
        let t2 = 0.5 - x2 * x2 - y2 * y2;
        if (t2 < 0) n2 = 0.0; else { t2 *= t2; n2 = t2 * t2 * dot(grad3[this.p[ii + 1 + this.p[jj + 1]] % 12], x2, y2); }
        return 70.0 * (n0 + n1 + n2);
    };
};
// --- Global Variables ---
let scene, camera, renderer, controls, ambientLight, directionalLight;
let gameCanvas, minimapCanvas, minimapCtx;
const blockSize = 1;
const gridSize = 16;
const maxHeight = 10;
const clock = new THREE.Clock();
const characters = [];
let worldTime = 0;
const DAY_DURATION = 120;
let nextCharacterId = 0;
let DEBUG_MODE = false;

const worldData = new Map();
const visualBlocks = new Map();

// --- Block & Item Definitions ---
const BLOCK_TYPES = {
    AIR:   { id: 0, name: '空気' },
    GRASS: { id: 1, name: '草', color: 0x4CAF50, diggable: true },
    DIRT:  { id: 2, name: '土', color: 0x966c4a, diggable: true },
    STONE: { id: 3, name: '石', color: 0x888888, diggable: false },
    FRUIT: { id: 4, name: '果実', color: 0xff4500, isEdible: true, foodValue: 50, drops: 'FRUIT_ITEM' },
    WOOD:  { id: 5, name: '木', color: 0x8b5a2b, diggable: true, drops: 'WOOD_LOG' },
    LEAF:  { id: 6, name: '葉', color: 0x228b22, diggable: true },
    BED:   { id: 7, name: '寝床', color: 0xffec8b, isBed: true }
};
const ITEM_TYPES = {
    WOOD_LOG: { id: 100, name: '丸太', material: new THREE.MeshLambertMaterial({ color: BLOCK_TYPES.WOOD.color }) },
    FRUIT_ITEM: { id: 101, name: '果実アイテム', material: new THREE.MeshLambertMaterial({ color: BLOCK_TYPES.FRUIT.color }), isStorable: true }
};
const blockMaterials = new Map();
Object.values(BLOCK_TYPES).forEach(type => { if (type.color) { blockMaterials.set(type.id, new THREE.MeshLambertMaterial({ color: type.color })); } });
const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 });

// --- Character Class ---
class Character {
    // Find a nearby diggable block (for hunger logic)
    findClosestPartner() {
        let closest = null;
        let minDist = Infinity;
        for (const char of characters) {
            if (char.id === this.id) continue;
            const dist = Math.abs(this.gridPos.x - char.gridPos.x) + Math.abs(this.gridPos.y - char.gridPos.y) + Math.abs(this.gridPos.z - char.gridPos.z);
            if (dist < minDist) {
                minDist = dist;
                closest = char;
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
    decideNextAction(isNight) {
        this.log(`Needs: H:${this.needs.hunger.toFixed(0)}, E:${this.needs.energy.toFixed(0)}, Sa:${this.needs.safety.toFixed(0)}, So:${this.needs.social.toFixed(0)} | Personality: B:${this.personality.bravery.toFixed(2)}, D:${this.personality.diligence.toFixed(2)}`);

        if (this.needs.safety < 50 * this.personality.bravery && isNight) {
            this.log("Safety critical!", {safety: this.needs.safety, bravery: this.personality.bravery});
            const shelterPos = this.findShelter(isNight);
            if (shelterPos) {
                this.log("Shelter found", shelterPos);
                this.setNextAction('SEEK_SHELTER', shelterPos, shelterPos); return;
            } else {
                this.log("No shelter found");
            }
            const digWallTarget = this.findDiggableShelterSpot();
            if (digWallTarget) {
                this.log("Diggable shelter spot found", digWallTarget);
                const adjacentSpot = this.findAdjacentSpot(digWallTarget);
                if (adjacentSpot) {
                    this.setNextAction('CREATE_SHELTER', digWallTarget, adjacentSpot); return;
                } else {
                    this.log("No adjacent spot for shelter digging");
                }
            } else {
                this.log("No diggable shelter spot found");
            }
            if (this.canDigDown()) {
                this.log("Can dig down for shelter");
                const digDownTarget = { x: this.gridPos.x, y: this.gridPos.y - 1, z: this.gridPos.z };
                const adjacentSpot = this.findAdjacentStandingSpot();
                if (adjacentSpot) {
                    this.setNextAction('CREATE_SHELTER', digDownTarget, adjacentSpot); return;
                } else {
                    this.log("No adjacent standing spot for digging down");
                }
            } else {
                this.log("Cannot dig down for shelter");
            }
        }
        if (this.needs.energy < 70 * this.personality.bravery) {
            this.log("Energy critical!", {energy: this.needs.energy, bravery: this.personality.bravery});
            if (this.isSafe(isNight)) {
                this.log("Safe spot for rest");
                this.setNextAction('REST'); return;
            }
            const shelterPos = this.findShelter(isNight) || this.findDiggableShelterSpot();
            if (shelterPos) {
                this.log("Shelter found for rest", shelterPos);
                const adjacentSpot = this.findAdjacentSpot(shelterPos) || shelterPos;
                if (adjacentSpot) {
                    this.setNextAction('SEEK_SHELTER_TO_REST', shelterPos, adjacentSpot); return;
                } else {
                    this.log("No adjacent spot for shelter rest");
                }
            } else {
                this.log("No shelter found for rest");
            }
        }
        if (this.needs.hunger < 70) {
            this.log("Hunger critical!", {hunger: this.needs.hunger});
            const foodPos = this.findClosestFood();
            if (foodPos) {
                this.log("Food found", foodPos);
                const adjacentSpot = this.findAdjacentSpot(foodPos);
                if(adjacentSpot){
                    this.setNextAction('EAT', foodPos, adjacentSpot); return;
                } else {
                    this.log("No adjacent spot for food");
                }
            } else {
                this.log("No food found");
            }
            const digTarget = this.findDiggableBlock();
            if (digTarget) {
                this.log("Diggable block found for hunger", digTarget);
                const adjacentSpot = this.findAdjacentSpot(digTarget);
                if (adjacentSpot) {
                    this.setNextAction('DESTROY_BLOCK', digTarget, adjacentSpot); return;
                } else {
                    this.log("No adjacent spot for diggable block");
                }
            } else {
                this.log("No diggable block found for hunger");
            }
        }
        if (this.needs.social < 70) {
            this.log("Social need critical!", {social: this.needs.social});
            const partner = this.findClosestPartner();
            if (partner) {
                this.log("Partner found", partner.id);
                this.setNextAction('SOCIALIZE', partner, partner.gridPos); return;
            } else {
                this.log("No partner found");
            }
        }

        const diligentRand = Math.random();
        this.log("Diligence check", {rand: diligentRand, threshold: this.personality.diligence - 0.5});
        if (diligentRand < this.personality.diligence - 0.5) {
            this.log("Feeling diligent...");
            if (this.inventory[0] !== null) {
                this.log("Inventory not empty", this.inventory[0]);
                const item = ITEM_TYPES[this.inventory[0]];
                if (item.isStorable && this.homePosition) {
                    this.log("Item is storable and home exists");
                    const storageSpot = this.findStorageSpot();
                    if (storageSpot) {
                        this.log("Storage spot found", storageSpot);
                        this.setNextAction('STORE_ITEM', storageSpot, this.findAdjacentSpot(storageSpot) || this.gridPos, BLOCK_TYPES.FRUIT); return;
                    } else {
                        this.log("No storage spot found");
                    }
                } else if (this.inventory[0] === 'WOOD_LOG' && this.provisionalHome && !this.homePosition) {
                    this.log("Ready to build home");
                    this.setNextAction('BUILD_HOME', this.provisionalHome, this.provisionalHome); return;
                } else {
                    this.log("Inventory item not storable or cannot build home");
                }
            } else {
                this.log("Inventory empty");
                if (this.needs.hunger > 90 && this.homePosition) {
                    this.log("High hunger and home exists");
                    const foodPos = this.findClosestFood();
                    if (foodPos) {
                        this.log("Food found for storage", foodPos);
                        const adjacentSpot = this.findAdjacentSpot(foodPos);
                        if(adjacentSpot){
                            this.setNextAction('COLLECT_FOR_STORAGE', foodPos, adjacentSpot); return;
                        } else {
                            this.log("No adjacent spot for food storage");
                        }
                    } else {
                        this.log("No food found for storage");
                    }
                }
                if (this.provisionalHome && !this.homePosition) {
                    this.log("Provisional home exists, no home yet");
                    const woodPos = this.findClosestWood();
                    if (woodPos) {
                        this.log("Wood found for chopping", woodPos);
                        const adjacentSpot = this.findAdjacentSpot(woodPos);
                        if(adjacentSpot){
                            this.setNextAction('CHOP_WOOD', woodPos, adjacentSpot); return;
                        } else {
                            this.log("No adjacent spot for wood chopping");
                        }
                    } else {
                        this.log("No wood found for chopping");
                    }
                }
            }
        }

        this.log("Wandering... (no other action chosen)");
        this.setNextAction('WANDER');
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

    findAdjacentSpot(target) {
        // Find adjacent empty spot next to target block, and ensure it's above ground
        const directions = [
            {dx:1, dz:0}, {dx:-1, dz:0}, {dx:0, dz:1}, {dx:0, dz:-1}
        ];
        for (const dir of directions) {
            const x = target.x + dir.dx;
            const z = target.z + dir.dz;
            const groundY = findGroundY(x, z);
            if (groundY === -1) continue;
            const y = groundY + 1;
            const key = `${x},${y},${z}`;
            if (!worldData.has(key)) return {x, y, z};
        }
        return null;
    }

    learn(outcome) {
        if (outcome.type === 'SAFETY_DECREASE') { this.personality.bravery = Math.max(0.5, this.personality.bravery - 0.05); }
        else if (outcome.type === 'ATE_FOOD' && outcome.inDanger) { this.personality.bravery = Math.min(1.5, this.personality.bravery + 0.1); }
        else if (outcome.type === 'BUILT_HOME') { this.personality.diligence = Math.min(1.5, this.personality.diligence + 0.2); }
        else if (outcome.type === 'FOUND_SHELTER') { this.personality.diligence = Math.min(1.5, this.personality.diligence + 0.05); }
        this.updateColorFromPersonality();
    }

    reproduceWith(partner) {
        // Placeholder for reproduction logic
        this.log('Reproducing with', partner.id);
    }
    constructor(scene, startPos, id, genes = null) {
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

        // Visuals
        this.bodyMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
        this.bodyMaterial.gradientMap = null;
        this.body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.5, 32), this.bodyMaterial);
        this.body.position.y = 0.25;
        this.body.castShadow = true;
        this.body.receiveShadow = true;
        this.mesh.add(this.body);
        this.head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 32, 32), this.bodyMaterial);
        this.head.position.y = 0.75;
        this.head.castShadow = true;
        this.head.receiveShadow = true;
        this.mesh.add(this.head);
        this.eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
        const eyeGeometry = new THREE.SphereGeometry(0.05, 16, 16);
        this.leftEye = new THREE.Mesh(eyeGeometry, this.eyeMaterial); this.leftEye.position.set(-0.1, 0.05, 0.23); this.head.add(this.leftEye);
        this.rightEye = new THREE.Mesh(eyeGeometry, this.eyeMaterial); this.rightEye.position.set(0.1, 0.05, 0.23); this.head.add(this.rightEye);
        this.eyeMeshes = [this.leftEye, this.rightEye];
        const mouthGeometry = new THREE.TorusGeometry(0.07, 0.012, 8, 16, Math.PI);
        this.mouth = new THREE.Mesh(mouthGeometry, new THREE.MeshBasicMaterial({ color: 0x222222 }));
        this.mouth.position.set(0, -0.07, 0.22);
        this.mouth.rotation.x = Math.PI / 2;
        this.head.add(this.mouth);
        const limbGeometry = new THREE.CylinderGeometry(0.08, 0.08, 0.4, 16);
        this.leftArm = new THREE.Mesh(limbGeometry, this.bodyMaterial); this.leftArm.position.set(-0.35, 0.38, 0); this.body.add(this.leftArm);
        this.rightArm = new THREE.Mesh(limbGeometry, this.bodyMaterial); this.rightArm.position.set(0.35, 0.38, 0); this.body.add(this.rightArm);
        this.body.position.y = 0.68;
        this.head.position.y = 1.18;
        this.carriedItemMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5)); this.carriedItemMesh.position.set(0, 0.6, 0.45); this.carriedItemMesh.visible = false; this.mesh.add(this.carriedItemMesh);
        const shadowGeometry = new THREE.CircleGeometry(0.32, 32);
        const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 });
        this.shadowMesh = new THREE.Mesh(shadowGeometry, shadowMaterial);
        this.shadowMesh.position.set(0, 0.01, 0);
        this.shadowMesh.rotation.x = -Math.PI / 2;
        this.mesh.add(this.shadowMesh);
        this.thoughtBubble = document.createElement('div');
        this.thoughtBubble.className = 'thought-bubble';
        this.thoughtBubble.setAttribute('data-aos', 'zoom-in');
        this.thoughtBubble.setAttribute('data-aos-duration', '300');
        document.body.appendChild(this.thoughtBubble);

        this.updateColorFromPersonality();
        this.updateWorldPosFromGrid();
    }

    log(message, ...args) { if (DEBUG_MODE) console.log(`%c[Char ${this.id}]`, `color: #${this.bodyMaterial.color.getHexString()}`, message, ...args); }

    updateColorFromPersonality() {
        const r = Math.max(0, Math.min(1, 0.2 + (this.personality.bravery - 0.5)));
        const g = Math.max(0, Math.min(1, 0.2 + (this.personality.diligence - 0.5)));
        const b = 0.3;
        this.bodyMaterial.color.setRGB(r, g, b);
    }

    updateWorldPosFromGrid() { this.mesh.position.set(this.gridPos.x * blockSize + 0.5, this.gridPos.y, this.gridPos.z * blockSize + 0.5); }

    update(deltaTime, isNight) {
        const oldSafety = this.needs.safety;
        this.needs.hunger -= deltaTime * 1.5 * this.personality.diligence;
        this.needs.social -= deltaTime * 1;
        if (this.state === 'moving' || this.state === 'working') { this.needs.energy -= deltaTime * 2; }
        if (isNight && !this.isSafe(isNight)) { this.needs.safety -= deltaTime * 5; } else if (!isNight) { this.needs.safety = Math.min(100, this.needs.safety + deltaTime * 10); }

        if (isNight && oldSafety > this.needs.safety) { this.learn && this.learn({ type: 'SAFETY_DECREASE' }); }

        if (this.state === 'resting') {
            this.needs.energy = Math.min(100, this.needs.energy + deltaTime * 10);
            if (this.needs.energy >= 100) {
                this.state = 'idle';
                if (this.provisionalHome === null) { this.provisionalHome = this.gridPos; this.learn && this.learn({ type: 'FOUND_SHELTER' }); }
            }
        }

        if (this.state === 'socializing') {
            const partner = this.action.target;
            if (this.mesh.position.distanceTo(partner.mesh.position) < 2) {
                this.needs.social = Math.min(100, this.needs.social + deltaTime * 15);
                let affinity = this.relationships.get(partner.id) || 0;
                affinity += deltaTime * 5;
                this.relationships.set(partner.id, affinity);
                if (affinity >= 50) {
                    this.reproduceWith && this.reproduceWith(partner);
                    this.relationships.set(partner.id, 0);
                    partner.relationships.set(this.id, 0);
                }
            }
            if(this.needs.social >= 100) this.state = 'idle';
        }

        if (this.state === 'idle') { this.actionCooldown -= deltaTime; if (this.actionCooldown <= 0) this.decideNextAction && this.decideNextAction(isNight); }
        if (this.state === 'moving') this.updateMovement(deltaTime);
        this.updateAnimations(deltaTime);
        this.updateThoughtBubble(isNight);
    }

    updateMovement(deltaTime) {
        if (!this.targetPos) { this.state = 'idle'; return; }
        const groundY = findGroundY(this.targetPos.x, this.targetPos.z);
        if (groundY === -1) {
            this.log('No ground at target', this.targetPos);
            this.state = 'idle';
            this.targetPos = null;
            this.action = null;
            this.actionCooldown = 0.5 + Math.random();
            return;
        }
        const currentY = this.gridPos.y;
        const targetY = this.targetPos.y;
        // --- 階段移動（BFS）ロジック ---
        if (Math.abs(targetY - currentY) > 1) {
            const start = this.gridPos;
            const goal = this.targetPos;
            const visited = new Set();
            const queue = [{pos: start, path: []}];
            let foundPath = null;
            const directions = [
                {dx:1, dz:0}, {dx:-1, dz:0}, {dx:0, dz:1}, {dx:0, dz:-1}
            ];
            let stepCount = 0;
        const maxSteps = 800;
            let nearest = null;
            let nearestDist = Infinity;
            while (queue.length > 0) {
                if (stepCount++ > maxSteps) {
                    this.log('BFS aborted: too many steps', {start, goal});
                    break;
                }
                const {pos, path} = queue.shift();
                const key = `${pos.x},${pos.y},${pos.z}`;
                if (visited.has(key)) continue;
                visited.add(key);
                // 目標に到達
                if (pos.x === goal.x && pos.y === goal.y && pos.z === goal.z) {
                    foundPath = path;
                    break;
                }
                // 目標に近い座標を記録
                const dist = Math.abs(pos.x - goal.x) + Math.abs(pos.y - goal.y) + Math.abs(pos.z - goal.z);
                if (dist < nearestDist) {
                    nearestDist = dist;
                    nearest = {pos, path};
                }
                for (const dir of directions) {
                    const nx = pos.x + dir.dx;
                    const nz = pos.z + dir.dz;
                    for (let dy = -1; dy <= 1; dy++) {
                        const ny = pos.y + dy;
                        const nkey = `${nx},${ny},${nz}`;
                        if (ny < 0 || ny >= maxHeight) continue;
                        if (!worldData.has(nkey)) {
                            queue.push({pos: {x: nx, y: ny, z: nz}, path: [...path, {x: nx, y: ny, z: nz}]});
                        } else {
                            const blockId = worldData.get(nkey);
                            const blockType = Object.values(BLOCK_TYPES).find(t => t.id === blockId);
                            if (blockType && blockType.diggable) {
                                queue.push({pos: {x: nx, y: ny, z: nz}, path: [...path, {x: nx, y: ny, z: nz, dig:true}]});
                            }
                        }
                    }
                }
            }
            if (foundPath && foundPath.length > 0) {
                const nextStep = foundPath[0];
                if (nextStep.dig) {
                    this.targetPos = {x: nextStep.x, y: nextStep.y, z: nextStep.z};
                    this.action = { type: 'DESTROY_BLOCK', target: {x: nextStep.x, y: nextStep.y, z: nextStep.z} };
                } else {
                    this.targetPos = nextStep;
                }
            } else if (nearest && nearest.path.length > 0) {
                // 目標に最も近い座標へ移動
                const nextStep = nearest.path[0];
                this.targetPos = nextStep;
                this.log('No path to goal, moving to nearest reachable', {nearest: nearest.pos});
            } else {
                this.log('No path found for stairs movement', {start, goal});
                this.state = 'idle';
                this.targetPos = null;
                this.action = null;
                this.actionCooldown = 0.5 + Math.random();
                return;
            }
        }
        const blockKey = `${this.targetPos.x},${this.targetPos.y},${this.targetPos.z}`;
        if (worldData.has(blockKey)) {
            this.log('Blocked by block at target', this.targetPos);
            this.state = 'idle';
            this.targetPos = null;
            this.action = null;
            this.actionCooldown = 0.5 + Math.random();
            return;
        }
        // Relax movement check for shelter/digging actions and food collection actions
        if (this.action && (
            this.action.type === 'CREATE_SHELTER' ||
            this.action.type === 'DIG_SHELTER' ||
            this.action.type === 'DESTROY_BLOCK' ||
            this.action.type === 'EAT' ||
            this.action.type === 'COLLECT_FOOD' ||
            this.action.type === 'COLLECT_FOR_STORAGE')) {
            // Allow movement even if not strictly above ground
        } else {
            if (this.targetPos.y !== groundY + 1) {
                this.log('Target position is not above ground', {targetY, groundY});
                this.state = 'idle';
                this.targetPos = null;
                this.action = null;
                this.actionCooldown = 0.5 + Math.random();
                return;
            }
        }
        const targetWorldPos = new THREE.Vector3(this.targetPos.x * blockSize + 0.5, this.targetPos.y, this.targetPos.z * blockSize + 0.5);
        const direction = targetWorldPos.clone().sub(this.mesh.position);
        if (direction.length() > 0.01) {
            const angle = Math.atan2(direction.x, direction.z);
            this.mesh.rotation.y = angle;
        }
        const moveDistance = this.movementSpeed * deltaTime;
        if (direction.length() < moveDistance) {
            this.mesh.position.copy(targetWorldPos);
            this.gridPos = {x: this.targetPos.x, y: this.targetPos.y, z: this.targetPos.z};
            this.state = 'idle';
            this.performAction();
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
        if (this.actionAnim.active) {
            this.actionAnim.timer -= deltaTime;
            const phase = 1.0 - (this.actionAnim.timer / this.actionAnim.duration);
            const scale = 1.0 - Math.sin(phase * Math.PI) * 0.3;
            this.body.scale.set(1 + (1 - scale) * 0.5, scale, 1 + (1 - scale) * 0.5);
            if (this.actionAnim.timer <= 0) { this.actionAnim.active = false; this.body.scale.set(1, 1, 1); }
        }
        if (this.state === 'resting') { this.body.scale.y = 0.6; } else if (!this.actionAnim.active) { this.body.scale.y = 1.0; }
    }

    updateThoughtBubble(isNight) {
        // Show emotion icon above head based on needs/state
        let icon = null;
        if (this.state === 'resting') icon = '🛏️';
        else if (this.state === 'socializing') icon = '💬';
        else if (this.needs.hunger < 30) icon = '🍎';
        else if (isNight && !this.isSafe(isNight)) icon = '😱';
        else if (this.needs.energy < 30) icon = '💤';
        else if (this.needs.social < 30) icon = '👥';
        else if (this.state === 'moving') icon = '🚶';
        else icon = null;

        if (icon) {
            this.thoughtBubble.textContent = icon;
            this.thoughtBubble.setAttribute('data-show', 'true');
            // Position above head
            const screenPos = toScreenPosition(this.head, camera);
            this.thoughtBubble.style.left = `${screenPos.x - 14}px`;
            this.thoughtBubble.style.top = `${screenPos.y - 38}px`;
        } else {
            this.thoughtBubble.setAttribute('data-show', 'false');
        }
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
            case 'CREATE_SHELTER': {
                // 掘った後にBED設置
                const {x, y, z} = this.action.target;
                removeBlock(x, y, z);
                addBlock(x, y, z, BLOCK_TYPES.BED);
                this.homePosition = {x, y, z};
                this.actionCooldown = 2.5;
                break;
            }
            case 'EAT': {
                // Eat food block directly from the world (not inventory)
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
                // Pick up food block (for future use, e.g. storage)
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
                // Dig down block for shelter
                const {x, y, z} = this.action.target;
                removeBlock(x, y, z);
                this.actionCooldown = 1.5;
                break;
            }
            case 'BUILD_HOME': {
                // Build home (bed block)
                const {x, y, z} = this.action.target;
                addBlock(x, y, z, BLOCK_TYPES.BED);
                this.homePosition = {x, y, z};
                this.inventory[0] = null;
                this.actionCooldown = 2.5;
                break;
            }
            case 'CHOP_WOOD': {
                // Chop wood block
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
                // Move to random nearby spot
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
        if (!isNight) return true;
        const {x, y, z} = this.gridPos;
        return isSafeSpot({x: Math.round(x), y: Math.round(y), z: Math.round(z)});
    }

    findShelter(isNight) {
        if (!isNight) return this.gridPos;
        if (this.homePosition && isSafeSpot(this.homePosition)) return this.homePosition;
        const radius = 6;
        for (let dx = -radius; dx <= radius; dx++) { for (let dz = -radius; dz <= radius; dz++) {
            const x = Math.round(this.gridPos.x + dx); const z = Math.round(this.gridPos.z + dz);
            const groundY = findGroundY(x, z);
            if (groundY !== -1) { if (isSafeSpot({x, y: groundY + 1, z})) { return { x, y: groundY + 1, z }; } }
        }} return null;
    }

    findDiggableShelterSpot() {
        const radius = 4; const y = this.gridPos.y - 1;
        for (let dx = -radius; dx <= radius; dx++) { for (let dz = -radius; dz <= radius; dz++) {
            if(dx === 0 && dz === 0) continue;
            const x = this.gridPos.x + dx; const z = this.gridPos.z + dz;
            const blockId = worldData.get(`${x},${y},${z}`);
            const blockType = Object.values(BLOCK_TYPES).find(t => t.id === blockId);
            if (blockType && blockType.diggable) { const adjacentSpot = this.findAdjacentSpot && this.findAdjacentSpot({x,y,z}); if(adjacentSpot) return {x,y,z}; }
        }} return null;
    }

    canDigDown() {
        const blockBelowPos = { x: this.gridPos.x, y: this.gridPos.y - 1, z: this.gridPos.z };
        const blockId = worldData.get(`${blockBelowPos.x},${blockBelowPos.y},${blockBelowPos.z}`);
        const blockType = Object.values(BLOCK_TYPES).find(t => t.id === blockId);
        return blockType && blockType.diggable;
    }
}

// --- World Functions ---
function init() {
    try {
        gameCanvas = document.getElementById('gameCanvas');
        minimapCanvas = document.getElementById('minimapCanvas');
        minimapCtx = minimapCanvas.getContext('2d');
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x87CEEB);

        // canvasサイズを明示的に設定（offsetWidth/offsetHeightを使用）
        gameCanvas.width = gameCanvas.offsetWidth;
        gameCanvas.height = gameCanvas.offsetHeight;

        camera = new THREE.PerspectiveCamera(75, gameCanvas.width / gameCanvas.height, 0.1, 1000);
        camera.position.set(gridSize * 1.2, gridSize * 1.1, gridSize * 1.2);

        renderer = new THREE.WebGLRenderer({ canvas: gameCanvas, antialias: true });
        renderer.setSize(gameCanvas.width, gameCanvas.height, false);
        renderer.setPixelRatio(window.devicePixelRatio);

        minimapCanvas.width = 96;
        minimapCanvas.height = 96;

        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.target.set(gridSize / 2, 2, gridSize / 2);

        ambientLight = new THREE.AmbientLight(0xcccccc);
        scene.add(ambientLight);
        directionalLight = new THREE.DirectionalLight(0xffffff, 0.7);
        directionalLight.position.set(50, 50, 50).normalize();
        scene.add(directionalLight);

        generateTerrain();
        // キャラクター人数を10人に固定
        for (let i = 0; i < 10; i++) {
            spawnCharacter(findValidSpawn());
        }

        window.addEventListener('resize', onWindowResize);
        document.getElementById('messageBoxCloseBtn').addEventListener('click', () => document.getElementById('messageBox').classList.add('hidden'));
        document.getElementById('debugToggle').addEventListener('change', (e) => { DEBUG_MODE = e.target.checked; });
        animate();
    } catch (error) { console.error("Initialization Error:", error); }
}

function spawnCharacter(pos, genes = null) {
    if (pos) {
        const char = new Character(scene, pos, nextCharacterId++, genes);
        characters.push(char);
    }
}

function generateTerrain() {
    PerlinNoise.seed(Math.random);
    const terrainScale = 12;
    for (let x = 0; x < gridSize; x++) { for (let z = 0; z < gridSize; z++) {
        const noiseVal = PerlinNoise.simplex2(x / terrainScale, z / terrainScale);
        const normalizedHeight = (noiseVal + 1) / 2;
        const height = Math.floor(normalizedHeight * (maxHeight / 1.5)) + 1;
        for (let y = 0; y < height; y++) { addBlock(x, y, z, y < height - 1 ? BLOCK_TYPES.DIRT : BLOCK_TYPES.GRASS, false); }
        if (Math.random() < 0.3) addBlock(x, height, z, BLOCK_TYPES.FRUIT, false); // 果実の生成確率を増やす
        if (Math.random() < 0.20 && x > 1 && x < gridSize - 2 && z > 1 && z < gridSize - 2) {
            const treeHeight = height + Math.floor(Math.random() * 3) + 3;
            for (let y = height; y < treeHeight; y++) addBlock(x, y, z, BLOCK_TYPES.WOOD, false);
            for(let dx = -1; dx <= 1; dx++) { for(let dz = -1; dz <= 1; dz++) {
                if(dx !== 0 || dz !== 0) addBlock(x + dx, treeHeight -1, z + dz, BLOCK_TYPES.LEAF, false);
                addBlock(x + dx, treeHeight, z + dz, BLOCK_TYPES.LEAF, false);
            }}
            addBlock(x, treeHeight + 1, z, BLOCK_TYPES.LEAF, false);
        }
    }}
    drawMinimap();
}

function addBlock(x, y, z, type, updateMinimap = true) {
    const key = `${x},${y},${z}`;
    if (worldData.has(key) || y >= maxHeight) return;
    removeBlock(x,y,z, false);
    worldData.set(key, type.id);
    const material = blockMaterials.get(type.id);
    let geometry = new THREE.BoxGeometry(blockSize, blockSize, blockSize);
    if (type.isBed) { geometry = new THREE.BoxGeometry(blockSize, blockSize * 0.4, blockSize); }
    const block = new THREE.Mesh(geometry, material);
    block.position.set(x + 0.5, y + (type.isBed ? 0.2 : 0.5), z + 0.5);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(block.geometry), edgeMaterial);
    block.add(edges);
    visualBlocks.set(key, block);
    scene.add(block);
    if(updateMinimap) drawMinimap();
}

function removeBlock(x, y, z, updateMinimap = true) {
    const key = `${x},${y},${z}`;
    if (worldData.has(key)) {
        worldData.delete(key);
        const block = visualBlocks.get(key);
        if (block) {
            scene.remove(block);
            block.geometry.dispose();
            if(block.children.length > 0) block.children[0].geometry.dispose();
            visualBlocks.delete(key);
        }
        if(updateMinimap) drawMinimap();
    }
}

function findGroundY(x, z) {
    for (let y = maxHeight - 1; y >= 0; y--) { if (worldData.has(`${x},${y},${z}`)) return y; } return -1;
}

function findValidSpawn() {
    for (let i = 0; i < 100; i++) {
        const x = Math.floor(Math.random() * gridSize);
        const z = Math.floor(Math.random() * gridSize);
        const y = findGroundY(x, z);
        if (y !== -1) return { x, y: y + 1, z };
    } return null;
}

function toScreenPosition(obj, camera) {
    const vector = new THREE.Vector3();
    obj.getWorldPosition(vector);
    vector.project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    // Return in window coordinate system
    const x = (vector.x + 1) * rect.width / 2 + rect.left;
    const y = (1 - vector.y) * rect.height / 2 + rect.top;
    return { x, y };
}

function updateWorldLighting() {
    const timeOfDay = (worldTime % DAY_DURATION) / DAY_DURATION; // 0 to 1
    const dayIntensity = Math.sin(timeOfDay * Math.PI);
    directionalLight.intensity = Math.max(0, dayIntensity) * 0.8;
    ambientLight.intensity = 0.3 + Math.max(0, dayIntensity) * 0.6;
    const nightColor = new THREE.Color(0x0a0a2a);
    const dayColor = new THREE.Color(0x87CEEB);
    if (scene.background) {
        scene.background.lerpColors(nightColor, dayColor, Math.max(0, dayIntensity));
    }
}

function onWindowResize() {
    if(!camera || !renderer) return;
    gameCanvas.width = gameCanvas.offsetWidth;
    gameCanvas.height = gameCanvas.offsetHeight;
    camera.aspect = gameCanvas.width / gameCanvas.height;
    camera.updateProjectionMatrix();
    renderer.setSize(gameCanvas.width, gameCanvas.height);
}

function isSafeSpot(pos) {
    for (let i = 1; i < 4; i++) { if (worldData.has(`${pos.x},${pos.y+i},${pos.z}`)) return true; }
    return false;
}

function drawMinimap() {
    if(!minimapCtx) return;
    const minimapSize = minimapCanvas.width;
    const cellSize = minimapSize / gridSize;
    minimapCtx.clearRect(0, 0, minimapSize, minimapSize);
    for (let x = 0; x < gridSize; x++) {
        for (let z = 0; z < gridSize; z++) {
            const y = findGroundY(x, z);
            if (y !== -1) {
                const blockId = worldData.get(`${x},${y},${z}`);
                const blockType = Object.values(BLOCK_TYPES).find(t => t.id === blockId);
                if(blockType && blockType.color) {
                   minimapCtx.fillStyle = '#' + new THREE.Color(blockType.color).getHexString();
                   minimapCtx.fillRect(x * cellSize, z * cellSize, cellSize, cellSize);
                }
            }
        }
    }
}

function animate() {
    requestAnimationFrame(animate);
    const deltaTime = clock.getDelta();
    worldTime += deltaTime;
    updateWorldLighting();
    const isNight = (worldTime % DAY_DURATION) > (DAY_DURATION / 2);
    if (controls) controls.update();
    for (const char of characters) char.update(deltaTime, isNight);
    renderer.render(scene, camera);
}

function main() {
    const checkReady = () => {
        const gameCanvasElement = document.getElementById('gameCanvas');
        if (typeof THREE !== 'undefined' && typeof THREE.OrbitControls !== 'undefined' && gameCanvasElement && gameCanvasElement.clientWidth > 0) {
            init();
        } else {
            requestAnimationFrame(checkReady);
        }
    };
    if (document.readyState === 'complete' || (document.readyState !== 'loading' && !document.documentElement.doScroll)) {
         checkReady();
    } else {
        document.addEventListener('DOMContentLoaded', checkReady);
    }
}
main();
