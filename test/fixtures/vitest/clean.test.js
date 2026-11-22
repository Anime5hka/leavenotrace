import { test, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { createRequire } from 'node:module';
const { withServer } = createRequire(import.meta.url)('../helpers.cjs');

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

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
test('restored spies, stubs and fake timers', () => {
  vi.spyOn(Date, 'now').mockReturnValue(1);
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubGlobal('navigator', { language: 'en' });
  vi.useFakeTimers();
  setTimeout(() => {}, 100000);
  console.log('a log line');
  expect(Date.now()).toBe(1);
});
test('dynamic import, crypto, json', async () => {
  const { createHash } = await import('node:crypto');
  expect(createHash('sha1').update('x').digest('hex')).toHaveLength(40);
  expect(JSON.parse('{"a":1}').a).toBe(1);
  expect(structuredClone({ a: [1] })).toEqual({ a: [1] });
});
