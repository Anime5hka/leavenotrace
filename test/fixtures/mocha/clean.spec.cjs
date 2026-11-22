const assert = require('node:assert/strict');
const fs = require('node:fs');
const { readFile, mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { withServer } = require('../helpers.cjs');

describe('clean', () => {
  let realNow;
  beforeEach(() => { realNow = Date.now; });
  afterEach(() => { Date.now = realNow; });
  it('fetch against a local server', () => withServer(async (url) => {
    assert.equal((await (await fetch(`${url}/a`)).json()).path, '/a');
  }));
  it('files and timers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lnt-'));
    fs.writeFileSync(join(dir, 'a'), 'x');
    assert.equal(await readFile(join(dir, 'a'), 'utf8'), 'x');
    await rm(dir, { recursive: true });
    await new Promise((r) => setTimeout(r, 5));
  });
  it('a stub restored in afterEach', () => { Date.now = () => 1; assert.equal(Date.now(), 1); });
});
