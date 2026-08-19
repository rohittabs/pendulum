// Area 1: Polyrhythm.
//
// First principles used throughout, derived before reading the engine:
//   An "x:y" polyrhythm places x evenly spaced notes in the span of y main
//   pulses. So one poly note every (y/x) pulses. In a bar of P pulses whose
//   poly grid restarts on the downbeat, the onsets are at p*(y/x) pulses for
//   every p with p*(y/x) < P. That is exactly ceil(P*x/y) onsets, the first of
//   them on the downbeat itself. Accents mark the start of each x-note cycle,
//   i.e. every p divisible by x.

import { loadEngine, section, build } from './extract.mjs';
import * as M from './lib/music.mjs';
import { Suite, fmt } from './lib/harness.mjs';

const E = loadEngine();
const S = new Suite('Polyrhythm');
export const tables = {};
const EPS = 1e-9;

// The onset count that minimises the bar-line discontinuity. With onsets every
// `step` seconds and `ideal` of them fitting in the bar, choosing n onsets puts
// the last at (n-1)*step and leaves a bar-line gap of (ideal-n+1) steps. We want
// that gap as close to 1 step as possible, so we pick n from {floor, ceil}
// minimising |ideal-n|. Ties (frac exactly 0.5) go to the larger count, which
// keeps the extra onset rather than leaving a hole.
function pickCount(ideal) {
  const lo = Math.floor(ideal + EPS), hi = Math.ceil(ideal - EPS);
  if (lo === hi) return lo;
  return (ideal - lo) >= (hi - ideal) ? hi : lo;
}

const polyOf = (tl, bar) => tl.events.filter(e => e.k === 'poly' && (bar === undefined || e.bar === bar));
const mainOf = (tl, bar) => tl.events.filter(e => e.k === 'main' && (bar === undefined || e.bar === bar));

// ---------------------------------------------------------------------------
// 1.1  Note count grid: every ratio 2:2..16:16 x 12 signatures x 13 note values
// ---------------------------------------------------------------------------
const silent = [];      // fewer than 1 note  -> polyrhythm switched on, nothing plays
const single = [];      // exactly 1 note     -> a click, not a rhythm
const miscount = [];    // count != ceil(ideal)
const countGrid = new Map();

for (const [num, den] of M.SIGS) {
  for (const nv of M.NV_KEYS) {
    const P = M.ppbEffective(num, den, nv);
    for (let x = 2; x <= 16; x++) {
      for (let y = 1; y <= 16; y++) {
        const ideal = M.polyIdeal(P, x, y);
        // How many onsets SHOULD a bar carry? The grid restarts each downbeat,
        // so the choice is floor(ideal) or ceil(ideal). Take whichever leaves a
        // bar-line gap closest to the in-bar step, since that is the choice a
        // listener notices least. (Proved elsewhere to equal round(ideal).)
        const want = pickCount(ideal);
        const tl = build(E, [section({ num, den, noteValue: nv, bars: 1, bpm: 120, poly: { x, y } })]);
        const got = polyOf(tl).length;
        const key = `${num}/${den}|${nv}|${x}:${y}`;
        countGrid.set(key, { P, x, y, ideal, want, got });

        const rec = { sig: `${num}/${den}`, nv, P, ratio: `${x}:${y}`, ideal, want, got };
        // A polyrhythm the user switched on must be audible as a rhythm.
        if (!S.ok(got >= 2, `audible poly ${key}`,
            `ppb=${P} ideal=${fmt(ideal)} -> engine emitted ${got} note(s); a rhythm needs at least 2`)) {
          (got === 0 ? silent : single).push(rec);
        }
        if (got !== want) miscount.push(rec);
      }
    }
  }
}
// Separate assertion so miscounts are reported even where count >= 2.
for (const r of miscount) {
  S.ok(false, `note count ${r.sig} ${r.nv} ${r.ratio}`,
    `ppb=${r.P}, ideal=${fmt(r.ideal)}; the least-audible onset count is ${r.want}, engine emitted ${r.got}`);
}

