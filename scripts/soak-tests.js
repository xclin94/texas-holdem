#!/usr/bin/env node
const { spawnSync } = require('node:child_process');

const roundsRaw = Number(process.env.SOAK_ROUNDS || 3);
const rounds = Number.isFinite(roundsRaw) && roundsRaw > 0 ? Math.floor(roundsRaw) : 3;

const targets = [
  'tests/frontend-display-contract.test.js',
  'tests/gameplay-rules.test.js',
  'tests/multi-hand-matrix.test.js',
  'tests/phase-social.test.js',
];

for (let i = 1; i <= rounds; i += 1) {
  // Keep each round isolated so transient flakiness is easy to spot.
  process.stdout.write(`\n[soak] round ${i}/${rounds}\n`);
  const result = spawnSync(process.execPath, ['--test', ...targets], {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    process.stderr.write(`[soak] failed at round ${i}/${rounds}\n`);
    process.exit(result.status || 1);
  }
}

process.stdout.write(`\n[soak] all ${rounds} rounds passed\n`);
