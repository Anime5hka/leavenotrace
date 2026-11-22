# Changelog

## 0.2.0 (2026-11-22)

- On GitHub Actions: the report goes to the job summary, and each leftover gets an error annotation on the test line that created it (or the test file when the line isn't known).
- `--markdown`: the report as Markdown.

## 0.1.0 (2026-11-22)

First release.

- Snapshot before and diff after every test (after all of its `afterEach` hooks): `process.env`, `cwd()`, `exitCode`, `process` listeners, globals, built-ins and their prototypes, node core modules.
- Explains replaced functions: unrestored vitest/jest/node:test mocks, sinon stubs, fake timers left on.
- Tracks timers, servers, sockets, child processes and `fs.watch` back to the line that created them (and the test line that called it).
- Leaked handles are `unref()`ed once reported, so a leaky suite no longer hangs `node --test`, mocha or jest.
- Adapters for vitest, jest, mocha and node:test; modes `fail` / `warn` / `quiet`; JSON-lines report; ignore list.
- A fix hint for every trace, specific to the runner (`vi.restoreAllMocks()`, `restoreMocks: true`, `mock.restoreAll()`, `vi.stubEnv()`...).
- CLI: `npx leavenotrace -- <test command>` prints a per-file summary.
