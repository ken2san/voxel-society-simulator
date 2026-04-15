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
    applyDistrictVisualization();
    emitDistrictChange();
}
export const blockSize = 1;
export const gridSize = 16;
export const maxHeight = 10;
export const clock = new THREE.Clock();
export const characters = [];
export let worldTime = 0;
export const DAY_DURATION = 120;
export let nextCharacterId = 0;
export function resetNextCharacterId() { nextCharacterId = 0; }

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

export const DISTRICT_MODE_OPTIONS = Object.freeze([1, 4, 16]);
let districtMode = 1;
let activeDistrictIndex = 0;
let districtSummaryCache = [];
let districtSummaryCacheUpdatedAt = 0;

function clampDistrictMode(mode) {
    const numeric = Number(mode);
    return DISTRICT_MODE_OPTIONS.includes(numeric) ? numeric : 1;
}

function getDistrictGridSide(mode = districtMode) {
    return Math.max(1, Math.round(Math.sqrt(clampDistrictMode(mode))));
}

function roundDistrictValue(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

export function getDistrictMode() {
    return districtMode;
}

export function getActiveDistrictIndex() {
    return activeDistrictIndex;
}

export function getDistrictCount(mode = districtMode) {
    const side = getDistrictGridSide(mode);
    return side * side;
}

export function getDistrictCellSize(mode = districtMode) {
    return gridSize / getDistrictGridSide(mode);
}

export function getDistrictIndexForPosition(pos, mode = districtMode) {
    const side = getDistrictGridSide(mode);
    if (side <= 1) return 0;
    const cellSize = gridSize / side;
    const x = Math.max(0, Math.min(gridSize - 1, Math.floor(Number(pos?.x) || 0)));
    const z = Math.max(0, Math.min(gridSize - 1, Math.floor(Number(pos?.z) || 0)));
    const col = Math.max(0, Math.min(side - 1, Math.floor(x / cellSize)));
    const row = Math.max(0, Math.min(side - 1, Math.floor(z / cellSize)));
    return row * side + col;
}

export function getDistrictBounds(index, mode = districtMode) {
    const side = getDistrictGridSide(mode);
    const count = side * side;
    const safeIndex = Math.max(0, Math.min(count - 1, Number(index) || 0));
    const cellSize = gridSize / side;
    const row = Math.floor(safeIndex / side);
    const col = safeIndex % side;
    const minX = Math.floor(col * cellSize);
    const maxX = Math.min(gridSize - 1, Math.floor((col + 1) * cellSize) - 1);
    const minZ = Math.floor(row * cellSize);
    const maxZ = Math.min(gridSize - 1, Math.floor((row + 1) * cellSize) - 1);
    return {
        index: safeIndex,
        row,
        col,
        minX,
        maxX,
        minZ,
        maxZ,
        centerX: (minX + maxX + 1) / 2,
        centerZ: (minZ + maxZ + 1) / 2
    };
}

function isGridPositionInActiveDistrict(pos) {
    if (districtMode === 1) return true;
    return getDistrictIndexForPosition(pos, districtMode) === activeDistrictIndex;
}

function setObjectDistrictVisibility(obj, pos) {
    if (!obj) return;
    obj.visible = isGridPositionInActiveDistrict(pos);
}

export function getDistrictRuntimeForPosition(pos) {
    const index = getDistrictIndexForPosition(pos, districtMode);
    const isActive = districtMode === 1 || index === activeDistrictIndex;
    return {
        mode: districtMode,
        sideLength: getDistrictGridSide(districtMode),
        index,
        activeDistrictIndex,
        isActive,
        shouldRender: isActive || districtMode === 1,
        updateInterval: isActive ? 0 : (districtMode >= 16 ? 0.9 : 0.45),
        bounds: getDistrictBounds(index, districtMode)
    };
}

export function getDistrictSummaries(sourceChars = characters, prevStateMap = null) {
    const count = getDistrictCount(districtMode);
    const hasPrevState = prevStateMap instanceof Map && prevStateMap.size > 0;
    const buckets = Array.from({ length: count }, (_, index) => ({
        index,
        label: `D${index + 1}`,
        population: 0,
        births: 0,
        deaths: 0,
        migrationIn: 0,
        migrationOut: 0,
        stageMix: { child: 0, young: 0, adult: 0, elder: 0 },
        foodPressure: 0,
        housingPressure: 0,
        timeStress: 0,
        supportDensity: 0,
        supportAccess: 0,
        relationshipStability: 0,
        conflictLevel: 0,
        socialPressure: 0,
        populationBalance: 0,
        opportunityScore: 0,
        avgNeeds: { hunger: 0, energy: 0, safety: 0, social: 0 }
    }));
    const sums = Array.from({ length: count }, () => ({
        hunger: 0,
        energy: 0,
        safety: 0,
        social: 0,
        lowFood: 0,
        noHome: 0,
        supported: 0,
        conflict: 0,
        timeStress: 0,
        relationshipStability: 0
    }));

    for (const c of Array.isArray(sourceChars) ? sourceChars : []) {
        if (!c?.gridPos) continue;
        const index = getDistrictIndexForPosition(c.gridPos, districtMode);
        const bucket = buckets[index];
        const sum = sums[index];
        const alive = c.state !== 'dead';
        const prev = hasPrevState ? prevStateMap.get(c.id) : null;

        if (alive) {
            bucket.population += 1;
            const stage = c.getLifeStage ? c.getLifeStage() : (c.isChild ? 'child' : 'adult');
            if (bucket.stageMix[stage] !== undefined) bucket.stageMix[stage] += 1;
            const hunger = Number(c.needs?.hunger || 0);
            const energy = Number(c.needs?.energy || 0);
            const safety = Number(c.needs?.safety || 0);
            const social = Number(c.needs?.social || 0);
            sum.hunger += hunger;
            sum.energy += energy;
            sum.safety += safety;
            sum.social += social;
            if (hunger < 40) sum.lowFood += 1;
            if (!c.homePosition) sum.noHome += 1;
            const relationshipValues = c.relationships instanceof Map
                ? Array.from(c.relationships.values()).map(Number).filter(Number.isFinite)
                : [];
            const networkSnapshot = typeof c.getRelationshipSnapshot === 'function' ? c.getRelationshipSnapshot(4) : null;
            const supportStrength = Math.max(
                Number(networkSnapshot?.supportScore || 0),
                c.groupId ? 0.22 : 0,
                relationshipValues.some(v => v >= 60) ? 0.18 : 0
            );
            sum.supported += clamp01(supportStrength);
            if (c._nearEnemy) sum.conflict += 1;
            const timeStress = ((Math.max(0, 55 - hunger) / 55) + (Math.max(0, 45 - energy) / 45)) / 2;
            sum.timeStress += Math.max(0, Math.min(1, timeStress));
            if (relationshipValues.length > 0) {
                const avgAffinity = relationshipValues.reduce((acc, value) => acc + value, 0) / relationshipValues.length;
                sum.relationshipStability += Math.max(0, Math.min(1, avgAffinity / 100));
            }
        }

        if (hasPrevState) {
            if (alive && !prev) {
                bucket.births += 1;
            } else if (prev) {
                if (prev.alive && !alive) {
                    const deathBucket = buckets[Math.max(0, Math.min(count - 1, Number(prev.districtIndex) || 0))];
                    deathBucket.deaths += 1;
                } else if (!prev.alive && alive) {
                    bucket.births += 1;
                }
                if (alive && prev.districtIndex !== undefined && prev.districtIndex !== index) {
                    bucket.migrationIn += 1;
                    const prevBucket = buckets[Math.max(0, Math.min(count - 1, Number(prev.districtIndex) || 0))];
                    prevBucket.migrationOut += 1;
                }
            }
        }
    }

    const alivePopulationTotal = buckets.reduce((acc, bucket) => acc + bucket.population, 0);
    const targetPopulationPerDistrict = Math.max(1, alivePopulationTotal / Math.max(1, count));

    return buckets.map((bucket, index) => {
        const n = Math.max(1, bucket.population);
        const sum = sums[index];
        const foodPressure = roundDistrictValue(sum.lowFood / n);
        const housingPressure = roundDistrictValue(sum.noHome / n);
        const timeStress = roundDistrictValue(sum.timeStress / n);
        const supportAccess = roundDistrictValue(sum.supported / n);
        const relationshipStability = roundDistrictValue(sum.relationshipStability / n);
        const conflictLevel = roundDistrictValue(sum.conflict / n);
        const socialPressure = roundDistrictValue(Math.max(0, Math.min(1,
            (foodPressure * 0.28) +
            (housingPressure * 0.30) +
            (timeStress * 0.22) +
            ((1 - supportAccess) * 0.10) +
            ((1 - relationshipStability) * 0.10)
        )));
        const populationBalance = roundDistrictValue(Math.max(0, Math.min(1,
            1 - (Math.abs(bucket.population - targetPopulationPerDistrict) / Math.max(1, targetPopulationPerDistrict * 1.5))
        )));
        const opportunityScore = roundDistrictValue(Math.max(0, Math.min(1,
            ((1 - socialPressure) * 0.36) +
            (supportAccess * 0.22) +
            (relationshipStability * 0.16) +
            ((1 - conflictLevel) * 0.10) +
            (populationBalance * 0.10) +
            ((1 - foodPressure) * 0.06)
        )));
        return {
            ...bucket,
            foodPressure,
            housingPressure,
            timeStress,
            supportDensity: supportAccess,
            supportAccess,
            relationshipStability,
            conflictLevel,
            socialPressure,
            populationBalance,
            opportunityScore,
            avgNeeds: {
                hunger: roundDistrictValue(sum.hunger / n),
                energy: roundDistrictValue(sum.energy / n),
                safety: roundDistrictValue(sum.safety / n),
                social: roundDistrictValue(sum.social / n)
            },
            migrationFlow: {
                in: bucket.migrationIn,
                out: bucket.migrationOut,
                net: bucket.migrationIn - bucket.migrationOut
            }
        };
    });
}

function getDistrictAnchorForCharacter(character, bounds) {
    if (!character?.gridPos || !bounds) return null;
    const homeInBounds = character.homePosition && getDistrictIndexForPosition(character.homePosition, districtMode) === bounds.index;
    const preferred = homeInBounds
        ? character.homePosition
        : { x: Math.floor(bounds.centerX), y: Number(character.gridPos.y || 1), z: Math.floor(bounds.centerZ) };

    for (let attempt = 0; attempt < 8; attempt++) {
        const spread = attempt < 3 ? 0.35 : 1.0;
        const rx = preferred.x + (Math.random() - 0.5) * ((bounds.maxX - bounds.minX + 1) * spread);
        const rz = preferred.z + (Math.random() - 0.5) * ((bounds.maxZ - bounds.minZ + 1) * spread);
        const x = Math.max(bounds.minX, Math.min(bounds.maxX, Math.round(rx)));
        const z = Math.max(bounds.minZ, Math.min(bounds.maxZ, Math.round(rz)));
        const groundY = Math.max(0, Math.min(maxHeight - 1, findGroundY(x, z)));
        const y = Math.max(1, Math.min(maxHeight, groundY + 1));
        const key = `${x},${y},${z}`;
        const belowKey = `${x},${y - 1},${z}`;
        if (!worldData.has(key) && worldData.has(belowKey)) {
            return { x, y, z };
        }
    }

    return {
        x: Math.max(bounds.minX, Math.min(bounds.maxX, Math.floor(bounds.centerX))),
        y: Math.max(1, Math.min(maxHeight, Number(character.gridPos.y || 1))),
        z: Math.max(bounds.minZ, Math.min(bounds.maxZ, Math.floor(bounds.centerZ)))
    };
}

export function pickDistrictMoveTargetForCharacter(character, sourceChars = characters) {
    if (!character?.gridPos || districtMode === 1) return null;
    const summaries = refreshDistrictSummaryCache(sourceChars);
    if (!Array.isArray(summaries) || summaries.length < 2) return null;

    const currentIndex = getDistrictIndexForPosition(character.gridPos, districtMode);
    const currentSummary = summaries[currentIndex] || null;
    const curiosity = clamp01(character.personality?.curiosity ?? 0.5);
    const sociality = clamp01(character.personality?.sociality ?? 0.5);
    const resilience = clamp01(character.personality?.resilience ?? 0.5);
    const hungerStress = clamp01((55 - Number(character.needs?.hunger || 0)) / 55);
    const energyStress = clamp01((45 - Number(character.needs?.energy || 0)) / 45);
    const socialStress = clamp01((50 - Number(character.needs?.social || 0)) / 50);
    const currentPressure = clamp01(currentSummary?.socialPressure ?? 0);
    const moveUrgency = clamp01(
        ((hungerStress * 0.30) + (energyStress * 0.18) + (socialStress * 0.18) + (currentPressure * 0.34))
        * (1.10 - (resilience * 0.20))
    );
    const homeIndex = character.homePosition ? getDistrictIndexForPosition(character.homePosition, districtMode) : null;

    const scored = summaries.map(summary => {
        const bounds = getDistrictBounds(summary.index, districtMode);
        const distNorm = clamp01(
            (Math.abs(bounds.centerX - character.gridPos.x) + Math.abs(bounds.centerZ - character.gridPos.z))
            / Math.max(1, gridSize)
        );
        const opportunity = clamp01(summary.opportunityScore ?? (1 - clamp01(summary.socialPressure ?? 0)));
        const familiarityBonus = (summary.index === currentIndex ? 0.08 : 0) + (homeIndex === summary.index ? 0.10 : 0);
        const socialBonus = clamp01(summary.supportAccess ?? 0) * (0.05 + sociality * 0.05);
        const distancePenalty = distNorm * (0.12 - curiosity * 0.04);
        const utility = clamp01(opportunity + familiarityBonus + socialBonus - distancePenalty);
        return { summary, bounds, utility };
    });

    const currentUtility = scored[currentIndex]?.utility ?? clamp01(currentSummary?.opportunityScore ?? 0.5);
    const bestUtility = Math.max(...scored.map(item => item.utility));
    if (bestUtility <= currentUtility + 0.02 && moveUrgency < 0.28) {
        return null;
    }

    const beta = 1.8 + (curiosity * 1.8) + (moveUrgency * 2.4) + (sociality * 0.8);
    const maxUtility = Math.max(...scored.map(item => item.utility));
    const weighted = scored.map(item => {
        const stayBias = item.summary.index === currentIndex ? (0.10 - moveUrgency * 0.08) : 0;
        const weight = Math.exp(((item.utility - stayBias) - maxUtility) * beta);
        return { ...item, weight };
    });
    const totalWeight = weighted.reduce((acc, item) => acc + item.weight, 0);
    if (!(totalWeight > 0)) return null;

    let roll = Math.random() * totalWeight;
    let chosen = weighted[weighted.length - 1];
    for (const item of weighted) {
        roll -= item.weight;
        if (roll <= 0) {
            chosen = item;
            break;
        }
    }

    const improvement = chosen.utility - currentUtility;
    const commitment = clamp01((moveUrgency * 0.46) + (curiosity * 0.20) + (Math.max(0, improvement) * 1.45));
    if (chosen.summary.index === currentIndex || commitment < 0.24) {
        return null;
    }

    const targetPos = getDistrictAnchorForCharacter(character, chosen.bounds);
    if (!targetPos) return null;

    return {
        districtIndex: chosen.summary.index,
        label: chosen.summary.label,
        targetPos,
        utility: roundDistrictValue(chosen.utility),
        currentUtility: roundDistrictValue(currentUtility),
        commitment: roundDistrictValue(commitment),
        opportunityScore: roundDistrictValue(chosen.summary.opportunityScore ?? chosen.utility)
    };
}

export function getDistrictSocialContextForPosition(pos, sourceChars = characters) {
    const index = getDistrictIndexForPosition(pos, districtMode);
    const summary = refreshDistrictSummaryCache(sourceChars)[index];
    return summary || {
        index,
        foodPressure: 0,
        housingPressure: 0,
        timeStress: 0,
        supportAccess: 0,
        relationshipStability: 0,
        socialPressure: 0,
        opportunityScore: 0.5
    };
}

export function refreshDistrictSummaryCache(sourceChars = characters, { force = false } = {}) {
    const now = Date.now();
    if (!force && districtSummaryCache.length > 0 && (now - districtSummaryCacheUpdatedAt) < 250) {
        return districtSummaryCache;
    }
    districtSummaryCache = getDistrictSummaries(sourceChars);
    districtSummaryCacheUpdatedAt = now;
    if (typeof window !== 'undefined') {
        window.__districtSummaryCache = districtSummaryCache;
    }
    return districtSummaryCache;
}

export function getDistrictState() {
    return {
        mode: districtMode,
        sideLength: getDistrictGridSide(districtMode),
        activeIndex: activeDistrictIndex,
        activeBounds: getDistrictBounds(activeDistrictIndex, districtMode),
        districts: Array.from({ length: getDistrictCount(districtMode) }, (_, index) => getDistrictBounds(index, districtMode))
    };
}

function focusCameraOnActiveDistrict() {
    if (!controls) return;
    const bounds = getDistrictBounds(activeDistrictIndex, districtMode);
    controls.target.set(bounds.centerX, 2, bounds.centerZ);
    if (camera) camera.lookAt(controls.target);
}

function emitDistrictChange() {
    if (typeof window === 'undefined') return;
    window.districtMode = districtMode;
    window.activeDistrictIndex = activeDistrictIndex;
    window.getDistrictRuntime = getDistrictRuntimeForPosition;
    window.getDistrictObservationSummary = () => refreshDistrictSummaryCache();
    window.getDistrictSocialContextForPosition = (pos) => getDistrictSocialContextForPosition(pos);
    window.pickDistrictMoveTargetForCharacter = (character) => pickDistrictMoveTargetForCharacter(character);
    window.getDistrictState = getDistrictState;
    try {
        window.dispatchEvent(new CustomEvent('district-changed', { detail: getDistrictState() }));
    } catch (err) {
        // ignore event dispatch issues in non-browser contexts
    }
}

export function applyDistrictVisualization() {
    if (scene) {
        for (const [key, block] of visualBlocks.entries()) {
            const [x, y, z] = key.split(',').map(Number);
            setObjectDistrictVisibility(block, { x, y, z });
        }
    }
    drawMinimap();
}

export function setDistrictMode(mode = 1) {
    districtMode = clampDistrictMode(mode);
    activeDistrictIndex = Math.max(0, Math.min(getDistrictCount(districtMode) - 1, Number(activeDistrictIndex) || 0));
    if (districtMode === 1) activeDistrictIndex = 0;
    districtSummaryCache = [];
    districtSummaryCacheUpdatedAt = 0;
    applyDistrictVisualization();
    focusCameraOnActiveDistrict();
    emitDistrictChange();
    return getDistrictState();
}

export function setActiveDistrict(index = 0) {
    activeDistrictIndex = Math.max(0, Math.min(getDistrictCount(districtMode) - 1, Number(index) || 0));
    if (districtMode === 1) activeDistrictIndex = 0;
    districtSummaryCacheUpdatedAt = 0;
    applyDistrictVisualization();
    focusCameraOnActiveDistrict();
    emitDistrictChange();
    return getDistrictState();
}

if (typeof window !== 'undefined') {
    emitDistrictChange();
}

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
    setObjectDistrictVisibility(block, { x, y, z });
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
    if(!minimapCtx || !minimapCanvas) return;
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

    if (districtMode > 1) {
        const side = getDistrictGridSide(districtMode);
        const active = getDistrictBounds(activeDistrictIndex, districtMode);
        const districtWidth = (active.maxX - active.minX + 1) * cellSize;
        const districtHeight = (active.maxZ - active.minZ + 1) * cellSize;

        minimapCtx.save();
        minimapCtx.fillStyle = 'rgba(255, 255, 255, 0.16)';
        minimapCtx.fillRect(active.minX * cellSize, active.minZ * cellSize, districtWidth, districtHeight);

        minimapCtx.strokeStyle = 'rgba(15, 23, 42, 0.45)';
        minimapCtx.lineWidth = 1;
        for (let i = 1; i < side; i++) {
            const pos = i * (minimapSize / side);
            minimapCtx.beginPath();
            minimapCtx.moveTo(pos, 0);
            minimapCtx.lineTo(pos, minimapSize);
            minimapCtx.stroke();
            minimapCtx.beginPath();
            minimapCtx.moveTo(0, pos);
            minimapCtx.lineTo(minimapSize, pos);
            minimapCtx.stroke();
        }

        minimapCtx.strokeStyle = 'rgba(255, 215, 0, 0.95)';
        minimapCtx.lineWidth = 2;
        minimapCtx.strokeRect(active.minX * cellSize, active.minZ * cellSize, districtWidth, districtHeight);
        minimapCtx.restore();
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
    refreshDistrictSummaryCache(characters);
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

    // --- 季節時計：シム経過時間を加算 ---
    if (!animate.simTime) animate.simTime = 0;
    animate.simTime += deltaTime;
    // 毎秒程度の頻度でサイドバー向け季節情報を更新（再生tick待ちでは遅すぎるため）
    if (!animate.lastSeasonUIUpdate) animate.lastSeasonUIUpdate = 0;
    animate.lastSeasonUIUpdate += deltaTime;
    if (animate.lastSeasonUIUpdate >= 1.0) {
        animate.lastSeasonUIUpdate = 0;
        const _cycleSec = (typeof window !== 'undefined' && window.seasonCycleSeconds > 0) ? window.seasonCycleSeconds : 120;
        const _amp = (typeof window !== 'undefined' && window.seasonAmplitude !== undefined) ? Math.min(1, Math.max(0, window.seasonAmplitude)) : 0.6;
        const _mul = 1 + _amp * Math.sin(2 * Math.PI * animate.simTime / _cycleSec);
        const _phase = (animate.simTime % _cycleSec) / _cycleSec;
        let _name, _icon;
        if (_phase < 0.25)       { _name = 'Spring'; _icon = '🌸'; }
        else if (_phase < 0.50)  { _name = 'Summer'; _icon = '☀️'; }
        else if (_phase < 0.75)  { _name = 'Autumn'; _icon = '🍂'; }
        else                     { _name = 'Winter'; _icon = '❄️'; }
        window.currentSeasonInfo = { name: _name, icon: _icon, multiplier: Math.max(0, _mul), amplitude: _amp, phase: _phase };

        // --- Society Chronicle event hooks (always active) ---
        if (typeof window.logChronicleEvent === 'function' && Array.isArray(window.characters)) {
            const _alv = window.characters.filter(c => c && c.state !== 'dead');
            const _pop = _alv.length;

            // Reset animate state when event log was cleared (sim restart)
            if (Array.isArray(window.__eventLog) && window.__eventLog.length === 0 && animate._chronicleStarted) {
                animate._chronicleStarted = false;
                animate._popPeak = 0;
                animate._lastChronPop = undefined;
                animate._lastChronConfl = 0;
                animate._lastChronStarving = 0;
                animate._lastChronSeason = undefined;
            }

            // Colony established (once)
            if (!animate._chronicleStarted && _pop > 0) {
                animate._chronicleStarted = true;
                window.logChronicleEvent('🌿', `Colony of ${_pop} established`, 'start');
            }

            // Season change (only when amplitude > 0 so flat-rate sims stay quiet)
            if (_amp > 0 && animate._lastChronSeason && animate._lastChronSeason !== _name) {
                const mul = Math.max(0, _mul);
                window.logChronicleEvent(_icon, `${_name} — food ×${mul.toFixed(2)}`, 'season');
            }
            animate._lastChronSeason = _name;

            // Population record high (not initial snapshot)
            if (_pop > 0 && _pop > (animate._popPeak || 0)) {
                if (animate._popPeak > 0) {
                    window.logChronicleEvent('📈', `Population record: ${_pop}`, 'peak');
                }
                animate._popPeak = _pop;
            }

            // Population critical (once per drop below 5)
            const _prevPop = animate._lastChronPop !== undefined ? animate._lastChronPop : _pop;
            if (_pop > 0 && _pop <= 4 && _prevPop > 4) {
                window.logChronicleEvent('⚠️', `Only ${_pop} survivors`, 'warning');
            }
            animate._lastChronPop = _pop;

            // Conflict wave (≥3 pairs newly active)
            const _conflPairs = Math.round(_alv.filter(c => c._nearEnemy).length / 2);
            const _prevConfl = animate._lastChronConfl || 0;
            if (_conflPairs >= 3 && _prevConfl < 3) {
                window.logChronicleEvent('⚔️', `Conflict wave — ${_conflPairs} pairs`, 'conflict');
            } else if (_conflPairs === 0 && _prevConfl >= 3) {
                window.logChronicleEvent('🕊️', `Tensions eased`, 'peace');
            }
            animate._lastChronConfl = _conflPairs;

            // Famine / recovery (starvationTimer > 0 indicates active starvation)
            const _starving = _alv.filter(c => (c._starvationTimer || 0) > 0).length;
            const _starvRate = _pop > 0 ? _starving / _pop : 0;
            const _prevStarv = animate._lastChronStarving !== undefined ? animate._lastChronStarving : 0;
            if (_starvRate > 0.4 && _prevStarv <= 0.4) {
                window.logChronicleEvent('☠️', `Famine — ${_starving}/${_pop} starving`, 'famine');
            } else if (_starvRate < 0.1 && _prevStarv > 0.4) {
                window.logChronicleEvent('🍎', `Famine ended`, 'recovery');
            }
            animate._lastChronStarving = _starvRate;
        }

        // --- World-level telemetry snapshot (1s tick) ---
        if (typeof window !== 'undefined' && window.simTestMode && window.__simTelemetry && typeof window.__simTelemetry.addWorldSample === 'function') {
            // Count fruit blocks (BLOCK_TYPES.FRUIT.id === 4)
            let _fruitCount = 0;
            worldData.forEach(v => { if (v === 4) _fruitCount++; });

            const _chars = Array.isArray(window.characters) ? window.characters : [];
            const _alive = _chars.filter(c => c && c.state !== 'dead');
            const _groups = new Set(_alive.map(c => c.groupId).filter(Boolean));
            const _isolated = _alive.filter(c => !c.groupId).length;
            const _stageMix = { child: 0, young: 0, adult: 0, elder: 0 };
            for (const c of _alive) {
                const stage = c.getLifeStage ? c.getLifeStage() : (c.isChild ? 'child' : 'adult');
                if (_stageMix[stage] !== undefined) _stageMix[stage] += 1;
            }
            const _conflictPairs = (() => {
                let cnt = 0;
                for (const c of _alive) { if (c._nearEnemy) cnt++; }
                return Math.round(cnt / 2); // each pair counted twice
            })();
            const _needsAvg = (() => {
                if (_alive.length === 0) return { hunger: 0, energy: 0, safety: 0, social: 0 };
                const sum = { hunger: 0, energy: 0, safety: 0, social: 0 };
                for (const c of _alive) {
                    sum.hunger += c.needs?.hunger || 0;
                    sum.energy += c.needs?.energy || 0;
                    sum.safety += c.needs?.safety || 0;
                    sum.social += c.needs?.social || 0;
                }
                const n = _alive.length;
                return { hunger: +(sum.hunger/n).toFixed(1), energy: +(sum.energy/n).toFixed(1), safety: +(sum.safety/n).toFixed(1), social: +(sum.social/n).toFixed(1) };
            })();
            const _prevDistrictState = animate._districtTelemetryState instanceof Map ? animate._districtTelemetryState : new Map();
            const _districts = getDistrictSummaries(_chars, _prevDistrictState);
            const _nextDistrictState = new Map();
            for (const c of _chars) {
                if (!c?.gridPos) continue;
                _nextDistrictState.set(c.id, {
                    districtIndex: getDistrictIndexForPosition(c.gridPos, districtMode),
                    alive: c.state !== 'dead'
                });
            }
            animate._districtTelemetryState = _nextDistrictState;

            window.__simTelemetry.addWorldSample({
                t: Date.now(),
                fruitCount: _fruitCount,
                season: { name: _name, multiplier: +Math.max(0, _mul).toFixed(3), phase: +_phase.toFixed(3) },
                pop: _alive.length,
                groups: _groups.size,
                isolated: _isolated,
                stageMix: _stageMix,
                conflictPairs: _conflictPairs,
                avgNeeds: _needsAvg,
                districtMode,
                activeDistrictIndex,
                activeDistrict: _districts[activeDistrictIndex] ?? null,
                districts: _districts
            });
        }
    }

    // --- 果物再生：fruitRegenIntervalSeconds ごとに表面GRASSにFRUITをランダム再生 ---
    // 季節サイクル（sinカーブ）で実効レートを変動させる。
    //   seasonAmplitude=0 → 季節なし（定数レート）
    //   seasonAmplitude=0.8, cycleSec=120 → 夏は1.8×、冬は0.2× のリズム
    if (!animate.lastFruitRegenTime) animate.lastFruitRegenTime = 0;
    animate.lastFruitRegenTime += deltaTime;
    const fruitRegenInterval = (typeof window !== 'undefined' && window.fruitRegenIntervalSeconds > 0)
        ? window.fruitRegenIntervalSeconds : 60;
    if (animate.lastFruitRegenTime >= fruitRegenInterval) {
        const baseRate = fruitSpawnRate;
        // 季節倍率は毎秒更新の window.currentSeasonInfo から取得（未設定なら1）
        const seasonalMultiplier = window.currentSeasonInfo ? window.currentSeasonInfo.multiplier : 1;
        const rate = baseRate * seasonalMultiplier;

        for (let x = 0; x < gridSize; x++) {
            for (let z = 0; z < gridSize; z++) {
                if (Math.random() >= rate) continue;
                const y = findGroundY(x, z);
                if (y < 0) continue;
                if (worldData.get(`${x},${y},${z}`) !== BLOCK_TYPES.GRASS.id) continue;
                if (worldData.has(`${x},${y + 1},${z}`)) continue;
                addBlock(x, y + 1, z, BLOCK_TYPES.FRUIT);
            }
        }
        animate.lastFruitRegenTime = 0;
    }

    renderer.render(scene, camera);
}
export function spawnCharacter(pos, genes = null) {
    if (pos) {
        if (typeof window !== 'undefined' && window.DEBUG_MODE) {
            try { console.log('[SPAWN] spawnCharacter called at', pos, 'genes=', genes); } catch (e) {}
        }
        const char = new Character(scene, pos, nextCharacterId++, genes);
        characters.push(char);
        return char;
    }
    return null;
}
// ...other world functions as needed...
