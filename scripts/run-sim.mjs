import fs from 'node:fs';
import path from 'node:path';
import { setSimulationIO, createHeadlessSimulationIO } from '../sim-core/interfaces.js';

function usage() {
    console.log(`Usage: npm run sim -- [options]\n\nExamples:\n  npm run sim -- --minutes=5 --districtMode=4 --population=48 --out=telemetry/d4-p48.json\n  npm run sim -- --ticks=1200 --population=12 --set=initialAgeMaxRatio=0.4 --set=pairReproductionCooldownSeconds=18\n  npm run sim -- --config=sim-settings.workspace.json --minutes=5 --districtMode=4 --population=48\n`);
}

function readFlag(...names) {
    for (const name of names) {
        const prefix = `--${name}=`;
        const hit = process.argv.find(arg => arg.startsWith(prefix));
        if (hit) return hit.slice(prefix.length);
    }
    return null;
}

function readNumberArg(names, fallback) {
    const nameList = Array.isArray(names) ? names : [names];
    const raw = readFlag(...nameList);
    if (raw === null) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
}

function parseLiteral(raw) {
    const text = String(raw ?? '').trim();
    if (text === 'true') return true;
    if (text === 'false') return false;
    if (text === 'null') return null;
    const num = Number(text);
    if (text !== '' && Number.isFinite(num)) return num;
    if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
        try { return JSON.parse(text); } catch (_) {}
    }
    return text;
}

function collectAssignments(flagName) {
    const prefix = `--${flagName}=`;
    return process.argv
        .filter(arg => arg.startsWith(prefix))
        .map(arg => arg.slice(prefix.length))
        .map(entry => {
            const eqIndex = entry.indexOf('=');
            if (eqIndex <= 0) return null;
            const key = entry.slice(0, eqIndex).trim();
            const value = parseLiteral(entry.slice(eqIndex + 1));
            return key ? [key, value] : null;
        })
        .filter(Boolean);
}

function loadSettingsFromFile(filePath) {
    if (!filePath) return {};
    const absPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(absPath)) return {};
    const raw = JSON.parse(fs.readFileSync(absPath, 'utf8'));
    if (raw?.settings?.sidebarParams && typeof raw.settings.sidebarParams === 'object') return { ...raw.settings.sidebarParams };
    if (raw?.sidebarParams && typeof raw.sidebarParams === 'object') return { ...raw.sidebarParams };
    return (raw && typeof raw === 'object') ? { ...raw } : {};
}

function createDomStubNode() {
    return {
        style: {},
        className: '',
        textContent: '',
        innerHTML: '',
        value: '',
        parentNode: null,
        setAttribute() {},
        appendChild(child) {
            if (child) child.parentNode = this;
        },
        removeChild(child) {
            if (child && child.parentNode === this) child.parentNode = null;
        },
        addEventListener() {},
        removeEventListener() {},
        getContext() { return null; },
        getBoundingClientRect() {
            return { left: 0, top: 0, width: 1280, height: 720 };
        },
        focus() {}
    };
}

