import * as THREE from 'three';
import { PerlinNoise } from './utils.js';
import { Character } from './character.js';
import { getSimulationIO } from './sim-core/interfaces.js';
import { createSnowSystem } from './sim-core/snow-system.js';
import { createRainSystem } from './sim-core/rain-system.js';
import { createBirdSystem } from './sim-core/ambient-creatures.js';
import { buildCampfireGroup } from './sim-core/campfire-renderer.js';
import { buildWellGroup } from './sim-core/well-renderer.js';
import { buildAngelGroup, buildReaperGroup } from './sim-core/special-entities.js';
import { playSound, updateAmbience } from './sim-core/sound-system.js';

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
let campfireObjects = [];  // decorative campfires (not worldData blocks)
let wellObject = null;     // single decorative village well

// ── Special entities (angel + reaper) ────────────────────────────────────────
// Angel roams when child count ≥ angelChildThreshold.
// Reaper roams when elder count ≥ reaperElderThreshold.
let specialEntities = { angel: null, reaper: null };
export { scene, camera, renderer, controls, ambientLight, directionalLight, gameCanvas, minimapCanvas, minimapCtx };

function simIO() {
    return getSimulationIO();
}

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
    // Initialize instanced character renderer (browser only)
    if (scene && typeof window !== 'undefined') {
        window._instancedCharRenderer = simIO().createInstancedCharacterRenderer(scene, 300);
    }
    // Selection ring: a flat circle on the ground that follows the selected character.
    // Uses layer 0 so it's always visible; positioned each frame in animate().
    if (scene && typeof window !== 'undefined') {
        const ringGeo = new THREE.RingGeometry(0.30, 0.42, 32);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0x00ffcc, side: THREE.DoubleSide,
            transparent: true, opacity: 0.82, depthWrite: false
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.visible = false;
        ring.renderOrder = 999;
        scene.add(ring);
        window._selectionRing = ring;
    }
}
export const blockSize = 1;
// Fixed footprint of a single district cell — never changes. `gridSize` is the
// TOTAL world size and grows with districtMode (tiling DISTRICT_CELL_SIZE
// cells together), recomputed in recomputeGridSize()/setDistrictMode().
export const DISTRICT_CELL_SIZE = 16;
export let gridSize = DISTRICT_CELL_SIZE;
export const maxHeight = 10;
export const clock = simIO().createClock();
export const characters = [];
export let worldTime = 0;
export const DAY_DURATION = 120;  // fallback constant (use getDayDuration() at runtime)

// Returns the current day duration in seconds, respecting the sidebar override.
function getDayDuration() {
    return (typeof window !== 'undefined' && window.dayDurationSeconds > 0)
        ? window.dayDurationSeconds : DAY_DURATION;
}
export let nextCharacterId = 0;
export function resetNextCharacterId() { nextCharacterId = 0; }
export function resetFrameTimingAfterVisibilityChange() {
    try {
        if (clock && typeof clock.getDelta === 'function') {
            clock.getDelta();
        }
        if (typeof updateAmbientWorldEffects === 'function') {
            updateAmbientWorldEffects._frameCounter = 0;
        }
    } catch (e) {
        // non-fatal: foreground resume should never break the render loop
    }
}

let DEBUG_MODE = false;
export function setDEBUG_MODE(val) { DEBUG_MODE = val; }
export function getDEBUG_MODE() { return DEBUG_MODE; }

// Resource generation settings (controlled by sliders)
export let treeSpawnRate = 0.35; // 35% chance for trees (increased for more wood)
export let fruitSpawnRate = 0.48; // 48% chance for fruit (supports pop up to ~60)
export let stoneSpawnRate = 0.15; // 15% chance for stone
export let caveSpawnRate = 0.10; // 10% chance for caves
export let leafSpawnRate = 0.70; // 70% chance for leaf generation per position (controls leaf density)

export function setTreeSpawnRate(rate) { treeSpawnRate = Math.max(0, Math.min(1, rate)); }
export function setFruitSpawnRate(rate) { fruitSpawnRate = Math.max(0, Math.min(1, rate)); }
export function setStoneSpawnRate(rate) { stoneSpawnRate = Math.max(0, Math.min(1, rate)); }
export function setCaveSpawnRate(rate) { caveSpawnRate = Math.max(0, Math.min(1, rate)); }
export function setLeafSpawnRate(rate) { leafSpawnRate = Math.max(0, Math.min(1, rate)); }

// ── Decomposition sites: death enriches the ground it happened on ────────────
// Ecology-level feedback loop instead of an individual-level rescue: a death
// temporarily boosts local fruit spawn probability (bacteria -> soil -> nutrients),
// so a die-off can, but is not guaranteed to, help survivors nearby recover. No
// permanent world object is placed — sites are pure data (+ an optional decorative
// ground disc in the browser) so they never consume space in the small world grid,
// and they auto-expire instead of needing manual cleanup.
// Each site: { x, y, z, remaining, duration, mesh }. `remaining` counts down by
// deltaTime every tick in both browser and headless runs (tickFruitRegen doesn't
// advance the shared `worldTime` clock, so sites can't be aged off an absolute
// timestamp — they carry their own countdown instead).
let _decompositionSites = [];
const DECOMP_DECAY_COLOR = new THREE.Color(0x2a1f14);  // dark, freshly-turned soil
const DECOMP_BLOOM_COLOR = new THREE.Color(0x4caf50);  // fertile green payoff

export function addDecompositionSite(x, y, z) {
    const duration = (typeof window !== 'undefined' && window.decompositionDurationSeconds > 0)
        ? window.decompositionDurationSeconds : 90;
    const site = { x, y, z, remaining: duration, duration, mesh: null };
    if (scene) {
        const geo = new THREE.CircleGeometry(0.55, 16);
        const mat = new THREE.MeshBasicMaterial({
            color: DECOMP_DECAY_COLOR.clone(), transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide,
        });
        const disc = new THREE.Mesh(geo, mat);
        disc.rotation.x = -Math.PI / 2;
        // `y` here is the dying character's gridPos.y, which (per
        // Character.updateWorldPosFromGrid) is already the world-y of the ground
        // they're standing on — no extra +1 needed, that was floating the disc a
        // full block above the surface.
        disc.position.set(x + 0.5, y + 0.02, z + 0.5);
        disc.renderOrder = 5;
        scene.add(disc);
        site.mesh = disc;
    }
    _decompositionSites.push(site);
}

// Ages every active site by deltaTime; updates the ground-disc color/opacity in the
// browser (dark decay -> green bloom -> fade out) and removes expired sites. Safe to
// call every tick in both browser and headless contexts (no-ops on the visual part
// when `scene` doesn't exist).
export function updateDecompositionSites(deltaTime) {
    if (_decompositionSites.length === 0) return;
    for (let i = _decompositionSites.length - 1; i >= 0; i--) {
        const site = _decompositionSites[i];
        site.remaining -= deltaTime;
        if (site.mesh) {
            const t = Math.min(1, Math.max(0, 1 - site.remaining / site.duration));
            site.mesh.material.color.copy(DECOMP_DECAY_COLOR).lerp(DECOMP_BLOOM_COLOR, t);
            const fadeIn = Math.min(1, (site.duration - site.remaining) / 3);
            const fadeOut = t > 0.7 ? Math.max(0, 1 - (t - 0.7) / 0.3) : 1;
            site.mesh.material.opacity = 0.7 * fadeIn * fadeOut;
        }
        if (site.remaining <= 0) {
            if (site.mesh) {
                scene.remove(site.mesh);
                site.mesh.geometry.dispose();
                site.mesh.material.dispose();
            }
            _decompositionSites.splice(i, 1);
        }
    }
}

// Fruit-spawn rate multiplier for a tile from the strongest overlapping active
// decomposition site (1 = no boost). Multiple overlapping sites don't stack, to
// avoid runaway rates around a mass-death cluster.
export function getDecompositionFruitBoost(x, z) {
    if (_decompositionSites.length === 0) return 1;
    const radius = (typeof window !== 'undefined' && window.decompositionRadius > 0)
        ? window.decompositionRadius : 2;
    const boostAmount = (typeof window !== 'undefined' && window.decompositionFruitBoost !== undefined)
        ? Number(window.decompositionFruitBoost) : 1.5;
    let best = 1;
    for (const site of _decompositionSites) {
        if (Math.max(Math.abs(x - site.x), Math.abs(z - site.z)) > radius) continue;
        const strength = 1 + boostAmount * Math.max(0, site.remaining / site.duration);
        if (strength > best) best = strength;
    }
    return best;
}

export const DISTRICT_MODE_OPTIONS = Object.freeze([1, 4, 16]);
let districtMode = 1;
let activeDistrictIndex = 0;
let districtSummaryCache = [];
let districtSummaryCacheUpdatedAt = 0;
const blockKeyIndex = new Map();

function normalizeBlockTypeId(blockValue) {
    if (typeof blockValue === 'object' && blockValue !== null && blockValue.id !== undefined) {
        return blockValue.id;
    }
    return blockValue;
}

function indexWorldBlockKey(key, blockValue) {
    const typeId = normalizeBlockTypeId(blockValue);
    if (typeId === undefined || typeId === null) return;
    let keys = blockKeyIndex.get(typeId);
    if (!keys) {
        keys = new Set();
        blockKeyIndex.set(typeId, keys);
    }
    keys.add(key);
}

function deindexWorldBlockKey(key, blockValue) {
    const typeId = normalizeBlockTypeId(blockValue);
    if (typeId === undefined || typeId === null) return;
    const keys = blockKeyIndex.get(typeId);
    if (!keys) return;
    keys.delete(key);
    if (keys.size === 0) {
        blockKeyIndex.delete(typeId);
    }
}

export function forEachWorldKeyOfTypes(typeIds = [], callback) {
    if (typeof callback !== 'function' || !Array.isArray(typeIds) || typeIds.length === 0) return;
    for (const typeId of typeIds) {
        const keys = blockKeyIndex.get(typeId);
        if (!keys || keys.size === 0) continue;
        for (const key of keys) {
            callback(key, typeId);
        }
    }
}

export function resetWorldSpatialIndex() {
    blockKeyIndex.clear();
    districtSummaryCache = [];
    districtSummaryCacheUpdatedAt = 0;
}

function clampDistrictMode(mode) {
    const numeric = Number(mode);
    return DISTRICT_MODE_OPTIONS.includes(numeric) ? numeric : 1;
}

function getDistrictGridSide(mode = districtMode) {
    return Math.max(1, Math.round(Math.sqrt(clampDistrictMode(mode))));
}

