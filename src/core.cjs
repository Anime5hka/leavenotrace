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
  let first = null;
  for (const line of String(stack).split('\n').slice(1)) {
    if (line.includes(SELF)) continue;
    const loc = frameLocation(line);
    if (!loc) { if (direct && !first && /\(?node:/.test(line)) return null; continue; }
    let file = loc.file.startsWith('file://') ? fileURLToPath(loc.file) : loc.file;
    if (file.startsWith(SELF)) continue;
    if (/[\\/]node_modules[\\/]/.test(file)) { if (direct && !first) return null; continue; }
    if (file.startsWith(CWD + path.sep)) file = file.slice(CWD.length + 1);
    const here = `${file}:${loc.line}`;
    if (!first) {
      first = { file, here };
      if (TEST_FILE.test(file)) return here;
    } else if (file !== first.file && TEST_FILE.test(file)) {
      // Created in your code, on behalf of a test: name both.
      return `${first.here} (from ${here})`;
    }
  }
  return first ? first.here : null;
}

const TEST_FILE = /(\.|_|-)(test|spec)\.[cm]?[jt]sx?$|[\\/]__tests__[\\/]|^tests?[\\/]/;

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
  return list.concat(nodeModules());
}

let modulesCache = null;
function nodeModules() {
  if (modulesCache) return modulesCache;
  modulesCache = [];
  for (const m of MODULES) {
    try { modulesCache.push([m, require(`node:${m}`)]); } catch {}
  }
  try { modulesCache.push(['EventEmitter.prototype', require('node:events').EventEmitter.prototype]); } catch {}
  return modulesCache;
}

