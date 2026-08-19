// Area 3: Song mode.
//
// First principles:
//   A section of B bars in num/den counted in note value nv holds B*ppb pulses,
//   each lasting 60/bpm seconds (or the ramped bpm at that pulse). Sections
//   abut: the next one starts exactly where the previous one ends. Bars are
//   numbered continuously from 0 across the whole song, each bar carries exactly
//   one downbeat, and time never repeats or runs backwards.

import { loadEngine, section, build } from './extract.mjs';
import * as M from './lib/music.mjs';
import { Suite, fmt } from './lib/harness.mjs';

const E = loadEngine();
const S = new Suite('Song mode');
export const notes = [];

const mains = tl => tl.events.filter(e => e.k === 'main');

// Analytic duration of one section, summed pulse by pulse, written independently.
function secSeconds(x) {
  const nv = x.noteValue || M.DEN_NV[x.den] || 'quarter';
  const ppb = M.ppbEffective(x.num, x.den, nv);
  const barsPlayed = Math.max(0, Math.ceil(x.bars));   // the engine plays whole bars only
  const tb = x.bars * ppb;                              // ramp is parameterised on the REQUESTED length
  let t = 0;
  for (let i = 0; i < barsPlayed * ppb; i++) {
    const f = tb > 1 ? i / (tb - 1) : 0;
    const bpm = x.bpmEnd != null ? x.bpm + (x.bpmEnd - x.bpm) * f : x.bpm;
    t += 60 / bpm;
  }
  return t * (x.repeat || 1);
}

function structuralChecks(tl, label, expectBars) {
  const ts = tl.events.map(e => e.t);
  S.ok(ts.every((t, i) => i === 0 || t >= ts[i - 1]), `${label}: time never runs backwards`);
  const seen = new Map();
  let dup = 0;
  for (const e of tl.events) {
    const k = e.t.toFixed(9) + '|' + e.k + '|' + (e.sj ?? '') + '|' + (e.pi ?? '');
    if (seen.has(k)) dup++; else seen.set(k, e);
  }
  S.eq(dup, 0, `${label}: no duplicate timestamps within a layer`, `${dup} collisions`);
  const byBar = new Map();
  for (const e of mains(tl)) { byBar.set(e.bar, (byBar.get(e.bar) || 0) + (e.beat === 1 ? 1 : 0)); }
  for (const [bar, n] of byBar) S.eq(n, 1, `${label}: exactly one downbeat in bar ${bar}`);
  const barsSeen = [...byBar.keys()].sort((a, b) => a - b);
  S.eq(barsSeen.length, expectBars, `${label}: bar count`, `expected ${expectBars} bars`);
  for (let i = 0; i < barsSeen.length; i++)
    S.eq(barsSeen[i], i, `${label}: bar counter continuous at index ${i}`, 'bars must run 0,1,2,... with no gap');
  S.eq(tl.bars, expectBars, `${label}: reported bar total`);
}