// Total world size for a given districtMode — districts tile fixed-size
// DISTRICT_CELL_SIZE cells together, so more districts means a bigger world,
// not a finer subdivision of a fixed-size one.
function getTotalGridSizeForMode(mode = districtMode) {
    return DISTRICT_CELL_SIZE * getDistrictGridSide(mode);
}

function recomputeGridSize() {
    gridSize = getTotalGridSizeForMode(districtMode);
}

function roundDistrictValue(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

function isTelemetryFidelityMode() {
    return typeof window !== 'undefined' && !!window.simTestMode;
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
    return DISTRICT_CELL_SIZE;
}

export function getDistrictIndexForPosition(pos, mode = districtMode) {
    const side = getDistrictGridSide(mode);
    if (side <= 1) return 0;
    const totalSize = getTotalGridSizeForMode(mode);
    const cellSize = DISTRICT_CELL_SIZE;
    const x = Math.max(0, Math.min(totalSize - 1, Math.floor(Number(pos?.x) || 0)));
    const z = Math.max(0, Math.min(totalSize - 1, Math.floor(Number(pos?.z) || 0)));
    const col = Math.max(0, Math.min(side - 1, Math.floor(x / cellSize)));
    const row = Math.max(0, Math.min(side - 1, Math.floor(z / cellSize)));
    return row * side + col;
}

export function getDistrictBounds(index, mode = districtMode) {
    const side = getDistrictGridSide(mode);
    const count = side * side;
    const safeIndex = Math.max(0, Math.min(count - 1, Number(index) || 0));
    const totalSize = getTotalGridSizeForMode(mode);
    const cellSize = DISTRICT_CELL_SIZE;
    const row = Math.floor(safeIndex / side);
    const col = safeIndex % side;
    const minX = Math.floor(col * cellSize);
    const maxX = Math.min(totalSize - 1, Math.floor((col + 1) * cellSize) - 1);
    const minZ = Math.floor(row * cellSize);
    const maxZ = Math.min(totalSize - 1, Math.floor((row + 1) * cellSize) - 1);
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

export function getDistrictRuntimeForPosition(pos) {
    const index = getDistrictIndexForPosition(pos, districtMode);
    const isActive = districtMode === 1 || index === activeDistrictIndex;
    const hiddenUpdateInterval = isTelemetryFidelityMode()
        ? 0.2
        : (districtMode >= 16 ? 1.1 : districtMode >= 4 ? 0.45 : 0.2);
    return {
        mode: districtMode,
        sideLength: getDistrictGridSide(districtMode),
        index,
        activeDistrictIndex,
        isActive,
        shouldRender: isActive || districtMode === 1,
        updateInterval: isActive ? 0 : hiddenUpdateInterval,
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
        uncertaintyLevel: 0,
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
        uncertainty: 0,
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
            const allyAffinityThreshold = (typeof window !== 'undefined' && window.allyAffinityThreshold !== undefined) ? Number(window.allyAffinityThreshold) : 60;
            const supportGroupBonus = (typeof window !== 'undefined' && window.supportGroupBonus !== undefined) ? Number(window.supportGroupBonus) : 0.26;
            const supportAllyPresenceBonus = (typeof window !== 'undefined' && window.supportAllyPresenceBonus !== undefined) ? Number(window.supportAllyPresenceBonus) : 0.22;
            const supportStrength = Math.max(
                Number(networkSnapshot?.supportScore || 0),
                c.groupId ? supportGroupBonus : 0,
                relationshipValues.some(v => v >= allyAffinityThreshold) ? supportAllyPresenceBonus : 0
            );
            sum.supported += clamp01(supportStrength);
            if (c._nearEnemy) sum.conflict += 1;
            const timeStress = ((Math.max(0, 55 - hunger) / 55) + (Math.max(0, 45 - energy) / 45)) / 2;
            sum.timeStress += Math.max(0, Math.min(1, timeStress));
            if (relationshipValues.length > 0) {
                const avgAffinity = relationshipValues.reduce((acc, value) => acc + value, 0) / relationshipValues.length;
                sum.relationshipStability += Math.max(0, Math.min(1, avgAffinity / 100));
            }
            const uncertaintyShock = Number(c._uncertaintyShock || 0);
            const localVolatility = Math.max(0, Math.min(1,
                (Math.max(0, 45 - energy) / 45) * 0.12 +
                (!c.homePosition ? 0.10 : 0) +
                (!c.groupId ? 0.08 : 0) +
                ((1 - clamp01(supportStrength)) * 0.12) +
                (c._nearEnemy ? 0.16 : 0) +
                (uncertaintyShock * 0.18)
            ));
            sum.uncertainty += localVolatility;
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
        const uncertaintyLevel = roundDistrictValue(Math.max(0, Math.min(1,
            (sum.uncertainty / n) +
            (Math.abs(bucket.migrationIn - bucket.migrationOut) / Math.max(1, n * 2)) * 0.18
        )));
        const socialPressureFoodWeight = (typeof window !== 'undefined' && window.socialPressureFoodWeight !== undefined) ? Number(window.socialPressureFoodWeight) : 0.24;
        const socialPressureHousingWeight = (typeof window !== 'undefined' && window.socialPressureHousingWeight !== undefined) ? Number(window.socialPressureHousingWeight) : 0.26;
        const socialPressureTimeWeight = (typeof window !== 'undefined' && window.socialPressureTimeWeight !== undefined) ? Number(window.socialPressureTimeWeight) : 0.18;
        const socialPressureSupportWeight = (typeof window !== 'undefined' && window.socialPressureSupportWeight !== undefined) ? Number(window.socialPressureSupportWeight) : 0.10;
        const socialPressureStabilityWeight = (typeof window !== 'undefined' && window.socialPressureStabilityWeight !== undefined) ? Number(window.socialPressureStabilityWeight) : 0.08;
        const socialPressureConflictWeight = (typeof window !== 'undefined' && window.socialPressureConflictWeight !== undefined) ? Number(window.socialPressureConflictWeight) : 0.09;
        const socialPressureUncertaintyWeight = (typeof window !== 'undefined' && window.socialPressureUncertaintyWeight !== undefined) ? Number(window.socialPressureUncertaintyWeight) : 0.05;
        const socialPressure = roundDistrictValue(Math.max(0, Math.min(1,
            (foodPressure * socialPressureFoodWeight) +
            (housingPressure * socialPressureHousingWeight) +
            (timeStress * socialPressureTimeWeight) +
            ((1 - supportAccess) * socialPressureSupportWeight) +
            ((1 - relationshipStability) * socialPressureStabilityWeight) +
            (conflictLevel * socialPressureConflictWeight) +
            (uncertaintyLevel * socialPressureUncertaintyWeight)
        )));
        const populationBalance = roundDistrictValue(Math.max(0, Math.min(1,
            1 - (Math.abs(bucket.population - targetPopulationPerDistrict) / Math.max(1, targetPopulationPerDistrict * 1.5))
        )));
        const opportunityPressureWeight = (typeof window !== 'undefined' && window.opportunityPressureWeight !== undefined) ? Number(window.opportunityPressureWeight) : 0.36;
        const opportunitySupportWeight = (typeof window !== 'undefined' && window.opportunitySupportWeight !== undefined) ? Number(window.opportunitySupportWeight) : 0.22;
        const opportunityStabilityWeight = (typeof window !== 'undefined' && window.opportunityStabilityWeight !== undefined) ? Number(window.opportunityStabilityWeight) : 0.16;
        const opportunityConflictWeight = (typeof window !== 'undefined' && window.opportunityConflictWeight !== undefined) ? Number(window.opportunityConflictWeight) : 0.10;
        const opportunityPopulationWeight = (typeof window !== 'undefined' && window.opportunityPopulationWeight !== undefined) ? Number(window.opportunityPopulationWeight) : 0.10;
        const opportunityFoodWeight = (typeof window !== 'undefined' && window.opportunityFoodWeight !== undefined) ? Number(window.opportunityFoodWeight) : 0.06;
        const opportunityScore = roundDistrictValue(Math.max(0, Math.min(1,
            ((1 - socialPressure) * opportunityPressureWeight) +
            (supportAccess * opportunitySupportWeight) +
            (relationshipStability * opportunityStabilityWeight) +
            ((1 - conflictLevel) * opportunityConflictWeight) +
            (populationBalance * opportunityPopulationWeight) +
            ((1 - foodPressure) * opportunityFoodWeight) -
            (uncertaintyLevel * 0.08)
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
            uncertaintyLevel,
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
        conflictLevel: 0,
        uncertaintyLevel: 0,
        socialPressure: 0,
        opportunityScore: 0.5
    };
}

export function refreshDistrictSummaryCache(sourceChars = characters, { force = false } = {}) {
    const now = Date.now();
    const popSize = Array.isArray(sourceChars) ? sourceChars.length : 0;
    const minRefreshMs = districtMode >= 16
        ? 1200
        : districtMode >= 4
            ? (popSize > 64 ? 900 : 600)
            : (popSize > 80 ? 1400 : popSize > 48 ? 900 : 250);
    if (!force && districtSummaryCache.length > 0 && (now - districtSummaryCacheUpdatedAt) < minRefreshMs) {
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

export function focusCameraOnActiveDistrict() {
    if (!controls || !camera) return;
    const bounds = getDistrictBounds(activeDistrictIndex, districtMode);
    const desiredTarget = new THREE.Vector3(bounds.centerX, 2, bounds.centerZ);
    const offset = camera.position.clone().sub(controls.target);
    const desiredDistance = Math.min(Math.max(offset.length(), 12), Math.max(20, DISTRICT_CELL_SIZE * 1.4));
    const desiredOffset = offset.length() > 0.001
        ? offset.clone().setLength(desiredDistance)
        : new THREE.Vector3(DISTRICT_CELL_SIZE * 0.7, DISTRICT_CELL_SIZE * 0.65, DISTRICT_CELL_SIZE * 0.7);
    const desiredCameraPos = desiredTarget.clone().add(desiredOffset);
    const startTarget = controls.target.clone();
    const startPos = camera.position.clone();
    const startedAt = performance.now();
    const duration = 280;
    if (window.__focusCharacterAnim) cancelAnimationFrame(window.__focusCharacterAnim);
    function step(now) {
        const t = Math.min(1, (now - startedAt) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        controls.target.lerpVectors(startTarget, desiredTarget, eased);
        camera.position.lerpVectors(startPos, desiredCameraPos, eased);
        controls.update();
        if (t < 1) window.__focusCharacterAnim = requestAnimationFrame(step);
    }
    window.__focusCharacterAnim = requestAnimationFrame(step);
}

function getPreferredCameraFocusTarget() {
    const bounds = getDistrictBounds(activeDistrictIndex, districtMode);
    const fallback = new THREE.Vector3(bounds.centerX, 2, bounds.centerZ);
    if (typeof window === 'undefined') return fallback;
    const selectedId = (window.selectedCharacterId !== undefined && window.selectedCharacterId !== null)
        ? String(window.selectedCharacterId)
        : '';
    if (!selectedId || !Array.isArray(characters)) return fallback;
    const selected = characters.find(char => String(char?.id) === selectedId && char?.state !== 'dead' && char?.mesh?.position);
    if (!selected?.mesh?.position) return fallback;
    const pos = selected.mesh.position;
    return new THREE.Vector3(pos.x, Math.max(1.5, pos.y + 1.2), pos.z);
}

export function stabilizeCameraAfterVisibilityChange() {
    if (!camera || !controls) return false;
    const desiredTarget = getPreferredCameraFocusTarget();
    const validTarget = controls.target
        && Number.isFinite(controls.target.x)
        && Number.isFinite(controls.target.y)
        && Number.isFinite(controls.target.z);
    const currentTarget = validTarget ? controls.target.clone() : desiredTarget.clone();
    let offset = (camera.position
        && Number.isFinite(camera.position.x)
        && Number.isFinite(camera.position.y)
        && Number.isFinite(camera.position.z))
        ? camera.position.clone().sub(currentTarget)
        : new THREE.Vector3(DISTRICT_CELL_SIZE * 0.7, DISTRICT_CELL_SIZE * 0.65, DISTRICT_CELL_SIZE * 0.7);
    if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y) || !Number.isFinite(offset.z) || offset.lengthSq() < 0.001) {
        offset = new THREE.Vector3(DISTRICT_CELL_SIZE * 0.7, DISTRICT_CELL_SIZE * 0.65, DISTRICT_CELL_SIZE * 0.7);
    }
    offset.clampLength(6, Math.max(14, DISTRICT_CELL_SIZE * 1.8));
    controls.target.copy(desiredTarget);
    camera.position.copy(desiredTarget.clone().add(offset));
    camera.lookAt(controls.target);
    if (typeof controls.update === 'function') controls.update();
    return true;
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
    // Debug: verify mesh cost stays scoped to one district regardless of total world size.
    window.__visualBlocksCount = () => visualBlocks.size;
    window.__worldDataCount = () => worldData.size;
    try {
        window.dispatchEvent(new CustomEvent('district-changed', { detail: getDistrictState() }));
    } catch (err) {
        // ignore event dispatch issues in non-browser contexts
    }
}

export function applyDistrictVisualization() {
    drawMinimap();
}

// Builds Three.js visuals for every worldData block in a district that
// doesn't already have one — i.e. "loads" a district's meshes from the
// always-resident block-data layer.
export function activateDistrict(index, mode = districtMode) {
    const bounds = getDistrictBounds(index, mode);
    const blockTypeById = new Map(Object.values(BLOCK_TYPES).map(t => [t.id, t]));
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
        for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
            for (let y = 0; y < maxHeight; y++) {
                const key = `${x},${y},${z}`;
                if (visualBlocks.has(key)) continue;
                const blockValue = worldData.get(key);
                if (blockValue === undefined) continue;
                const typeId = normalizeBlockTypeId(blockValue);
                if (typeId === undefined || typeId === BLOCK_TYPES.AIR.id) continue;
                const type = blockTypeById.get(typeId);
                if (!type) continue;
                buildAndRegisterBlockVisual(key, x, y, z, type);
            }
        }
    }
}

// Disposes Three.js visuals for a district's blocks — worldData (the
// persisted block-type layer) is left untouched, so re-activating the same
// district later reconstructs identical state, including any edits made
// while it was active.
export function deactivateDistrict(index, mode = districtMode) {
    const bounds = getDistrictBounds(index, mode);
    const io = simIO();
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
        for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
            for (let y = 0; y < maxHeight; y++) {
                const key = `${x},${y},${z}`;
                const block = visualBlocks.get(key);
                if (!block) continue;
                io.removeVisual(scene, block);
                visualBlocks.delete(key);
            }
        }
    }
}

export function setDistrictMode(mode = 1) {
    const requestedMode = clampDistrictMode(mode);
    const isShrink = requestedMode < districtMode;
    if (isShrink) {
        // Shrinking in place would leave worldData/visualBlocks outside the
        // new (smaller) bounds as orphaned, unreachable leftovers. Safe fix:
        // since this can only be reached pre-Start (the sidebar disables the
        // mode buttons once a simulation is actually running, and Start's own
        // setDistrictMode call just replays whatever mode was already chosen
        // pre-Start) there's no live population to strand — treat a shrink as
        // a fresh start at the smaller size instead of rejecting it outright.
        worldData.clear();
        resetWorldSpatialIndex();
        const io = simIO();
        for (const block of visualBlocks.values()) {
            io.removeVisual(scene, block);
        }
        visualBlocks.clear();
        lastGeneratedGridSize = 0;
    }
    const previousMode = districtMode;
    districtMode = requestedMode;
    recomputeGridSize();
    activeDistrictIndex = Math.max(0, Math.min(getDistrictCount(districtMode) - 1, Number(activeDistrictIndex) || 0));
    if (districtMode === 1) activeDistrictIndex = 0;
    districtSummaryCache = [];
    districtSummaryCacheUpdatedAt = 0;

    // Backfill worldData for any newly-exposed territory (growth) or fully
    // regenerate (shrink, worldData was just cleared above). Cheap either
    // way — Map writes only, gated by isGridPositionInActiveDistrict inside
    // addBlock so mesh cost stays proportional to one district.
    generateTerrain();

    if (previousMode !== districtMode) {
        // Total world footprint changed — old visualBlocks no longer
        // correspond to the same district bounds. Drop everything and
        // rebuild only the active district from worldData.
        const io = simIO();
        for (const block of visualBlocks.values()) {
            io.removeVisual(scene, block);
        }
        visualBlocks.clear();
        activateDistrict(activeDistrictIndex, districtMode);
        // A district's bounds shift when the world is tiled bigger (even for
        // the "same" activeDistrictIndex, e.g. index 0 goes from being the
        // whole 16x16 world to just its top-left cell) — without this the
        // camera stays wherever it was, looking at empty space where the old
        // district used to be.
        focusCameraOnActiveDistrict();
        if (animate._birds) {
            const _b = getDistrictBounds(activeDistrictIndex, districtMode);
            animate._birds.recenter(_b.centerX, _b.centerZ);
        }
    }

    applyDistrictVisualization();
    emitDistrictChange();
    return getDistrictState();
}

export function setActiveDistrict(index = 0) {
    const requestedIndex = Math.max(0, Math.min(getDistrictCount(districtMode) - 1, Number(index) || 0));
    const resolvedIndex = districtMode === 1 ? 0 : requestedIndex;
    if (resolvedIndex !== activeDistrictIndex) {
        deactivateDistrict(activeDistrictIndex, districtMode);
        activeDistrictIndex = resolvedIndex;
        activateDistrict(activeDistrictIndex, districtMode);
        // Districts are physically separate cells now (not just a highlighted
        // sub-region of one shared small world) — the camera must actually
        // travel to the newly-active district, not stay put.
        focusCameraOnActiveDistrict();
        if (animate._birds) {
            const _b = getDistrictBounds(activeDistrictIndex, districtMode);
            animate._birds.recenter(_b.centerX, _b.centerZ);
        }
    } else {
        activeDistrictIndex = resolvedIndex;
    }
    districtSummaryCacheUpdatedAt = 0;
    applyDistrictVisualization();
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
    GRASS: { id: 1, name: 'Grass', color: 0x4CAF50, diggable: true, isGrassBlock: true },
    DIRT:  { id: 2, name: 'Dirt', color: 0x966c4a, diggable: true, isDirtBlock: true },
    STONE: { id: 3, name: 'Stone', color: 0x888888, diggable: true, isStoneBlock: true },
    FRUIT: { id: 4, name: 'Fruit', color: 0xff4500, isEdible: true, foodValue: 50, drops: 'FRUIT_ITEM', isFruitBlock: true },
    WOOD:  { id: 5, name: 'Wood', color: 0x8b5a2b, diggable: true, drops: 'WOOD_LOG', isWoodBlock: true },
    LEAF:  { id: 6, name: 'Leaf', color: 0x228b22, diggable: true, isLeafBlock: true },
    BED:   { id: 7, name: 'Charge Stone', color: 0x7b4fcf, isBed: true, isBedBlock: true, isChargeStone: true },
    HOUSE_WALL: { id: 8, name: 'House Wall', color: 0xd8c39a, isHouseWall: true },
    HOUSE_ROOF: { id: 9, name: 'House Roof', color: 0x6b4a2f, isHouseRoof: true },
    STONE_WALL: { id: 10, name: 'Stone Wall', color: 0x7b8a94, isHouseWall: true, isStoneWall: true },
    DARK_ROOF:  { id: 11, name: 'Dark Roof',  color: 0x46515e, isHouseRoof: true, isDarkRoof: true }
};
export const ITEM_TYPES = {
    WOOD_LOG: { id: 100, name: 'Log', material: null },
    FRUIT_ITEM: { id: 101, name: 'Fruit Item', material: null, isStorable: true },
    STONE_TOOL: { id: 102, name: 'Stone Tool', material: null, isTool: true }
};
export const blockMaterials = new Map();
export let edgeMaterial = null;

const ambientHouseEffects = new Map();
const AMBIENT_SMOKE_LIMIT = 14;

function areAmbientEffectsEnabled() {
    return !(typeof window !== 'undefined' && window.showEffects === false);
}

function hashWorldKey(key = '') {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = ((hash << 5) - hash) + key.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

function resetAmbientBlock(block) {
    if (!block?.userData?.ambientBasePos) return;
    const base = block.userData.ambientBasePos;
    block.position?.set?.(base.x, base.y, base.z);
    if (block.rotation) {
        block.rotation.x = block.userData.ambientBaseRotX || 0;
        block.rotation.y = block.userData.ambientBaseRotY || 0;
        block.rotation.z = block.userData.ambientBaseRotZ || 0;
    }
}

function disposeAmbientHouseEffect(effect) {
    if (!effect) return;
    try { scene?.remove?.(effect.group); } catch (_) { /* ignore */ }
    for (const puff of effect.puffs || []) {
        try { puff.geometry?.dispose?.(); } catch (_) { /* ignore */ }
        try { puff.material?.dispose?.(); } catch (_) { /* ignore */ }
    }
}

function ensureHouseSmokeEffect(key, block) {
    if (!scene || !block || ambientHouseEffects.has(key)) return ambientHouseEffects.get(key) || null;
    const group = new THREE.Group();
    group.visible = false;
    const puffs = [];
    for (let i = 0; i < 3; i++) {
        const puff = new THREE.Mesh(
            new THREE.SphereGeometry(0.09 + (i * 0.03), 6, 6),
            new THREE.MeshBasicMaterial({ color: 0xe5e7eb, transparent: true, opacity: 0, depthWrite: false })
        );
        group.add(puff);
        puffs.push(puff);
    }
    scene.add(group);
    const effect = {
        group,
        puffs,
        phase: (hashWorldKey(key) % 360) * (Math.PI / 180)
    };
    ambientHouseEffects.set(key, effect);
    return effect;
}

function updateAmbientWorldEffects() {
    const enabled = areAmbientEffectsEnabled();
    const popSize = Array.isArray(characters) ? characters.length : 0;
    // Ambient motion is observation polish, not gameplay-critical simulation.
    // Throttle it modestly in larger scenes to keep camera interaction responsive.
    const frameStride = enabled
        ? (popSize > 90 ? 8 : popSize > 64 ? 6 : popSize > 48 ? 4 : popSize > 24 ? 2 : 1)
        : 1;
    updateAmbientWorldEffects._frameCounter = (updateAmbientWorldEffects._frameCounter || 0) + 1;
    const wasEnabled = updateAmbientWorldEffects._lastEnabled !== false;
    updateAmbientWorldEffects._lastEnabled = enabled;
    if (!enabled && !wasEnabled) return;
    if (enabled && frameStride > 1 && (updateAmbientWorldEffects._frameCounter % frameStride) !== 0) {
        return;
    }

    const time = Number(worldTime) || 0;
    const _DD = getDayDuration();
    const dayPhase = (time % _DD) / _DD;
    const isNight = dayPhase > 0.5;
    const nightBlend = isNight ? (0.45 + 0.55 * Math.sin((dayPhase - 0.5) * Math.PI)) : 0;
    const warmIntensity = enabled ? nightBlend * (0.1 + 0.06 * (0.5 + 0.5 * Math.sin(time * 2.1))) : 0;

    for (const blockType of [BLOCK_TYPES.HOUSE_WALL, BLOCK_TYPES.STONE_WALL]) {
        const material = blockMaterials.get(blockType.id);
        if (!material) continue;
        if (!material.emissive) material.emissive = simIO().createColor(0xffb36b);
        if (typeof material.emissive.set === 'function') material.emissive.set(0xffb36b);
        material.emissiveIntensity = warmIntensity;
    }
    for (const roofType of [BLOCK_TYPES.HOUSE_ROOF, BLOCK_TYPES.DARK_ROOF]) {
        const material = blockMaterials.get(roofType.id);
        if (!material) continue;
        material.emissiveIntensity = 0;
    }

    let smokeCount = 0;
    const smokeLimit = enabled ? (popSize > 72 ? 4 : popSize > 48 ? 6 : AMBIENT_SMOKE_LIMIT) : 0;
    const staleKeys = new Set(ambientHouseEffects.keys());

    for (const [key, block] of visualBlocks.entries()) {
        staleKeys.delete(key);
        if (!block?.position) continue;
        if (!block.userData) block.userData = {};
        const blockId = worldData.get(key);

        if (blockId === BLOCK_TYPES.LEAF.id) {
            if (!block.userData.ambientBasePos) {
                block.userData.ambientBasePos = { x: block.position.x, y: block.position.y, z: block.position.z };
                block.userData.ambientBaseRotX = block.rotation?.x || 0;
                block.userData.ambientBaseRotY = block.rotation?.y || 0;
                block.userData.ambientBaseRotZ = block.rotation?.z || 0;
                block.userData.ambientSeed = (hashWorldKey(key) % 1000) / 1000;
                block.userData.ambientLeaf = true;
            }
            if (enabled && block.visible !== false) {
                const seed = (block.userData.ambientSeed || 0) * Math.PI * 2;
                const sway = Math.sin(time * 1.25 + seed) * 0.035;
                block.position.x = block.userData.ambientBasePos.x + sway;
                block.position.z = block.userData.ambientBasePos.z + Math.cos(time * 0.9 + seed) * 0.025;
                if (block.rotation) block.rotation.z = block.userData.ambientBaseRotZ + sway * 0.6;
            } else {
                resetAmbientBlock(block);
            }
            // Autumn foliage overlay: visible only in Autumn (golden tint, not fruit)
            if (block.userData.fruitOverlay) {
                const _sn = (typeof window !== 'undefined' && window.currentSeasonInfo)
                    ? window.currentSeasonInfo.name : '';
                block.userData.fruitOverlay.visible =
                    _sn === 'Autumn' && block.visible !== false;
            }
            continue;
        }

        if (block.userData.ambientLeaf) resetAmbientBlock(block);

        const isRoof = blockId === BLOCK_TYPES.HOUSE_ROOF.id || blockId === BLOCK_TYPES.DARK_ROOF.id;
        const eligibleForSmoke = enabled && isRoof && block.visible !== false && smokeCount < smokeLimit && (hashWorldKey(key) % 3 === 0);
        const effect = eligibleForSmoke ? ensureHouseSmokeEffect(key, block) : ambientHouseEffects.get(key);
        if (!effect) continue;
        if (!eligibleForSmoke) {
            effect.group.visible = false;
            continue;
        }

        smokeCount += 1;
        effect.group.visible = true;
        effect.group.position.set(
            block.position.x + 0.03 * Math.sin(time * 0.8 + effect.phase),
            block.position.y + 0.28,
            block.position.z + 0.03 * Math.cos(time * 0.7 + effect.phase)
        );

        effect.puffs.forEach((puff, index) => {
            const drift = time * 0.55 + effect.phase + index * 0.45;
            const rise = (drift % 1.6) / 1.6;
            puff.position.set(
                Math.sin(drift * 1.7) * 0.045,
                0.08 + rise * 0.55 + index * 0.05,
                Math.cos(drift * 1.3) * 0.045
            );
            puff.scale.setScalar(0.8 + rise * 0.55);
            if (puff.material) puff.material.opacity = enabled ? Math.max(0, 0.09 * (1 - rise)) : 0;
        });
    }

    for (const key of staleKeys) {
        disposeAmbientHouseEffect(ambientHouseEffects.get(key));
        ambientHouseEffects.delete(key);
    }
}

export function refreshRenderResources() {
    const io = simIO();
    ITEM_TYPES.WOOD_LOG.material = io.createMaterial({ color: BLOCK_TYPES.WOOD.color });
    ITEM_TYPES.FRUIT_ITEM.material = io.createMaterial({ color: BLOCK_TYPES.FRUIT.color });
    ITEM_TYPES.STONE_TOOL.material = io.createMaterial({ color: 0x888888 });
    blockMaterials.clear();
    Object.values(BLOCK_TYPES).forEach(type => {
        if (type.color) {
            blockMaterials.set(type.id, io.createMaterial({ color: type.color }));
        }
    });
    edgeMaterial = io.createEdgeMaterial({ color: 0x000000, transparent: true, opacity: 0.3 });
}

refreshRenderResources();

// ── Visual rebuild: recreate all block meshes (e.g. after voxelDetailMode toggle) ──────────
// Iterates every key in visualBlocks, removes the old mesh from the scene,
// calls createBlockVisual with the stored worldData type, and re-inserts.
// worldData is NOT touched — only the Three.js side is rebuilt.
export function rebuildAllBlockVisuals() {
    const io = simIO();
    const blockTypeById = new Map(Object.values(BLOCK_TYPES).map(t => [t.id, t]));

    for (const [key, oldBlock] of visualBlocks.entries()) {
        const blockId = worldData.get(key);
        if (blockId === undefined || blockId === BLOCK_TYPES.AIR.id) continue;

        // Remove old visual
        io.removeVisual(scene, oldBlock);

        const type = blockTypeById.get(typeof blockId === 'object' ? blockId.id : blockId);
        if (!type) { visualBlocks.delete(key); continue; }

        const [xStr, yStr, zStr] = key.split(',');
        const x = Number(xStr), y = Number(yStr), z = Number(zStr);
        const material = blockMaterials.get(type.id);

        // visualBlocks only ever holds active-district entries now, so this
        // rebuild (triggered by the Voxel Detail toggle) never touches
        // inactive-district blocks — always visible.
        const newBlock = io.createBlockVisual({
            x, y, z, type, blockSize, material, edgeMaterial,
            isVisible: true,
            hasBlock: (bx, by, bz) => worldData.has(`${bx},${by},${bz}`),
        });

        if (newBlock) {
            if (!newBlock.userData) newBlock.userData = {};
            newBlock.userData.worldKey = key;
            newBlock.userData.blockTypeId = type.id;
            visualBlocks.set(key, newBlock);
            scene?.add?.(newBlock);
        } else {
            visualBlocks.delete(key);
        }
    }
}

// Places decorative campfires near the housing cluster (not worldData blocks).
// Pre-places up to maxCampfireSpots spots; animate() shows only as many as
// the current population warrants (1 per charsPerCampfire alive chars).
function placeCampfires() {
    const MAX_CAMPFIRE_SPOTS   = (typeof window !== 'undefined' && window.maxCampfireSpots !== undefined) ? Number(window.maxCampfireSpots) : 4;     // absolute ceiling
    const MIN_CAMPFIRE_SPACING = (typeof window !== 'undefined' && window.minCampfireSpacing !== undefined) ? Number(window.minCampfireSpacing) : 3; // minimum grid-unit separation between fires
    // Clean up any previous campfires (world regeneration)
    for (const cf of campfireObjects) {
        scene?.remove?.(cf);
        cf.traverse(o => { try { o.geometry?.dispose?.(); o.material?.dispose?.(); } catch (_) {} });
    }
    campfireObjects = [];
    animate._campfireActive = false;
    animate._campfireCount  = 0;
    animate._campfireAliveTimer = 0;
    if (!scene) return;

    // ── Helpers ────────────────────────────────────────────────────────────────
    const GROUND_IDS = new Set([BLOCK_TYPES.GRASS.id, BLOCK_TYPES.DIRT.id]);
    function findSolidGround(x, z) {
        for (let y = maxHeight - 1; y >= 0; y--) {
            const id = worldData.get(`${x},${y},${z}`);
            if (id !== undefined && GROUND_IDS.has(id)) return y;
        }
        return -1;
    }

    // ── Search origin: centroid of HOUSE_WALL blocks (village centre) ──────────
    let hx = 0, hz = 0, hCount = 0;
    for (const [key, id] of worldData) {
        if (id !== BLOCK_TYPES.HOUSE_WALL.id) continue;
        const parts = key.split(',');
        hx += Number(parts[0]);
        hz += Number(parts[2]);
        hCount++;
    }
    const cx = hCount > 0 ? Math.round(hx / hCount) : Math.floor(gridSize / 2);
    const cz = hCount > 0 ? Math.round(hz / hCount) : Math.floor(gridSize / 2);

    // ── Spiral candidate list (radius 0..10) ──────────────────────────────────
    const offsets = [];
    for (let r = 0; r <= 10; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) === r) offsets.push([dx, dz]);
            }
        }
    }

    // ── Placement: GRASS/DIRT, flat, 2-block clearance, min spacing ──────────
    const CARDINALS = [[1,0],[-1,0],[0,1],[0,-1]];
    const placed = [];  // [{x, z}] for spacing check
    for (const [dx, dz] of offsets) {
        if (placed.length >= MAX_CAMPFIRE_SPOTS) break;
        const x = cx + dx, z = cz + dz;
        if (x < 1 || x >= gridSize - 1 || z < 1 || z >= gridSize - 1) continue;

        const gy = findSolidGround(x, z);
        if (gy < 0) continue;
        if (worldData.has(`${x},${gy + 1},${z}`)) continue;
        if (worldData.has(`${x},${gy + 2},${z}`)) continue;

        const isFlat = CARDINALS.every(([ndx, ndz]) => {
            const ng = findSolidGround(x + ndx, z + ndz);
            return ng >= 0 && Math.abs(ng - gy) <= 1;
        });
        if (!isFlat) continue;

        // Minimum spacing from already-placed fires
        const tooClose = placed.some(p => Math.abs(p.x - x) < MIN_CAMPFIRE_SPACING && Math.abs(p.z - z) < MIN_CAMPFIRE_SPACING);
        if (tooClose) continue;

        const cf = buildCampfireGroup(placed.length * 2.1);
        cf.position.set(x + 0.5, gy + 1.0, z + 0.5);
        cf.userData.gridPos = { x, y: gy, z };  // used for district visibility
        cf.visible = false;  // animate() controls visibility
        scene.add(cf);
        campfireObjects.push(cf);
        placed.push({ x, z });
    }
}

