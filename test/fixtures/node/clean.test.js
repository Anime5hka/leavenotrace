import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const { withServer } = createRequire(import.meta.url)('../helpers.cjs');

afterEach(() => { mock.restoreAll(); mock.timers.reset(); });

test('fetch against a local server', () => withServer(async (url) => {
  assert.equal((await (await fetch(`${url}/a`)).json()).path, '/a');
}));
test('files and timers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lnt-'));
  fs.writeFileSync(join(dir, 'a'), 'x');
  assert.equal(await readFile(join(dir, 'a'), 'utf8'), 'x');
  await rm(dir, { recursive: true });
  await new Promise((r) => setTimeout(r, 5));
});
test('restored mocks and mock timers', () => {
  mock.method(Date, 'now', () => 1);
  mock.timers.enable({ apis: ['setTimeout'] });
  setTimeout(() => {}, 100000);
  assert.equal(Date.now(), 1);
});
