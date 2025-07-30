import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PerlinNoise } from './utils.js';

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

export const worldData = new Map();
export const visualBlocks = new Map();
export const BLOCK_TYPES = {
    AIR:   { id: 0, name: '空気' },
    GRASS: { id: 1, name: '草', color: 0x4CAF50, diggable: true },
    DIRT:  { id: 2, name: '土', color: 0x966c4a, diggable: true },
    STONE: { id: 3, name: '石', color: 0x888888, diggable: false },
    FRUIT: { id: 4, name: '果実', color: 0xff4500, isEdible: true, foodValue: 50, drops: 'FRUIT_ITEM' },
    WOOD:  { id: 5, name: '木', color: 0x8b5a2b, diggable: true, drops: 'WOOD_LOG' },
    LEAF:  { id: 6, name: '葉', color: 0x228b22, diggable: true },
    BED:   { id: 7, name: '寝床', color: 0xffec8b, isBed: true }
};
export const ITEM_TYPES = {
    WOOD_LOG: { id: 100, name: '丸太', material: new THREE.MeshLambertMaterial({ color: BLOCK_TYPES.WOOD.color }) },
    FRUIT_ITEM: { id: 101, name: '果実アイテム', material: new THREE.MeshLambertMaterial({ color: BLOCK_TYPES.FRUIT.color }), isStorable: true },
    STONE_TOOL: { id: 102, name: '石の道具', material: new THREE.MeshLambertMaterial({ color: 0x888888 }), isTool: true }
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
        if (!isPath && height > 4 && Math.random() < 0.10) {
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
        if (!isPath && Math.random() < 0.3) addBlock(x, height, z, BLOCK_TYPES.FRUIT, false);
        if (!isPath && Math.random() < 0.20 && x > 1 && x < gridSize - 2 && z > 1 && z < gridSize - 2) {
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
export function addBlock(x, y, z, type, updateMinimap = true) {
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
export function removeBlock(x, y, z, updateMinimap = true) {
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
    worldTime += deltaTime;
    updateWorldLighting();
    const isNight = (worldTime % DAY_DURATION) > (DAY_DURATION / 2);
    if (controls) controls.update();
    for (const char of characters) char.update(deltaTime, isNight, camera);
    renderer.render(scene, camera);
}
export async function spawnCharacter(pos, genes = null) {
    if (pos) {
        const { Character } = await import('./character.js');
        const char = new Character(scene, pos, nextCharacterId++, genes);
        characters.push(char);
    }
}
// ...other world functions as needed...
