<h1 align="center">leavenotrace 🧹</h1>

<p align="center">
  <b>Fail the test that leaves a mess, not the one that trips over it.</b><br>
  leavenotrace checks the process after every test and names what the test left behind:<br>
  env vars, globals, unrestored mocks, fake timers, running intervals, open servers and sockets, with the line that created them.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D20.6-339933" alt="node >= 20.6">
  <img src="https://img.shields.io/badge/works%20with-vitest%20%C2%B7%20jest%20%C2%B7%20mocha%20%C2%B7%20node%3Atest-8957e5" alt="works with vitest, jest, mocha, node:test">
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen" alt="zero dependencies">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT"></a>
</p>

<p align="center">
  <img src="assets/demo.svg" alt="leavenotrace on a test suite: three tests in catalog.test.js left a trace: process.env.CURRENCY set to EUR, Date.now replaced by a mock that was never restored, and a setInterval still running, created at shop.js:15 from catalog.test.js:18" width="900">
</p>

"Passes alone, fails in the suite." Somewhere, a test set `process.env.CURRENCY = 'EUR'`, or mocked `Date.now` and never restored it, or started an interval that kept running. That test passed. A *different* test fails later, in another file, only in a certain order, usually on CI. You spend an afternoon bisecting.

leavenotrace catches the leak where it happens. Before each test it takes a snapshot of the process; after the test (and after all of its `afterEach` hooks) it compares. Anything still changed is a trace, and in strict mode the leaky test itself fails, with the exact thing it left and the line that created it:

```
FAIL  catalog.test.js > stock is checked every second
LeftATrace: this test left a trace:
  setInterval  still running (every 1000 ms), created at shop.js:15 (from catalog.test.js:18)
```

No victim test needed, no bisection, no re-runs.

## Quick start

See what your suite leaves behind, without changing anything:

```sh
npx github:Anime5hka/leavenotrace -- node --test
npx github:Anime5hka/leavenotrace -- npx mocha
```

This runs your tests once and prints a per-file summary of leaky tests. It doesn't change their results. For **vitest and jest**, add the one-line [setup](#setup) first (they don't load setup files from the command line), then `npx github:Anime5hka/leavenotrace -- npm test`.

Try it on the example in this repo: `catalog.test.js` leaks three ways, and `checkout.test.js` is the victim.

```sh
git clone https://github.com/Anime5hka/leavenotrace && cd leavenotrace/examples/checkout
node ../../bin/leavenotrace.js -- node --test --test-isolation=none
```

## Setup

To make leaky tests **fail** (what you want in CI), install it and add one line for your runner:

```sh
npm i -D github:Anime5hka/leavenotrace
```

| Runner | Add |
|---|---|
| vitest | `test: { setupFiles: ['leavenotrace/vitest'] }` in `vitest.config.*` |
| jest | `setupFilesAfterEnv: ['leavenotrace/jest']` in the jest config |
| mocha | `--require leavenotrace/mocha` (or `require: ['leavenotrace/mocha']` in `.mocharc`) |
| node:test | `node --import leavenotrace/node --test` |

Put it first in the list if you have other setup files: its check then runs after their cleanup.

Modes, set with the `LEAVENOTRACE` environment variable:

| `LEAVENOTRACE=` | |
|---|---|
| `fail` (default) | The leaky test fails with a `LeftATrace` error. In mocha, traces are printed as they're found and one error at the end fails the run, because a failing `afterEach` makes mocha skip the rest of the suite. |
| `warn` | Print the traces to stderr, keep the test results. A gentle way to start on a big suite. |
| `quiet` | Only write the report file. |

`LEAVENOTRACE_REPORT=traces.jsonl` also appends every finding as JSON lines (test, file, findings), for CI annotations or your own tooling.

## What counts as a trace

| | Example of what you see |
|---|---|
| **Environment** | `process.env.API_URL  set to "http://localhost:4010" (was unset)` |
| **Working directory, exit code** | `process.cwd()  changed to "/repo" (was "/repo/packages/app")` · `process.exitCode  set to 1` |
| **Mocks and spies left on** | `Date.now  replaced by a mock that was never restored` · `fs.readFileSync  replaced by a sinon stub (missing restore()?)` |
| **Fake timers left on** | `fake timers  still installed (fake timers were turned on and never turned off)` |
| **Globals** | `globalThis.cache  added (a Map)` |
| **Prototype pollution** | `Array.prototype.last  added (an anonymous function)` |
| **Patched built-ins and node modules** | anything replaced on `Date`, `Math`, `JSON`, `console`, `Promise`, `Intl`, `crypto`, `fs`, `http`, `net`, `child_process`, `os`, `path`, `events`, … |
| **process listeners** | `process.on(SIGUSR2)  1 listener added and not removed` |
| **Timers** | `setInterval  still running (every 1000 ms), created at src/poller.js:12 (from test/poller.test.js:8)` |
| **Servers, sockets** | `server  still listening on port 41237` · `socket  still open to port 5432` |
| **Child processes, watchers** | `child process  still running (/usr/bin/node, pid 4242)` · `fs.watch  still watching "./config"` |

