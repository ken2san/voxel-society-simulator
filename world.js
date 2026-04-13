import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PerlinNoise } from './utils.js';
import { Character } from './character.js';

// Function to remove all character 3D objects from scene
export function removeAllCharacterObjects() {
    if (!scene || !scene.children) return;
    // Remove all Groups whose name starts with 'Character'
    const toRemove = scene.children.filter(obj => obj.type === 'Group' && obj.name && obj.name.startsWith('Character'));
    toRemove.forEach(obj => {
        scene.remove(obj);
        // Memory leak prevention: dispose
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
        if (obj.children && obj.children.length > 0) {
            obj.children.forEach(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
        }
    });
    // Call dispose method if exists for each character in characters array
    if (Array.isArray(characters)) {
        characters.forEach(char => {
            if (typeof char.dispose === 'function') {
                char.dispose();
            }
        });
    }
}

let scene, camera, renderer, controls, ambientLight, directionalLight;
let gameCanvas, minimapCanvas, minimapCtx;
export { scene, camera, renderer, controls, ambientLight, directionalLight, gameCanvas, minimapCanvas, minimapCtx };

export function setWorldObjects(objs) {
    scene = objs.scene;
    camera = objs.camera;
    renderer = objs.renderer;
    controls = objs.controls;
    ambientLight = objs.ambientLight;
    directionalLight = objs.directionalLight;
    gameCanvas = objs.gameCanvas;
    minimapCanvas = objs.minimapCanvas;
    minimapCtx = objs.minimapCtx;
}
export const blockSize = 1;
export const gridSize = 16;
export const maxHeight = 10;
export const clock = new THREE.Clock();
export const characters = [];
export let worldTime = 0;
export const DAY_DURATION = 120;
export let nextCharacterId = 0;

let DEBUG_MODE = false;
export function setDEBUG_MODE(val) { DEBUG_MODE = val; }
export function getDEBUG_MODE() { return DEBUG_MODE; }

// Resource generation settings (controlled by sliders)
export let treeSpawnRate = 0.35; // 35% chance for trees (increased for more wood)
export let fruitSpawnRate = 0.30; // 30% chance for fruit
export let stoneSpawnRate = 0.15; // 15% chance for stone
export let caveSpawnRate = 0.10; // 10% chance for caves
export let leafSpawnRate = 0.70; // 70% chance for leaf generation per position (controls leaf density)

export function setTreeSpawnRate(rate) { treeSpawnRate = Math.max(0, Math.min(1, rate)); }
export function setFruitSpawnRate(rate) { fruitSpawnRate = Math.max(0, Math.min(1, rate)); }
export function setStoneSpawnRate(rate) { stoneSpawnRate = Math.max(0, Math.min(1, rate)); }
export function setCaveSpawnRate(rate) { caveSpawnRate = Math.max(0, Math.min(1, rate)); }
export function setLeafSpawnRate(rate) { leafSpawnRate = Math.max(0, Math.min(1, rate)); }

// Export getters for current rates
export function getTreeSpawnRate() { return treeSpawnRate; }
export function getFruitSpawnRate() { return fruitSpawnRate; }
export function getStoneSpawnRate() { return stoneSpawnRate; }
export function getCaveSpawnRate() { return caveSpawnRate; }
export function getLeafSpawnRate() { return leafSpawnRate; }

export const worldData = new Map();
export const visualBlocks = new Map();
// Incremented whenever blocks are added/removed so characters can detect world changes
export let worldChangeCounter = 0;
export const BLOCK_TYPES = {
    AIR:   { id: 0, name: 'Air' },
    GRASS: { id: 1, name: 'Grass', color: 0x4CAF50, diggable: true },
    DIRT:  { id: 2, name: 'Dirt', color: 0x966c4a, diggable: true },
    STONE: { id: 3, name: 'Stone', color: 0x888888, diggable: true },
    FRUIT: { id: 4, name: 'Fruit', color: 0xff4500, isEdible: true, foodValue: 50, drops: 'FRUIT_ITEM' },
    WOOD:  { id: 5, name: 'Wood', color: 0x8b5a2b, diggable: true, drops: 'WOOD_LOG' },
    LEAF:  { id: 6, name: 'Leaf', color: 0x228b22, diggable: true },
    BED:   { id: 7, name: 'Bed', color: 0xffec8b, isBed: true },
    HOUSE_WALL: { id: 8, name: 'House Wall', color: 0xd2b48c, isHouseWall: true },
    HOUSE_ROOF: { id: 9, name: 'House Roof', color: 0x8b4513, isHouseRoof: true }
};
export const ITEM_TYPES = {
    WOOD_LOG: { id: 100, name: 'Log', material: new THREE.MeshLambertMaterial({ color: BLOCK_TYPES.WOOD.color }) },
    FRUIT_ITEM: { id: 101, name: 'Fruit Item', material: new THREE.MeshLambertMaterial({ color: BLOCK_TYPES.FRUIT.color }), isStorable: true },
    STONE_TOOL: { id: 102, name: 'Stone Tool', material: new THREE.MeshLambertMaterial({ color: 0x888888 }), isTool: true }
};
export const blockMaterials = new Map();
Object.values(BLOCK_TYPES).forEach(type => { if (type.color) { blockMaterials.set(type.id, new THREE.MeshLambertMaterial({ color: type.color })); } });
export const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 });

