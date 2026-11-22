'use strict';
// jest: `setupFilesAfterEnv: ['leavenotrace/jest']`
// Our afterEach must run after the test file's own top-level afterEach hooks, which are
// registered later than this file. Once everything is registered we move ours to the end.
const core = require('./core.cjs');
core.setRunner('jest');
const cwd = process.cwd();

const check = () => {
  const state = expect.getState();
  core.report(state.currentTestName, core.finish(globalThis), state.testPath && require('node:path').relative(cwd, state.testPath));
};

beforeEach(() => { core.start(globalThis); });
afterEach(check);
beforeAll(() => {
  const sym = Object.getOwnPropertySymbols(globalThis).find((s) => s.description === 'JEST_STATE_SYMBOL');
  const hooks = sym && globalThis[sym]?.rootDescribeBlock?.hooks;
  if (!Array.isArray(hooks)) return;
  const i = hooks.findIndex((h) => h.fn === check);
  if (i >= 0) hooks.push(...hooks.splice(i, 1));
});