function keyLabel(owner, key) {
  if (typeof key === 'symbol') return `${owner}[${String(key)}]`;
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${owner}.${key}` : `${owner}[${JSON.stringify(key)}]`;
}

/** Identity of a property, without ever calling a getter. */
function slot(obj, key) {
  return Object.getOwnPropertyDescriptor(obj, key);
}

function snapshot(g) {
  // owner label -> Map(key -> property descriptor). Labels for keys are only built for changes.
  const props = new Map();
  for (const [owner, obj] of watched(g)) {
    let keys;
    try { keys = Reflect.ownKeys(obj); } catch { continue; }
    const slots = new Map();
    for (const key of keys) {
      if (owner === 'globalThis' && (key === 'process' || key === 'global')) continue;
      const d = slot(obj, key);
      // process.* data properties (env, title, exitCode...) are handled separately or change on their own.
      if (owner === 'process' && typeof d?.value !== 'function') continue;
      slots.set(key, d);
    }
    props.set(owner, slots);
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

  for (const [owner, bs] of after.props) {
    const as = before.props.get(owner) || new Map();
    for (const [key, b] of bs) {
      const a = as.get(key);
      if (sameSlot(a, b)) continue;
      const label = keyLabel(owner, key);
      if (a === undefined) out.push({ label, what: `added (${show(b.value ?? b.get)})` });
      else out.push({ label, what: describeReplacement(a, b) });
    }
    for (const [key, a] of as) {
      if (!bs.has(key)) out.push({ label: keyLabel(owner, key), what: `deleted (was ${show(a.value ?? a.get)})` });
    }
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
const FAKED = /^(globalThis\.(Date|Intl|performance|setTimeout|clearTimeout|setInterval|clearInterval|setImmediate|clearImmediate|queueMicrotask|requestAnimationFrame|cancelAnimationFrame|requestIdleCallback|cancelIdleCallback)$|(Date|Intl|performance)(\.|\[)|Date\.prototype|timers\.|process\.(hrtime|nextTick|uptime)$)/;
function collapseFakeTimers(after, findings) {
  const date = after.props.get('globalThis')?.get('Date')?.value;
  const timeout = after.props.get('globalThis')?.get('setTimeout')?.value;
  const fake = (date && (date.isFake === true || date.isMock === true)) || (timeout && (timeout.clock || timeout._isMockFunction === undefined && /^fake/i.test(timeout.name)));
  if (!fake || !findings.some((f) => FAKED.test(f.label))) return findings;
  return [
    { label: 'fake timers', what: 'still installed (fake timers were turned on and never turned off)' },
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

// `handle` is unref'd once the leak is reported, so a leaked interval or server does not also
// keep the test process from exiting (node --test and mocha would otherwise hang).
function track(kind, describe, alive, site, handle) {
  if (current === null || !site) return;
  live.add({ kind, describe, alive, site, handle, test: current });
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
        track('setTimeout', () => `still pending (a ${Number(ms) || 0} ms timeout)`, () => !t._destroyed, site, t);
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
        track('setInterval', () => `still running (every ${Number(ms) || 0} ms)`, () => !t._destroyed, site, t);
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
      // Connections the server accepted keep the process alive too (an http server holds an
      // idle one for ~90 s), so releasing the server releases them as well.
      const conns = new Set();
      let released = false;
      server.on('connection', (socket) => {
        if (released) { socket.unref(); return; }
        conns.add(socket);
        socket.once('close', () => conns.delete(socket));
      });
      const release = { unref() { released = true; server.unref(); for (const c of conns) c.unref(); } };
      track('server', () => {
        const a = safe(() => server.address());
        return `still listening${a && typeof a === 'object' ? ` on port ${a.port}` : a ? ` on ${a}` : ''}`;
      }, () => server.listening, site, release);
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
        return `still open${where}`;
      }, () => !socket.destroyed, site, socket);
    }
    return realConnect.apply(this, args);
  };
  const cp = require('node:child_process');
  const realSpawn = cp.ChildProcess.prototype.spawn;
  cp.ChildProcess.prototype.spawn = function (options) {
    const r = realSpawn.call(this, options);
    const child = this;
    const site = here();
    track('child process', () => `still running (${child.spawnfile ?? ''}, pid ${child.pid})`,
      () => child.exitCode === null && child.signalCode === null && !child.killed, site,
      { unref() { child.unref(); for (const s of child.stdio ?? []) s?.unref?.(); } });
    return r;
  };
  const fs = require('node:fs');
  const realWatch = fs.watch;
  fs.watch = function watch(...args) {
    const w = realWatch.apply(this, args);
    let closed = false;
    w.once('close', () => { closed = true; });
    track('fs.watch', () => `still watching ${show(String(args[0]))}`, () => !closed, here(), w);
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
  const handles = new Map();
  for (const r of live) {
    if (r.test !== current || !safe(r.alive)) continue;
    const f = { label: r.kind, what: r.describe(), site: r.site };
    findings.push(f);
    handles.set(f, r.handle);
  }
  live.clear();
  base = null;
  current = null;
  const kept = findings.filter((f) => !ignored(f));
  for (const f of kept) safe(() => handles.get(f)?.unref?.());
  return kept;
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

/**
 * 'fail' (default): the leaking test fails. 'warn': report to stderr and pass.
 * 'quiet': only write LEAVENOTRACE_REPORT (the CLI prints a summary at the end).
 */
const mode = () => (['warn', 'quiet'].includes(process.env.LEAVENOTRACE) ? process.env.LEAVENOTRACE : 'fail');

function report(testName, findings, file) {
  if (!findings.length) return;
  if (process.env.LEAVENOTRACE_REPORT) {
    try {
      require('node:fs').appendFileSync(process.env.LEAVENOTRACE_REPORT,
        `${JSON.stringify({ test: testName, file, findings })}\n`);
    } catch {}
  }
  if (mode() === 'fail') throw new LeftATrace(findings);
  if (mode() === 'quiet') return;
  process.stderr.write(`\n[leavenotrace] ${testName ? `"${testName}"` : 'a test'}${file ? ` (${file})` : ''} left a trace:\n${format(findings)}\n`);
}

module.exports = { start, finish, report, ignore, format, snapshot, diff, userSite, frameLocation, LeftATrace, mode };
