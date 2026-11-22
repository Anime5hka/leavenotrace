'use strict';
// mocha: `--require leavenotrace/mocha` (a root hook plugin)
// Root hooks from test files are registered after ours; once they are all in, ours moves last.
const core = require('./core.cjs');

function check() {
  const t = this.currentTest;
  core.report(t && t.fullTitle(), core.finish(globalThis), t && t.file && require('node:path').relative(process.cwd(), t.file));
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
};