function createTelemetryRuntime(windowRef) {
    const normalizeDeathCause = (cause) => {
        const normalized = String(cause || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
        if (!normalized) return 'unknown';
        if (normalized === 'starvation' || normalized === 'starved' || normalized.includes('starv')) return 'starvation';
        if (normalized === 'old_age' || normalized === 'oldage' || normalized === 'old') return 'old_age';
        return 'unknown';
    };

    windowRef.simTelemetryConfig = {
        sampleIntervalMs: Math.max(200, Number(windowRef.sampleIntervalMs || 1000)),
        maxSamples: Math.max(1000, Number(windowRef.maxSamples || 120000)),
        maxEvents: Math.max(1000, Number(windowRef.maxEvents || 50000)),
        autoDownloadOnStop: false,
        fileNamePrefix: 'telemetry-cli'
    };

    windowRef.resetPopulationStats = function resetPopulationStats(initialPopulation = 0) {
        windowRef.__simPopulationStats = {
            initialPopulation: Number(initialPopulation || 0),
            births: 0,
            deaths: 0,
            deathsByCause: {
                starvation: 0,
                old_age: 0,
                unknown: 0
            },
            latestBirth: null,
            latestDeath: null
        };
        return windowRef.__simPopulationStats;
    };

    windowRef.getPopulationStats = function getPopulationStats() {
        return windowRef.__simPopulationStats || windowRef.resetPopulationStats(0);
    };

    windowRef.recordPopulationBirth = function recordPopulationBirth(payload = {}) {
        const stats = windowRef.getPopulationStats();
        stats.births += 1;
        stats.latestBirth = { t: Date.now(), ...payload };
        return stats;
    };

    windowRef.recordPopulationDeath = function recordPopulationDeath(payload = {}) {
        const stats = windowRef.getPopulationStats();
        stats.deaths += 1;
        const cause = normalizeDeathCause(payload?.cause);
        if (stats.deathsByCause[cause] === undefined) stats.deathsByCause[cause] = 0;
        stats.deathsByCause[cause] += 1;
        stats.latestDeath = { t: Date.now(), ...payload, cause };
        return stats;
    };

    windowRef.__simTelemetry = {
        startedAt: 0,
        endedAt: 0,
        samples: [],
        worldSamples: [],
        events: [],
        counters: { droppedSamples: 0, droppedEvents: 0 },
        addSample(sample) {
            if (!sample) return;
            if (this.samples.length >= windowRef.simTelemetryConfig.maxSamples) {
                this.counters.droppedSamples++;
                return;
            }
            this.samples.push(sample);
        },
        addWorldSample(sample) {
            if (!sample) return;
            const cap = Math.ceil(windowRef.simTelemetryConfig.maxSamples / 10);
            if (this.worldSamples.length >= cap) return;
            this.worldSamples.push(sample);
        },
        addEvent(evt) {
            if (!evt) return;
            if (this.events.length >= windowRef.simTelemetryConfig.maxEvents) {
                this.counters.droppedEvents++;
                return;
            }
            this.events.push(evt);
        },
        snapshotMeta() {
            const stats = windowRef.getPopulationStats();
            const chars = Array.isArray(windowRef.characters) ? windowRef.characters : [];
            const alive = chars.filter(c => c && c.state !== 'dead');
            const stageCounts = { child: 0, young: 0, adult: 0, elder: 0 };
            for (const c of alive) {
                const stage = c?.getLifeStage ? c.getLifeStage() : (c?.isChild ? 'child' : 'adult');
                if (stageCounts[stage] !== undefined) stageCounts[stage] += 1;
            }
            return {
                startedAt: this.startedAt,
                endedAt: this.endedAt,
                durationMs: (this.endedAt || Date.now()) - (this.startedAt || Date.now()),
                sampleCount: this.samples.length,
                eventCount: this.events.length,
                counters: { ...this.counters },
                config: { ...windowRef.simTelemetryConfig },
                runtime: {
                    aiMode: windowRef.aiMode,
                    districtMode: windowRef.districtMode,
                    activeDistrictIndex: windowRef.activeDistrictIndex,
                    characterLifespan: windowRef.characterLifespan,
                    socialThreshold: windowRef.socialThreshold,
                    groupAffinityThreshold: windowRef.groupAffinityThreshold,
                    initialAgeMaxRatio: windowRef.initialAgeMaxRatio,
                    reproductionCooldownSeconds: windowRef.reproductionCooldownSeconds,
                    pairReproductionCooldownSeconds: windowRef.pairReproductionCooldownSeconds,
                    bondPersistence: windowRef.bondPersistence,
                    supportSeekingDrive: windowRef.supportSeekingDrive,
                    socialAnchorBias: windowRef.socialAnchorBias,
                    affinityIncreaseRate: windowRef.affinityIncreaseRate,
                    affinityDecayRate: windowRef.affinityDecayRate,
                    supportGroupBonus: windowRef.supportGroupBonus,
                    supportAllyPresenceBonus: windowRef.supportAllyPresenceBonus,
                    minReproductionAgeRatio: windowRef.minReproductionAgeRatio,
                    hungerDecayRate: windowRef.hungerDecayRate,
                    activeEnergyDrainRate: windowRef.activeEnergyDrainRate,
                    homeBuildingPriority: windowRef.homeBuildingPriority,
                    homeReturnHungerLevel: windowRef.homeReturnHungerLevel,
                    perceptionRange: windowRef.perceptionRange
                },
                population: {
                    ...stats,
                    deathsByCause: { ...(stats.deathsByCause || {}) },
                    current: {
                        totalTracked: chars.length,
                        alive: alive.length,
                        children: stageCounts.child,
                        adults: stageCounts.young + stageCounts.adult + stageCounts.elder,
                        stageCounts,
                        maxGeneration: chars.reduce((m, c) => Math.max(m, Number(c?.generation || 0)), 0)
                    }
                }
            };
        },
        exportObject() {
            return {
                meta: this.snapshotMeta(),
                samples: this.samples,
                worldSamples: this.worldSamples,
                events: this.events
            };
        },
        reset() {
            this.startedAt = Date.now();
            this.endedAt = 0;
            this.samples = [];
            this.worldSamples = [];
            this.events = [];
            this.counters = { droppedSamples: 0, droppedEvents: 0 };
        }
    };

    windowRef.startTelemetryTest = function startTelemetryTest(opts = {}) {
        if (opts.sampleIntervalMs !== undefined) windowRef.simTelemetryConfig.sampleIntervalMs = Math.max(200, Number(opts.sampleIntervalMs) || 1000);
        if (opts.maxSamples !== undefined) windowRef.simTelemetryConfig.maxSamples = Math.max(1000, Number(opts.maxSamples) || 120000);
        if (opts.maxEvents !== undefined) windowRef.simTelemetryConfig.maxEvents = Math.max(1000, Number(opts.maxEvents) || 50000);
        windowRef.__simTelemetry.reset();
        windowRef.simTestMode = true;
    };

    windowRef.stopTelemetryTest = function stopTelemetryTest() {
        windowRef.simTestMode = false;
        windowRef.__simTelemetry.endedAt = Date.now();
    };
}

function applySettings(windowRef, settings) {
    const aliases = {
        socialTh: 'socialThreshold',
        groupAffinityTh: 'groupAffinityThreshold'
    };
    const sidebarParams = { ...(windowRef.sidebarParams || {}) };
    for (const [key, value] of Object.entries(settings || {})) {
        sidebarParams[key] = value;
        windowRef[key] = value;
        if (aliases[key]) windowRef[aliases[key]] = value;
    }
    if (sidebarParams.socialTh !== undefined && windowRef.socialThreshold === undefined) windowRef.socialThreshold = sidebarParams.socialTh;
    if (sidebarParams.groupAffinityTh !== undefined && windowRef.groupAffinityThreshold === undefined) windowRef.groupAffinityThreshold = sidebarParams.groupAffinityTh;
    windowRef.sidebarParams = sidebarParams;
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    process.exit(0);
}

const dt = Math.max(0.01, readNumberArg('dt', 0.25));
const minutes = Math.max(0, readNumberArg('minutes', 0));
const seconds = Math.max(0, readNumberArg('seconds', minutes > 0 ? minutes * 60 : 0));
const ticksArg = readNumberArg('ticks', NaN);
const ticks = Number.isFinite(ticksArg) && ticksArg > 0
    ? Math.max(1, Math.floor(ticksArg))
    : Math.max(1, Math.round((seconds > 0 ? seconds : 60) / dt));
const population = Math.max(1, Math.floor(readNumberArg(['population', 'characters', 'charNum'], 10)));
const districtMode = Math.max(1, Math.floor(readNumberArg('districtMode', 1)));
const activeDistrictIndex = Math.max(0, Math.floor(readNumberArg('activeDistrictIndex', 0)));
const outFile = readFlag('out');
const verbose = process.argv.includes('--verbose');
// Canonical settings live in public/ (Vite serves it directly to the browser).
// run-sim.mjs reads the same real file so there is no sync problem.
const configPath = readFlag('config')
    || (fs.existsSync(path.resolve(process.cwd(), 'public/sim-settings.workspace.json')) ? 'public/sim-settings.workspace.json'
        : fs.existsSync(path.resolve(process.cwd(), 'sim-settings.workspace.json')) ? 'sim-settings.workspace.json'
        : null);
const sampleIntervalMs = Math.max(200, Math.floor(readNumberArg('sampleIntervalMs', 1000)));
const maxSamples = Math.max(1000, Math.floor(readNumberArg('maxSamples', 120000)));
const maxEvents = Math.max(1000, Math.floor(readNumberArg('maxEvents', 50000)));
const aiMode = readFlag('aiMode') || 'rulebase';
const fileSettings = loadSettingsFromFile(configPath);
const cliSettings = Object.fromEntries([
    ...collectAssignments('set'),
    ...collectAssignments('param')
]);

const options = {
    ticks,
    dt,
    seconds: ticks * dt,
    population,
    districtMode,
    activeDistrictIndex,
    outFile,
    verbose,
    aiMode,
    sampleIntervalMs,
    maxSamples,
    maxEvents,
    settings: {
        ...fileSettings,
        ...cliSettings,
        districtMode,
        activeDistrictIndex,
        charNum: population,
    }
};

const realConsoleLog = console.log.bind(console);
if (!verbose) {
    console.log = (...args) => {
        const first = String(args?.[0] ?? '');
        if (first.startsWith('{') || first.startsWith('Usage:')) {
            realConsoleLog(...args);
        }
    };
}

setSimulationIO(createHeadlessSimulationIO());

const domStub = createDomStubNode();
globalThis.document = {
    body: domStub,
    createElement: () => createDomStubNode(),
    getElementById: () => null,
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => []
};

const realDateNow = Date.now;
const realPerformance = globalThis.performance;
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
let simulatedNow = realDateNow();
Date.now = () => Math.floor(simulatedNow);
globalThis.performance = { ...(realPerformance || {}), now: () => simulatedNow };
globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};

