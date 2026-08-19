// Area 2: Swing.
//
// First principles:
//   Swing displaces the OFF-beat inside a pulse and leaves the pulse itself
//   alone. An "amount" a% puts the offbeat a% of the way through its pair, so
//   the pair splits into slots of a% and (100-a)%. A long:short ratio of R
//   therefore needs a = 100*R/(R+1): 2:1 is 66.666...%, 3:1 is exactly 75%.
//   Straight playing is 50%. Slots must sum to one pulse and none may vanish.

import { loadEngine, section, build } from './extract.mjs';
import * as M from './lib/music.mjs';
import { Suite, fmt } from './lib/harness.mjs';

const E = loadEngine();
const S = new Suite('Swing');
export const notes = [];
const MODES = ['off', '8th', '16th'];
const SUBDIV_FOR = { '8th': 2, '16th': 4 };
const ratioFor = R => 100 * R / (R + 1);   // amount that yields long:short = R:1

// ---------------------------------------------------------------------------
// 2.1  Core invariant: swing never moves the main pulses
// ---------------------------------------------------------------------------
for (const mode of MODES) {
  for (let amt = 50; amt <= 75; amt += 1) {
    for (const sd of [1, 2, 4]) {
      const bpm = 132, num = 4, den = 4;
      const tl = build(E, [section({ num, den, bpm, bars: 4, subdiv: sd })], { mode, amount: amt });
      const pulse = 60 / bpm;
      const mains = tl.events.filter(e => e.k === 'main');
      S.eq(mains.length, 16, `pulse count unchanged ${mode}/${amt}/sd${sd}`);
      for (let i = 0; i < mains.length; i++)
        S.near(mains[i].t, i * pulse, 1e-12, `pulse ${i} unmoved ${mode}/${amt}/sd${sd}`,
          `pulse ${i} must sit at ${i} x ${fmt(pulse)}s regardless of swing`);
      S.near(tl.duration, 16 * pulse, 1e-12, `bar length unchanged ${mode}/${amt}/sd${sd}`,
        `4 bars of 4 pulses at ${bpm} BPM = ${fmt(16 * pulse)}s`);
    }
  }
}

// ---------------------------------------------------------------------------
// 2.2  Amount 50 is identical to swing off
// ---------------------------------------------------------------------------
for (const [mode, sd] of Object.entries(SUBDIV_FOR)) {
  const a = E.subOffsets(sd, mode, 50), b = E.subOffsets(sd, 'off', 50);
  S.eq(JSON.stringify(a), JSON.stringify(b), `amount 50 identical to off (${mode}, subdiv ${sd})`,
    `swung ${JSON.stringify(a)} vs straight ${JSON.stringify(b)}`);
  const t1 = build(E, [section({ bars: 2, subdiv: sd })], { mode, amount: 50 });
  const t2 = build(E, [section({ bars: 2, subdiv: sd })], { mode: 'off', amount: 50 });
  S.eq(JSON.stringify(t1.events.map(e => e.t)), JSON.stringify(t2.events.map(e => e.t)),
    `timeline at amount 50 identical to off (${mode})`);
}

// ---------------------------------------------------------------------------
// 2.3  Exact swing ratios, computed from slot durations without rounding
// ---------------------------------------------------------------------------
for (const [label, R] of [['2:1', 2], ['3:1', 3], ['1:1', 1]]) {
  const amt = ratioFor(R);
  for (const [mode, sd] of Object.entries(SUBDIV_FOR)) {
    const durs = E.slotDurs(E.subOffsets(sd, mode, amt));
    for (let i = 0; i + 1 < durs.length; i += 2)
      S.near(durs[i] / durs[i + 1], R, 1e-12, `${label} at amount ${fmt(amt)} (${mode}) pair ${i / 2}`,
        `long ${fmt(durs[i])} / short ${fmt(durs[i + 1])} must equal ${R}`);
  }
}
// The brief asserts 67 gives exactly 2:1. Test that literally against subOffsets.
for (const [mode, sd] of Object.entries(SUBDIV_FOR)) {
  const durs = E.slotDurs(E.subOffsets(sd, mode, 67));
  S.near(durs[0] / durs[1], 2, 1e-12, `amount 67 gives exactly 2:1 (${mode})`,
    `67/33 = ${fmt(durs[0] / durs[1])}; exact 2:1 needs amount 100*2/3 = ${fmt(200 / 3)}`);
}

