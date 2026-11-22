// `leavenotrace [options] -- <test command>`: runs the command with the check switched on
// and prints which tests left what behind.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('.', import.meta.url));

const HELP = `leavenotrace: find the tests that leave a mess behind

Usage: leavenotrace [options] -- <test command...>

  --fail      make leaky tests fail (default: report them and keep the test result)
  --verbose   show the test command's own output
  --json      print the findings as JSON

Works out of the box with node --test and mocha. For vitest and jest, add one line to
your config instead (see https://github.com/Anime5hka/leavenotrace#setup).

Examples:
  npx leavenotrace -- node --test
  npx leavenotrace -- npx mocha
  npx leavenotrace -- npm test`;

export function parseArgs(argv) {
  const dash = argv.indexOf('--');
  const own = dash === -1 ? argv : argv.slice(0, dash);
  const command = dash === -1 ? [] : argv.slice(dash + 1);
  const o = { fail: false, verbose: false, json: false, help: false };
  for (const a of own) {
    if (a === '--fail') o.fail = true;
    else if (a === '--verbose') o.verbose = true;
    else if (a === '--json') o.json = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`unknown option ${a} (the test command goes after --)`);
  }
  return { o, command };
}

/** Which runner a command starts, as far as we can tell from the command line. */
export function detectRunner(command) {
  const names = command.map((c) => basename(c).replace(/\.(c|m)?js$/, ''));
  if (names.includes('vitest')) return 'vitest';
  if (names.includes('jest')) return 'jest';
  if (names.includes('mocha') || names.includes('_mocha')) return 'mocha';
  return 'other';
}

const CODES = { red: 31, green: 32, yellow: 33, cyan: 36, gray: 90, bold: 1 };
const painter = (on) => (style, s) => (on ? `\x1b[${CODES[style]}m${s}\x1b[0m` : s);

export async function main(argv, { out = process.stdout, err = process.stderr, color } = {}) {
  let parsed;
  try { parsed = parseArgs(argv); } catch (e) { err.write(`leavenotrace: ${e.message}\n\n${HELP}\n`); return 2; }
  const { o, command } = parsed;
  if (o.help) { out.write(`${HELP}\n`); return 0; }
  if (!command.length) { err.write(`leavenotrace: give the test command after --\n\n${HELP}\n`); return 2; }
  const c = painter(color ?? (Boolean(out.isTTY) && !process.env.NO_COLOR));

  const runner = detectRunner(command);
  const args = command.slice(1);
  if (runner === 'mocha') args.push('--require', join(SRC, 'mocha.cjs'));

  const dir = mkdtempSync(join(tmpdir(), 'leavenotrace-'));
  const report = join(dir, 'report.jsonl');
  const env = {
    ...process.env,
    LEAVENOTRACE: o.fail ? 'fail' : 'quiet',
    LEAVENOTRACE_REPORT: report,
    // node:test (and anything else that runs it) loads the check through the preload.
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import ${JSON.stringify(join(SRC, 'node.mjs'))}`.trim(),
  };
  delete env.NODE_TEST_CONTEXT;

  if (!o.json) out.write(`${c('bold', 'leavenotrace')} ${c('gray', '·')} ${command.join(' ')}\n`);
  const code = await new Promise((resolve) => {
    const child = spawn(command[0], args, {
      env,
      stdio: ['inherit', o.verbose && !o.json ? 'inherit' : 'pipe', o.verbose && !o.json ? 'inherit' : 'pipe'],
      shell: process.platform === 'win32',
    });
    let tail = '';
    const keep = (d) => { tail = (tail + d).slice(-4000); };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    child.on('error', (e) => { tail += `\ncould not start ${command[0]}: ${e.message}\n`; });
    child.on('close', (c2, signal) => resolve({ code: c2 ?? (signal ? 128 : 1), tail }));
  });
  const reports = existsSync(report)
    ? readFileSync(report, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
  rmSync(dir, { recursive: true, force: true });

  if (o.json) {
    out.write(`${JSON.stringify({ command, exitCode: code.code, leaky: reports }, null, 2)}\n`);
    return reports.length ? 1 : code.code;
  }

  if (!reports.length) {
    if (runner === 'vitest' || runner === 'jest') {
      out.write(`\n${c('yellow', '!')} ${runner} needs one line in its config to load the check:\n` +
        `    ${runner === 'vitest' ? "test: { setupFiles: ['leavenotrace/vitest'] }" : "setupFilesAfterEnv: ['leavenotrace/jest']"}\n`);
      return code.code || 0;
    }
    if (code.code !== 0) {
      out.write(`\n${c('red', '✗')} The tests failed, but none of them left a trace. Output:\n${code.tail.trimEnd().split('\n').slice(-15).map((l) => `  │ ${l}`).join('\n')}\n`);
      return code.code;
    }
    out.write(`\n${c('green', '✓')} Every test cleaned up after itself.\n`);
    return 0;
  }

  out.write(`\n${c('red', '✗')} ${c('bold', `${reports.length} ${reports.length === 1 ? 'test left' : 'tests left'} a trace`)}\n`);
  const byFile = new Map();
  for (const r of reports) {
    const k = r.file ?? '(unknown file)';
    if (!byFile.has(k)) byFile.set(k, []);
    byFile.get(k).push(r);
  }
  for (const [file, rs] of byFile) {
    out.write(`\n  ${c('cyan', file)}\n`);
    for (const r of rs) {
      out.write(`    ${c('red', '✗')} ${r.test ?? '(unnamed test)'}\n`);
      const width = Math.min(30, Math.max(...r.findings.map((f) => f.label.length)));
      for (const f of r.findings) {
        out.write(`        ${c('bold', f.label.padEnd(width))}  ${f.what}${f.site ? c('gray', `  ${f.site}`) : ''}\n`);
        if (f.hint) out.write(`        ${c('green', `↳ ${f.hint}`)}\n`);
      }
    }
  }
  if (code.code !== 0 && !o.fail) {
    out.write(`\n${c('gray', `The test run also failed (exit code ${code.code}). Tests that ran after a leaky one may be failing because of it.`)}\n`);
  }
  return 1;
}