// Where the ratio divides the bar exactly there is no judgement call at all:
// the count must be the ideal and the bar line must close perfectly.
for (const [key, v] of countGrid) {
  if (Math.abs(v.ideal - Math.round(v.ideal)) >= EPS) continue;
  S.eq(v.got, Math.round(v.ideal), `exact-fit note count ${key}`,
    `ppb=${v.P} x ${v.x}/${v.y} = ${fmt(v.ideal)} onsets, a whole number, so nothing may be dropped or added`);
}
tables.silent = silent;
tables.single = single;
tables.miscount = miscount;
tables.countGrid = countGrid;

// ---------------------------------------------------------------------------
// 1.2  Downbeat alignment: first poly note of every bar == that bar's downbeat
// ---------------------------------------------------------------------------
for (const bpm of [10, 40, 120, 233.7, 400]) {
  for (const nv of M.NV_KEYS) {
    for (const [x, y] of M.POLY_PRESETS) {
      const sec = section({ num: 4, den: 4, noteValue: nv, bpm, bars: 4, poly: { x, y } });
      const tl = build(E, [sec]);
      for (let b = 0; b < 4; b++) {
        const p = polyOf(tl, b), m = mainOf(tl, b);
        if (!p.length) continue;
        S.ok(Math.abs(p[0].t - m[0].t) < 1e-12, `downbeat align 4/4 ${nv} ${x}:${y} @${bpm} bar${b}`,
          `downbeat at ${fmt(m[0].t)}, first poly at ${fmt(p[0].t)}`);
        S.eq(p[0].a, 2, `downbeat accented 4/4 ${nv} ${x}:${y} @${bpm} bar${b}`);
      }
    }
  }
}
// with a ramp
for (const [x, y] of M.POLY_PRESETS) {
  const tl = build(E, [section({ num: 7, den: 8, noteValue: '8th', bpm: 60, bpmEnd: 180, bars: 6, poly: { x, y } })]);
  for (let b = 0; b < 6; b++) {
    const p = polyOf(tl, b), m = mainOf(tl, b);
    if (!p.length) continue;
    S.ok(Math.abs(p[0].t - m[0].t) < 1e-12, `ramped downbeat align 7/8 ${x}:${y} bar${b}`,
      `downbeat ${fmt(m[0].t)} vs poly ${fmt(p[0].t)}`);
  }
}

// ---------------------------------------------------------------------------
// 1.3  Bar-line closure, ranked
// ---------------------------------------------------------------------------
const closure = [];
for (const [num, den] of M.SIGS) {
  const nv = M.DEN_NV[den];
  const P = M.ppbEffective(num, den, nv);
  for (const [x, y] of M.POLY_PRESETS) {
    const ideal = M.polyIdeal(P, x, y);
    const bpm = 120, barDur = M.barSeconds(num, den, nv, bpm);
    const step = barDur / ideal;                      // one poly note every y/x pulses
    const tl = build(E, [section({ num, den, noteValue: nv, bpm, bars: 2, poly: { x, y } })]);
    const p = polyOf(tl, 0).map(e => e.t);
    const gapCross = barDur - p[p.length - 1];
    closure.push({
      sig: `${num}/${den}`, nv, P, ratio: `${x}:${y}`, ideal,
      fracErr: Math.abs(ideal - Math.round(ideal)),
      n: p.length, step, gapCross, gapRatio: gapCross / step,
    });
    // Even spacing inside the bar is a hard requirement.
    for (let i = 2; i < p.length; i++)
      S.near(p[i] - p[i - 1], step, 1e-12, `even spacing ${num}/${den} ${x}:${y} idx${i}`,
        `every gap must be barDur/ideal = ${fmt(step)}`);
  }
}
closure.sort((a, b) => Math.abs(b.gapRatio - 1) - Math.abs(a.gapRatio - 1));
tables.closure = closure;

// The bar-line gap should equal the in-bar gap. Where it does not, the poly
// stutters once per bar. Assert it, and let the failures rank themselves.
for (const c of closure)
  S.near(c.gapRatio, 1, 1e-9, `bar-line closure ${c.sig} ${c.ratio}`,
    `ideal ${fmt(c.ideal)} notes per bar; in-bar gap ${fmt(c.step)}s, bar-line gap ${fmt(c.gapCross)}s (${fmt(c.gapRatio)}x)`);

