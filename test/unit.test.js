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

test('hint(): a runner-specific fix for each kind of trace, none for the unknown', () => {
  const h = (label, what, runner) => core.hint({ label, what }, runner);
  assert.match(h('process.env.TZ', 'set to "UTC" (was unset)', 'vitest'), /vi\.stubEnv/);
  assert.match(h('process.env.TZ', 'set to "UTC" (was unset)', 'jest'), /restore it in afterEach/);
  assert.match(h('Date.now', 'replaced by a mock that was never restored', 'jest'), /restoreMocks: true/);
  assert.match(h('Date.now', 'replaced by a mock that was never restored', 'node'), /mock\.restoreAll/);
  assert.match(h('fs.readFile', 'replaced by a sinon stub (missing restore()?)', 'mocha'), /sinon\.restore/);
  assert.match(h('fake timers', 'still installed', 'vitest'), /useRealTimers/);
  assert.match(h('setInterval', 'still running (every 5 ms)'), /clearInterval/);
  assert.match(h('Array.prototype.last', 'added (a function)'), /prototypes/);
  assert.match(h('globalThis.cache', 'added (a Map)', 'node'), /delete globalThis\.cache/);
  assert.equal(h('something.else', 'odd'), undefined);
  const lines = core.hints([
    { label: 'setInterval', what: 'still running' }, { label: 'setInterval', what: 'still running' },
    { label: 'something.else', what: 'odd' },
  ]);
  assert.equal(lines.split('\n').length, 1, 'duplicate hints are merged, unknown ones skipped');
});

test('added objects are named with the right article', () => {
  const a = core.snapshot(globalThis);
  globalThis.__lntObj = {};
  globalThis.__lntMap = new Map();
  try {
    const whats = core.diff(a, core.snapshot(globalThis)).map((f) => f.what);
    assert.ok(whats.includes('added (an Object)'), whats.join('; '));
    assert.ok(whats.includes('added (a Map)'), whats.join('; '));
  } finally { delete globalThis.__lntObj; delete globalThis.__lntMap; }
});

test('GitHub Actions: annotate the test line that created a leftover, else its site, else the test file', async () => {
  const { location, annotations, markdown } = await import('../src/github.js');
  assert.deepEqual(location({ site: 'shop.js:15 (from catalog.test.js:18)' }, 'catalog.test.js'), { file: 'catalog.test.js', line: 18 });
  assert.deepEqual(location({ site: 'server.js:7:3' }, 'a.test.js'), { file: 'server.js', line: 7 });
  assert.deepEqual(location({}, 'a.test.js'), { file: 'a.test.js', line: null });
  const reports = [{ test: 'polls, every second', file: 'catalog.test.js', findings: [
    { label: 'setInterval', what: 'still running (every 1000 ms)', site: 'shop.js:15 (from catalog.test.js:18)', hint: 'clearInterval() it in afterEach' },
    { label: 'process.env.CURRENCY', what: 'set to "EUR" (was unset)' },
  ] }];
  assert.equal(annotations(reports, '/repo/pkg', '/repo'),
    '::error file=pkg/catalog.test.js,line=18,title=leavenotrace%3A "polls%2C every second" leaves setInterval behind::setInterval still running (every 1000 ms). Fix: clearInterval() it in afterEach.\n'
    + '::error file=pkg/catalog.test.js,title=leavenotrace%3A "polls%2C every second" leaves process.env.CURRENCY behind::process.env.CURRENCY set to "EUR" (was unset).\n');
  assert.match(markdown(reports, ['node', '--test']), /1 test left a trace[\s\S]*\| polls, every second \| `catalog\.test\.js` \| `setInterval` still running/);
  assert.match(markdown([], ['node', '--test']), /Every test cleaned up after itself/);
});
