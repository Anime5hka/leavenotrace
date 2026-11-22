import { test, describe, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs';

let restoreTz;
afterEach(() => { if (restoreTz) { restoreTz(); restoreTz = null; } });

test('clean: sets env and restores it in a top-level afterEach', () => {
  const old = process.env.TZ;
  process.env.TZ = 'Asia/Tokyo';
  restoreTz = () => { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; };
});

test('leaky: env var', () => { process.env.API_URL = 'http://localhost:4010'; });

test('leaky: interval', () => { setInterval(() => {}, 1000); });

test('leaky: server', async () => {
  const s = createServer(() => {});
  await new Promise((r) => s.listen(0, r));
});

test('leaky: spy on fs', () => { mock.method(fs, 'readFileSync', () => 'x'); mock.restoreAll; });

test('leaky: Array.prototype', () => { Array.prototype.last = function () { return this.at(-1); }; });

test('leaky: global', () => { globalThis.cache = new Map(); });

describe('suite', () => {
  let t;
  beforeEach(() => { t = setTimeout(() => {}, 5000); });
  afterEach(() => clearTimeout(t));
  test('clean: timer cleared in describe afterEach', () => {});
  test('clean: nothing', () => { assert.ok(true); });
});