const worldModule = await import('../world.js');
const characterModule = await import('../character.js');

const {
    generateTerrain,
    findValidSpawn,
    spawnCharacter,
    characters,
    DAY_DURATION,
    worldData,
    resetNextCharacterId,
    setDistrictMode,
    setActiveDistrict,
    getDistrictSummaries,
    getDistrictIndexForPosition,
    tickFruitRegen,
} = worldModule;

const { Character } = characterModule;

globalThis.window = {
    characters,
    simulationRunning: true,
    DEBUG_MODE: false,
    worldReservations: new Map(),
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    addEventListener() {},
    removeEventListener() {},
    aiMode,
    sampleIntervalMs,
    maxSamples,
    maxEvents,
};

createTelemetryRuntime(globalThis.window);
applySettings(globalThis.window, options.settings);
globalThis.window.resetPopulationStats(population);
globalThis.window.startTelemetryTest({ sampleIntervalMs, maxSamples, maxEvents });

resetNextCharacterId();
characters.length = 0;
worldData.clear();
if (typeof setDistrictMode === 'function') setDistrictMode(districtMode);
if (typeof setActiveDistrict === 'function') setActiveDistrict(activeDistrictIndex);
generateTerrain();

for (let i = 0; i < options.population; i++) {
    const spawnPos = findValidSpawn();
    if (spawnPos) spawnCharacter(spawnPos);
}