// ── Village well: single permanent decoration near the housing cluster ────────
function placeVillageWell() {
    // Remove previous well (world regeneration)
    if (wellObject) {
        scene?.remove?.(wellObject);
        wellObject.traverse(o => {
            try { o.geometry?.dispose?.(); } catch (_) { /* ignore */ }
            try { o.material?.dispose?.(); } catch (_) { /* ignore */ }
        });
        wellObject = null;
    }
    if (!scene) return;

    // Find village centroid from HOUSE_WALL blocks
    let hx = 0, hz = 0, hCount = 0;
    for (const [key, id] of worldData) {
        if (id !== BLOCK_TYPES.HOUSE_WALL.id) continue;
        const parts = key.split(',');
        hx += Number(parts[0]);
        hz += Number(parts[2]);
        hCount++;
    }
    if (hCount === 0) return;
    const cx = Math.round(hx / hCount);
    const cz = Math.round(hz / hCount);

    // Spiral search for a flat, clear spot near the centre (radius ≤ 8)
    const offsets = [];
    for (let r = 1; r <= 8; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) === r) offsets.push([dx, dz]);
            }
        }
    }

    for (const [dx, dz] of offsets) {
        const wx = cx + dx, wz = cz + dz;
        if (wx < 1 || wx >= gridSize - 1 || wz < 1 || wz >= gridSize - 1) continue;
        const gy = findSolidGround(wx, wz);
        if (gy < 0) continue;
        if (worldData.has(`${wx},${gy + 1},${wz}`)) continue;  // something occupies the space

        // Needs at least 2 blocks of air above ground
        if (worldData.has(`${wx},${gy + 2},${wz}`)) continue;

        // Must be reasonably flat (neighbours ≤1 block difference)
        const flat = [[1,0],[-1,0],[0,1],[0,-1]].every(([ndx, ndz]) => {
            const ng = findSolidGround(wx + ndx, wz + ndz);
            return ng >= 0 && Math.abs(ng - gy) <= 1;
        });
        if (!flat) continue;

        // Min distance from campfires
        const tooClose = campfireObjects.some(cf =>
            cf.userData.gridPos &&
            Math.abs(cf.userData.gridPos.x - wx) < 2 &&
            Math.abs(cf.userData.gridPos.z - wz) < 2
        );
        if (tooClose) continue;

        const well = buildWellGroup(dx * 7 + dz * 3);
        well.position.set(wx + 0.5, gy + 1.0, wz + 0.5);
        well.userData.gridPos = { x: wx, y: gy, z: wz };
        scene.add(well);
        wellObject = well;
        break;
    }
}