// ---------------------------------------------------------------------------
// 3.1  Seams: every join changes something
// ---------------------------------------------------------------------------
{
  const secs = [
    section({ id: 'a', num: 4, den: 4, noteValue: 'quarter', bpm: 120, bars: 2, subdiv: 1, states: [1, 0, 0, 0] }),
    section({ id: 'b', num: 7, den: 8, noteValue: '8th', bpm: 96, bars: 2, subdiv: 2, states: M.STATES_78 || [1, 0, 0, 1, 0, 1, 0] }),
    section({ id: 'c', num: 3, den: 4, noteValue: '8th', bpm: 160, bars: 3, subdiv: 3, states: [1, 0, 1, 0, 1, 0] }),
    section({ id: 'd', num: 6, den: 8, noteValue: 'dquarter', bpm: 60, bars: 2, subdiv: 4, states: [1, 1] }),
    section({ id: 'e', num: 5, den: 4, noteValue: 'quarter', bpm: 200, bars: 1, subdiv: 1, states: [1, 0, 1, 0, 0] }),
  ];
  const tl = build(E, secs, { mode: '8th', amount: 200 / 3 });
  structuralChecks(tl, 'seam song', 10);
  // Sections must abut exactly.
  let acc = 0;
  for (const x of secs) {
    const first = mains(tl).find(e => e.sec === x.id);
    S.near(first.t, acc, 1e-9, `section ${x.id} starts where the previous ended`,
      `running total ${fmt(acc)}s`);
    acc += secSeconds(x);
  }
  S.near(tl.duration, acc, 1e-9, 'seam song total duration', `analytic sum ${fmt(acc)}s`);
  // Accent pattern survives the seam.
  for (const x of secs) {
    const bar0 = mains(tl).filter(e => e.sec === x.id && e.secBar === 0);
    const gotAcc = bar0.map(e => (e.a === 2 ? 2 : e.a === 1 ? 1 : 0));
    const wantAcc = x.states.map((st, i) => st === 1 ? (i === 0 ? 2 : 1) : 0);
    S.eq(JSON.stringify(gotAcc), JSON.stringify(wantAcc), `section ${x.id} accent pattern preserved`);
  }
}

// ---------------------------------------------------------------------------
// 3.2  Duration of a 20-section song where every section differs
// ---------------------------------------------------------------------------
{
  const nvs = M.NV_KEYS;
  const secs = [];
  for (let i = 0; i < 20; i++) {
    const [num, den] = M.SIGS[i % M.SIGS.length];
    secs.push(section({
      id: 's' + i, num, den, noteValue: nvs[i % nvs.length],
      bpm: 40 + i * 13, bpmEnd: i % 3 === 0 ? 40 + i * 13 + 25 : null,
      bars: 1 + (i % 4), subdiv: 1 + (i % 4), repeat: 1 + (i % 3),
    }));
  }
  const tl = build(E, secs, { mode: '16th', amount: 70 });
  const analytic = secs.reduce((a, x) => a + secSeconds(x), 0);
  S.near(tl.duration, analytic, 1e-9, '20-section song duration matches analytic sum',
    `analytic ${fmt(analytic)}s vs engine ${fmt(tl.duration)}s`);
  const expectBars = secs.reduce((a, x) => a + Math.ceil(x.bars) * (x.repeat || 1), 0);
  structuralChecks(tl, '20-section song', expectBars);
}

// ---------------------------------------------------------------------------
// 3.3  Repeats and whole-song loop, nested
// ---------------------------------------------------------------------------
{
  const secs = [
    section({ id: 'r1', num: 4, den: 4, bpm: 120, bars: 2, repeat: 3 }),
    section({ id: 'r2', num: 3, den: 4, bpm: 90, bars: 1, repeat: 2 }),
  ];
  const loop = 2;
  const tl = build(E, secs, null, loop);
  const perPass = secs.reduce((a, x) => a + Math.ceil(x.bars) * x.repeat, 0);   // 6 + 2 = 8
  structuralChecks(tl, 'repeat+loop song', perPass * loop);
  const analytic = secs.reduce((a, x) => a + secSeconds(x), 0) * loop;
  S.near(tl.duration, analytic, 1e-9, 'repeat+loop duration', `analytic ${fmt(analytic)}s`);
  // Timeline must be continuous at both the repeat boundary and the loop boundary.
  const m = mains(tl);
  const gaps = [];
  for (let i = 1; i < m.length; i++) gaps.push(m[i].t - m[i - 1].t);
  S.ok(gaps.every(g => g > 0), 'every pulse advances at both repeat and loop boundaries',
    `smallest gap ${fmt(Math.min(...gaps))}`);
}

