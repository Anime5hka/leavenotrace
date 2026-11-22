const { test, expect, afterEach } = require('@jest/globals');
const fs = require('node:fs');
const { readFile, mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { request } = require('node:http');
const { withServer } = require('../helpers.cjs');

afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('fetch and http against a local server', () => withServer(async (url) => {
  expect((await (await fetch(`${url}/a`)).json()).path).toBe('/a');
  const body = await new Promise((res, rej) => request(`${url}/b`, (r) => { let s = ''; r.on('data', (d) => { s += d; }); r.on('end', () => res(s)); }).on('error', rej).end());
  expect(JSON.parse(body).path).toBe('/b');
}));
test('files, timers, promises', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lnt-'));
  fs.writeFileSync(join(dir, 'a'), 'x');
  expect(await readFile(join(dir, 'a'), 'utf8')).toBe('x');
  await rm(dir, { recursive: true });
  await new Promise((r) => setTimeout(r, 5));
  const i = setInterval(() => {}, 5); clearInterval(i);
});
test('restored spies and fake timers', () => {
  jest.spyOn(Date, 'now').mockReturnValue(1);
  jest.useFakeTimers();
  setTimeout(() => {}, 100000);
  console.log('a log line');
  expect(typeof Date.now()).toBe('number');
});
test('crypto, json', () => {
  const { createHash } = require('node:crypto');
  expect(createHash('sha1').update('x').digest('hex')).toHaveLength(40);
  expect(structuredClone({ a: [1] })).toEqual({ a: [1] });
});