// ---------------------------------------------------------------------------
// 2.4  Slots sum to exactly one pulse and none is degenerate
// ---------------------------------------------------------------------------
for (const mode of MODES) {
  for (let amt = 50; amt <= 75; amt += 0.5) {
    for (const sd of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const durs = E.slotDurs(E.subOffsets(sd, mode, amt));
      const sum = durs.reduce((a, b) => a + b, 0);
      S.near(sum, 1, 1e-12, `slots sum to one pulse ${mode}/${amt}/sd${sd}`, `got ${fmt(sum)}`);
      for (let i = 0; i < durs.length; i++)
        S.ok(durs[i] > 0, `slot ${i} strictly positive ${mode}/${amt}/sd${sd}`, `got ${fmt(durs[i])}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 2.5  Mismatched subdivision falls back to straight
// ---------------------------------------------------------------------------
for (const [mode, own] of Object.entries(SUBDIV_FOR)) {
  for (const sd of [1, 2, 3, 4, 5, 6, 7, 8]) {
    if (sd === own) continue;
    const got = E.subOffsets(sd, mode, 75);
    const straight = Array.from({ length: sd }, (_, i) => i / sd);
    S.eq(JSON.stringify(got), JSON.stringify(straight), `${mode} swing on subdiv ${sd} plays straight`,
      `expected even ${JSON.stringify(straight)}, got ${JSON.stringify(got)}`);
  }
}

// ---------------------------------------------------------------------------
// 2.6  Out-of-range amounts (lead 3)
// ---------------------------------------------------------------------------
for (const amt of [NaN, undefined, null, 120, 400, -10, 0, 100, 'x']) {
  const offs = E.subOffsets(2, '8th', amt);
  const durs = E.slotDurs(offs);
  const finite = offs.every(Number.isFinite);
  const inRange = offs.every(o => o >= 0 && o < 1);
  const positive = durs.every(d => d > 0);
  S.ok(finite, `amount ${fmt(amt)} yields finite offsets`, `offsets ${JSON.stringify(offs)}`);
  S.ok(inRange, `amount ${fmt(amt)} keeps the offbeat inside its own pulse`, `offsets ${JSON.stringify(offs)}`);
  S.ok(positive, `amount ${fmt(amt)} yields positive slots`, `slots ${JSON.stringify(durs)}`);
  const tl = build(E, [section({ bars: 1, subdiv: 2 })], { mode: '8th', amount: amt });
  const ts = tl.events.map(e => e.t);
  S.ok(ts.every(Number.isFinite), `amount ${fmt(amt)} yields a finite timeline`,
    `${ts.filter(t => !Number.isFinite(t)).length} of ${ts.length} events have non-finite time`);
  S.ok(ts.every((t, i) => i === 0 || t >= ts[i - 1]), `amount ${fmt(amt)} yields a monotonic timeline`,
    `times ${JSON.stringify(ts.map(t => +Number(t).toFixed(4)))}`);
  S.eq(new Set(ts).size, ts.length, `amount ${fmt(amt)} yields no duplicate timestamps`,
    `times ${JSON.stringify(ts.map(t => +Number(t).toFixed(4)))}`);
}

// ---------------------------------------------------------------------------
// 2.7  Swing does not reach the polyrhythm
// ---------------------------------------------------------------------------
for (const [x, y] of M.POLY_PRESETS) {
  const mk = sw => build(E, [section({ num: 4, den: 4, bars: 4, subdiv: 2, bpm: 96, poly: { x, y } })], sw)
    .events.filter(e => e.k === 'poly').map(e => e.t);
  const off = mk({ mode: 'off', amount: 50 });
  for (const amt of [50, 60, 200 / 3, 75]) {
    const on = mk({ mode: '8th', amount: amt });
    S.eq(JSON.stringify(on), JSON.stringify(off), `poly unchanged by swing ${x}:${y} @${fmt(amt)}`,
      `poly is an independent layer and must not inherit the swing grid`);
  }
}

// ---------------------------------------------------------------------------
// 2.8  Swing with a ramp: each offbeat is proportional to ITS OWN pulse
// ---------------------------------------------------------------------------
{
  const bpm = 60, bpmEnd = 180, bars = 4, num = 4, den = 4, sd = 2, amt = 75;
  const tl = build(E, [section({ num, den, bpm, bpmEnd, bars, subdiv: sd })], { mode: '8th', amount: amt });
  const mains = tl.events.filter(e => e.k === 'main');
  const subs = tl.events.filter(e => e.k === 'sub');
  S.eq(subs.length, mains.length, 'one offbeat per pulse under a ramp');
  for (let i = 0; i < mains.length; i++) {
    // This pulse's own duration is the distance to the next pulse.
    const next = i + 1 < mains.length ? mains[i + 1].t : tl.duration;
    const own = next - mains[i].t;
    S.near(subs[i].t - mains[i].t, own * amt / 100, 1e-12,
      `ramped offbeat ${i} scales with its own pulse`,
      `pulse ${i} lasts ${fmt(own)}s, so a ${amt}% offbeat sits ${fmt(own * amt / 100)}s in`);
  }
}

// ---------------------------------------------------------------------------
// 2.9  Song mode: swing is global, subdivision is per section
// ---------------------------------------------------------------------------
{
  const secs = [
    section({ id: 'sw', num: 4, den: 4, bars: 2, bpm: 120, subdiv: 2 }),   // matches 8th swing
    section({ id: 'st', num: 4, den: 4, bars: 2, bpm: 120, subdiv: 3 }),   // does not match
    section({ id: 'sw2', num: 3, den: 4, bars: 2, bpm: 120, subdiv: 2 }),
  ];
  const tl = build(E, secs, { mode: '8th', amount: 75 });
  const pulse = 0.5;
  for (const e of tl.events.filter(e => e.k === 'sub' && e.sec === 'sw'))
    S.near((e.t % pulse) / pulse, 0.75, 1e-12, 'swung section offbeat sits at 75%');
  const straightFracs = tl.events.filter(e => e.k === 'sub' && e.sec === 'st')
    .map(e => +(((e.t % pulse) / pulse)).toFixed(9));
  for (const f of straightFracs)
    S.ok(Math.abs(f - 1 / 3) < 1e-9 || Math.abs(f - 2 / 3) < 1e-9,
      'non-matching subdivision plays straight while neighbours swing', `offbeat at ${fmt(f)} of a pulse`);
  const ts = tl.events.map(e => e.t);
  S.ok(ts.every((t, i) => i === 0 || t >= ts[i - 1]), 'song with mixed subdivisions never runs backwards');
  S.eq(new Set(ts.map(t => t.toFixed(9))).size, ts.length, 'song with mixed subdivisions has no duplicate timestamps',
    `${ts.length} events, ${new Set(ts.map(t => t.toFixed(9))).size} distinct times`);
  const mains = tl.events.filter(e => e.k === 'main');
  S.eq(mains.length, 4 * 2 + 4 * 2 + 3 * 2, 'no beat dropped at the swung/straight seam',
    '2 bars of 4/4 + 2 bars of 4/4 + 2 bars of 3/4 = 8 + 8 + 6 = 22 pulses');
}

// ---------------------------------------------------------------------------
// 2.10  Extremes: the shortest audible gap
// ---------------------------------------------------------------------------
for (const [bpm, mode, sd, amt] of [[300, '16th', 4, 75], [400, '16th', 4, 75], [300, '8th', 2, 75], [400, '8th', 2, 75]]) {
  const shortest = Math.min(...E.slotDurs(E.subOffsets(sd, mode, amt))) * (60 / bpm) * 1000;
  S.ok(shortest > 10, `shortest slot above 10 ms at ${bpm} BPM ${mode} ${amt}%`,
    `pulse ${fmt(60000 / bpm)} ms, shortest slot ${fmt(shortest)} ms`);
  notes.push({ bpm, mode, amt, shortestMs: shortest });
}

export default S;
