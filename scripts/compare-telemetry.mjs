#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function usage() {
  console.log('Usage: node scripts/compare-telemetry.mjs <baseline.json> <candidate.json>');
}

const baselineArg = process.argv[2];
const candidateArg = process.argv[3];
if (!baselineArg || !candidateArg) {
  usage();
  process.exit(1);
}

function resolveAndRead(inputPath) {
  const absPath = path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`file not found: ${absPath}`);
  }
  return {
    absPath,
    payload: JSON.parse(fs.readFileSync(absPath, 'utf8'))
  };
}

function asNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pct(v) {
  return `${(v * 100).toFixed(1)}%`;
}

function signed(n, digits = 2) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 'n/a';
  const s = v >= 0 ? '+' : '';
  return `${s}${v.toFixed(digits)}`;
}

function summarize(payload) {
  const meta = payload.meta || {};
  const samples = Array.isArray(payload.samples) ? payload.samples : [];
  const events = Array.isArray(payload.events) ? payload.events : [];

  const actionCounts = new Map();
  let socializeCount = 0;
  let wanderCount = 0;
  let lowEnergyCount = 0;
  let lowHungerCount = 0;

  for (const s of samples) {
    const action = String(s.action || 'null');
    actionCounts.set(action, (actionCounts.get(action) || 0) + 1);
    if (action === 'SOCIALIZE') socializeCount++;
    if (action === 'WANDER') wanderCount++;
    if (s.decisionPressure?.lowEnergy) lowEnergyCount++;
    if (s.decisionPressure?.lowHunger) lowHungerCount++;
  }

  const n = Math.max(1, samples.length);
  const population = meta.population || {};
  const deathsByCause = population.deathsByCause || {};

  const birthEvents = events.filter(e => e && e.kind === 'birth').length;
  const deathEvents = events.filter(e => e && e.kind === 'death');
  const deathByCauseEvents = deathEvents.reduce((acc, e) => {
    const c = typeof e?.cause === 'string' ? e.cause : 'unknown';
    acc[c] = (acc[c] || 0) + 1;
    return acc;
  }, {});

  const deaths = asNum(population.deaths, 0);
  const births = asNum(population.births, 0);

  return {
    file: path.basename(payload?.meta?.sourceFile || ''),
    durationSec: asNum(meta.durationMs, 0) / 1000,
    sampleCount: samples.length,
    socializeRatio: socializeCount / n,
    wanderRatio: wanderCount / n,
    lowEnergyRatio: lowEnergyCount / n,
    lowHungerRatio: lowHungerCount / n,
    births,
    deaths,
    birthDeathRatio: deaths > 0 ? births / deaths : (births > 0 ? Infinity : 0),
    deathStarvation: asNum(deathsByCause.starvation, 0),
    deathOldAge: asNum(deathsByCause.old_age, 0),
    deathUnknown: asNum(deathsByCause.unknown, 0),
    birthEvents,
    deathEvents: deathEvents.length,
    deathByCauseEvents,
    actionCounts
  };
}

function printSummary(label, s) {
  console.log(`\n[${label}]`);
  console.log(`- durationSec: ${s.durationSec.toFixed(1)}`);
  console.log(`- sampleCount: ${s.sampleCount}`);
  console.log(`- socializeRatio: ${pct(s.socializeRatio)}`);
  console.log(`- wanderRatio: ${pct(s.wanderRatio)}`);
  console.log(`- lowEnergyRatio: ${pct(s.lowEnergyRatio)}`);
  console.log(`- lowHungerRatio: ${pct(s.lowHungerRatio)}`);
  console.log(`- births/deaths: ${s.births}/${s.deaths}`);
  console.log(`- birthDeathRatio: ${Number.isFinite(s.birthDeathRatio) ? s.birthDeathRatio.toFixed(2) : 'inf'}`);
  console.log(`- deathsByCause(meta): starvation=${s.deathStarvation}, old_age=${s.deathOldAge}, unknown=${s.deathUnknown}`);
  console.log(`- events: births=${s.birthEvents}, deaths=${s.deathEvents}`);
}

function printDelta(base, cand) {
  const deltaBirthDeath = (cand.births - base.births);
  const deltaDeaths = (cand.deaths - base.deaths);

  console.log('\n[Delta: candidate - baseline]');
  console.log(`- socializeRatio: ${signed((cand.socializeRatio - base.socializeRatio) * 100, 2)} pts`);
  console.log(`- wanderRatio: ${signed((cand.wanderRatio - base.wanderRatio) * 100, 2)} pts`);
  console.log(`- lowEnergyRatio: ${signed((cand.lowEnergyRatio - base.lowEnergyRatio) * 100, 2)} pts`);
  console.log(`- lowHungerRatio: ${signed((cand.lowHungerRatio - base.lowHungerRatio) * 100, 2)} pts`);
  console.log(`- births: ${signed(deltaBirthDeath, 0)}`);
  console.log(`- deaths: ${signed(deltaDeaths, 0)}`);

  const baseBdr = base.birthDeathRatio;
  const candBdr = cand.birthDeathRatio;
  if (Number.isFinite(baseBdr) && Number.isFinite(candBdr)) {
    console.log(`- birthDeathRatio: ${signed(candBdr - baseBdr, 2)}`);
  } else {
    console.log('- birthDeathRatio: n/a (one side is inf)');
  }
}

function main() {
  let baselineData;
  let candidateData;
  try {
    baselineData = resolveAndRead(baselineArg);
    candidateData = resolveAndRead(candidateArg);
  } catch (err) {
    console.error(`[compare-telemetry] ${err.message}`);
    process.exit(1);
  }

  const baseline = summarize(baselineData.payload);
  const candidate = summarize(candidateData.payload);

  console.log('=== Telemetry Comparison ===');
  console.log(`baseline:  ${baselineData.absPath}`);
  console.log(`candidate: ${candidateData.absPath}`);

  printSummary('Baseline', baseline);
  printSummary('Candidate', candidate);
  printDelta(baseline, candidate);

  console.log('\nInterpretation hints:');
  console.log('- Better social/reproduction: socializeRatio up, birthDeathRatio up, wanderRatio down.');
  console.log('- Better survival pressure: lowEnergyRatio and lowHungerRatio down.');
}

main();