export function generateTerrain() {
    PerlinNoise.seed(Math.random);
    const terrainScale = 12;
    const pathRows = [Math.floor(gridSize/3), Math.floor(gridSize*2/3)];
    const pathCols = [Math.floor(gridSize/3), Math.floor(gridSize*2/3)];
    for (let x = 0; x < gridSize; x++) { for (let z = 0; z < gridSize; z++) {
        let isPath = pathRows.includes(z) || pathCols.includes(x);
        const noiseVal = PerlinNoise.simplex2(x / terrainScale, z / terrainScale);
        const normalizedHeight = (noiseVal + 1) / 2;
        const height = Math.floor(normalizedHeight * (maxHeight / 1.5)) + 1;
        // --- Cave generation: randomly carve out horizontal caves at mid-level ---
        let isCave = false;
        if (!isPath && height > 4 && Math.random() < caveSpawnRate) {
            // 10% chance to make a cave at y = 2 or 3
            const caveY = 2 + Math.floor(Math.random() * 2);
            for (let y = 0; y < height; y++) {
                if (y === caveY || y === caveY + 1) {
                    // Mark as cave air (special flag)
                    const key = `${x},${y},${z}`;
                    worldData.set(key, { id: BLOCK_TYPES.AIR.id, cave: true });
                    isCave = true;
                } else {
                    addBlock(x, y, z, y < height - 1 ? BLOCK_TYPES.DIRT : BLOCK_TYPES.GRASS, false);
                }
            }
        } else {
            for (let y = 0; y < height; y++) {
                if (isPath && y === height - 1) continue;
                addBlock(x, y, z, y < height - 1 ? BLOCK_TYPES.DIRT : BLOCK_TYPES.GRASS, false);
            }
        }
        if (!isPath && Math.random() < fruitSpawnRate) addBlock(x, height, z, BLOCK_TYPES.FRUIT, false);
        // 石ブロックを表面に生成（設定可能な確率）
        if (!isPath && Math.random() < stoneSpawnRate) addBlock(x, height, z, BLOCK_TYPES.STONE, false);
        if (!isPath && Math.random() < treeSpawnRate && x > 1 && x < gridSize - 2 && z > 1 && z < gridSize - 2) {
            const treeHeight = height + Math.floor(Math.random() * 3) + 3;
            for (let y = height; y < treeHeight; y++) addBlock(x, y, z, BLOCK_TYPES.WOOD, false);
            // 葉の生成（leafSpawnRateで密度制御）
            for(let dx = -1; dx <= 1; dx++) { for(let dz = -1; dz <= 1; dz++) {
                if(dx !== 0 || dz !== 0) {
                    if (Math.random() < leafSpawnRate) {
                        addBlock(x + dx, treeHeight -1, z + dz, BLOCK_TYPES.LEAF, false);
                    }
                }
                if (Math.random() < leafSpawnRate) {
                    addBlock(x + dx, treeHeight, z + dz, BLOCK_TYPES.LEAF, false);
                }
            }}
            // 木の頂上の葉（必ず生成）
            addBlock(x, treeHeight + 1, z, BLOCK_TYPES.LEAF, false);
        }
    }}
    drawMinimap();
}
export function addBlock(x, y, z, type, updateMinimap = true) {
    const key = `${x},${y},${z}`;
    if (worldData.has(key) || y >= maxHeight) return;
    removeBlock(x,y,z, false);
    worldData.set(key, type.id);
    const material = blockMaterials.get(type.id);
    let geometry = new THREE.BoxGeometry(blockSize, blockSize, blockSize);

    // 特別な形状の設定
    if (type.isBed) {
        geometry = new THREE.BoxGeometry(blockSize, blockSize * 0.4, blockSize);
    } else if (type.isHouseWall) {
        // 壁は少し厚みのある形状
        geometry = new THREE.BoxGeometry(blockSize * 0.9, blockSize, blockSize * 0.9);
    } else if (type.isHouseRoof) {
        // 屋根は三角屋根風
        geometry = new THREE.ConeGeometry(blockSize * 0.7, blockSize * 0.8, 4);
    }

    const block = new THREE.Mesh(geometry, material);

    // 位置の調整
    let yOffset = 0.5;
    if (type.isBed) yOffset = 0.2;
    else if (type.isHouseRoof) yOffset = 0.4;

    block.position.set(x + 0.5, y + yOffset, z + 0.5);

    // 屋根の向きを調整
    if (type.isHouseRoof) {
        block.rotation.y = Math.PI / 4; // 45度回転
    }
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(block.geometry), edgeMaterial);
    block.add(edges);
    visualBlocks.set(key, block);
    scene.add(block);
    if(updateMinimap) drawMinimap();
    // signal world change
    try { worldChangeCounter++; if (typeof window !== 'undefined') window.worldChangeCounter = (window.worldChangeCounter || 0) + 1; } catch (e) {}
}
export function removeBlock(x, y, z, updateMinimap = true) {
    // Prevent removing the bottom-most floor (bedrock layer)
    if (y <= 0) return;
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
        // signal world change
        try { worldChangeCounter++; if (typeof window !== 'undefined') window.worldChangeCounter = (window.worldChangeCounter || 0) + 1; } catch (e) {}
    }

        // After removing block, ensure no characters are left floating above an emptied block column.
        // If a character has no block directly below their gridPos, drop them to the nearest ground at that x,z.
        try {
            if (Array.isArray(characters) && characters.length > 0) {
                for (const char of characters) {
                    if (!char || !char.gridPos) continue;
                    // If character is above the removed block column (same x,z) and has no footing
                    if (char.gridPos.x === x && char.gridPos.z === z) {
                        let belowKey = `${char.gridPos.x},${char.gridPos.y-1},${char.gridPos.z}`;
                        if (!worldData.has(belowKey)) {
                            // find nearest ground below
                            let fallY = char.gridPos.y - 1;
                            while (fallY > 0 && !worldData.has(`${char.gridPos.x},${fallY-1},${char.gridPos.z}`)) {
                                fallY--;
                            }
                            if (fallY < 0) fallY = 0;
                            // assign new y and update mesh
                            char.gridPos.y = fallY;
                            if (typeof char.updateWorldPosFromGrid === 'function') char.updateWorldPosFromGrid();
                            if (typeof char.log === 'function') char.log && char.log('World.removeBlock: dropped character to ground after block removal', {id: char.id, newY: fallY});
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('Error while dropping characters after removeBlock', e);
        }
}
export function findGroundY(x, z) {
    for (let y = maxHeight - 1; y >= 0; y--) { if (worldData.has(`${x},${y},${z}`)) return y; } return -1;
}
export function findValidSpawn() {
    for (let i = 0; i < 100; i++) {
        const x = Math.floor(Math.random() * gridSize);
        const z = Math.floor(Math.random() * gridSize);
        const y = findGroundY(x, z);
        if (y !== -1) {
            // 下のブロックがGRASSまたはDIRTのみ許可
            const belowId = worldData.get(`${x},${y},${z}`);
            if (belowId === BLOCK_TYPES.GRASS.id || belowId === BLOCK_TYPES.DIRT.id) {
                return { x, y: y + 1, z };
            }
        }
    }
    return null;
}
export function toScreenPosition(obj, camera) {
    const vector = new THREE.Vector3();
    obj.getWorldPosition(vector);
    vector.project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    const x = (vector.x + 1) * rect.width / 2 + rect.left;
    const y = (1 - vector.y) * rect.height / 2 + rect.top;
    return { x, y };
}
export function updateWorldLighting() {
    const timeOfDay = (worldTime % DAY_DURATION) / DAY_DURATION;
    const dayIntensity = Math.sin(timeOfDay * Math.PI);
    directionalLight.intensity = Math.max(0, dayIntensity) * 0.8;
    ambientLight.intensity = 0.3 + Math.max(0, dayIntensity) * 0.6;
    const nightColor = new THREE.Color(0x0a0a2a);
    const dayColor = new THREE.Color(0x87CEEB);
    if (scene.background) {
        scene.background.lerpColors(nightColor, dayColor, Math.max(0, dayIntensity));
    }
}
export function onWindowResize() {
    if(!camera || !renderer) return;
    gameCanvas.width = gameCanvas.offsetWidth;
    gameCanvas.height = gameCanvas.offsetHeight;
    camera.aspect = gameCanvas.width / gameCanvas.height;
    camera.updateProjectionMatrix();
    renderer.setSize(gameCanvas.width, gameCanvas.height);
}
export function isSafeSpot(pos) {
    // Recognize cave air as safe
    for (let i = 1; i < 4; i++) {
        const key = `${pos.x},${pos.y+i},${pos.z}`;
        const val = worldData.get(key);
        if (val && ((typeof val === 'object' && val.cave) || (typeof val === 'number' && val !== BLOCK_TYPES.AIR.id))) return true;
    }
    // Also, if current spot is cave air
    const here = worldData.get(`${pos.x},${pos.y},${pos.z}`);
    if (here && typeof here === 'object' && here.cave) return true;
    return false;
}
export function drawMinimap() {
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
export function animate() {
    requestAnimationFrame(animate);
    const deltaTime = clock.getDelta();
    // simulationRunningがtrueのときだけ進行
    if (typeof window !== 'undefined' && window.simulationRunning === false) {
        // 停止中もワールドの描画・UI更新は継続
        updateWorldLighting();
        if (controls) controls.update();
        renderer.render(scene, camera);
        return;
    }
    worldTime += deltaTime;
    updateWorldLighting();
    const isNight = (worldTime % DAY_DURATION) > (DAY_DURATION / 2);
    if (controls) controls.update();
    for (const char of characters) char.update(deltaTime, isNight, camera);

    // --- グループ再判定を1秒ごとに実行 ---
    if (!animate.lastGroupDetectTime) animate.lastGroupDetectTime = 0;
    animate.lastGroupDetectTime += deltaTime;
    if (animate.lastGroupDetectTime >= 1.0) {
        if (typeof window !== 'undefined' && window.characters && window.characters.length > 0) {
            Character.detectGroupsAndElectLeaders(window.characters);
        }
        animate.lastGroupDetectTime = 0;
    }

    renderer.render(scene, camera);
}
export async function spawnCharacter(pos, genes = null) {
    if (pos) {
        const { Character } = await import('./character.js');
    if (typeof window !== 'undefined' && window.DEBUG_MODE) {
        try { console.log('[SPAWN] spawnCharacter called at', pos, 'genes=', genes); } catch (e) {}
    }
    const char = new Character(scene, pos, nextCharacterId++, genes);
    characters.push(char);
    }
}
// ...other world functions as needed...