Character.initializeAllRelationships(characters);
Character.applyInitialAgeSpread(characters);

let simTime = 0;
let nextWorldSampleMs = simulatedNow;
let prevDistrictState = new Map();

for (let tick = 0; tick < options.ticks; tick++) {
    globalThis.window.characters = characters;
    const isNight = (simTime % DAY_DURATION) > (DAY_DURATION / 2);
    const currentChars = [...characters];
    for (const char of currentChars) {
        if (char && typeof char.update === 'function') {
            char.update(options.dt, isNight, null);
        }
    }

    simulatedNow += options.dt * 1000;
    simTime += options.dt;

    // Fruit regeneration (mirrors the animate() loop in the browser)
    if (typeof tickFruitRegen === 'function') tickFruitRegen(options.dt);

    if (simulatedNow >= nextWorldSampleMs) {
        const alive = characters.filter(char => char && char.state !== 'dead');
        const stageMix = { child: 0, young: 0, adult: 0, elder: 0 };
        for (const char of alive) {
            const stage = char?.getLifeStage ? char.getLifeStage() : (char?.isChild ? 'child' : 'adult');
            if (stageMix[stage] !== undefined) stageMix[stage] += 1;
        }
        const districts = typeof getDistrictSummaries === 'function'
            ? getDistrictSummaries(characters, prevDistrictState)
            : [];
        const nextDistrictState = new Map();
        for (const char of characters) {
            if (!char?.gridPos) continue;
            nextDistrictState.set(char.id, {
                districtIndex: typeof getDistrictIndexForPosition === 'function' ? getDistrictIndexForPosition(char.gridPos, districtMode) : 0,
                alive: char.state !== 'dead'
            });
        }
        prevDistrictState = nextDistrictState;

        globalThis.window.__simTelemetry.addWorldSample({
            t: Date.now(),
            pop: alive.length,
            stageMix,
            districtMode,
            activeDistrictIndex,
            activeDistrict: districts[activeDistrictIndex] ?? null,
            districts,
        });
        nextWorldSampleMs += sampleIntervalMs;
    }
}