// ---------------------------------------------------------------------------
// 1.4  Accent placement and truncated cycles
// ---------------------------------------------------------------------------
const doubleAccents = [];
for (const [num, den] of M.SIGS) {
  const nv = M.DEN_NV[den], P = M.ppbEffective(num, den, nv);
  for (const [x, y] of M.POLY_PRESETS) {
    const tl = build(E, [section({ num, den, noteValue: nv, bpm: 120, bars: 3, poly: { x, y } })]);
    const p = polyOf(tl);
    if (p.length < 2) continue;
    for (const e of p)
      S.eq(e.a === 2, e.pi === 0, `accent iff cycle start ${num}/${den} ${x}:${y} bar${e.bar} pi${e.pi}`);
    // Two accents in a row: a truncated last cycle whose final note is itself a
    // cycle start, immediately followed by the next bar's downbeat accent.
    for (let i = 1; i < p.length; i++) {
      if (p[i].a === 2 && p[i - 1].a === 2 && p[i].bar !== p[i - 1].bar) {
        const barDur = M.barSeconds(num, den, nv, 120);
        const step = barDur / M.polyIdeal(P, x, y);
        doubleAccents.push({ sig: `${num}/${den}`, ratio: `${x}:${y}`, gap: p[i].t - p[i - 1].t, step });
        break;
      }
    }
  }
}
tables.doubleAccents = doubleAccents;
for (const d of doubleAccents)
  S.ok(false, `no two accents in a row ${d.sig} ${d.ratio}`,
    `truncated final cycle leaves an accent ${fmt(d.gap)}s before the next downbeat accent (normal cycle is ${fmt(d.step * 0)}${fmt(d.step)}s apart)`);

// ---------------------------------------------------------------------------
// 1.5  Ramp interaction: spacing tracks each bar, nothing crosses the bar line
// ---------------------------------------------------------------------------
for (const [x, y] of [...M.POLY_PRESETS, [16, 3], [2, 15]]) {
  const bars = 8;
  const tl = build(E, [section({ num: 5, den: 4, noteValue: 'quarter', bpm: 50, bpmEnd: 200, bars, poly: { x, y } })]);
  const m = mainOf(tl);
  for (let b = 0; b < bars; b++) {
    const p = polyOf(tl, b);
    if (p.length < 2) continue;
    const barStart = m.filter(e => e.bar === b)[0].t;
    const nextStart = b + 1 < bars ? m.filter(e => e.bar === b + 1)[0].t : tl.duration;
    const barDur = nextStart - barStart;
    const step = barDur / M.polyIdeal(5, x, y);
    S.near(p[1].t - p[0].t, step, 1e-12, `ramp poly spacing tracks bar ${x}:${y} bar${b}`,
      `bar duration ${fmt(barDur)}s / ideal ${fmt(M.polyIdeal(5, x, y))} = ${fmt(step)}s`);
    S.ok(p[p.length - 1].t < nextStart - 1e-12, `ramp poly stays inside bar ${x}:${y} bar${b}`,
      `last poly at ${fmt(p[p.length - 1].t)}, next bar starts ${fmt(nextStart)}`);
  }
}

// ---------------------------------------------------------------------------
// 1.6  Mute agreement
// ---------------------------------------------------------------------------
{
  const tl = build(E, [section({ num: 4, den: 4, bars: 8, poly: { x: 3, y: 2 }, pattern: { on: 1, off: 1 } })]);
  for (let b = 0; b < 8; b++) {
    const mm = mainOf(tl, b), pp = polyOf(tl, b);
    const barMuted = mm.every(e => e.muted);
    for (const e of pp)
      S.eq(!!e.muted, barMuted, `poly mute agrees with bar ${b} (pattern 1 on / 1 off)`);
  }
}
{
  const tl = build(E, [section({ num: 4, den: 4, bars: 24, poly: { x: 5, y: 4 }, randomPct: 50, seed: 7 })]);
  let checked = 0;
  for (let b = 0; b < 24; b++) {
    const mm = mainOf(tl, b), pp = polyOf(tl, b);
    const barMuted = mm.every(e => e.muted);
    for (const e of pp) { S.eq(!!e.muted, barMuted, `poly mute agrees on random-silent bar ${b}`); checked++; }
  }
  S.ok(checked > 0, 'random silent bars produced poly events to check');
}
{
  // A single beat muted via state 2 must not silence the independent poly line.
  const tl = build(E, [section({ num: 4, den: 4, bars: 1, states: [1, 2, 2, 2], poly: { x: 3, y: 2 } })]);
  const pp = polyOf(tl, 0);
  S.ok(pp.length > 0 && pp.every(e => !e.muted), 'per-beat mute does not silence poly',
    `poly muted flags: ${pp.map(e => e.muted).join(',')}`);
}

