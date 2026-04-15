#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function usage() {
  console.log('Usage: node scripts/regress-telemetry.mjs [--dir <path>] [--recent <n>] [--target <metric>]');
  console.log('Targets: finalPop, peakPop, avgRelationships, avgAffinity, bondedRate, allyRate, wanderRate, lowEnergyRate');
}

function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function variance(arr) {
  if (arr.length < 2) return 0;
  const mean = avg(arr);
  return avg(arr.map(v => (v - mean) ** 2));
}

function stddev(arr) {
  return Math.sqrt(variance(arr));
}

function parseArgs(argv) {
  const out = {
    dir: '/Users/kenji/Downloads',
    recent: 30,
    targets: []
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dir') {
      out.dir = argv[++i];
    } else if (arg === '--recent') {
      out.recent = Math.max(1, Number(argv[++i]) || 30);
    } else if (arg === '--target') {
      out.targets.push(String(argv[++i] || ''));
    } else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
  }

  return out;
}

function readTelemetryRows(dir, recent) {
  if (!fs.existsSync(dir)) {
    throw new Error(`directory not found: ${dir}`);
  }

  const files = fs.readdirSync(dir)
    .filter(name => /^telemetry-.*\.json$/i.test(name))
    .map(name => {
      const fullPath = path.join(dir, name);
      return {
        name,
        fullPath,
        mtimeMs: fs.statSync(fullPath).mtimeMs
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, recent);

  const rows = [];
  for (const file of files) {
    try {
      const payload = JSON.parse(fs.readFileSync(file.fullPath, 'utf8'));
      const runtime = payload.runtime || payload.meta?.runtime || payload.metadata?.runtime || {};
      const samples = Array.isArray(payload.samples) ? payload.samples : [];
      const world = Array.isArray(payload.worldSamples)
        ? payload.worldSamples
        : (Array.isArray(payload.worldTimeline) ? payload.worldTimeline : []);

      const rels = samples.map(s => Number(s.social?.relationshipCount || 0)).filter(Number.isFinite);
      const affinities = samples.map(s => Number(s.social?.avgAffinity || 0)).filter(Number.isFinite);
      const bondedRate = avg(samples.map(s => Number(s.social?.bondedCount || 0) > 0 ? 1 : 0));
      const allyRate = avg(samples.map(s => Number(s.social?.allyCount || 0) > 0 ? 1 : 0));
      const wanderRate = avg(samples.map(s => s.action === 'WANDER' ? 1 : 0));
      const lowEnergyRate = avg(samples.map(s => Number(s.needs?.energy || 0) <= 10 ? 1 : 0));
      const popSeries = world.map(w => Number(w.pop || 0)).filter(Number.isFinite);

      rows.push({
        file: file.name,
        runtime,
        metrics: {
          finalPop: popSeries.length ? popSeries[popSeries.length - 1] : NaN,
          peakPop: popSeries.length ? Math.max(...popSeries) : NaN,
          avgRelationships: avg(rels),
          avgAffinity: avg(affinities),
          bondedRate,
          allyRate,
          wanderRate,
          lowEnergyRate
        }
      });
    } catch {
      // ignore malformed files
    }
  }

  return rows;
}

function solveLinearSystem(matrix, vector) {
  const n = matrix.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-10) return null;
    if (pivot !== col) [a[col], a[pivot]] = [a[pivot], a[col]];

    const pivotVal = a[col][col];
    for (let j = col; j <= n; j += 1) a[col][j] /= pivotVal;

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let j = col; j <= n; j += 1) {
        a[row][j] -= factor * a[col][j];
      }
    }
  }

  return a.map(row => row[n]);
}

