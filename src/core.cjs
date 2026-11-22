'use strict';
// Runner-independent core: snapshot the process state a test can leave behind, diff two
// snapshots, and track timers, servers, sockets, child processes and watchers back to the line
// of test code that created them. The runner adapters call start() before each test (before
// any of its hooks) and finish() after it (after all of its hooks).

const path = require('node:path');
const { fileURLToPath } = require('node:url');

const SELF = __dirname + path.sep;
const CWD = process.cwd();

// Things the runners themselves change between tests. Matched against finding labels.
const IGNORE = [
  /^globalThis\.__vitest/, /^globalThis\.__VITEST/, /^globalThis\[Symbol\(vitest/i,
  /^globalThis\[Symbol\((jest|JEST)/, /^globalThis\.__coverage__$/, /^globalThis\.__VUE/,
  /^globalThis\.__leavenotrace/, /^globalThis\[Symbol\(leavenotrace/,
  /^globalThis\.(expect|jasmine|__mocha_id__)$/,
  // Created lazily by node itself (fetch, http) the first time anything uses them.
  /^globalThis\[Symbol\(undici\./,
  /^process\.env\.(VITEST_|JEST_WORKER_ID$|NODE_TEST_CONTEXT$|NODE_V8_COVERAGE$)/,
  /^process\.on\((warning|newListener|removeListener)\)/,
];

// ---------------------------------------------------------------- where code came from

/**
 * File:line of the first stack frame in the user's code (not node internals, not node_modules).
 * With `direct`, only if the user's code is the direct caller: a timer that node's http client
 * or a library schedules on the user's behalf is theirs to clean up, not the test's.
 */
function userSite(stack, direct = false) {
  for (const line of String(stack).split('\n').slice(1)) {
    if (line.includes(SELF)) continue;
    const loc = frameLocation(line);
    if (!loc) { if (direct && /\(?node:/.test(line)) return null; continue; }
    let file = loc.file.startsWith('file://') ? fileURLToPath(loc.file) : loc.file;
    if (file.startsWith(SELF)) continue;
    if (/[\\/]node_modules[\\/]/.test(file)) { if (direct) return null; continue; }
    if (file.startsWith(CWD + path.sep)) file = file.slice(CWD.length + 1);
    return `${file}:${loc.line}`;
  }
  return null;
}

function frameLocation(line) {
  const text = line.trim().replace(/^at\s+/, '');
  const inner = text.endsWith(')') ? text.slice(text.lastIndexOf('(') + 1, -1) : text.replace(/^async\s+/, '');
  const m = /^(.*):(\d+):(\d+)$/.exec(inner);
  if (!m || /[()<>]/.test(m[1]) || !/^(file:\/\/|\/|[A-Za-z]:\\)/.test(m[1])) return null;
  return { file: m[1], line: Number(m[2]), col: Number(m[3]) };
}

function here(direct = false) {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 40;
  const stack = new Error().stack;
  Error.stackTraceLimit = limit;
  return userSite(stack, direct);
}

// ---------------------------------------------------------------- snapshots

const MODULES = ['fs', 'fs/promises', 'http', 'https', 'net', 'child_process', 'os', 'path', 'crypto',
  'dns', 'timers', 'util', 'events', 'zlib', 'stream', 'readline', 'url', 'worker_threads'];

/** The objects whose own properties a test should not leave changed, with their labels. */
function watched(g) {
  const list = [['globalThis', g]];
  for (const name of ['Date', 'Math', 'JSON', 'console', 'Promise', 'Object', 'Array', 'String', 'Number',
    'Reflect', 'Intl', 'Buffer', 'URL', 'crypto', 'performance']) {
    if (g[name] && (typeof g[name] === 'object' || typeof g[name] === 'function')) list.push([name, g[name]]);
  }
  for (const name of ['Object', 'Array', 'String', 'Number', 'Boolean', 'Function', 'Promise', 'Date', 'RegExp',
    'Map', 'Set', 'Error', 'Symbol']) {
    if (g[name] && g[name].prototype) list.push([`${name}.prototype`, g[name].prototype]);
  }
  list.push(['process', process]);
  for (const m of MODULES) {
    try { list.push([m, require(`node:${m}`)]); } catch {}
  }
  try { list.push(['EventEmitter.prototype', require('node:events').EventEmitter.prototype]); } catch {}
  return list;
}

function keyLabel(owner, key) {
  if (typeof key === 'symbol') return `${owner}[${String(key)}]`;
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${owner}.${key}` : `${owner}[${JSON.stringify(key)}]`;
}

/** Identity of a property, without ever calling a getter. */
function slot(obj, key) {
  const d = Object.getOwnPropertyDescriptor(obj, key);
  if (!d) return undefined;
  return 'value' in d ? { value: d.value } : { get: d.get, set: d.set };
}

function snapshot(g) {
  const props = new Map();
  for (const [owner, obj] of watched(g)) {
    let keys;
    try { keys = Reflect.ownKeys(obj); } catch { continue; }
    for (const key of keys) {
      // process.* data properties (env, title, exitCode...) are handled separately or change on their own.
      if (owner === 'process' && typeof slot(obj, key)?.value !== 'function') continue;
      if (owner === 'globalThis' && (key === 'process' || key === 'global')) continue;
      props.set(keyLabel(owner, key), slot(obj, key));
    }
  }
  const listeners = new Map();
  for (const ev of process.eventNames()) listeners.set(ev, process.rawListeners(ev).slice());
  return {
    env: { ...process.env },
    cwd: safe(() => process.cwd()),
    exitCode: process.exitCode,
    props,
    listeners,
  };
}

const safe = (fn) => { try { return fn(); } catch { return undefined; } };

function show(v) {
  if (v === undefined) return 'undefined';
  if (typeof v === 'function') return v.name ? `function ${v.name}` : 'an anonymous function';
  if (typeof v === 'string') return JSON.stringify(v.length > 60 ? `${v.slice(0, 57)}...` : v);
  if (v && typeof v === 'object') return v.constructor && v.constructor.name ? `a ${v.constructor.name}` : 'an object';
  return String(v);
}

function sameSlot(a, b) {
  if (!a || !b) return a === b;
  return Object.is(a.value, b.value) && a.get === b.get && a.set === b.set;
}

/** What changed between two snapshots, as findings { label, what }. */
function diff(before, after) {
  const out = [];
  const keys = new Set([...Object.keys(before.env), ...Object.keys(after.env)]);
  for (const k of keys) {
    const a = before.env[k];
    const b = after.env[k];
    if (a === b) continue;
    const label = `process.env.${k}`;
    if (a === undefined) out.push({ label, what: `set to ${show(b)} (was unset)` });
    else if (b === undefined) out.push({ label, what: `deleted (was ${show(a)})` });
    else out.push({ label, what: `changed to ${show(b)} (was ${show(a)})` });
  }
  if (before.cwd !== after.cwd) out.push({ label: 'process.cwd()', what: `changed to ${JSON.stringify(after.cwd)} (was ${JSON.stringify(before.cwd)})` });
  if (before.exitCode !== after.exitCode) out.push({ label: 'process.exitCode', what: `set to ${show(after.exitCode)}` });

  for (const [label, b] of after.props) {
    const a = before.props.get(label);
    if (sameSlot(a, b)) continue;
    if (a === undefined) out.push({ label, what: `added (${show(b.value ?? b.get)})` });
    else out.push({ label, what: describeReplacement(a, b) });
  }
  for (const [label, a] of before.props) {
    if (!after.props.has(label)) out.push({ label, what: `deleted (was ${show(a.value ?? a.get)})` });
  }

  const events = new Set([...before.listeners.keys(), ...after.listeners.keys()]);
  for (const ev of events) {
    const a = before.listeners.get(ev) || [];
    const b = after.listeners.get(ev) || [];
    const added = b.filter((fn) => !a.includes(fn)).length;
    const removed = a.filter((fn) => !b.includes(fn)).length;
    const label = `process.on(${String(ev)})`;
    if (added) out.push({ label, what: `${added} listener${added > 1 ? 's' : ''} added and not removed` });
    if (removed) out.push({ label, what: `${removed} listener${removed > 1 ? 's' : ''} removed` });
  }
  return collapseFakeTimers(after, out).filter((f) => !IGNORE.some((re) => re.test(f.label)));
}

// Fake timers (@sinonjs/fake-timers, used by vitest and jest) replace Date, timers, performance,
// Intl.DateTimeFormat and process.hrtime all at once. One finding says it better than eighty.
const FAKED = /^(globalThis\.(Date|Intl|performance|setTimeout|clearTimeout|setInterval|clearInterval|setImmediate|clearImmediate|queueMicrotask|requestAnimationFrame|cancelAnimationFrame|requestIdleCallback|cancelIdleCallback)$|(Date|Intl|performance)(\.|\[)|Date\.prototype|process\.(hrtime|nextTick|uptime)$)/;
function collapseFakeTimers(after, findings) {
  const date = after.props.get('globalThis.Date')?.value;
  const timeout = after.props.get('globalThis.setTimeout')?.value;
  const fake = (date && date.isFake === true) || (timeout && (timeout.clock || timeout._isMockFunction === undefined && /^fake/i.test(timeout.name)));
  if (!fake || !findings.some((f) => FAKED.test(f.label))) return findings;
  return [
    { label: 'fake timers', what: 'still installed (useFakeTimers() without useRealTimers())' },
    ...findings.filter((f) => !FAKED.test(f.label)),
  ];
}

function describeReplacement(a, b) {
  const fn = b.value;
  if (typeof fn === 'function') {
    // vitest / jest spies say so; sinon stubs too.
    if (fn._isMockFunction || fn.mock) return 'replaced by a mock that was never restored';
    if (fn.isSinonProxy || fn.restore) return 'replaced by a sinon stub (missing restore()?)';
    if (/fake|clock/i.test(fn.name) || fn.clock) return 'replaced (fake timers still installed?)';
    return `replaced (${show(fn)})`;
  }
  return `changed to ${show(b.value ?? b.get)} (was ${show(a.value ?? a.get)})`;
}

// ---------------------------------------------------------------- live resources

let current = null; // id of the running test
const live = new Set();

function track(kind, describe, alive, site) {
  if (current === null || !site) return;
  live.add({ kind, describe, alive, site, test: current });
}

// Node's modules are shared by the whole process, but this file can be loaded more than once
// (jest gives every test file its own module registry). The patches on node's modules are
// installed once per process and always report to the most recently loaded copy.
const SHARED = Symbol.for('leavenotrace.shared');
const shared = process[SHARED] || (process[SHARED] = { installed: false, track: null });
shared.track = (...a) => track(...a);

const HTTP_INTERNALS = /node:internal\/deps\/undici|node:_http_agent|node:_http_client|node:https|node:internal\/http/;

let installedFor = new WeakSet();
function install(g) {
  if (installedFor.has(g)) return;
  installedFor.add(g);

  const realSetTimeout = g.setTimeout;
  const realSetInterval = g.setInterval;
  if (typeof realSetTimeout === 'function') {
    const setTimeout = function setTimeout(fn, ms, ...args) {
      const t = realSetTimeout.call(this, fn, ms, ...args);
      const site = here(true);
      if (site && t && typeof t === 'object') {
        track('setTimeout', () => `setTimeout(…, ${Number(ms) || 0}) still pending`, () => !t._destroyed, site);
      }
      return t;
    };
    copyProps(realSetTimeout, setTimeout);
    g.setTimeout = setTimeout;
  }
  if (typeof realSetInterval === 'function') {
    const setInterval = function setInterval(fn, ms, ...args) {
      const t = realSetInterval.call(this, fn, ms, ...args);
      const site = here(true);
      if (site && t && typeof t === 'object') {
        track('setInterval', () => `setInterval(…, ${Number(ms) || 0}) still running`, () => !t._destroyed, site);
      }
      return t;
    };
    copyProps(realSetInterval, setInterval);
    g.setInterval = setInterval;
  }
  installNode();
}

function installNode() {
  if (shared.installed) return;
  shared.installed = true;
  const track = (...a) => shared.track(...a);
  const net = require('node:net');
  const realListen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...args) {
    const site = here();
    if (site && !this.__lntTracked) {
      this.__lntTracked = true;
      const server = this;
      track('server', () => {
        const a = safe(() => server.address());
        return `server still listening${a && typeof a === 'object' ? ` on port ${a.port}` : a ? ` on ${a}` : ''}`;
      }, () => server.listening, site);
    }
    return realListen.apply(this, args);
  };
  const realConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    if (!this.__lntTracked) {
      this.__lntTracked = true;
      const stack = new Error().stack;
      const site = HTTP_INTERNALS.test(stack) ? null : here();
      const socket = this;
      track('socket', () => {
        const where = socket.remotePort ? ` to port ${socket.remotePort}` : '';
        return `socket${where} still open`;
      }, () => !socket.destroyed, site);
    }
    return realConnect.apply(this, args);
  };
  const cp = require('node:child_process');
  const realSpawn = cp.ChildProcess.prototype.spawn;
  cp.ChildProcess.prototype.spawn = function (options) {
    const r = realSpawn.call(this, options);
    const child = this;
    const site = here();
    track('child process', () => `child process ${child.spawnfile ?? ''} (pid ${child.pid}) still running`,
      () => child.exitCode === null && child.signalCode === null && !child.killed, site);
    return r;
  };
  const fs = require('node:fs');
  const realWatch = fs.watch;
  fs.watch = function watch(...args) {
    const w = realWatch.apply(this, args);
    let closed = false;
    w.once('close', () => { closed = true; });
    track('fs.watch', () => `fs.watch(${show(String(args[0]))}) still watching`, () => !closed, here());
    return w;
  };
  const { syncBuiltinESMExports } = require('node:module');
  syncBuiltinESMExports();
}

function copyProps(from, to) {
  for (const key of Reflect.ownKeys(from)) {
    if (key === 'length' || key === 'name' || key === 'prototype') continue;
    try { Object.defineProperty(to, key, Object.getOwnPropertyDescriptor(from, key)); } catch {}
  }
}

// ---------------------------------------------------------------- the per-test protocol

let seq = 0;
let base = null;

/** Call before each test, before any of its hooks. */
function start(g) {
  install(g);
  current = ++seq;
  base = snapshot(g);
  return current;
}

/**
 * Call after each test, after all of its hooks. Returns the traces the test left behind.
 * Each finding: { label, what, site? }.
 */
function finish(g) {
  if (base === null) return [];
  const findings = diff(base, snapshot(g));
  for (const r of live) {
    if (r.test === current && safe(r.alive)) findings.push({ label: r.kind, what: r.describe(), site: r.site });
  }
  live.clear();
  base = null;
  current = null;
  return findings.filter((f) => !ignored(f));
}

let extraIgnore = [];
function ignored(f) {
  return extraIgnore.some((p) => (p instanceof RegExp ? p.test(f.label) : f.label === p || f.label.startsWith(`${p}.`)));
}

/** Labels (exact, prefix or RegExp) to never report, e.g. 'process.env.DEBUG' or /^globalThis\.__my/. */
function ignore(...patterns) {
  extraIgnore.push(...patterns.flat());
  return extraIgnore;
}
if (process.env.LEAVENOTRACE_IGNORE) ignore(process.env.LEAVENOTRACE_IGNORE.split(',').map((s) => s.trim()).filter(Boolean));

function format(findings) {
  const width = Math.min(34, Math.max(...findings.map((f) => f.label.length)));
  return findings.map((f) => `  ${f.label.padEnd(width)}  ${f.what}${f.site ? `, created at ${f.site}` : ''}`).join('\n');
}

class LeftATrace extends Error {
  constructor(findings) {
    super(`this test left a trace:\n${format(findings)}\n\nClean it up in the test (or an afterEach), or see https://github.com/Anime5hka/leavenotrace#ignoring`);
    this.name = 'LeftATrace';
    this.findings = findings;
    // The stack would only point at this file; the useful locations are in the message.
    this.stack = `${this.name}: ${this.message}`;
  }
}

/** 'fail' (default): the leaking test fails. 'warn': report to stderr and pass. */
const mode = () => (process.env.LEAVENOTRACE === 'warn' ? 'warn' : 'fail');

function report(testName, findings, file) {
  if (!findings.length) return;
  if (process.env.LEAVENOTRACE_REPORT) {
    try {
      require('node:fs').appendFileSync(process.env.LEAVENOTRACE_REPORT,
        `${JSON.stringify({ test: testName, file, findings })}\n`);
    } catch {}
  }
  if (mode() === 'fail') throw new LeftATrace(findings);
  process.stderr.write(`\n[leavenotrace] ${testName ? `"${testName}"` : 'a test'}${file ? ` (${file})` : ''} left a trace:\n${format(findings)}\n`);
}

module.exports = { start, finish, report, ignore, format, snapshot, diff, userSite, frameLocation, LeftATrace, mode };
