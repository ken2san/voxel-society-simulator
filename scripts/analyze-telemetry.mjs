#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function usage() {
  console.log('Usage: node scripts/analyze-telemetry.mjs <telemetry.json>');
}

const inputPath = process.argv[2];
if (!inputPath) {
  usage();
  process.exit(1);
}

const absPath = path.resolve(process.cwd(), inputPath);
if (!fs.existsSync(absPath)) {
  console.error(`[analyze-telemetry] file not found: ${absPath}`);
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(fs.readFileSync(absPath, 'utf8'));
} catch (err) {
  console.error(`[analyze-telemetry] failed to parse JSON: ${err.message}`);
  process.exit(1);
}

const meta = payload.meta || {};
const samples = Array.isArray(payload.samples) ? payload.samples : [];
const events = Array.isArray(payload.events) ? payload.events : [];

if (samples.length === 0) {
  console.log('[analyze-telemetry] no samples found in telemetry file.');
  process.exit(0);
}

const byId = new Map();
for (const s of samples) {
  if (!byId.has(s.id)) byId.set(s.id, []);
  byId.get(s.id).push(s);
}

for (const arr of byId.values()) {
  arr.sort((a, b) => a.t - b.t);
}

const stallEventsById = new Map();
for (const e of events) {
  if (!stallEventsById.has(e.id)) stallEventsById.set(e.id, []);
  stallEventsById.get(e.id).push(e);
}

function pct(v) {
  return `${(v * 100).toFixed(1)}%`;
}

function summarizeChar(id, arr) {
  const n = arr.length;
  let wanderCount = 0;
  let idleCount = 0;
  let stuckLikeCount = 0;
  let lowEnergyCount = 0;
  let lowSafetyCount = 0;
  let highMicroPauseCount = 0;
  let noMoveWindows = 0;
  let moveDistancePrev = arr[0]?.moveDistance || 0;
  let longNoMoveStart = null;

  for (const s of arr) {
    if (s.action === 'WANDER') wanderCount++;
    if (s.state === 'idle') idleCount++;
    if ((s.pathLen || 0) === 0 && (s.action === 'WANDER' || s.state === 'moving')) stuckLikeCount++;
    if ((s.needs?.energy || 0) <= 10) lowEnergyCount++;
    if ((s.needs?.safety || 0) <= 10) lowSafetyCount++;
    if ((s.microPause || 0) > 1.2) highMicroPauseCount++;

    const moved = (s.moveDistance || 0) > moveDistancePrev;
    if (!moved) {
      if (longNoMoveStart === null) longNoMoveStart = s.t;
      if (s.t - longNoMoveStart >= 8000) {
        noMoveWindows++;
        longNoMoveStart = s.t + 1;
      }
    } else {
      longNoMoveStart = null;
      moveDistancePrev = s.moveDistance || moveDistancePrev;
    }
  }

  const stallEvents = (stallEventsById.get(id) || []).filter(e => e.kind === 'stall-detected').length;
  const recoveredEvents = (stallEventsById.get(id) || []).filter(e => e.kind === 'stall-recovered').length;

  return {
    id,
    samples: n,
    wanderRatio: wanderCount / n,
    idleRatio: idleCount / n,
    stuckLikeRatio: stuckLikeCount / n,
    lowEnergyRatio: lowEnergyCount / n,
    lowSafetyRatio: lowSafetyCount / n,
    highMicroPauseRatio: highMicroPauseCount / n,
    noMoveWindows,
    stallEvents,
    recoveredEvents
  };
}

const summaries = [];
for (const [id, arr] of byId.entries()) {
  summaries.push(summarizeChar(id, arr));
}

summaries.sort((a, b) => {
  const scoreA = a.stuckLikeRatio * 3 + a.lowEnergyRatio * 2 + a.noMoveWindows * 0.2 + a.stallEvents * 0.1;
  const scoreB = b.stuckLikeRatio * 3 + b.lowEnergyRatio * 2 + b.noMoveWindows * 0.2 + b.stallEvents * 0.1;
  return scoreB - scoreA;
});