// ── Special entity: create & hide; animate() controls visibility + roaming ────────
function placeSpecialEntities() {
    for (const e of Object.values(specialEntities)) {
        if (!e) continue;
        scene?.remove?.(e);
        e.traverse(o => { try { o.geometry?.dispose?.(); o.material?.dispose?.(); } catch (_) {} });
    }
    specialEntities = { angel: null, reaper: null };
    animate._specialTimer = 0;
    animate._childCount   = 0;
    animate._elderCount   = 0;
    if (!scene) return;

    // Anchor to the active district's center, not the raw (possibly
    // world-spanning) grid midpoint — keeps the angel/reaper near wherever
    // the village actually is instead of the middle of the whole world.
    const activeBounds = getDistrictBounds(activeDistrictIndex, districtMode);
    const midX = activeBounds.centerX;
    const midZ = activeBounds.centerZ;
    const angel = buildAngelGroup();
    angel.position.set(midX + 0.5, 4, midZ + 3.5);
    angel.visible = false;
    scene.add(angel);
    specialEntities.angel = angel;

    const reaper = buildReaperGroup();
    reaper.position.set(midX - 2.5, 4, midZ + 0.5);
    reaper.visible = false;
    scene.add(reaper);
    specialEntities.reaper = reaper;
}

// Module-scope helper called each frame for each special entity.
// Handles show/hide, wandering, hover-height, and custom animation.
function _updateSpecialEntity(entity, shouldShow, dt) {
    if (!entity) return;
    entity.visible = shouldShow;
    if (!shouldShow) return;

    const roam = entity.userData.roam;
    const px = entity.position.x;
    const pz = entity.position.z;
    const dx = roam.tx + 0.5 - px;
    const dz = roam.tz + 0.5 - pz;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 0.5) {
        // Arrived — pick a new random target within the active district only
        // (not the whole, possibly much larger, world).
        const bounds = getDistrictBounds(activeDistrictIndex, districtMode);
        const spanX = Math.max(1, bounds.maxX - bounds.minX - 3);
        const spanZ = Math.max(1, bounds.maxZ - bounds.minZ - 3);
        roam.tx = bounds.minX + 2 + Math.random() * spanX;
        roam.tz = bounds.minZ + 2 + Math.random() * spanZ;
    } else {
        const spd = roam.speed * dt;
        entity.position.x += (dx / dist) * spd;
        entity.position.z += (dz / dist) * spd;
        // Face the direction of travel (both models are built facing +Z)
        entity.rotation.y = Math.atan2(dx, dz);
    }

    // Hover: float above the ground tile directly below
    const gx = Math.max(0, Math.min(gridSize - 1, Math.floor(entity.position.x)));
    const gz = Math.max(0, Math.min(gridSize - 1, Math.floor(entity.position.z)));
    const gy = findGroundY(gx, gz);
    const baseY  = (gy >= 0 ? gy : 3) + 1.6;
    const floatY = baseY + Math.sin(worldTime * 1.5 + roam.phase) * 0.20;
    entity.position.y += (floatY - entity.position.y) * Math.min(1.0, dt * 3.0);

    if (entity.userData.updateAnim) entity.userData.updateAnim(worldTime);
}

