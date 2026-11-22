import { appendFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const prop = (s) => esc(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

/**
 * Where to annotate a finding: the test's own line that created the leak ("x.js:14 (from x.test.js:15)"),
 * else the line that created it, else the test file.
 */
export function location(finding, testFile) {
  const site = finding.site ?? '';
  const from = /\(from (.+):(\d+)\)$/.exec(site);
  if (from) return { file: from[1], line: Number(from[2]) };
  const at = /^(.+?):(\d+)(?::\d+)?$/.exec(site);
  if (at) return { file: at[1], line: Number(at[2]) };
  return testFile ? { file: testFile, line: null } : null;
}

/** The findings as a Markdown report (job summary, PR comment). */
export function markdown(reports, command) {
  const head = `### leavenotrace · \`${cell(command.join(' '))}\`\n\n`;
  if (!reports.length) return `${head}✅ **Every test cleaned up after itself.**\n`;
  const rows = [];
  for (const r of reports) {
    for (const f of r.findings) {
      rows.push(`| ${cell(r.test ?? '(unnamed test)')} | \`${cell(r.file ?? '?')}\` | \`${cell(f.label)}\` ${cell(f.what)}${f.site ? ` (\`${cell(f.site)}\`)` : ''} | ${cell(f.hint ?? '')} |`);
    }
  }
  return `${head}❌ **${reports.length} ${reports.length === 1 ? 'test left' : 'tests left'} a trace**\n\n`
    + `| Test | File | Left behind | Fix |\n|---|---|---|---|\n${rows.join('\n')}\n`;
}

/** GitHub Actions workflow commands: an error per leftover, on the line that created it. */
export function annotations(reports, cwd, workspace = cwd) {
  let out = '';
  for (const r of reports) {
    for (const f of r.findings) {
      const loc = location(f, r.file);
      let where = '';
      if (loc) {
        const file = relative(workspace, isAbsolute(loc.file) ? loc.file : join(cwd, loc.file));
        where = `file=${prop(file)}${loc.line ? `,line=${loc.line}` : ''},`;
      }
      const title = `leavenotrace: "${r.test ?? 'a test'}" leaves ${f.label} behind`;
      out += `::error ${where}title=${prop(title)}::${esc(`${f.label} ${f.what}.${f.hint ? ` Fix: ${f.hint}.` : ''}`)}\n`;
    }
  }
  return out;
}

/** On GitHub Actions: the report in the job summary and an error annotation per leftover. */
export function publish(reports, command, { env, cwd, stream }) {
  if (env.GITHUB_ACTIONS !== 'true') return;
  if (env.GITHUB_STEP_SUMMARY) {
    try { appendFileSync(env.GITHUB_STEP_SUMMARY, `${markdown(reports, command)}\n`); } catch {}
  }
  stream.write(annotations(reports, cwd, env.GITHUB_WORKSPACE || cwd));
}