console.log('=== Telemetry Summary ===');
console.log(`Duration(ms): ${meta.durationMs ?? 'unknown'}`);
console.log(`Samples: ${samples.length}`);
console.log(`Events: ${events.length}`);
if (meta.runtime) {
  console.log('Runtime parameters:');
  for (const [k, v] of Object.entries(meta.runtime)) {
    console.log(`  - ${k}: ${v}`);
  }
}
if (meta.population) {
  const p = meta.population;
  const born = Number(p.initialPopulation || 0) + Number(p.births || 0);
  console.log('Population counters:');
  console.log(`  - initialPopulation: ${Number(p.initialPopulation || 0)}`);
  console.log(`  - totalBorn: ${born}`);
  console.log(`  - births: ${Number(p.births || 0)}`);
  console.log(`  - deaths: ${Number(p.deaths || 0)}`);
  console.log(`  - deaths.starvation: ${Number(p.deathsByCause?.starvation || 0)}`);
  console.log(`  - deaths.old_age: ${Number(p.deathsByCause?.old_age || 0)}`);
  console.log(`  - deaths.unknown: ${Number(p.deathsByCause?.unknown || 0)}`);
}

const birthEvents = events.filter(e => e && e.kind === 'birth').length;
const deathEvents = events.filter(e => e && e.kind === 'death');
const actionTransitions = events.filter(e => e && e.kind === 'action-transition');
const deathByCause = deathEvents.reduce((acc, e) => {
  const c = e && typeof e.cause === 'string' ? e.cause : 'unknown';
  acc[c] = (acc[c] || 0) + 1;
  return acc;
}, {});
const actionPairs = actionTransitions.reduce((acc, e) => {
  const from = e && e.from ? e.from : 'null';
  const to = e && e.to ? e.to : 'null';
  const key = `${from} -> ${to}`;
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});
if (birthEvents > 0 || deathEvents.length > 0 || actionTransitions.length > 0) {
  console.log('Lifecycle events:');
  console.log(`  - birthEvents: ${birthEvents}`);
  console.log(`  - deathEvents: ${deathEvents.length}`);
  for (const [cause, count] of Object.entries(deathByCause)) {
    console.log(`  - deathEvents.${cause}: ${count}`);
  }
  console.log(`  - actionTransitions: ${actionTransitions.length}`);
  const topActionPairs = Object.entries(actionPairs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  for (const [pair, count] of topActionPairs) {
    console.log(`  - actionTransitions.${pair}: ${count}`);
  }
}

console.log('\n=== Top Suspect Characters (stuck progression) ===');
for (const s of summaries.slice(0, 10)) {
  console.log(
    [
      `id=${s.id}`,
      `wander=${pct(s.wanderRatio)}`,
      `idle=${pct(s.idleRatio)}`,
      `stuckLike=${pct(s.stuckLikeRatio)}`,
      `lowEnergy=${pct(s.lowEnergyRatio)}`,
      `lowSafety=${pct(s.lowSafetyRatio)}`,
      `microPause>${1.2}s=${pct(s.highMicroPauseRatio)}`,
      `noMoveWindows=${s.noMoveWindows}`,
      `stall=${s.stallEvents}/${s.recoveredEvents}`
    ].join(' | ')
  );
}

const global = summaries.reduce(
  (acc, s) => {
    acc.wander += s.wanderRatio;
    acc.stuck += s.stuckLikeRatio;
    acc.lowEnergy += s.lowEnergyRatio;
    acc.lowSafety += s.lowSafetyRatio;
    acc.stall += s.stallEvents;
    acc.recovered += s.recoveredEvents;
    return acc;
  },
  { wander: 0, stuck: 0, lowEnergy: 0, lowSafety: 0, stall: 0, recovered: 0 }
);

const m = Math.max(1, summaries.length);
console.log('\n=== Aggregate Risk Signals ===');
console.log(`avgWanderRatio: ${pct(global.wander / m)}`);
console.log(`avgStuckLikeRatio: ${pct(global.stuck / m)}`);
console.log(`avgLowEnergyRatio: ${pct(global.lowEnergy / m)}`);
console.log(`avgLowSafetyRatio: ${pct(global.lowSafety / m)}`);
console.log(`stallDetected: ${global.stall}, stallRecovered: ${global.recovered}`);

console.log('\nHint: If avgLowEnergyRatio is high and avgWanderRatio is high together, raise energy emergency threshold and reduce wander fallback pressure.');

// --- Age distribution over time (cohort wave detector) ---
// Groups samples into 30-second simulation-time buckets.
// Reports lifeRatio distribution (p25/median/p75) and population count.
// A narrow band that shifts uniformly is a synchronized cohort wave.
{
  if (samples.length > 0 && samples[0].lifeRatio !== undefined) {
    const recStart = meta.startedAt ?? samples[0].t;
    const BUCKET_SEC = 30;
    const buckets = new Map(); // bucket index -> { lifeRatios, ids }

    for (const s of samples) {
      const bucketIdx = Math.floor((s.t - recStart) / 1000 / BUCKET_SEC);
      if (!buckets.has(bucketIdx)) buckets.set(bucketIdx, { lifeRatios: [], ids: new Set() });
      const b = buckets.get(bucketIdx);
      b.lifeRatios.push(s.lifeRatio);
      b.ids.add(s.id);
    }

    function percentile(sorted, p) {
      const i = Math.floor(sorted.length * p);
      return sorted[Math.min(i, sorted.length - 1)];
    }

    console.log('\n=== Age Distribution Over Time (cohort wave detector) ===');
    console.log('bucket_start_s  pop  lifeRatio[p25/p50/p75]');
    const sortedBuckets = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]);
    for (const [idx, b] of sortedBuckets) {
      const tSec = idx * BUCKET_SEC;
      const sorted = b.lifeRatios.slice().sort((a, c) => a - c);
      const p25 = percentile(sorted, 0.25).toFixed(2);
      const p50 = percentile(sorted, 0.50).toFixed(2);
      const p75 = percentile(sorted, 0.75).toFixed(2);
      const pop = b.ids.size;
      const bar = '█'.repeat(pop);
      console.log(`  t=${String(tSec).padStart(5)}s  pop=${String(pop).padStart(2)}  [${p25} / ${p50} / ${p75}]  ${bar}`);
    }
    console.log('Hint: If p25-p75 band is narrow and p50 approaches 1.0 uniformly across buckets, a cohort mass-death event is imminent.');
  }
}