globalThis.window.stopTelemetryTest();

const alive = characters.filter(char => char && char.state !== 'dead');
const averageNeeds = alive.length
    ? alive.reduce((acc, char) => {
        acc.hunger += char.needs?.hunger || 0;
        acc.energy += char.needs?.energy || 0;
        acc.safety += char.needs?.safety || 0;
        acc.social += char.needs?.social || 0;
        return acc;
    }, { hunger: 0, energy: 0, safety: 0, social: 0 })
    : { hunger: 0, energy: 0, safety: 0, social: 0 };

if (alive.length > 0) {
    averageNeeds.hunger = +(averageNeeds.hunger / alive.length).toFixed(2);
    averageNeeds.energy = +(averageNeeds.energy / alive.length).toFixed(2);
    averageNeeds.safety = +(averageNeeds.safety / alive.length).toFixed(2);
    averageNeeds.social = +(averageNeeds.social / alive.length).toFixed(2);
}

const telemetry = globalThis.window.__simTelemetry.exportObject();
let telemetryPath = null;
if (outFile) {
    telemetryPath = path.resolve(process.cwd(), outFile);
    fs.mkdirSync(path.dirname(telemetryPath), { recursive: true });
    fs.writeFileSync(telemetryPath, JSON.stringify(telemetry, null, 2), 'utf8');
}

const summary = {
    mode: 'headless-sim',
    ticks: options.ticks,
    dt: options.dt,
    simulatedSeconds: options.seconds,
    simulatedMinutes: +(options.seconds / 60).toFixed(2),
    districtMode,
    populationStart: options.population,
    populationEnd: alive.length,
    births: globalThis.window.getPopulationStats().births,
    deaths: globalThis.window.getPopulationStats().deaths,
    totalCharactersSeen: characters.length,
    telemetrySamples: telemetry.samples.length,
    worldSamples: telemetry.worldSamples.length,
    events: telemetry.events.length,
    worldBlocks: worldData.size,
    averageNeeds,
    telemetryPath,
};

realConsoleLog(JSON.stringify(summary, null, 2));

console.log = realConsoleLog;
Date.now = realDateNow;
globalThis.performance = realPerformance;
globalThis.setTimeout = realSetTimeout;
globalThis.clearTimeout = realClearTimeout;
globalThis.setInterval = realSetInterval;
globalThis.clearInterval = realClearInterval;
