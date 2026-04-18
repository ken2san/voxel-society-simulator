#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function readFlag(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find(arg => arg.startsWith(prefix));
  if (!hit) return fallback;
  return hit.slice(prefix.length);
}

function asNum(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const minutes = Math.max(1, asNum(readFlag('minutes', '5'), 5));
const districtMode = Math.max(1, asNum(readFlag('districtMode', '4'), 4));
const population = Math.max(1, asNum(readFlag('population', '48'), 48));
const outDir = path.resolve(process.cwd(), readFlag('outDir', 'telemetry/tuning'));
fs.mkdirSync(outDir, { recursive: true });

const candidates = [
  {
    label: 'baseline',
    params: {}
  },
  {
    label: 'bonded-support',
    params: {
      supportSeekingDrive: 0.18,
      socialAnchorBias: 0.28,
      bondPersistence: 1.45,
      pairReproductionCooldownSeconds: 28,
      minReproductionAgeRatio: 0.2
    }
  },
  {
    label: 'earlier-family',
    params: {
      initialAgeMaxRatio: 0.45,
      minReproductionAgeRatio: 0.16,
      pairReproductionCooldownSeconds: 24,
      reproductionCooldownSeconds: 8,
      homeBuildingPriority: 72
    }
  },
  {
    label: 'stable-overlap',
    params: {
      initialAgeMaxRatio: 0.38,
      characterLifespan: 420,
      supportSeekingDrive: 0.2,
      socialThreshold: 82,
      bondPersistence: 1.5
    }
  }
];

function scoreTelemetry(payload) {
  const meta = payload?.meta || {};
  const pop = meta?.population || {};
  const current = pop?.current || {};
  const stage = current?.stageCounts || {};
  const births = Number(pop?.births || 0);
  const deaths = Number(pop?.deaths || 0);
  const starvation = Number(pop?.deathsByCause?.starvation || 0);
  const oldAge = Number(pop?.deathsByCause?.old_age || 0);
  const alive = Number(current?.alive || 0);
  const maxGeneration = Number(current?.maxGeneration || 0);
  const youngAdults = Number(stage?.young || 0) + Number(stage?.adult || 0);
  const children = Number(stage?.child || 0);
  const elders = Number(stage?.elder || 0);
  const dependencyRatio = (children + elders) / Math.max(1, youngAdults);

  let score = 0;
  score += births * 8;
  score += maxGeneration * 20;
  score += alive * 0.5;
  score -= starvation * 20;
  score -= oldAge * 6;
  score -= deaths * 3;
  score -= Math.max(0, dependencyRatio - 1.8) * 12;
  return {
    score: +score.toFixed(2),
    births,
    deaths,
    starvation,
    oldAge,
    alive,
    maxGeneration,
    dependencyRatio: +dependencyRatio.toFixed(2)
  };
}

const results = [];

for (const candidate of candidates) {
  const outFile = path.join(outDir, `${candidate.label}.json`);
  const args = [
    'scripts/run-sim.mjs',
    `--minutes=${minutes}`,
    `--districtMode=${districtMode}`,
    `--population=${population}`,
    `--out=${outFile}`
  ];

  for (const [key, value] of Object.entries(candidate.params)) {
    args.push(`--set=${key}=${value}`);
  }

  const run = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20
  });

  if (run.status !== 0) {
    results.push({
      label: candidate.label,
      ok: false,
      error: (run.stderr || run.stdout || '').trim().split('\n').slice(-8).join('\n')
    });
    continue;
  }

  const payload = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  const scored = scoreTelemetry(payload);
  results.push({
    label: candidate.label,
    ok: true,
    file: outFile,
    params: candidate.params,
    ...scored
  });
}

results.sort((a, b) => (b.score || -Infinity) - (a.score || -Infinity));

console.log(JSON.stringify({
  mode: 'generation-tuning-sweep',
  minutes,
  districtMode,
  population,
  best: results.find(r => r.ok) || null,
  results
}, null, 2));
