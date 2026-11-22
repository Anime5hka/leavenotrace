// Renders the real output of leavenotrace on the checkout example as an animated terminal SVG.
// Usage: node scripts/demo-svg.js > assets/demo.svg   (--static: no fade-in, for PNG renderers)
import { main } from '../src/cli.js';

const STATIC = process.argv.includes('--static');
const cmd = ['node', '--test', '--test-isolation=none', "'examples/checkout/*.test.js'"];
let text = '';
await main(['--', 'node', '--test', '--test-isolation=none', '--test-force-exit', 'examples/checkout/*.test.js'],
  { out: { write: (s) => { text += s; } }, color: true });
text = text.trimEnd().replace(/^.*\n\s*\n/, ''); // the header line repeats the command; we draw our own prompt

const palette = { 31: '#ff7b72', 32: '#7ee787', 33: '#e3b341', 36: '#79c0ff', 90: '#8b949e' };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function spans(line) {
  const out = [];
  let style = null;
  for (const part of line.split(/(\x1b\[\d+m)/)) {
    const m = part.match(/^\x1b\[(\d+)m$/);
    if (m) { style = m[1] === '0' ? null : m[1]; continue; }
    if (!part) continue;
    if (!style) out.push(esc(part));
    else if (style === '1') out.push(`<tspan font-weight="700" fill="#f0f6fc">${esc(part)}</tspan>`);
    else out.push(`<tspan fill="${palette[style]}">${esc(part)}</tspan>`);
  }
  return out.join('');
}

const lines = [`\x1b[90m$\x1b[0m npx leavenotrace -- ${cmd.join(' ')}`, '', ...text.split('\n')];
const lh = 20;
const top = 52;
const width = 1000;
const height = top + lines.length * lh + 16;
const rows = lines.map((l, i) => {
  const delay = i < 2 ? i * 0.3 : 0.9 + (i - 2) * 0.12;
  return `<text x="20" y="${top + i * lh}" class="l" style="animation-delay:${delay.toFixed(2)}s" xml:space="preserve">${spans(l)}</text>`;
}).join('\n  ');

process.stdout.write(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="leavenotrace output: three tests in catalog.test.js left a trace: process.env.CURRENCY set to EUR, Date.now replaced by a mock that was never restored, and an interval still running, created at shop.js line 15 from catalog.test.js line 18">
<style>
  .l { font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; fill: #c9d1d9;${STATIC ? '' : ' opacity: 0; animation: in .25s ease-out forwards;'} }
  @keyframes in { to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .l { animation: none; opacity: 1; } }
</style>
<rect width="${width}" height="${height}" rx="10" fill="#0d1117"/>
<rect width="${width}" height="30" rx="10" fill="#161b22"/>
<rect y="20" width="${width}" height="10" fill="#161b22"/>
<circle cx="20" cy="15" r="6" fill="#ff5f56"/><circle cx="40" cy="15" r="6" fill="#ffbd2e"/><circle cx="60" cy="15" r="6" fill="#27c93f"/>
  ${rows}
</svg>
`);