// ---------------------------------------------------------------------------
// 3.4  Lead 4: does a ramp restart on every repeat
// ---------------------------------------------------------------------------
{
  const tl = build(E, [section({ num: 4, den: 4, bars: 2, bpm: 60, bpmEnd: 120, repeat: 3 })]);
  const m = mains(tl);
  const p0 = m.slice(0, 8).map(e => e.bpm), p1 = m.slice(8, 16).map(e => e.bpm), p2 = m.slice(16, 24).map(e => e.bpm);
  const restarts = JSON.stringify(p0) === JSON.stringify(p1) && JSON.stringify(p1) === JSON.stringify(p2);
  notes.push({ rampRestartsPerRepeat: restarts, pass0: p0.map(b => +b.toFixed(2)) });
  // A repeat replays the section, so restarting is the defensible reading. What must
  // NOT happen is a discontinuity: the tempo jumps 120 -> 60 at each repeat boundary.
  S.ok(restarts, 'ramp restarts identically on each repeat (documented behaviour)');
  const jump = Math.abs(m[7].bpm - m[8].bpm);
  notes.push({ tempoJumpAtRepeatBoundary: jump });
  S.eq(jump, 0, 'no tempo discontinuity at the repeat boundary',
    `pulse 7 ends at ${fmt(m[7].bpm)} BPM and pulse 8 restarts at ${fmt(m[8].bpm)} BPM, a ${fmt(jump)} BPM jump`);
}

// ---------------------------------------------------------------------------
// 3.5  States: wrong length must fall back gracefully, never lose the downbeat
// ---------------------------------------------------------------------------
{
  const cases = [
    { states: [1, 0, 0], label: 'too short' },
    { states: [1, 0, 0, 0, 0, 0], label: 'too long' },
    { states: [], label: 'empty' },
    { states: null, label: 'null' },
    { states: [0, 0, 0, 0], label: 'no accent at all' },
    { states: [2, 2, 2, 2], label: 'every beat muted' },
  ];
  for (const c of cases) {
    const tl = build(E, [section({ num: 4, den: 4, bars: 1, states: c.states })]);
    const m = mains(tl);
    S.eq(m.length, 4, `states ${c.label}: still 4 pulses`);
    // A WRONG-LENGTH array must be replaced by a default that carries a downbeat.
    // A right-length array is the user's explicit choice and is honoured verbatim,
    // so "always has an accent" is asserted only on the resize path below.
    if (!c.states || c.states.length !== 4)
      S.ok(m.some(e => e.a === 2), `states ${c.label}: falls back to a pattern with a downbeat`,
        `accents ${JSON.stringify(m.map(e => e.a))}`);
    notes.push({ statesCase: c.label, accents: m.map(e => e.a), muted: m.map(e => !!e.muted) });
  }
  // resizeStates is the documented resizer; check it by index and pads with plain clicks.
  for (const [old, n, want] of [
    [[1, 0, 1], 5, [1, 0, 1, 0, 0]],
    [[1, 0, 1, 0, 0], 3, [1, 0, 1]],
    [[0, 0, 0], 3, [1, 0, 0]],
    [null, 4, [1, 0, 0, 0]],
    [[2, 2], 4, [1, 2, 0, 0]],   // no 1 present, so the resizer installs a downbeat
  ]) {
    const got = E.resizeStates(old, n);
    S.eq(JSON.stringify(got), JSON.stringify(want), `resizeStates(${JSON.stringify(old)}, ${n})`);
  }
}