function fitRegression(rows, targetKey, featureKeys) {
  const cleanRows = rows.filter(row => Number.isFinite(row.metrics[targetKey]));
  if (cleanRows.length < 4) {
    return { error: `not enough usable runs for ${targetKey}` };
  }

  const usableFeatures = featureKeys.filter(key => {
    const vals = cleanRows.map(row => Number(row.runtime[key])).filter(Number.isFinite);
    return vals.length === cleanRows.length && new Set(vals).size > 1;
  });

  if (usableFeatures.length === 0) {
    return { error: `no varying parameters available for ${targetKey}` };
  }

  const limitedFeatures = usableFeatures.slice(0, Math.max(1, cleanRows.length - 2));
  const yRaw = cleanRows.map(row => Number(row.metrics[targetKey]));
  const yMean = avg(yRaw);
  const yStd = stddev(yRaw) || 1;
  const y = yRaw.map(v => (v - yMean) / yStd);

  const standardizedColumns = [];
  const featureStats = new Map();
  for (const key of limitedFeatures) {
    const values = cleanRows.map(row => Number(row.runtime[key]));
    const mean = avg(values);
    const sd = stddev(values) || 1;
    featureStats.set(key, { mean, sd, unique: new Set(values).size });
    standardizedColumns.push(values.map(v => (v - mean) / sd));
  }

  const X = cleanRows.map((_, rowIndex) => {
    const row = [1];
    for (const col of standardizedColumns) row.push(col[rowIndex]);
    return row;
  });

  const p = X[0].length;
  const xtx = Array.from({ length: p }, () => Array(p).fill(0));
  const xty = Array(p).fill(0);

  for (let i = 0; i < X.length; i += 1) {
    for (let r = 0; r < p; r += 1) {
      xty[r] += X[i][r] * y[i];
      for (let c = 0; c < p; c += 1) {
        xtx[r][c] += X[i][r] * X[i][c];
      }
    }
  }

  for (let d = 0; d < p; d += 1) xtx[d][d] += 1e-6;
  const beta = solveLinearSystem(xtx, xty);
  if (!beta) {
    return { error: `matrix solve failed for ${targetKey}` };
  }

  const predictions = X.map(row => row.reduce((sum, v, idx) => sum + v * beta[idx], 0));
  const ssRes = predictions.reduce((sum, pred, i) => sum + (y[i] - pred) ** 2, 0);
  const ssTot = y.reduce((sum, val) => sum + val ** 2, 0);
  const r2 = ssTot > 0 ? 1 - (ssRes / ssTot) : 0;

  const coefficients = limitedFeatures.map((key, idx) => ({
    key,
    beta: beta[idx + 1],
    ...featureStats.get(key)
  })).sort((a, b) => Math.abs(b.beta) - Math.abs(a.beta));

  return {
    runs: cleanRows.length,
    targetKey,
    r2,
    intercept: beta[0],
    coefficients
  };
}

function printModel(model) {
  if (model.error) {
    console.log(`\nTarget: ${model.error}`);
    return;
  }

  console.log(`\n=== Regression Target: ${model.targetKey} ===`);
  console.log(`runs: ${model.runs}`);
  console.log(`R²: ${model.r2.toFixed(3)}`);
  console.log('standardized effect sizes:');
  for (const coeff of model.coefficients) {
    const sign = coeff.beta >= 0 ? '+' : '';
    console.log(`- ${coeff.key}: ${sign}${coeff.beta.toFixed(3)}  (unique=${coeff.unique})`);
  }
}

const focusKeys = [
  'energyEmergencyThreshold',
  'explorationBaseRate',
  'explorationMinRate',
  'explorationMaxRate',
  'explorationAdaptBoost',
  'explorationForagePenalty',
  'explorationRestPenalty',
  'socialAdaptationBoost',
  'socialForagePenalty',
  'socialRestPenalty',
  'bondPersistence',
  'bondedAffinityThreshold',
  'allyAffinityThreshold',
  'affinityIncreaseRate',
  'affinityDecayRate',
  'supportGroupBonus',
  'supportAllyPresenceBonus',
  'supportBondedWeight',
  'supportAllyWeight',
  'initialAgeMaxRatio',
  'opportunityPressureWeight',
  'opportunitySupportWeight',
  'opportunityStabilityWeight'
];

function main() {
  const args = parseArgs(process.argv);
  const rows = readTelemetryRows(args.dir, args.recent);

  if (rows.length === 0) {
    console.log('No telemetry files found.');
    process.exit(0);
  }

  console.log('=== Telemetry Regression Scan ===');
  console.log(`directory: ${args.dir}`);
  console.log(`runs loaded: ${rows.length}`);

  const varied = focusKeys
    .map(key => {
      const values = rows.map(row => Number(row.runtime[key])).filter(Number.isFinite);
      return { key, unique: new Set(values).size, values: [...new Set(values)].sort((a, b) => a - b) };
    })
    .filter(item => item.unique > 1);

  if (varied.length === 0) {
    console.log('No meaningful parameter variation found across these runs.');
    console.log('Regression is not identifiable yet; run a small parameter sweep first.');
    process.exit(0);
  }

  console.log('varying parameters:');
  for (const item of varied) {
    console.log(`- ${item.key}: ${item.values.join(', ')}`);
  }

  const targets = args.targets.length
    ? args.targets
    : ['finalPop', 'avgRelationships', 'bondedRate', 'wanderRate', 'lowEnergyRate'];

  for (const targetKey of targets) {
    printModel(fitRegression(rows, targetKey, focusKeys));
  }
}

main();
