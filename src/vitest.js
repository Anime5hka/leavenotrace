// vitest: `test: { setupFiles: ['leavenotrace/vitest'] }`
// Setup-file hooks run first before a test and last after it (sequence.hooks = 'stack').
import { beforeEach, afterEach } from 'vitest';
import core from './core.cjs';

beforeEach(() => { core.start(globalThis); });
afterEach((ctx) => {
  const findings = core.finish(globalThis);
  core.report(ctx.task.fullName ?? ctx.task.name, findings, ctx.task.file?.name);
});