let lastGeneratedGridSize = 0;
export function generateTerrain() {
    // Safe to call again after gridSize grows (district-mode change): columns
    // that already have terrain are skipped entirely, so existing terrain —
    // including any digging/building characters already did — is untouched,
    // and only the newly-exposed territory gets generated. A fully-cleared
    // worldData (e.g. regenerateWorld()) always counts as "growing" so
    // decorations get freshly placed even when gridSize itself is unchanged.
    const isGrowingPass = worldData.size === 0 || gridSize > lastGeneratedGridSize;
    PerlinNoise.seed(Math.random);
    const terrainScale = 12;
    const pathRows = [Math.floor(gridSize/3), Math.floor(gridSize*2/3)];
    const pathCols = [Math.floor(gridSize/3), Math.floor(gridSize*2/3)];
    for (let x = 0; x < gridSize; x++) { for (let z = 0; z < gridSize; z++) {
        if (worldData.has(`${x},0,${z}`)) continue;
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
                    indexWorldBlockKey(key, BLOCK_TYPES.AIR.id);
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
    // Only re-roll decoration placement when the world actually grew — not on
    // every setDistrictMode()/generateTerrain() call (including re-selecting
    // the same mode), which would otherwise relocate campfires/well/entities
    // for no reason.
    if (isGrowingPass) {
        placeCampfires();
        placeVillageWell();
        placeSpecialEntities();
    }
    lastGeneratedGridSize = gridSize;
}
// Builds and registers a block's Three.js visual. Only ever called for blocks
// already known to be in the active district (see addBlock/activateDistrict),
// so isVisible is unconditionally true here — inactive-district blocks simply
// never get a visual at all, rather than getting one and hiding it.
function buildAndRegisterBlockVisual(key, x, y, z, type) {
    const material = blockMaterials.get(type.id);
    const block = simIO().createBlockVisual({
        x,
        y,
        z,
        type,
        blockSize,
        material,
        edgeMaterial,
        isVisible: true,
        hasBlock: (bx, by, bz) => worldData.has(`${bx},${by},${bz}`),
    });

    if (block) {
        if (!block.userData) block.userData = {};
        block.userData.worldKey = key;
        block.userData.blockTypeId = type.id;
        visualBlocks.set(key, block);
        scene?.add?.(block);
    }
    return block;
}

export function addBlock(x, y, z, type, updateMinimap = true) {
    const key = `${x},${y},${z}`;
    if (worldData.has(key) || y >= maxHeight) return;
    removeBlock(x,y,z, false);
    worldData.set(key, type.id);
    indexWorldBlockKey(key, type.id);

    if (isGridPositionInActiveDistrict({ x, y, z })) {
        buildAndRegisterBlockVisual(key, x, y, z, type);
    }
    if(updateMinimap) drawMinimap();
    // signal world change
    try { worldChangeCounter++; if (typeof window !== 'undefined') window.worldChangeCounter = (window.worldChangeCounter || 0) + 1; } catch (e) {}
}
export function removeBlock(x, y, z, updateMinimap = true) {
    // Prevent removing the bottom-most floor (bedrock layer)
    if (y <= 0) return;
    const key = `${x},${y},${z}`;
    if (worldData.has(key)) {
        const previousBlock = worldData.get(key);
        worldData.delete(key);
        deindexWorldBlockKey(key, previousBlock);
        const block = visualBlocks.get(key);
        if (block) {
            simIO().removeVisual(scene, block);
            visualBlocks.delete(key);
        }
        if (ambientHouseEffects.has(key)) {
            disposeAmbientHouseEffect(ambientHouseEffects.get(key));
            ambientHouseEffects.delete(key);
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

// Headless-safe fruit regeneration tick. Called by run-sim.mjs each tick since
// the browser animate() loop (which normally handles this) is never called headless.
let _fruitRegenAccum = 0;
export function tickFruitRegen(deltaTime) {
    // Ages decomposition sites every tick, independent of the regen-interval gate
    // below, so their duration doesn't drift with whatever fruitRegenInterval is set to.
    updateDecompositionSites(deltaTime);
    _fruitRegenAccum += deltaTime;
    const fruitRegenInterval = (typeof globalThis.window !== 'undefined' && globalThis.window.fruitRegenIntervalSeconds > 0)
        ? globalThis.window.fruitRegenIntervalSeconds : 15;
    if (_fruitRegenAccum < fruitRegenInterval) return;
    _fruitRegenAccum = 0;
    // Density-dependent multiplier: logistic cap so heavy consumption accelerates regrowth
    // and a full ecosystem slows to zero. densityMult = max(0, 1 - currentFruit / capacity).
    const carryingCapacity = (typeof globalThis.window !== 'undefined' && globalThis.window.fruitCarryingCapacity > 0)
        ? globalThis.window.fruitCarryingCapacity : 200;
    let _currentFruitCount = 0;
    forEachWorldKeyOfTypes([BLOCK_TYPES.FRUIT.id], () => _currentFruitCount++);
    const densityMult = Math.max(0, 1 - _currentFruitCount / carryingCapacity);
    if (densityMult <= 0) return; // At/above carrying capacity — no new spawns
    // Apply the same seasonal multiplier that animate() uses in the browser.
    // Without this, headless CLI always runs at full spawn rate while the browser
    // experiences winter dips (amplitude=0.6 → 0.4× rate), making CLI unrepresentative.
    const seasonalMultiplier = (typeof globalThis.window !== 'undefined' && globalThis.window.currentSeasonInfo)
        ? Math.max(0, globalThis.window.currentSeasonInfo.multiplier) : 1;
    const rate = fruitSpawnRate * seasonalMultiplier * densityMult;
    for (let x = 0; x < gridSize; x++) {
        for (let z = 0; z < gridSize; z++) {
            const tileRate = rate * getDecompositionFruitBoost(x, z);
            if (Math.random() >= tileRate) continue;
            const y = findGroundY(x, z);
            if (y < 0) continue;
            if (worldData.get(`${x},${y},${z}`) !== BLOCK_TYPES.GRASS.id) continue;
            if (worldData.has(`${x},${y + 1},${z}`)) continue;
            // Skip enclosed positions — fruit spawned inside building interiors
            // is unreachable and causes starvation despite appearing on-screen.
            // Only check that at least one cardinal neighbour at fruit-level is
            // unoccupied; do NOT require same-height ground (that incorrectly
            // blocks spawning on sloped terrain where neighbour ground ≠ y).
            const fruitY = y + 1;
            const hasPassableNeighbor = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz]) =>
                !worldData.has(`${x+dx},${fruitY},${z+dz}`));
            if (!hasPassableNeighbor) continue;
            addBlock(x, y + 1, z, BLOCK_TYPES.FRUIT);
        }
    }
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
    return simIO().toScreenPosition(obj, camera, renderer?.domElement);
}
export function updateWorldLighting() {
    const timeOfDay = (worldTime % getDayDuration()) / getDayDuration();
    const dayIntensity = Math.sin(timeOfDay * Math.PI);
    if (directionalLight) directionalLight.intensity = Math.max(0, dayIntensity) * 0.8;
    if (ambientLight) ambientLight.intensity = 0.3 + Math.max(0, dayIntensity) * 0.6;

    const io = simIO();

    // ── Seasonal sky / ambient colour ─────────────────────────────────────────
    // 4 season anchor colours indexed 0=Spring, 1=Summer, 2=Autumn, 3=Winter.
    // phase from window.currentSeasonInfo (0–1 over full cycle) is split into
    // 4 equal segments; we lerp smoothly between adjacent seasons.
    const SEASON_SKY = [0xb4d4f0, 0x6bc5ff, 0xe09040, 0xb0c8de];  // Spring→Summer→Autumn→Winter
    const SEASON_AMB = [0xfff4fa, 0xfff8e8, 0xffe8c0, 0xeaf0ff];  // ambient tint per season

    if (!updateWorldLighting._s0) {
        updateWorldLighting._s0 = io.createColor(0);
        updateWorldLighting._s1 = io.createColor(0);
        updateWorldLighting._seasonSky = io.createColor(0);
        updateWorldLighting._seasonAmb = io.createColor(0);
    }
    const phase = (typeof window !== 'undefined' && window.currentSeasonInfo)
        ? window.currentSeasonInfo.phase : 0;
    const si = Math.floor(phase * 4) % 4;
    const t  = (phase * 4) % 1.0;
    const ni = (si + 1) % 4;

    updateWorldLighting._s0.set(SEASON_SKY[si]);
    updateWorldLighting._s1.set(SEASON_SKY[ni]);
    updateWorldLighting._seasonSky.lerpColors(updateWorldLighting._s0, updateWorldLighting._s1, t);

    updateWorldLighting._s0.set(SEASON_AMB[si]);
    updateWorldLighting._s1.set(SEASON_AMB[ni]);
    updateWorldLighting._seasonAmb.lerpColors(updateWorldLighting._s0, updateWorldLighting._s1, t);

    if (ambientLight) ambientLight.color.copy(updateWorldLighting._seasonAmb);
    if (directionalLight) directionalLight.color.copy(updateWorldLighting._seasonAmb);

    // ── Sky background (lerp between night and seasonal day sky) ─────────────
    if (!updateWorldLighting._nightColor) updateWorldLighting._nightColor = io.createColor(0x0a0a2a);
    const nightColor = updateWorldLighting._nightColor;
    const dayColor   = updateWorldLighting._seasonSky;  // seasonal sky replaces static 0x87CEEB

    if (scene) {
        if (!scene.background) scene.background = io.createColor(0x87CEEB);
        if (typeof scene.background?.lerpColors === 'function') {
            scene.background.lerpColors(nightColor, dayColor, Math.max(0, dayIntensity));
            // Blend sky toward overcast — heavy rain = dark slate, drizzle = soft blue-grey
            const _isRaining  = (typeof window !== 'undefined' && !!window._isRaining);
            const _rainType   = (typeof window !== 'undefined' && window._rainType) || null;
            if (_isRaining) {
                const isHeavy = _rainType === 'heavy';
                const rainSkyHex   = isHeavy ? 0x556677 : 0x9aaabb;  // dark slate vs soft grey-blue
                const rainSkyBlend = isHeavy ? 0.60 : 0.35;
                if (!updateWorldLighting._rainColor) updateWorldLighting._rainColor = io.createColor(0x556677);
                updateWorldLighting._rainColor.setHex(rainSkyHex);
                scene.background.lerp(updateWorldLighting._rainColor, rainSkyBlend);
            }
            // Lightning flash: briefly bleach sky toward near-white
            const flash = (typeof window !== 'undefined' && window._thunderFlash) ? Math.max(0, window._thunderFlash) : 0;
            if (flash > 0.01) {
                if (!updateWorldLighting._flashColor) updateWorldLighting._flashColor = io.createColor(0xeef8ff);
                scene.background.lerp(updateWorldLighting._flashColor, flash * 0.75);
            }
        } else {
            scene.background = dayIntensity >= 0.5 ? dayColor.clone() : nightColor.clone();
        }
    }
}
export function onWindowResize() {
    if (!camera || !renderer || !gameCanvas) return;
    const nextWidth = Math.max(1, Math.floor(gameCanvas.clientWidth || gameCanvas.offsetWidth || window.innerWidth || 1));
    const nextHeight = Math.max(1, Math.floor(gameCanvas.clientHeight || gameCanvas.offsetHeight || window.innerHeight || 1));
    if (!Number.isFinite(nextWidth) || !Number.isFinite(nextHeight)) return;

    gameCanvas.width = nextWidth;
    gameCanvas.height = nextHeight;
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    renderer.setSize(nextWidth, nextHeight, false);
    if (typeof controls?.update === 'function') controls.update();
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
// drawMinimap() is called on every block add/remove (default updateMinimap=true),
// which at large districtMode (up to 64x64=4096 columns) becomes a real per-dig
// cost. Throttle to a max redraw rate — callers that fire faster than this just
// coalesce into the next scheduled redraw, so the minimap still ends up correct,
// just not re-rendered on every single block edit.
const MINIMAP_MIN_INTERVAL_MS = 200;
let _lastMinimapDrawAt = 0;
let _minimapRedrawPending = false;

export function drawMinimap() {
    if (!minimapCtx || !minimapCanvas) return;
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    if (now - _lastMinimapDrawAt < MINIMAP_MIN_INTERVAL_MS) {
        if (!_minimapRedrawPending) {
            _minimapRedrawPending = true;
            setTimeout(() => {
                _minimapRedrawPending = false;
                _lastMinimapDrawAt = (typeof performance !== 'undefined') ? performance.now() : Date.now();
                drawMinimapImmediate();
            }, MINIMAP_MIN_INTERVAL_MS);
        }
        return;
    }
    _lastMinimapDrawAt = now;
    drawMinimapImmediate();
}

function drawMinimapImmediate() {
    const minimapSize = minimapCanvas.width;
    const cellSize = minimapSize / gridSize;
    const blockTypeById = new Map(Object.values(BLOCK_TYPES).map(t => [t.id, t]));
    minimapCtx.clearRect(0, 0, minimapSize, minimapSize);
    for (let x = 0; x < gridSize; x++) {
        for (let z = 0; z < gridSize; z++) {
            const y = findGroundY(x, z);
            if (y !== -1) {
                const blockId = worldData.get(`${x},${y},${z}`);
                const blockType = blockTypeById.get(typeof blockId === 'object' ? blockId?.id : blockId);
                if(blockType && blockType.color) {
                   minimapCtx.fillStyle = simIO().colorToCssHex(blockType.color);
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
    const _frameStart = performance.now();
    const deltaTime = Math.min(clock.getDelta(), 0.1); // cap at 100ms to prevent tab-backgrounding spikes

    // ── Mobile render throttle: toggle each frame so GPU renders at ~30fps ────
    // Simulation logic still runs every frame; only the renderer.render() call
    // is skipped on odd frames to halve mobile GPU fill cost.
    animate._mobileRenderFlag = !animate._mobileRenderFlag;
    const _skipRender = !!(typeof window !== 'undefined' && window.__mobileOptimized && animate._mobileRenderFlag);

    // ── Lazy-init snow system (created once, tied to scene lifetime) ──────────
    if (!animate._snow && scene) {
        animate._snow = createSnowSystem(scene);
    }

    // ── Lazy-init bird system (ambient creatures, pure visual) ────────────────
    if (!animate._birds && scene) {
        const _birdBounds = getDistrictBounds(activeDistrictIndex, districtMode);
        animate._birds = createBirdSystem(scene, DISTRICT_CELL_SIZE, _birdBounds.centerX, _birdBounds.centerZ);
    }
    if (animate._birds) animate._birds.update(deltaTime);

    // ── Lazy-init rain system (spring/summer rainfall, pure visual) ──────────
    if (!animate._rain && scene) {
        animate._rain = createRainSystem(scene);
    }

    // ── Campfire lifecycle ────────────────────────────────────────────────────
    // Visible count = min(spots, floor(aliveChars / CHARS_PER_CAMPFIRE)).
    // Only active (dusk-to-dawn) fires flicker; count is re-evaluated every ~1s.
    if (campfireObjects.length > 0) {
        const _cfTod  = (worldTime % getDayDuration()) / getDayDuration();
        const _cfDayI = Math.sin(_cfTod * Math.PI);
        const _shouldBurn = _cfDayI < 0.55;  // true: dusk → midnight → dawn

        // Re-count alive characters every ~1 second (not every frame)
        animate._campfireAliveTimer = (animate._campfireAliveTimer || 0) + deltaTime;
        if (animate._campfireAliveTimer >= 1.0 || animate._campfireCount === undefined) {
            animate._campfireAliveTimer = 0;
            let alive = 0;
            for (const c of characters) { if (c && c.state !== 'dead') alive++; }
            const charsPerCampfire = (typeof window !== 'undefined' && window.charsPerCampfire !== undefined) ? Number(window.charsPerCampfire) : 20;
            animate._campfireCount = Math.min(campfireObjects.length, Math.floor(alive / charsPerCampfire));
        }
        const activeCount = animate._campfireCount || 0;

        // Update each campfire's visibility (day/night + population threshold + district)
        const _campfirePositionsBuf = [];
        for (let i = 0; i < campfireObjects.length; i++) {
            const cf = campfireObjects[i];
            const inDistrict = !cf.userData.gridPos || isGridPositionInActiveDistrict(cf.userData.gridPos);
            cf.visible = _shouldBurn && i < activeCount && inDistrict;
            if (cf.visible && cf.userData.gridPos) _campfirePositionsBuf.push(cf.userData.gridPos);
        }
        // Expose for character cold-exposure checks
        if (typeof window !== 'undefined') window._activeCampfirePositions = _campfirePositionsBuf;
        // Animate only the burning visible fires
        if (_shouldBurn) {
            for (let i = 0; i < activeCount; i++) {
                if (campfireObjects[i]?.userData?.updateFire) campfireObjects[i].userData.updateFire(worldTime);
            }
        }
    }

    // ── Village well: district visibility only (no animation) ────────────────
    if (wellObject) {
        const inDistrict = !wellObject.userData.gridPos || isGridPositionInActiveDistrict(wellObject.userData.gridPos);
        wellObject.visible = inDistrict;
    }

    // ── Special entities: angel (child ≥ 10) + reaper (elder ≥ 10) ──────────
    // Population counts are re-evaluated every ~2.5 s to avoid per-frame iteration.
    if (specialEntities.angel || specialEntities.reaper) {
        animate._specialTimer = (animate._specialTimer || 0) + deltaTime;
        if (animate._specialTimer >= 2.5) {
            animate._specialTimer = 0;
            let childCount = 0, elderCount = 0;
            for (const c of characters) {
                if (!c || c.state === 'dead') continue;
                const stage = c.getLifeStage ? c.getLifeStage() : (c.isChild ? 'child' : 'adult');
                if (stage === 'child') childCount++;
                if (stage === 'elder') elderCount++;
            }
            animate._childCount = childCount;
            animate._elderCount = elderCount;
        }
        const angelChildThreshold = (typeof window !== 'undefined' && window.angelChildThreshold !== undefined) ? Number(window.angelChildThreshold) : 10;
        const reaperElderThreshold = (typeof window !== 'undefined' && window.reaperElderThreshold !== undefined) ? Number(window.reaperElderThreshold) : 10;
        _updateSpecialEntity(specialEntities.angel,  (animate._childCount || 0) >= angelChildThreshold, deltaTime);
        _updateSpecialEntity(specialEntities.reaper, (animate._elderCount || 0) >= reaperElderThreshold, deltaTime);
    }

    // ── Snow update helper (called both when paused and running) ──────────────
    function _updateSnow(dt) {
        if (!animate._snow) return;
        // snow-system.js recenters recycled particles on window._simCamera, but
        // nothing ever assigned that global — particles always recycled around
        // world origin (0,0), so switching districts (camera jumps elsewhere)
        // left snow falling in the old spot. `camera` is this module's own live
        // binding, so just keep the global in sync with it here.
        if (typeof window !== 'undefined') window._simCamera = camera;
        const si   = (typeof window !== 'undefined' && window.currentSeasonInfo) ? window.currentSeasonInfo : null;
        const ph   = si ? si.phase     : 0;
        const amp  = si ? si.amplitude : 0;
        const fx   = !(typeof window !== 'undefined' && window.showEffects === false);
        animate._snow.update(dt, ph, amp, fx);
    }

    // ── Rain update helper (called both when paused and running) ─────────────
    function _updateRain(dt) {
        if (!animate._rain) return;
        // Same window._simCamera fix as _updateSnow above — see that comment.
        if (typeof window !== 'undefined') window._simCamera = camera;
        // On mobile, skip rain particle CPU update on the non-rendered frame
        if (_skipRender) return;
        const si  = (typeof window !== 'undefined' && window.currentSeasonInfo) ? window.currentSeasonInfo : null;
        const ph  = si ? si.phase     : 0;
        const amp = si ? si.amplitude : 0;
        const fx  = !(typeof window !== 'undefined' && window.showEffects === false);
        animate._rain.update(dt, ph, amp, fx);
    }

    // simulationRunningがtrueのときだけ進行
    if (typeof window !== 'undefined' && window.simulationRunning === false) {
        // 停止中もワールドの描画・UI更新は継続
        updateWorldLighting();
        updateAmbientWorldEffects();
        _updateSnow(deltaTime);
        _updateRain(deltaTime);
        if (controls) controls.update();
        if (!_skipRender) renderer.render(scene, camera);
        return;
    }
    worldTime += deltaTime;
    if (typeof window !== 'undefined') window._simTick = (window._simTick || 0) + 1; // used by findClosestFood result cache
    updateWorldLighting();
    updateAmbientWorldEffects();
    _updateSnow(deltaTime);
    _updateRain(deltaTime);
    const _dd = getDayDuration();
    const isNight = (worldTime % _dd) > (_dd / 2);
    // Day/night transition sounds
    if (typeof window !== 'undefined') {
        const _prevNight = window._prevIsNight;
        if (_prevNight !== undefined && _prevNight !== isNight) {
            playSound(isNight ? 'night' : 'dawn');
        }
        window._prevIsNight = isNight;
        // Ambient soundscape (wind / birds / crickets) – season & day/night aware
        const _ambPhase = (typeof window !== 'undefined' && window.currentSeasonInfo) ? window.currentSeasonInfo.phase : 0;
        updateAmbience(isNight, _ambPhase);
    }
    refreshDistrictSummaryCache(characters);
    if (typeof window !== 'undefined') {
        let activeCount = 0;
        for (const char of characters) {
            if (!char || char.state === 'dead') continue;
            if (districtMode === 1 || getDistrictIndexForPosition(char.gridPos, districtMode) === activeDistrictIndex) {
                activeCount++;
            }
        }
        window.__activeCharacterCount = activeCount;
    }
    if (controls) controls.update();

    // On mobile, skip character AI+animation on the non-rendered frame.
    // Accumulate deltaTime so the next frame processes the full elapsed time.
    // This halves character update CPU cost while keeping simulation time accurate.
    if (_skipRender) {
        animate._mobileCharDtAccum = (animate._mobileCharDtAccum || 0) + deltaTime;
    } else {
        const charDt = (animate._mobileCharDtAccum || 0) + deltaTime;
        animate._mobileCharDtAccum = 0;
        for (const char of characters) char.update(charDt, isNight, camera);
    }

    // Sync instanced character renderer (batches body/head/arms/shadow into 5 draw calls)
    if (!_skipRender && typeof window !== 'undefined' && window._instancedCharRenderer) {
        window._instancedCharRenderer.update(characters);
    }

    // Update selection ring position to follow the selected character
    if (typeof window !== 'undefined' && window._selectionRing) {
        const selId = String(window.selectedCharacterId ?? '');
        const selChar = selId ? characters.find(c => c && String(c.id) === selId && c.mesh) : null;
        if (selChar) {
            const p = selChar.mesh.position;
            window._selectionRing.position.set(p.x, p.y + 0.02, p.z);
            window._selectionRing.visible = true;
        } else {
            window._selectionRing.visible = false;
        }
    }

    // --- グループ再判定は人口が増えたら間引く ---
    if (!animate.lastGroupDetectTime) animate.lastGroupDetectTime = 0;
    animate.lastGroupDetectTime += deltaTime;
    const groupRefreshInterval = isTelemetryFidelityMode()
        ? 1.0
        : (characters.length > 96 ? 3.0 : characters.length > 64 ? 2.2 : 1.2);
    if (animate.lastGroupDetectTime >= groupRefreshInterval) {
        if (typeof window !== 'undefined' && window.characters && window.characters.length > 0) {
            Character.detectGroupsAndElectLeaders(window.characters);
        }
        animate.lastGroupDetectTime = 0;
    }

    // --- 季節時計：日数ベースで計算（worldTime / DAY_DURATION = 経過日数） ---
    // seasonCycleSeconds は「1サイクルあたりの日数」として扱う（デフォルト4日）。
    // これにより昼夜サイクルと季節が自然に連動する（1季節 = 1日 etc）。
    if (!animate.lastSeasonUIUpdate) animate.lastSeasonUIUpdate = 0;
    animate.lastSeasonUIUpdate += deltaTime;
    if (animate.lastSeasonUIUpdate >= 1.0) {
        animate.lastSeasonUIUpdate = 0;
        const _cycleDays = (typeof window !== 'undefined' && window.seasonCycleSeconds > 0) ? window.seasonCycleSeconds : 4;
        const _amp = (typeof window !== 'undefined' && window.seasonAmplitude !== undefined) ? Math.min(1, Math.max(0, window.seasonAmplitude)) : 0.6;
        const _daysElapsed = worldTime / getDayDuration();
        const _mul = 1 + _amp * Math.sin(2 * Math.PI * _daysElapsed / _cycleDays);
        const _phase = (_daysElapsed % _cycleDays) / _cycleDays;
        let _name, _icon;
        if (_phase < 0.25)       { _name = 'Spring'; _icon = '🌸'; }
        else if (_phase < 0.50)  { _name = 'Summer'; _icon = '☀️'; }
        else if (_phase < 0.75)  { _name = 'Autumn'; _icon = '🍂'; }
        else                     { _name = 'Winter'; _icon = '❄️'; }
        window.currentSeasonInfo = { name: _name, icon: _icon, multiplier: Math.max(0, _mul), amplitude: _amp, phase: _phase };

        // Rebuild terrain voxels when season changes (snow on step edges etc.)
        if (animate._lastSeasonName !== _name) {
            const _isFirstSeason = !animate._lastSeasonName;
            animate._lastSeasonName = _name;
            if (window.voxelDetailMode !== false && !window.__mobileOptimized) rebuildAllBlockVisuals();
            if (!_isFirstSeason) {
                // Chronicle logging for season change already happens below
                // (Society Chronicle event hooks, "<Season> — food ×N" entry).
                // No screen particle here by design: season is a global event with
                // no character to anchor to, so sound + Timeline carry it alone —
                // a screen-wide banner would just restate the Timeline text.
                if (typeof playSound === 'function') { try { playSound('season'); } catch (_) {} }
            }
        }

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
            const _simNow = worldTime;
            if (_starvRate > 0.4 && _prevStarv <= 0.4) {
                // Escalate: shortage → famine
                window.logChronicleEvent('☠️', `Famine — ${_starving}/${_pop} starving`, 'famine');
                animate._lastShortageEventTime = _simNow; // reset cooldown so shortage won't double-fire
            } else if (_starvRate > 0.15 && _prevStarv <= 0.15) {
                // First crossing into shortage territory
                window.logChronicleEvent('🌾', `Food shortage — ${_starving}/${_pop} hungry`, 'shortage');
                animate._lastShortageEventTime = _simNow;
            } else if (_starvRate > 0.15 && _starvRate <= 0.4) {
                // Sustained shortage: re-fire with 60s simulated cooldown
                const _sinceLastShortage = _simNow - (animate._lastShortageEventTime || 0);
                if (_sinceLastShortage >= 60) {
                    window.logChronicleEvent('🌾', `Food shortage — ${_starving}/${_pop} hungry`, 'shortage');
                    animate._lastShortageEventTime = _simNow;
                }
            } else if (_starvRate < 0.1 && _prevStarv >= 0.15) {
                // Recovery from either shortage or famine
                const _label = _prevStarv > 0.4 ? 'Famine ended' : 'Shortage eased';
                window.logChronicleEvent('🍎', _label, 'recovery');
                animate._lastShortageEventTime = 0;
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
            const _socialTrends = (() => {
                if (_alive.length === 0) {
                    return {
                        avgRelationships: 0,
                        avgAffinity: 0,
                        bondedChars: 0,
                        bondedRate: 0,
                        allyChars: 0,
                        alliesRate: 0,
                        nearbySupportChars: 0,
                        nearbySupportRate: 0
                    };
                }
                const _allyThreshold = (typeof window !== 'undefined' && window.allyAffinityThreshold !== undefined) ? Number(window.allyAffinityThreshold) : 60;
                const _bondedThreshold = (typeof window !== 'undefined' && window.bondedAffinityThreshold !== undefined) ? Number(window.bondedAffinityThreshold) : 80;
                const _nearbyRadius = (typeof window !== 'undefined' && window.nearbySupportRadius !== undefined) ? Number(window.nearbySupportRadius) : 3;
                const _aliveById = new Map(_alive.map(c => [String(c?.id), c]));
                let _relationshipTotal = 0;
                let _avgAffinityTotal = 0;
                let _bondedChars = 0;
                let _allyChars = 0;
                let _nearbyChars = 0;

                for (const c of _alive) {
                    const _entries = c?.relationships instanceof Map ? Array.from(c.relationships.entries()) : [];
                    const _affinityValues = _entries
                        .map(([, rawAffinity]) => Number(rawAffinity))
                        .filter(Number.isFinite);
                    _relationshipTotal += _affinityValues.length;
                    _avgAffinityTotal += _affinityValues.length
                        ? (_affinityValues.reduce((sum, value) => sum + value, 0) / _affinityValues.length)
                        : 0;

                    let _hasBonded = false;
                    let _hasAlly = false;
                    let _hasNearby = false;

                    for (const [otherId, rawAffinity] of _entries) {
                        const _affinity = Number(rawAffinity || 0);
                        if (_affinity >= _bondedThreshold) _hasBonded = true;
                        if (_affinity >= _allyThreshold) {
                            _hasAlly = true;
                            const _other = _aliveById.get(String(otherId));
                            if (!_hasNearby && c?.gridPos && _other?.gridPos) {
                                const _dist = Math.abs(c.gridPos.x - _other.gridPos.x) + Math.abs(c.gridPos.y - _other.gridPos.y) + Math.abs(c.gridPos.z - _other.gridPos.z);
                                if (_dist <= _nearbyRadius) _hasNearby = true;
                            }
                        }
                    }

                    if (_hasBonded) _bondedChars += 1;
                    if (_hasAlly) _allyChars += 1;
                    if (_hasNearby) _nearbyChars += 1;
                }

                const _n = Math.max(1, _alive.length);
                return {
                    avgRelationships: +(_relationshipTotal / _n).toFixed(2),
                    avgAffinity: +(_avgAffinityTotal / _n).toFixed(2),
                    bondedChars: _bondedChars,
                    bondedRate: +(_bondedChars / _n).toFixed(3),
                    allyChars: _allyChars,
                    alliesRate: +(_allyChars / _n).toFixed(3),
                    nearbySupportChars: _nearbyChars,
                    nearbySupportRate: +(_nearbyChars / _n).toFixed(3)
                };
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
                socialTrends: _socialTrends,
                districtMode,
                activeDistrictIndex,
                activeDistrict: _districts[activeDistrictIndex] ?? null,
                districts: _districts
            });
        }
    }

    // Ages decomposition sites every frame (visual fade + fruit-boost countdown),
    // independent of the regen-interval gate below.
    updateDecompositionSites(deltaTime);

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

        let _fruitAdded = 0;
        for (let x = 0; x < gridSize; x++) {
            for (let z = 0; z < gridSize; z++) {
                const tileRate = rate * getDecompositionFruitBoost(x, z);
                if (Math.random() >= tileRate) continue;
                const y = findGroundY(x, z);
                if (y < 0) continue;
                if (worldData.get(`${x},${y},${z}`) !== BLOCK_TYPES.GRASS.id) continue;
                if (worldData.has(`${x},${y + 1},${z}`)) continue;
                // Skip enclosed positions — only check fruit-level neighbours,
                // not same-height ground (avoids blocking on sloped terrain).
                const fruitY = y + 1;
                const hasPassableNeighbor = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz]) =>
                    !worldData.has(`${x+dx},${fruitY},${z+dz}`));
                if (!hasPassableNeighbor) continue;
                addBlock(x, y + 1, z, BLOCK_TYPES.FRUIT, false); // skip per-block minimap refresh
                _fruitAdded++;
            }
        }
        if (_fruitAdded > 0) drawMinimap(); // single redraw after all fruit placed
        animate.lastFruitRegenTime = 0;
    }

    const _renderStart = performance.now();
    if (!_skipRender) renderer.render(scene, camera);
    const _frameEnd = performance.now();

    // --- Perf stats for debug overlay ---
    if (typeof window !== 'undefined') {
        const _info = renderer.info;
        const _fps = animate._lastFrameEnd ? Math.round(1000 / (_frameEnd - animate._lastFrameEnd)) : 0;
        const _frameMs = Math.round(_frameEnd - _frameStart);
        const _renderMs = Math.round(_frameEnd - _renderStart);
        const _logicMs = Math.round(_renderStart - _frameStart);
        // Rolling 60-frame averages
        if (!animate._fpsHistory) animate._fpsHistory = [];
        animate._fpsHistory.push(_fps);
        if (animate._fpsHistory.length > 60) animate._fpsHistory.shift();
        const _avgFps = Math.round(animate._fpsHistory.reduce((a, b) => a + b, 0) / animate._fpsHistory.length);
        window.__perfStats = {
            fps: _fps,
            avgFps: _avgFps,
            frameMs: _frameMs,
            logicMs: _logicMs,
            renderMs: _renderMs,
            drawCalls: _info.render.calls,
            triangles: _info.render.triangles,
            charCount: characters.filter(c => c && c.state !== 'dead').length,
        };
        animate._lastFrameEnd = _frameEnd;
    }
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
