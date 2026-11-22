import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const core = createRequire(import.meta.url)('../src/core.cjs');

test('an unchanged process has no findings (NaN, getters and all)', () => {
  const a = core.snapshot(globalThis);
  const b = core.snapshot(globalThis);
  assert.deepEqual(core.diff(a, b), []);
});

test('getters are compared, never called', () => {
  let calls = 0;
  Object.defineProperty(globalThis, '__lntGetter', { get() { calls++; return 1; }, configurable: true });
  try {
    const a = core.snapshot(globalThis);
    core.diff(a, core.snapshot(globalThis));
    assert.equal(calls, 0);
  } finally { delete globalThis.__lntGetter; }
});

test('env: set, changed, deleted', () => {
  process.env.LNT_KEEP = 'a';
  process.env.LNT_DROP = 'b';
  const a = core.snapshot(globalThis);
  process.env.LNT_KEEP = 'c';
  delete process.env.LNT_DROP;
  process.env.LNT_NEW = 'd';
  const findings = core.diff(a, core.snapshot(globalThis));
  delete process.env.LNT_KEEP; delete process.env.LNT_NEW;
  assert.deepEqual(findings.map((f) => `${f.label}: ${f.what}`).sort(), [
    'process.env.LNT_DROP: deleted (was "b")',
    'process.env.LNT_KEEP: changed to "c" (was "a")',
    'process.env.LNT_NEW: set to "d" (was unset)',
  ]);
});

test('start/finish attribute a still-running interval to the line that created it', () => {
  core.start(globalThis);
  const t = setInterval(() => {}, 1000);
  const findings = core.finish(globalThis);
  clearInterval(t);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].label, 'setInterval');
  assert.match(findings[0].site, /^test\/unit\.test\.js:\d+$/);
});

test('a timer that already fired or was cleared is not a trace', async () => {
  core.start(globalThis);
  await new Promise((r) => setTimeout(r, 1));
  clearTimeout(setTimeout(() => {}, 1000));
  assert.deepEqual(core.finish(globalThis), []);
});

test('ignore(): exact labels, prefixes and RegExps', () => {
  core.ignore('process.env.LNT_IGNORED', /^globalThis\.__lntIgnored/);
  core.start(globalThis);
  process.env.LNT_IGNORED = '1';
  globalThis.__lntIgnoredToo = 1;
  const findings = core.finish(globalThis);
  delete process.env.LNT_IGNORED; delete globalThis.__lntIgnoredToo;
  assert.deepEqual(findings, []);
});

test('userSite skips node internals and node_modules; direct mode requires a user caller', () => {
  const stack = [
    'Error',
    '    at setTimeout (node:internal/timers:1:1)',
    '    at f (/x/node_modules/lib/index.js:3:4)',
    `    at g (${process.cwd()}/lib/app.js:10:5)`,
  ].join('\n');
  assert.equal(core.userSite(stack), 'lib/app.js:10');
  assert.equal(core.userSite(stack, true), null);
  assert.equal(core.userSite(['Error', `    at g (${process.cwd()}/lib/app.js:7:1)`].join('\n'), true), 'lib/app.js:7');
});