// ---------------------------------------------------------------------------
// 3.6  Degenerate sections
// ---------------------------------------------------------------------------
{
  const deg = [
    { label: 'zero bars', sec: { bars: 0 }, wantEvents: 0, wantBars: 0 },
    { label: 'negative bars', sec: { bars: -1 }, wantEvents: 0, wantBars: 0 },
    { label: 'one pulse per bar', sec: { num: 1, den: 4, bars: 2 }, wantEvents: 2, wantBars: 2 },
    { label: '32 pulses per bar', sec: { num: 4, den: 4, noteValue: '32nd', bars: 1 }, wantEvents: 32, wantBars: 1 },
    { label: '64 pulses per bar', sec: { num: 8, den: 4, noteValue: '32nd', bars: 1 }, wantEvents: 64, wantBars: 1 },
  ];
  for (const d of deg) {
    const tl = build(E, [section(d.sec)]);
    S.eq(mains(tl).length, d.wantEvents, `degenerate ${d.label}: pulse count`);
    S.eq(tl.bars, d.wantBars, `degenerate ${d.label}: bar count`);
    S.ok(tl.events.every(e => Number.isFinite(e.t)), `degenerate ${d.label}: all times finite`);
  }
  // Fractional bars (lead 5): bars are discrete, so the engine rounds up.
  for (const bars of [0.5, 1.7, 2.0000001]) {
    const tl = build(E, [section({ num: 4, den: 4, bars })]);
    S.eq(tl.bars, Math.ceil(bars), `fractional bars ${bars}: rounds up to whole bars`,
      `engine played ${tl.bars} whole bars for a requested ${bars}`);
    // The song panel's duration readout sums bars*ppb pulses; the engine plays
    // ceil(bars)*ppb. Those must agree or the displayed length is a lie.
    const readoutPulses = Math.floor(bars * 4);
    S.eq(mains(tl).length, readoutPulses, `fractional bars ${bars}: played length matches the duration readout`,
      `readout sums ${readoutPulses} pulses, engine plays ${mains(tl).length}`);
  }
  // A ramp inside a section shorter than one bar: the ramp must still land on bpmEnd.
  for (const [bars, num] of [[1, 1], [0.5, 4], [1.7, 4]]) {
    const tl = build(E, [section({ num, den: 4, bars, bpm: 60, bpmEnd: 120 })]);
    const m = mains(tl);
    if (!m.length) continue;
    S.ok(m.every(e => e.bpm >= 60 - 1e-9 && e.bpm <= 120 + 1e-9),
      `ramp stays within 60..120 for bars=${bars}, num=${num}`,
      `tempos ${JSON.stringify(m.map(e => +e.bpm.toFixed(2)))}`);
  }
  // Every beat muted.
  {
    const tl = build(E, [section({ num: 4, den: 4, bars: 2, states: [2, 2, 2, 2] })]);
    S.ok(mains(tl).every(e => e.muted), 'section with every beat muted produces only muted pulses');
    S.eq(mains(tl).length, 8, 'muted section still keeps its length');
  }
}

// ---------------------------------------------------------------------------
// 3.7  Random silent bars are seeded by GLOBAL bar, not by section
// ---------------------------------------------------------------------------
{
  const secs = [
    section({ id: 'p', num: 4, den: 4, bars: 8, randomPct: 50, seed: 42 }),
    section({ id: 'q', num: 4, den: 4, bars: 8, randomPct: 50, seed: 42 }),
  ];
  const tl = build(E, secs);
  const patt = id => {
    const out = [];
    for (const e of mains(tl)) if (e.sec === id && e.beat === 1) out.push(e.muted ? 1 : 0);
    return out.join('');
  };
  const a = patt('p'), b = patt('q');
  S.ok(a !== b, 'two sections sharing a seed do not mute identically',
    `section p ${a}, section q ${b} — the seed must be indexed by global bar`);
  notes.push({ randomSeedPatterns: { p: a, q: b } });
}

