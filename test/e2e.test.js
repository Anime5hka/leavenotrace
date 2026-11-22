// Runs the fixtures under every supported runner and checks exactly what each test is blamed for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = (name) => join(root, 'node_modules', '.bin', name);

const EXPECTED = {
  'env var': ['process.env.API_URL'],
  interval: ['setInterval'],
  timeout: ['setTimeout'],
  server: ['server'],
  socket: ['server', 'socket'],
  'child process': ['child process'],
  spy: ['fs.readFileSync'],
  'fake timers': ['fake timers'],
  global: ['globalThis.cache'],
  prototype: ['Array.prototype.last'],
  'process listener': ['process.on(SIGUSR2)'],
  cwd: ['process.cwd()'],
};

function run(cmd, args, cwd, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lnt-e2e-'));
  const report = join(dir, 'report.jsonl');
  return new Promise((resolve) => {
    const childEnv = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', LEAVENOTRACE_REPORT: report, ...env };
    // Set because this file runs under node --test; it would turn the inner runner into a child reporter.
    delete childEnv.NODE_TEST_CONTEXT;
    const child = spawn(cmd, args, {
      cwd,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    // The fixtures leak timers, servers and child processes on purpose; once reported they are
    // unref'd, so the runner must exit on its own (no --forceExit). Fail instead of hanging.
    const hang = setTimeout(() => { output += '\n[e2e] did not exit within 20 s: leaked handles keep it alive'; child.kill('SIGKILL'); }, 20_000);
    child.on('close', (code) => {
      clearTimeout(hang);
      const reports = existsSync(report)
        ? readFileSync(report, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
        : [];
      rmSync(dir, { recursive: true, force: true });
      resolve({ code, output, reports });
    });
  });
}

/** test name (last part of the full name) -> sorted finding labels */
function blamed(reports) {
  const out = {};
  for (const r of reports) {
    const name = r.test.split(/ > | › /).pop().replace(/^leaky:? ?/, '');
    out[name.replace(/^.*\s(?=(env var|interval|timeout|server|socket|child process|spy|fake timers|global|prototype|process listener|cwd)$)/, '')] =
      r.findings.map((f) => f.label).sort();
  }
  return out;
}

const RUNNERS = {
  vitest: [bin('vitest'), ['run'], 'test/fixtures/vitest'],
  jest: [bin('jest'), [], 'test/fixtures/jest'],
  mocha: [bin('mocha'), [], 'test/fixtures/mocha'],
  'node:test': [process.execPath, ['--import', 'leavenotrace/node', '--test', '--test-concurrency=1'], 'test/fixtures/node'],
};

for (const [name, [cmd, args, cwd]] of Object.entries(RUNNERS)) {
  test(`${name}: blames each leaky test for exactly what it left, and nothing else`, async () => {
    const r = await run(cmd, args, join(root, cwd));
    assert.doesNotMatch(r.output, /did not exit within/, r.output.slice(-3000));
    assert.notEqual(r.code, 0, 'leaky tests must fail the run');
    const expected = { ...EXPECTED };
    if (name === 'mocha') delete expected['fake timers']; // no built-in fake timers
    const got = blamed(r.reports);
    for (const k of Object.keys(expected)) expected[k] = [...expected[k]].sort();
    assert.deepEqual(got, expected, r.output.slice(-3000));
  });

  test(`${name}: warn mode reports the same and passes`, async () => {
    const r = await run(cmd, [...args, ...(name === 'node:test' ? ['clean.test.js'] : [])], join(root, cwd), { LEAVENOTRACE: 'warn' });
    if (name === 'node:test') {
      assert.equal(r.code, 0, r.output.slice(-3000));
      assert.deepEqual(r.reports, []);
    } else {
      // the leaky fixtures also contain tests that never finish cleanly (open servers) but none fail
      assert.equal(r.code, 0, r.output.slice(-3000));
      assert.ok(r.reports.length >= 10);
    }
  });
}
