# Changelog

## 0.1.0 (unreleased)

First release.

- Snapshot before and diff after every test (after all of its `afterEach` hooks): `process.env`, `cwd()`, `exitCode`, `process` listeners, globals, built-ins and their prototypes, node core modules.
- Explains replaced functions: unrestored vitest/jest/node:test mocks, sinon stubs, fake timers left on.
- Tracks timers, servers, sockets, child processes and `fs.watch` back to the line that created them (and the test line that called it).
- Leaked handles are `unref()`ed once reported, so a leaky suite no longer hangs `node --test`, mocha or jest.
- Adapters for vitest, jest, mocha and node:test; modes `fail` / `warn` / `quiet`; JSON-lines report; ignore list.
- CLI: `npx leavenotrace -- <test command>` prints a per-file summary.
