// node:test: `node --import leavenotrace/node --test` (or NODE_OPTIONS=--import=leavenotrace/node)
// node:test runs root-level afterEach hooks in the order they were registered, and the test
// file registers its own after we do. So the check runs at the end of the *last* root-level
// afterEach the test file registers (or in ours, if it registers none).
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { relative } from 'node:path';

const require = createRequire(import.meta.url);
const core = require('./core.cjs');
const nt = require('node:test');
const cwd = process.cwd();

// `node --test` without isolation=none is only an orchestrator: tests run in child processes.
const orchestrator = process.execArgv.some((a) => a === '--test' || a.startsWith('--test=')) &&
  !process.env.NODE_TEST_CONTEXT && !process.execArgv.some((a) => /^--(experimental-)?test-isolation=none$/.test(a));

if (!orchestrator && !globalThis.__leavenotraceNode) {
  globalThis.__leavenotraceNode = true;
  let depth = 0;
  let lastRoot = null;
  const check = (t) => {
    const path = t?.filePath ?? process.argv[1];
    const file = path ? relative(cwd, path.startsWith('file:') ? new URL(path).pathname : path) : undefined;
    core.report(t?.fullName ?? t?.name, core.finish(globalThis), file);
  };
  const realAfterEach = nt.afterEach;
  const afterEach = function afterEach(fn, options) {
    if (depth > 0 || typeof fn !== 'function') return realAfterEach(fn, options);
    const wrapped = async function (t, ...rest) {
      try { return await fn.call(this, t, ...rest); } finally { if (lastRoot === wrapped) check(t); }
    };
    lastRoot = wrapped;
    return realAfterEach(wrapped, options);
  };
  // Hooks registered inside describe() belong to that suite and run before the root ones.
  const inSuite = (real) => {
    const w = function (...args) {
      const i = args.findIndex((a) => typeof a === 'function');
      if (i >= 0) {
        const fn = args[i];
        args[i] = function (...a) { depth++; try { return fn.apply(this, a); } finally { depth--; } };
      }
      return real.apply(this, args);
    };
    for (const k of Reflect.ownKeys(real)) {
      if (k === 'length' || k === 'name' || k === 'prototype') continue;
      try { Object.defineProperty(w, k, Object.getOwnPropertyDescriptor(real, k)); } catch {}
    }
    return w;
  };
  for (const name of ['describe', 'suite']) {
    const w = inSuite(nt[name]);
    nt[name] = w;
    if (nt.test[name]) nt.test[name] = w;
  }
  nt.afterEach = afterEach;
  nt.test.afterEach = afterEach;
  syncBuiltinESMExports();

  nt.beforeEach(() => { core.start(globalThis); });
  realAfterEach((t) => { if (!lastRoot) check(t); });
}
