const test = it;
const { createServer } = require('node:http');
const { connect } = require('node:net');
const { spawn } = require('node:child_process');
const fs = require('node:fs');

let restore;
afterEach(() => { restore?.(); restore = null; });

test('clean: env restored in a top-level afterEach', () => {
  const old = process.env.TZ;
  process.env.TZ = 'Asia/Tokyo';
  restore = () => { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; };
});
test('env var', () => { process.env.API_URL = 'http://localhost:4010'; });
test('interval', () => { setInterval(() => {}, 1000); });
test('timeout', () => { setTimeout(() => {}, 60_000); });
test('server', async () => { const s = createServer(); await new Promise((r) => s.listen(0, '127.0.0.1', r)); });
test('socket', async () => {
  const s = createServer(); await new Promise((r) => s.listen(0, '127.0.0.1', r)); s.unref();
  await new Promise((r) => connect(s.address().port, '127.0.0.1', r));
});
test('child process', () => { spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3000)']); });
test('spy', () => { fs.readFileSync = () => 'stub'; });
test('global', () => { globalThis.cache = new Map(); });
test('prototype', () => { Array.prototype.last = function () { return this.at(-1); }; });
test('process listener', () => { process.on('SIGUSR2', () => {}); });
test('cwd', () => { process.chdir('..'); });
describe('suite', () => {
  let t;
  beforeEach(() => { t = setTimeout(() => {}, 5000); });
  afterEach(() => clearTimeout(t));
  test('clean: timer cleared in a describe afterEach', () => {});
});
