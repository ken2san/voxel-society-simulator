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