// ---------------------------------------------------------------------------
// 1.7  Note value interaction: same ratio, different pulse grid
// ---------------------------------------------------------------------------
{
  // 6/8 is 3 quarter notes long. At dotted quarter that is 2 pulses; at eighth, 6.
  const cases = [
    { nv: 'dquarter', expectP: 2 },
    { nv: '8th', expectP: 6 },
    { nv: 'quarter', expectP: 3 },
    { nv: '16th', expectP: 12 },
  ];
  for (const c of cases) {
    S.eq(M.ppbEffective(6, 8, c.nv), c.expectP, `6/8 ${c.nv} pulses per bar`,
      `6/8 spans 6*(4/8) = 3 quarter notes`);
    const P = c.expectP;
    const tl = build(E, [section({ num: 6, den: 8, noteValue: c.nv, bars: 1, bpm: 120, poly: { x: 4, y: 3 } })]);
    const got = polyOf(tl).length;
    const ideal = M.polyIdeal(P, 4, 3);
    const want = pickCount(ideal);
    S.eq(got, want, `6/8 ${c.nv} poly 4:3 note count`,
      `ppb=${P}, ideal=${fmt(ideal)} -> ${want} onsets fit inside the bar`);
  }
}

// ---------------------------------------------------------------------------
// 1.8  Song mode: poly per section and the seam between sections
// ---------------------------------------------------------------------------
{
  const secs = [
    section({ id: 'a', num: 4, den: 4, bars: 2, bpm: 120, poly: { x: 3, y: 2 } }),
    section({ id: 'b', num: 3, den: 4, bars: 2, bpm: 120 }),                        // no poly
    section({ id: 'c', num: 7, den: 8, noteValue: '8th', bars: 2, bpm: 140, poly: { x: 5, y: 4 } }),
  ];
  const tl = build(E, secs);
  S.eq(polyOf(tl).filter(e => e.sec === 'b').length, 0, 'section without poly emits no poly events');
  for (const [id, num, den, nv, x, y] of [['a', 4, 4, 'quarter', 3, 2], ['c', 7, 8, '8th', 5, 4]]) {
    const p = polyOf(tl).filter(e => e.sec === id);
    const P = M.ppbEffective(num, den, nv);
    const ideal = M.polyIdeal(P, x, y);
    const want = pickCount(ideal) * 2;
    S.eq(p.length, want, `song section ${id} poly note count over 2 bars`, `ideal ${fmt(ideal)}/bar`);
    for (const e of p) S.eq(e.sec, id, `poly carries its own section id (${id})`);
  }
  // Seam: every poly note must lie inside its own section's span. A section
  // ENDS where the next one begins, which is one pulse past its last onset, so
  // the bound is the next section's first onset, not this section's last.
  const starts = {};
  for (const e of tl.events.filter(e => e.k === 'main')) starts[e.sec] ??= e.t;
  const order = secs.map(s => s.id);
  const span = {};
  order.forEach((id, i) => { span[id] = { lo: starts[id], hi: i + 1 < order.length ? starts[order[i + 1]] : tl.duration }; });
  for (const e of polyOf(tl))
    S.ok(e.t >= span[e.sec].lo - 1e-12 && e.t < span[e.sec].hi - 1e-12,
      `poly of section ${e.sec} stays within its section`, `t=${fmt(e.t)} span ${fmt(span[e.sec].lo)}..${fmt(span[e.sec].hi)}`);
}

export default S;
