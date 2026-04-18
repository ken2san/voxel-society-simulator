import { setSimulationIO, createHeadlessSimulationIO } from '../sim-core/interfaces.js';

function readArg(name, fallback) {
    const prefix = `--${name}=`;
    const hit = process.argv.find(arg => arg.startsWith(prefix));
    if (!hit) return fallback;
    const value = Number(hit.slice(prefix.length));
    return Number.isFinite(value) ? value : fallback;
}

const options = {
    ticks: Math.max(1, Math.floor(readArg('ticks', 240))),
    population: Math.max(1, Math.floor(readArg('population', 10))),
    dt: Math.max(0.01, readArg('dt', 0.25))
};

setSimulationIO(createHeadlessSimulationIO());

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
} = worldModule;

const { Character } = characterModule;

globalThis.window = {
    characters,
    simulationRunning: true,
    DEBUG_MODE: false,
    worldReservations: new Map(),
};

resetNextCharacterId();
characters.length = 0;
worldData.clear();
generateTerrain();

for (let i = 0; i < options.population; i++) {
    const spawnPos = findValidSpawn();
    if (spawnPos) spawnCharacter(spawnPos);
}

Character.initializeAllRelationships(characters);

let simTime = 0;
for (let tick = 0; tick < options.ticks; tick++) {
    globalThis.window.characters = characters;
    const isNight = (simTime % DAY_DURATION) > (DAY_DURATION / 2);
    const currentChars = [...characters];
    for (const char of currentChars) {
        if (char && typeof char.update === 'function') {
            char.update(options.dt, isNight, null);
        }
    }
    simTime += options.dt;
}

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

const summary = {
    mode: 'headless-sim',
    ticks: options.ticks,
    dt: options.dt,
    populationStart: options.population,
    populationEnd: alive.length,
    totalCharactersSeen: characters.length,
    worldBlocks: worldData.size,
    averageNeeds,
};

console.log(JSON.stringify(summary, null, 2));
