# leavenotrace — one-pager

**Problem.** "Passes alone, fails in the suite." A test changes `process.env`, leaves an interval running,
spies on `Date.now` without restoring it, patches a global, `chdir`s, or keeps a server open. The test
itself passes. Some *other* test fails later, in a different order, on CI. Bisection tools
(find-polluter, whiteglove) only help after a victim exists, and only tell you *which* test, not *what*.

**Product.** A setup file for your runner. Before and after every test (after all its hooks) it
snapshots process state and reports, per test, exactly what was left behind, with the source line:

    ✗ caches the user  (test/user.test.js)  left a trace:
        process.env.API_URL   set to "http://localhost:4010" (was unset)
        setInterval           still running, created at src/poller.js:12
        Date.now              replaced (test/user.test.js:31)

Modes: `warn` (default: report at the end) and `fail` (the leaking test fails, for CI).

**Integration (one line each).**
- vitest: `setupFiles: ['leavenotrace/vitest']` (vitest has no CLI flag for setup files)
- jest: `setupFilesAfterEnv: ['leavenotrace/jest']`
- mocha: `--require leavenotrace/mocha` (root hooks plugin)
- node:test: `node --import leavenotrace/node --test` or `npx leavenotrace -- node --test`

**What is checked (MVP).** process.env, cwd, umask, process.exitCode; globalThis own keys added/replaced;
replaced functions on builtins (Date.now, Math.random, console.*, JSON.*, fetch, setTimeout → fake
timers left on) and on node core modules (fs, http, child_process, ...); built-in prototype pollution
(Object/Array/String/Function/Promise/Map/Set prototypes); process listeners added; timers (setTimeout
still pending / setInterval still running), servers still listening, sockets still open, child
processes still running, fs watchers — attributed to the user code line that created them.

**Non-goals.** Memory leaks, DOM/jsdom state (maybe later), module registry state.