Timers, servers, sockets and child processes are traced back to the code that created them. When that's your source code called from a test, you get both lines. Timers created by libraries on their own (a connection pool's keep-alive, say) are left out; if your code didn't call `setTimeout` itself, it's not your trace.

## Your suite stops hanging, too

A leaked interval or server keeps Node running after the last test: `node --test` and mocha wait forever, and jest prints "Jest did not exit one second after the test run has completed". The usual fix is `--forceExit`, which hides the leak.

Once leavenotrace has reported a leaked timer, server (with its open connections), socket or child process, it `unref()`s it, so the process can exit normally. You get the name and line of the leak instead of a hang.

## Ignoring

Some leaks are on purpose. Ignore them by label, by prefix or by RegExp:

```sh
LEAVENOTRACE_IGNORE=process.env.DEBUG,globalThis.__APP_CACHE__ npx vitest
```

```js
// in a setup file
import { ignore } from 'leavenotrace';
ignore('process.env.DEBUG', /^globalThis\.__my/);
```

The runners' own globals (vitest, jest, mocha, node:test internals, coverage counters) are ignored already.

## How it works

- **Snapshot.** Before each test, leavenotrace records the own property descriptors of `globalThis`, the built-in objects and their prototypes, `process` and the node core modules, plus `process.env`, `cwd()`, `exitCode` and the `process` listeners. Descriptors are compared by identity, so getters are never called and nothing is deep-cloned. Both snapshots together take about a millisecond per test.
- **Tracking.** `setTimeout` / `setInterval` (when your code calls them directly), `net.Server#listen`, `net.Socket#connect`, `ChildProcess#spawn` and `fs.watch` are wrapped to remember where each resource was created and which test was running.
- **Ordering.** The check has to run after *all* of the test's cleanup, including `afterEach` hooks your test files register later than the setup file. Each runner needs a different trick: vitest already runs setup-file hooks last; for jest and mocha the hook moves itself to the end of the root hook list once everything is registered; for node:test, the check runs at the end of the last root-level `afterEach`. All four are tested end to end in [`test/e2e.test.js`](test/e2e.test.js) against the same set of leaks.

## FAQ

**My runner isolates test files. Does this still matter?** Isolation is per file, not per test. A test leaks into every later test in the same file, and with vitest `--no-isolate` or `node --test --test-isolation=none` into other files too. Mocha doesn't isolate at all.

**Isn't this what `--detectOpenHandles` does?** jest's `--detectOpenHandles` lists handles at the very end, without saying which test left them, and it only covers handles. leavenotrace checks after every test and also covers env, globals, mocks, fake timers and prototypes.

**What about vitest's `unstubEnvs` / `restoreMocks`?** Use them! They prevent some leaks if you go through `vi.stubEnv` and `vi.spyOn`. leavenotrace also catches the leaks that don't go through vitest's API: `process.env.X = …`, `globalThis.x = …`, a hand-rolled monkey patch, an interval.

**Does it slow down my tests?** About a millisecond per test (1.2 ms measured on a small cloud VM).

## Caveats

- **Node only.** jsdom / happy-dom state (DOM nodes, `localStorage`, `document.cookie`) isn't checked yet, and neither are Bun or Deno.
- **Module state isn't visible.** A module-level `let cache` that a test fills is a leak, but it's not on any object leavenotrace can see. Exported objects aren't snapshotted.
- **Concurrent tests** (`test.concurrent`, node:test `concurrency`) can be blamed for each other's traces. Run with concurrency 1 when you hunt.

## Roadmap

- [ ] jsdom / happy-dom: DOM nodes left in `document.body`, `localStorage`, cookies, `window` listeners
- [ ] Unhandled promise rejections and still-pending promises created by a test
- [ ] `--fix` hints: the cleanup line to add (`vi.unstubAllEnvs()`, `clearInterval(...)`, `mock.restore()`)
- [ ] A GitHub Action that annotates the leaky test lines in a PR

## See also

[shakeout](https://github.com/Anime5hka/shakeout) finds flaky tests caused by timing. [raceloom](https://github.com/Anime5hka/raceloom) and [sqlloom](https://github.com/Anime5hka/sqlloom) find race conditions in async code and SQL transactions.

## License

[MIT](LICENSE)
