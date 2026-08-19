// Runs the three area suites and prints a per-area tally plus every failure.
import a1 from './area1-poly.mjs';
import a2 from './area2-swing.mjs';
import a3 from './area3-song.mjs';
import { report } from './lib/harness.mjs';

// The browser suite needs Playwright, which lives outside the repo. It is opt-in:
//   node tests/run.mjs --browser
const suites = [a1, a2, a3];
if (process.argv.includes('--browser')) {
  const b = await import('./ui/browser.mjs');
  suites.push(b.default);
}
if (process.argv.includes('--pullmet')) {
  const b = await import('./ui/pullmet.mjs');
  suites.push(b.default);
}
for (const s of suites) console.log(`${s.area.padEnd(12)} run ${String(s.n).padStart(6)}  pass ${String(s.pass).padStart(6)}  fail ${String(s.fails.length).padStart(5)}`);
const { n, p, f } = report(suites);
console.log(`${'TOTAL'.padEnd(12)} run ${String(n).padStart(6)}  pass ${String(p).padStart(6)}  fail ${String(f).padStart(5)}`);

if (process.argv.includes('--failures')) {
  console.log('\n--- failures ---');
  const seen = new Map();
  for (const s of suites) for (const fl of s.fails) {
    const k = s.area + '|' + fl.name.replace(/[-0-9.]+\/[-0-9.]+|\b\d+\b/g, '#');
    if (!seen.has(k)) { seen.set(k, 0); console.log(`[${s.area}] ${fl.name}\n    ${fl.detail}`); }
    seen.set(k, seen.get(k) + 1);
  }
  console.log(`\n(${[...seen.values()].reduce((a, b) => a + b, 0)} failures in ${seen.size} distinct shapes)`);
}
export { suites };
