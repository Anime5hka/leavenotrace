'use strict';
// mocha: `--require leavenotrace/mocha` (a root hook plugin)
// Root hooks from test files are registered after ours; once they are all in, ours moves last.
// A failing afterEach hook makes mocha skip the rest of the suite, so in 'fail' mode each trace
// is printed as it is found, and one error at the end fails the run.
const path = require('node:path');
const core = require('./core.cjs');
core.setRunner('mocha');
const cwd = process.cwd();

const leaky = [];

function check() {
  const t = this.currentTest;
  const name = t && t.fullTitle();
  const file = t && t.file && path.relative(cwd, t.file);
  const findings = core.finish(globalThis);
  if (!findings.length) return;
  if (core.mode() === 'fail') {
    leaky.push(name);
    process.stderr.write(`\n[leavenotrace] "${name}"${file ? ` (${file})` : ''} left a trace:\n${core.format(findings)}\n${core.hints(findings) ? `How to fix:\n${core.hints(findings)}\n` : ''}`);
    try { core.report(name, findings, file); } catch {}
  } else {
    core.report(name, findings, file);
  }
}

exports.mochaHooks = {
  beforeAll() {
    const hooks = this.test && this.test.parent && this.test.parent._afterEach;
    if (!Array.isArray(hooks)) return;
    const i = hooks.findIndex((h) => h.fn === check);
    if (i >= 0) hooks.push(...hooks.splice(i, 1));
  },
  beforeEach() { core.start(globalThis); },
  afterEach: check,
  afterAll() {
    if (!leaky.length) return;
    const n = leaky.length;
    const err = new Error(`${n} test${n > 1 ? 's' : ''} left a trace (details above):\n${leaky.map((t) => `  - ${t}`).join('\n')}`);
    err.stack = `LeftATrace: ${err.message}`;
    leaky.length = 0;
    throw err;
  },
};
