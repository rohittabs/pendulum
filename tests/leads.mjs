// Reproduction of the five leads stated in TESTING-DEEP.md, run against the
// live engine before any new testing starts. Each block prints what the engine
// actually produced next to the claim, so the harness is trusted or discarded.

import { loadEngine, section, build } from './extract.mjs';
import * as M from './lib/music.mjs';

const E = loadEngine();
const out = [];
const say = (s = '') => { out.push(s); console.log(s); };

say(`engine source: ${E.__source}`);
say('');

// --- cross-check: my independent note-value table vs the engine's -----------
say('== sanity: independent note-value table vs engine ==');
let nvBad = 0;
for (const k of M.NV_KEYS) {
  if (Math.abs(M.NV_Q[k] - E.NV[k]) > 1e-12) { nvBad++; say(`  MISMATCH ${k}: mine ${M.NV_Q[k]} engine ${E.NV[k]}`); }
}
say(nvBad === 0 ? `  all ${M.NV_KEYS.length} note values agree` : `  ${nvBad} disagree`);
say('');

// --- lead 1 -----------------------------------------------------------------
say('== lead 1: poly ratios that produce fewer than 2 notes ==');
const L1 = [
  { label: '2/4 quarter, poly 2:16',    sec: { num: 2, den: 4, noteValue: 'quarter',  bars: 1, poly: { x: 2,  y: 16 } }, claim: 0 },
  { label: '3/8 dquarter, poly 3:16',   sec: { num: 3, den: 8, noteValue: 'dquarter', bars: 1, poly: { x: 3,  y: 16 } }, claim: 0 },
  { label: '2/4 quarter, poly 2:3',     sec: { num: 2, den: 4, noteValue: 'quarter',  bars: 1, poly: { x: 2,  y: 3  } }, claim: 1 },
  { label: '4/4 quarter, poly 2:16',    sec: { num: 4, den: 4, noteValue: 'quarter',  bars: 1, poly: { x: 2,  y: 16 } }, claim: 1 },
];
for (const c of L1) {
  const tl = build(E, [section(c.sec)]);
  const got = tl.events.filter(e => e.k === 'poly').length;
  const P = M.ppbEffective(c.sec.num, c.sec.den, c.sec.noteValue);
  const ideal = M.polyIdeal(P, c.sec.poly.x, c.sec.poly.y);
  say(`  ${c.label.padEnd(30)} ppb=${P} ideal=${ideal.toFixed(4)} -> engine ${got} notes (claim ${c.claim}) ${got === c.claim ? 'REPRODUCED' : 'NOT REPRODUCED'}`);
}
say('');

// --- lead 2 -----------------------------------------------------------------
say('== lead 2: preset ratios that do not close on the bar line ==');
let nonInt = 0, total = 0;
for (const [num, den] of M.SIGS) for (const [x, y] of M.POLY_PRESETS) {
  // Each signature counted in its own denominator note: 2/2 in halves, x/8 in eighths.
  const Pn = M.ppbEffective(num, den, M.DEN_NV[den]);
  const ideal = M.polyIdeal(Pn, x, y);
  total++;
  if (M.nearestIntError(ideal) > 1e-9) nonInt++;
}
say(`  ${nonInt} of ${total} preset combinations have a non-integer ideal note count (claim 56 of 84)`);

const five4 = build(E, [section({ num: 5, den: 4, noteValue: 'quarter', bpm: 120, bars: 2, poly: { x: 4, y: 3 } })]);
const bar0 = five4.events.filter(e => e.k === 'poly' && e.bar === 0).map(e => e.t);
const barDur = M.barSeconds(5, 4, 'quarter', 120);
say(`  5/4 @120 quarter, poly 4:3 -> ideal ${M.polyIdeal(5, 4, 3).toFixed(4)}, engine emitted ${bar0.length} notes`);
say(`    times: ${bar0.map(t => +t.toFixed(6)).join(', ')}   (bar ends at ${barDur})`);
const gapIn = bar0[1] - bar0[0];
const gapCross = barDur - bar0[bar0.length - 1];
say(`    gap inside bar ${gapIn}, gap across bar line ${+gapCross.toFixed(9)}`);
say('');

// --- lead 3 -----------------------------------------------------------------
say('== lead 3: swing amount has no clamp inside subOffsets ==');
for (const a of [NaN, undefined, 120, -10, 0, 100]) {
  const offs = E.subOffsets(2, '8th', a);
  const durs = E.slotDurs(offs);
  say(`  amount ${String(a).padEnd(9)} offsets [${offs.join(', ')}]  slots [${durs.join(', ')}]`);
}
const nanTl = build(E, [section({ subdiv: 2 })], { mode: '8th', amount: NaN });
const nanCount = nanTl.events.filter(e => Number.isNaN(e.t)).length;
say(`  buildTimeline with amount NaN -> ${nanCount} of ${nanTl.events.length} events have NaN time`);
say('');

// --- lead 4 -----------------------------------------------------------------
say('== lead 4: does a ramp restart on every repeat ==');
const ramp = build(E, [section({ num: 4, den: 4, bars: 2, bpm: 60, bpmEnd: 120, repeat: 3 })]);
const mains = ramp.events.filter(e => e.k === 'main');
for (let r = 0; r < 3; r++) {
  const slice = mains.slice(r * 8, r * 8 + 8).map(e => +e.bpm.toFixed(1));
  say(`  repeat ${r}: ${slice.join(', ')}`);
}
say('');

// --- lead 5 -----------------------------------------------------------------
say('== lead 5: fractional bar counts ==');
for (const bars of [0.5, 1.7, -1, 2.0000001]) {
  const tl = build(E, [section({ num: 4, den: 4, bars })]);
  say(`  bars=${String(bars).padEnd(10)} -> ${tl.events.length} events, ${tl.bars} bar(s), duration ${tl.duration}`);
}
say('');

export default out;
