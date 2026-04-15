#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DOWNLOADS_DIR = path.join(os.homedir(), 'Downloads');

const SCENARIOS = {
  'd1-bonding': {
    label: 'D1 bonding baseline',
    checks: [
      { metric: 'districtMode', op: '=', value: 1, label: 'single district mode' },
      { metric: 'avgRelationships', op: '>=', value: 16, label: 'dense enough relationship network' },
      { metric: 'avgAffinity', op: '>=', value: 18, label: 'affinity accumulation' },
      { metric: 'allySampleRate', op: '>=', value: 0.12, label: 'ally emergence' },
      { metric: 'bondedSampleRate', op: '>=', value: 0.03, label: 'bond emergence' },
      { metric: 'finalPopulation', op: '>=', value: 8, label: 'population retention' }
    ]
  },
  'd1-dense': {
    label: 'D1 dense population',
    checks: [
      { metric: 'districtMode', op: '=', value: 1, label: 'single district mode' },
      { metric: 'peakPopulation', op: '>=', value: 20, label: 'dense run context' },
      { metric: 'avgRelationships', op: '>=', value: 18, label: 'very strong contact network' },
      { metric: 'allySampleRate', op: '>=', value: 0.16, label: 'ally formation at scale' },
      { metric: 'bondedSampleRate', op: '>=', value: 0.05, label: 'bond formation at scale' }
    ]
  },
  'district-observation': {
    label: 'Multi-district observation',
    checks: [
      { metric: 'districtMode', op: '>=', value: 4, label: 'district mode enabled' },
      { metric: 'avgRelationships', op: '>=', value: 10, label: 'cross-run social structure' },
      { metric: 'allySampleRate', op: '>=', value: 0.04, label: 'nonzero support ties' },
      { metric: 'finalPopulation', op: '>=', value: 6, label: 'population remains observable' }
    ]
  }
};

function usage() {
  console.log('Usage:');
  console.log('  node scripts/benchmark-telemetry.mjs --latest [--scenario <name>] [--json]');
  console.log('  node scripts/benchmark-telemetry.mjs --recent <count> [--scenario <name>]');
  console.log('  node scripts/benchmark-telemetry.mjs <telemetry.json> [--scenario <name>] [--json]');
  console.log('');
  console.log('Scenarios:', Object.keys(SCENARIOS).join(', '));
}

function asNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function avg(values) {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function pct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

function findTelemetryFiles(dir = DOWNLOADS_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => /^telemetry-.*\.json$/.test(name))
    .map(name => ({
      name,
      filePath: path.join(dir, name),
      mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function resolveInputFiles(args) {
  if (args.includes('--latest')) {
    const latest = findTelemetryFiles()[0];
    if (!latest) throw new Error('No telemetry files found in Downloads.');
    return [latest.filePath];
  }

  const recentIndex = args.indexOf('--recent');
  if (recentIndex >= 0) {
    const count = Math.max(1, Math.min(20, asNum(args[recentIndex + 1], 5)));
    const files = findTelemetryFiles().slice(0, count).map(item => item.filePath);
    if (!files.length) throw new Error('No telemetry files found in Downloads.');
    return files;
  }

  const explicitFile = args.find((arg, index) => {
    if (arg.startsWith('--')) return false;
    const prev = args[index - 1];
    if (prev === '--scenario' || prev === '--recent') return false;
    return arg.endsWith('.json') || fs.existsSync(path.resolve(process.cwd(), arg));
  });
  if (explicitFile) return [path.resolve(process.cwd(), explicitFile)];

  const latest = findTelemetryFiles()[0];
  if (!latest) throw new Error('No telemetry files found in Downloads.');
  return [latest.filePath];
}

function getFlagValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function loadPayload(filePath) {
  const abs = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`File not found: ${abs}`);
  }
  return {
    filePath: abs,
    payload: JSON.parse(fs.readFileSync(abs, 'utf8'))
  };
}

function extractMetrics(payload) {
  const meta = payload.meta || {};
  const populationMeta = meta.population || {};
  const samples = Array.isArray(payload.samples) ? payload.samples : [];
  const world = Array.isArray(payload.worldSamples)
    ? payload.worldSamples
    : (Array.isArray(payload.worldTimeline) ? payload.worldTimeline : []);

  const lastWorld = world[world.length - 1] || {};
  const lastWindow = samples.slice(-Math.min(600, samples.length));
  const aliveWindow = lastWindow.filter(sample => sample.state !== 'dead');
  const socialWindow = aliveWindow.filter(sample => sample.social && typeof sample.social === 'object');

  const getSocial = key => socialWindow.map(sample => asNum(sample.social?.[key], 0)).filter(Number.isFinite);
  const getNeed = key => aliveWindow.map(sample => asNum(sample.needs?.[key], 0)).filter(Number.isFinite);

  const popSeries = world.map(entry => asNum(entry.pop, 0)).filter(Number.isFinite);
  const districtMode = asNum(lastWorld.districtMode, 1);
  const initialPopulation = asNum(populationMeta.initialPopulation, popSeries[0] || 0);

  const bondedCountSeries = getSocial('bondedCount');
  const allyCountSeries = getSocial('allyCount');
  const nearbySupportSeries = getSocial('nearbySupport');
  const relationshipSeries = getSocial('relationshipCount');
  const affinitySeries = getSocial('avgAffinity');

  return {
    initialPopulation,
    peakPopulation: popSeries.length ? Math.max(...popSeries) : initialPopulation,
    finalPopulation: popSeries.length ? popSeries[popSeries.length - 1] : initialPopulation,
    minPopulation: popSeries.length ? Math.min(...popSeries) : initialPopulation,
    districtMode,
    districtCount: Array.isArray(lastWorld.districts) ? lastWorld.districts.length : districtMode,
    avgRelationships: round3(avg(relationshipSeries)),
    avgAffinity: round3(avg(affinitySeries)),
    avgBondedCount: round3(avg(bondedCountSeries)),
    avgAllyCount: round3(avg(allyCountSeries)),
    avgNearbySupport: round3(avg(nearbySupportSeries)),
    bondedSampleRate: round3(socialWindow.length ? socialWindow.filter(sample => asNum(sample.social?.bondedCount, 0) > 0).length / socialWindow.length : 0),
    allySampleRate: round3(socialWindow.length ? socialWindow.filter(sample => asNum(sample.social?.allyCount, 0) > 0).length / socialWindow.length : 0),
    nearbySampleRate: round3(socialWindow.length ? socialWindow.filter(sample => asNum(sample.social?.nearbySupport, 0) > 0).length / socialWindow.length : 0),
    avgHunger: round3(avg(getNeed('hunger'))),
    avgEnergy: round3(avg(getNeed('energy'))),
    avgSafety: round3(avg(getNeed('safety'))),
    avgSocialNeed: round3(avg(getNeed('social'))),
    sampleCount: samples.length
  };
}

function autoPickScenario(metrics) {
  if (metrics.districtMode >= 4) return 'district-observation';
  if (Math.max(metrics.initialPopulation, metrics.peakPopulation) >= 24) return 'd1-dense';
  return 'd1-bonding';
}

function compareMetric(actual, op, expected) {
  if (op === '=') return actual === expected;
  if (op === '>=') return actual >= expected;
  if (op === '<=') return actual <= expected;
  return false;
}

function evaluateScenario(metrics, scenarioName) {
  const scenario = SCENARIOS[scenarioName];
  if (!scenario) throw new Error(`Unknown scenario: ${scenarioName}`);

  const checks = scenario.checks.map(check => {
    const actual = metrics[check.metric];
    const pass = compareMetric(actual, check.op, check.value);
    return {
      ...check,
      actual,
      pass
    };
  });

  const passCount = checks.filter(check => check.pass).length;
  const status = passCount === checks.length ? 'PASS' : (passCount >= Math.ceil(checks.length * 0.6) ? 'WARN' : 'FAIL');

  let interpretation = 'Model behavior looks broadly consistent with this scenario.';
  if (metrics.bondedSampleRate === 0 && metrics.allySampleRate > 0) {
    interpretation = 'Social contact exists, but ties are not crossing the bond threshold consistently.';
  } else if (metrics.allySampleRate === 0 && metrics.avgRelationships >= 10) {
    interpretation = 'Characters see each other often, but affinity accumulation is too weak.';
  } else if (metrics.avgRelationships < 10) {
    interpretation = 'Contact density looks low; environment or movement is preventing repeated interaction.';
  } else if (metrics.bondedSampleRate > 0.05) {
    interpretation = 'Bond emergence is healthy in this run context.';
  }

  return {
    scenario: scenarioName,
    label: scenario.label,
    status,
    passCount,
    totalChecks: checks.length,
    checks,
    interpretation
  };
}

function printSingleResult(filePath, metrics, evaluation) {
  console.log(`\n=== Telemetry Benchmark ===`);
  console.log(`file: ${filePath}`);
  console.log(`scenario: ${evaluation.label} (${evaluation.scenario})`);
  console.log(`status: ${evaluation.status} (${evaluation.passCount}/${evaluation.totalChecks})`);
  console.log('');
  console.log('Core metrics:');
  console.log(`- districtMode: ${metrics.districtMode}`);
  console.log(`- population: start ${metrics.initialPopulation}, peak ${metrics.peakPopulation}, final ${metrics.finalPopulation}`);
  console.log(`- avgRelationships: ${metrics.avgRelationships}`);
  console.log(`- avgAffinity: ${metrics.avgAffinity}`);
  console.log(`- avgBondedCount: ${metrics.avgBondedCount}`);
  console.log(`- avgAllyCount: ${metrics.avgAllyCount}`);
  console.log(`- avgNearbySupport: ${metrics.avgNearbySupport}`);
  console.log(`- bondedSampleRate: ${pct(metrics.bondedSampleRate)}`);
  console.log(`- allySampleRate: ${pct(metrics.allySampleRate)}`);
  console.log(`- nearbySampleRate: ${pct(metrics.nearbySampleRate)}`);
  console.log('');
  console.log('Checks:');
  for (const check of evaluation.checks) {
    const mark = check.pass ? 'PASS' : 'FAIL';
    console.log(`- ${mark} ${check.label}: ${check.metric} ${check.op} ${check.value} (actual ${check.actual})`);
  }
  console.log('');
  console.log(`Interpretation: ${evaluation.interpretation}`);
}

function pad(str, width) {
  return String(str).padEnd(width, ' ');
}

function printRecentTable(results) {
  console.log('=== Recent Telemetry Benchmarks ===');
  console.log(
    [
      pad('file', 32),
      pad('scenario', 20),
      pad('status', 6),
      pad('bond', 8),
      pad('ally', 8),
      pad('near', 8),
      pad('rels', 8),
      pad('pop', 8)
    ].join(' | ')
  );

  for (const result of results) {
    console.log(
      [
        pad(path.basename(result.filePath), 32),
        pad(result.evaluation.scenario, 20),
        pad(result.evaluation.status, 6),
        pad(result.metrics.avgBondedCount.toFixed(3), 8),
        pad(result.metrics.avgAllyCount.toFixed(3), 8),
        pad(result.metrics.avgNearbySupport.toFixed(3), 8),
        pad(result.metrics.avgRelationships.toFixed(2), 8),
        pad(String(result.metrics.finalPopulation), 8)
      ].join(' | ')
    );
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    usage();
    return;
  }

  const jsonMode = args.includes('--json');
  const requestedScenario = getFlagValue(args, '--scenario');

  const filePaths = resolveInputFiles(args);
  const results = filePaths.map(filePath => {
    const { payload, filePath: absPath } = loadPayload(filePath);
    const metrics = extractMetrics(payload);
    const scenarioName = requestedScenario || autoPickScenario(metrics);
    const evaluation = evaluateScenario(metrics, scenarioName);
    return { filePath: absPath, metrics, evaluation };
  });

  if (jsonMode) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (results.length === 1) {
    printSingleResult(results[0].filePath, results[0].metrics, results[0].evaluation);
  } else {
    printRecentTable(results);
  }
}

try {
  main();
} catch (error) {
  console.error(`[benchmark-telemetry] ${error.message}`);
  process.exit(1);
}