// ---------------------------------------------------------------------------
// 3.8  Import-shaped input: what the importer would hand the engine
// ---------------------------------------------------------------------------
{
  // The importer maps each raw section as:
  //   bars: x.bars||4, bpm: x.bpm||120, repeat: x.repeat||1, subdiv: x.subdiv||1,
  //   num: x.num||4, den: x.den||4, noteValue validated, states: resizeStates(...)
  // It validates the note value and the states array; it does not validate the rest.
  const imported = raw => section({
    id: 'i', num: raw.num || 4, den: raw.den || 4,
    noteValue: E.NV[raw.noteValue] ? raw.noteValue : E.denNote(raw.den || 4),
    bars: raw.bars || 4, bpm: raw.bpm || 120, bpmEnd: raw.bpmEnd ?? null,
    subdiv: raw.subdiv || 1, repeat: raw.repeat || 1,
    states: E.resizeStates(raw.states, M.ppbEffective(raw.num || 4, raw.den || 4,
      E.NV[raw.noteValue] ? raw.noteValue : E.denNote(raw.den || 4))),
  });
  const hostile = [
    { label: 'negative bpm', raw: { bpm: -120 } },
    { label: 'absurd bpm', raw: { bpm: 1e9 } },
    { label: 'fractional bars', raw: { bars: 1.7 } },
    { label: 'negative bars', raw: { bars: -3 } },
    { label: 'fractional repeat', raw: { repeat: 2.5 } },
    { label: 'negative repeat', raw: { repeat: -2 } },
    { label: 'huge subdiv', raw: { subdiv: 1000 } },
    { label: 'fractional subdiv', raw: { subdiv: 2.5 } },
    { label: 'bpmEnd zero', raw: { bpm: 100, bpmEnd: 0 } },
    { label: 'bogus note value', raw: { noteValue: 'nonsense' } },
    { label: 'string bpm', raw: { bpm: '90' } },
  ];
  for (const h of hostile) {
    let tl = null, threw = null;
    try { tl = build(E, [imported(h.raw)]); } catch (err) { threw = err; }
    S.ok(!threw, `import ${h.label}: does not throw`, threw && threw.message);
    if (!tl) continue;
    const ts = tl.events.map(e => e.t);
    S.ok(ts.every(Number.isFinite), `import ${h.label}: timeline has no non-finite times`,
      `${ts.filter(t => !Number.isFinite(t)).length} of ${ts.length} bad`);
    S.ok(ts.every((t, i) => i === 0 || t >= ts[i - 1]), `import ${h.label}: timeline never runs backwards`,
      `first 8 times ${JSON.stringify(ts.slice(0, 8).map(t => +Number(t).toFixed(4)))}`);
    S.ok(tl.duration >= 0 && Number.isFinite(tl.duration), `import ${h.label}: duration is finite and non-negative`,
      `duration ${fmt(tl.duration)}`);
    S.ok(tl.events.length < 200000, `import ${h.label}: event count stays sane`,
      `${tl.events.length} events`);
  }
}

// ---------------------------------------------------------------------------
// 3.9  The three built-in examples
// ---------------------------------------------------------------------------
{
  const mk = (name, bars, num, den, bpm, extra) => section({
    id: name, name, bars, num, den, bpm, noteValue: E.denNote(den),
    bpmEnd: null, subdiv: 1, repeat: 1, states: E.defaultStates(num), pattern: null, ...(extra || {}),
  });
  const examples = {
    'Marching show': [
      mk('Opener', 16, 4, 4, 144), mk('Waltz interlude', 8, 3, 4, 120),
      mk('Odd hit', 4, 5, 8, 120, { states: E.statesFromGrouping(5, '3+2') }),
      mk('Build', 12, 4, 4, 120, { bpmEnd: 168 }),
      mk('Closer', 8, 6, 8, 168, { states: E.statesFromGrouping(6, '3+3') }),
    ],
    'Odd-time riff': [
      mk('Riff A', 4, 7, 8, 132, { states: E.statesFromGrouping(7, '3+2+2') }),
      mk('Turnaround', 2, 4, 4, 132),
      mk('Riff B', 4, 5, 4, 132, { states: E.statesFromGrouping(5, '3+2') }),
    ],
    'Speed trainer': Array.from({ length: 8 }, (_, i) => mk((80 + i * 10) + ' BPM', 8, 4, 4, 80 + i * 10)),
  };
  for (const [name, secs] of Object.entries(examples)) {
    const tl = build(E, secs);
    const bars = secs.reduce((a, x) => a + x.bars * (x.repeat || 1), 0);
    structuralChecks(tl, `example "${name}"`, bars);
    const analytic = secs.reduce((a, x) => a + secSeconds(x), 0);
    S.near(tl.duration, analytic, 1e-9, `example "${name}" duration matches analytic sum`,
      `analytic ${fmt(analytic)}s vs engine ${fmt(tl.duration)}s`);
    notes.push({ example: name, bars, seconds: tl.duration });
  }
}

export default S;