// --- Social network summary (ideology gap verification) ---
{
  const socialSamples = samples.filter(s => s.social);
  if (socialSamples.length > 0) {
    const byIdSocial = new Map();
    for (const s of socialSamples) {
      if (!byIdSocial.has(s.id)) byIdSocial.set(s.id, []);
      byIdSocial.get(s.id).push(s);
    }
    // Per-character: last-known avgAffinity and groupSize
    const charStats = [];
    for (const [id, arr] of byIdSocial.entries()) {
      const last = arr[arr.length - 1];
      charStats.push({
        id,
        relationshipCount: last.social.relationshipCount,
        avgAffinity: last.social.avgAffinity,
        groupSize: last.social.groupSize,
        gen: last.generation
      });
    }
    charStats.sort((a, b) => a.id - b.id);

    // group size distribution
    const gsMap = new Map();
    for (const c of charStats) {
      gsMap.set(c.groupSize, (gsMap.get(c.groupSize) || 0) + 1);
    }

    const totalAvgAffinity = charStats.reduce((s, c) => s + c.avgAffinity, 0) / Math.max(1, charStats.length);
    const totalAvgRel = charStats.reduce((s, c) => s + c.relationshipCount, 0) / Math.max(1, charStats.length);

    console.log('\n=== Social Network Summary ===');
    console.log(`avgRelationshipCount: ${totalAvgRel.toFixed(1)}`);
    console.log(`avgAffinity (all chars, last snapshot): ${totalAvgAffinity.toFixed(1)}`);
    console.log('Group size distribution (char count per group size):');
    for (const [size, count] of Array.from(gsMap.entries()).sort((a, b) => a[0] - b[0])) {
      console.log(`  groupSize=${size}: ${count} chars`);
    }
    console.log('Hint: Many chars in groupSize=1 = ideological fragmentation working. Larger clusters = homogeneous community forming.');
  }
}
