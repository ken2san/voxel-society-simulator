/**
 * export-telemetry.mjs
 *
 * Converts a raw telemetry JSON into an AI-analysis-friendly format.
 *
 * Usage:
 *   node scripts/export-telemetry.mjs <input.json> [output.json]
 *
 * If output path is omitted, writes to stdout.
 *
 * Output structure:
 * {
 *   meta:             { params, duration, worldSize }
 *   worldTimeline:    [ { t_sec, fruitCount, pop, groups, isolated, stageMix, conflictPairs, avgNeeds, season, districts } ]
 *   characterProfiles:[ { id, gen, isChild, lifeStageFirst, lifeStageLast, parentIds, born_t, died_t, cause, lifespan, peakLifeRatio } ]
 *   stageSummary:     [ { t_sec, child, young, adult, elder, dependencyRatio } ]
 *   districtSummary:  [ { t_sec, districtMode, activeDistrictIndex, districts } ]
 *   socialSummary:    { t_sec: { avgRelationships, avgAffinity, isolationRate, conflictRate } }
 *   events:           [ { t_sec, kind, ...fields } ]
 * }
 */

import fs from 'fs';
import path from 'path';

// ── helpers ─────────────────────────────────────────────────────────────────

function avg(arr) {
    if (!arr.length) return 0;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function round2(n) { return Math.round(n * 100) / 100; }

// ── main ─────────────────────────────────────────────────────────────────────

const inputPath  = process.argv[2];
const outputPath = process.argv[3] || null;

if (!inputPath) {
    console.error('Usage: node export-telemetry.mjs <input.json> [output.json]');
    process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const { meta, samples = [], worldSamples = [], events = [] } = raw;

const recStart  = meta.startedAt;
const simStart  = meta.population?.startedAt ?? recStart;
const toSec     = t => Math.round((t - recStart) / 1000);
const toSimSec  = t => Math.round((t - simStart)  / 1000);

// ── meta ─────────────────────────────────────────────────────────────────────

const exportMeta = {
    recordingDurationSec: Math.round(meta.durationMs / 1000),
    simOffsetSec: Math.round((recStart - simStart) / 1000),
    params: meta.runtime ?? {},
    populationSummary: meta.population ?? null,
    dropped: meta.counters ?? {}
};

// ── worldTimeline ─────────────────────────────────────────────────────────────
// Use worldSamples if present; otherwise derive pop from per-char samples.

const stageMixBySecond = new Map();
for (const s of samples) {
    if (s.state === 'dead') continue;
    const sec = toSec(s.t);
    if (!stageMixBySecond.has(sec)) stageMixBySecond.set(sec, { child: 0, young: 0, adult: 0, elder: 0, _ids: new Set() });
    const bucket = stageMixBySecond.get(sec);
    if (bucket._ids.has(s.id)) continue;
    bucket._ids.add(s.id);
    const st = s.lifeStage ?? (s.isChild ? 'child' : 'adult');
    if (bucket[st] !== undefined) bucket[st] += 1;
}
for (const bucket of stageMixBySecond.values()) delete bucket._ids;

let worldTimeline = [];

if (worldSamples.length > 0) {
    worldTimeline = worldSamples.map(s => ({
        t_sec:        toSec(s.t),
        sim_sec:      toSimSec(s.t),
        fruitCount:   s.fruitCount,
        pop:          s.pop,
        groups:       s.groups,
        isolated:     s.isolated,
        stageMix:     s.stageMix ?? stageMixBySecond.get(toSec(s.t)) ?? null,
        conflictPairs: s.conflictPairs,
        avgNeeds:     s.avgNeeds,
        season:       s.season,
        districtMode: s.districtMode ?? 1,
        activeDistrictIndex: s.activeDistrictIndex ?? 0,
        activeDistrict: s.activeDistrict ?? null,
        districts:    s.districts ?? []
    }));
} else {
    // Fallback: derive from per-char samples (older telemetry files)
    const bySecond = new Map();
    for (const s of samples) {
        const sec = toSec(s.t);
        if (!bySecond.has(sec)) bySecond.set(sec, []);
        bySecond.get(sec).push(s);
    }
    for (const [sec, group] of [...bySecond.entries()].sort((a, b) => a[0] - b[0])) {
        const alive = group.filter(s => s.state !== 'dead');
        worldTimeline.push({
            t_sec:    sec,
            sim_sec:  sec + Math.round((recStart - simStart) / 1000),
            pop:      new Set(alive.map(s => s.id)).size,
            avgNeeds: {
                hunger: round2(avg(alive.map(s => s.needs?.hunger ?? 0))),
                energy: round2(avg(alive.map(s => s.needs?.energy ?? 0))),
                safety: round2(avg(alive.map(s => s.needs?.safety ?? 0))),
                social: round2(avg(alive.map(s => s.needs?.social ?? 0)))
            },
            stageMix: stageMixBySecond.get(sec) ?? (() => {
                const mix = { child: 0, young: 0, adult: 0, elder: 0 };
                for (const s of alive) {
                    const st = s.lifeStage ?? (s.isChild ? 'child' : 'adult');
                    if (mix[st] !== undefined) mix[st] += 1;
                }
                return mix;
            })()
        });
    }
}

// ── characterProfiles ─────────────────────────────────────────────────────────
// One entry per character: birth, death, needs trajectory, etc.

const charMap = new Map(); // id → { earliest, latest, allSamples[] }
for (const s of samples) {
    if (!charMap.has(s.id)) charMap.set(s.id, { earliest: s, latest: s, samples: [] });
    const entry = charMap.get(s.id);
    if (s.t < entry.earliest.t) entry.earliest = s;
    if (s.t > entry.latest.t)   entry.latest   = s;
    entry.samples.push(s);
}

// Birth events from events array
const birthByChildId = new Map();
for (const e of events) {
    if (e.kind === 'birth' && e.childId != null) birthByChildId.set(e.childId, e);
}
// Death events
const deathByCharId = new Map();
for (const e of events) {
    if (e.kind === 'death' && e.id != null) deathByCharId.set(e.id, e);
}

const characterProfiles = [];
for (const [id, entry] of charMap.entries()) {
    const { earliest, latest, samples: charSamples } = entry;
    const lifeRatios = charSamples.map(s => s.lifeRatio ?? 0);
    const peakLifeRatio = round2(Math.max(...lifeRatios));

    // Need trajectory: average per need at 10% lifeRatio buckets
    const needTrajectory = {};
    for (let bucket = 0; bucket <= 9; bucket++) {
        const lo = bucket * 0.1, hi = lo + 0.1;
        const inBucket = charSamples.filter(s => (s.lifeRatio ?? 0) >= lo && (s.lifeRatio ?? 0) < hi);
        if (inBucket.length) {
            needTrajectory[`${Math.round(lo * 100)}%`] = {
                hunger: round2(avg(inBucket.map(s => s.needs?.hunger ?? 0))),
                energy: round2(avg(inBucket.map(s => s.needs?.energy ?? 0))),
                safety: round2(avg(inBucket.map(s => s.needs?.safety ?? 0))),
                social: round2(avg(inBucket.map(s => s.needs?.social ?? 0)))
            };
        }
    }

    const birthEvt  = birthByChildId.get(id);
    const deathEvt  = deathByCharId.get(id);
    const isDead    = latest.state === 'dead' || !!deathEvt;

    characterProfiles.push({
        id,
        generation:    earliest.generation ?? 0,
        isChild:       !!earliest.isChild,
        lifeStageFirst: earliest.lifeStage ?? (earliest.isChild ? 'child' : 'adult'),
        lifeStageLast:  latest.lifeStage ?? (latest.isChild ? 'child' : 'adult'),
        parentIds:     birthEvt?.parents ?? null,
        born_t_sec:    birthEvt ? toSec(birthEvt.t) : toSec(earliest.t),
        died_t_sec:    deathEvt ? toSec(deathEvt.t) : (isDead ? toSec(latest.t) : null),
        cause:         deathEvt?.cause ?? null,
        lifespan:      earliest.lifespan ?? null,
        peakLifeRatio,
        finalNeeds:    latest.needs ?? null,
        personality:   earliest.personality ?? null,
        groupHistory:  (() => {
            const groups = [];
            let cur = null;
            for (const s of charSamples) {
                if (s.groupId !== cur) { groups.push({ groupId: s.groupId, at_sec: toSec(s.t) }); cur = s.groupId; }
            }
            return groups;
        })(),
        needTrajectory,
        conflictExposure: round2(charSamples.filter(s => s.nearEnemy).length / Math.max(1, charSamples.length))
    });
}

// sort by generation then born_t
characterProfiles.sort((a, b) => a.generation - b.generation || (a.born_t_sec ?? 0) - (b.born_t_sec ?? 0));

// ── stageSummary ──────────────────────────────────────────────────────────────

const stageSummary = worldTimeline.map(w => {
    const mix = w.stageMix ?? { child: 0, young: 0, adult: 0, elder: 0 };
    const working = (mix.young || 0) + (mix.adult || 0);
    const dependents = (mix.child || 0) + (mix.elder || 0);
    return {
        t_sec: w.t_sec,
        child: mix.child || 0,
        young: mix.young || 0,
        adult: mix.adult || 0,
        elder: mix.elder || 0,
        dependencyRatio: round2(dependents / Math.max(1, working))
    };
});

// ── socialSummary ─────────────────────────────────────────────────────────────

const socialBySecond = new Map();
for (const s of samples) {
    if (!s.social) continue;
    const sec = toSec(s.t);
    if (!socialBySecond.has(sec)) socialBySecond.set(sec, []);
    socialBySecond.get(sec).push(s);
}

const socialSummary = [];
for (const [sec, group] of [...socialBySecond.entries()].sort((a, b) => a[0] - b[0])) {
    const alive = group.filter(s => s.state !== 'dead');
    if (!alive.length) continue;
    socialSummary.push({
        t_sec:              sec,
        avgRelationships:   round2(avg(alive.map(s => s.social?.relationshipCount ?? 0))),
        avgAffinity:        round2(avg(alive.map(s => s.social?.avgAffinity ?? 0))),
        avgGroupSize:       round2(avg(alive.map(s => s.social?.groupSize ?? 1))),
        isolationRate:      round2(alive.filter(s => !s.groupId).length / alive.length),
        conflictRate:       round2(alive.filter(s => s.nearEnemy).length / alive.length)
    });
}

const districtSummary = worldTimeline
    .filter(w => Array.isArray(w.districts) && w.districts.length > 0)
    .map(w => ({
        t_sec: w.t_sec,
        sim_sec: w.sim_sec,
        districtMode: w.districtMode ?? 1,
        activeDistrictIndex: w.activeDistrictIndex ?? 0,
        activeDistrict: w.activeDistrict ?? null,
        districts: w.districts
    }));

// ── events (re-keyed with sec) ─────────────────────────────────────────────

function keepMeaningfulEvent(e) {
    if (!e) return false;
    if (e.kind !== 'action-transition') return true;
    const getAction = (value) => {
        const part = String(value || '').split('|').pop();
        return (!part || part === '-') ? null : part;
    };
    const fromAction = getAction(e.from);
    const toAction = getAction(e.to ?? e.action);
    const importantActions = new Set(['COLLECT_FOOD', 'EAT', 'REST', 'SOCIALIZE', 'BUILD_HOME', 'DIG', 'FLEE', 'ATTACK', 'REPRODUCE']);
    if (fromAction === toAction && (toAction === 'WANDER' || toAction === null)) return false;
    return importantActions.has(fromAction) || importantActions.has(toAction);
}

const exportEvents = events
    .filter(keepMeaningfulEvent)
    .map(e => ({ ...e, t_sec: toSec(e.t), sim_sec: toSimSec(e.t) }));

// ── assemble ──────────────────────────────────────────────────────────────────

const output = {
    meta:               exportMeta,
    worldTimeline,
    characterProfiles,
    stageSummary,
    districtSummary,
    socialSummary,
    events:             exportEvents
};

const json = JSON.stringify(output, null, 2);

if (outputPath) {
    fs.writeFileSync(outputPath, json, 'utf8');
    console.error(`[export-telemetry] wrote ${outputPath} (${(json.length / 1024).toFixed(1)} KB, ${characterProfiles.length} characters, ${worldTimeline.length} world ticks)`);
} else {
    process.stdout.write(json);
}
