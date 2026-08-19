// The polyrhythm path that actually ships.
//
// pullMet() is stateful: g.t/g.beat/g.bar drive the main clock, g.pt/g.pn drive an
// independent poly clock, and g.q/g.pq are one-event queues that decide which layer
// emits next. Nothing here is testable one call at a time, so every test below drives
// the generator exactly the way scheduleAhead() does — repeated pull() calls — and
// asserts on the resulting event stream.
//
// Run: node tests/run.mjs --pullmet

import { Suite, fmt } from '../lib/harness.mjs';

const PW_DIR = process.env.PLAYWRIGHT_DIR
  || '/private/tmp/claude-501/-Users-rohitmishra-pendulum/a3488d50-d186-4e37-8eaa-689e5ef2f66e/scratchpad/node_modules';
const pw = await import(`${PW_DIR}/playwright/index.js`);
const chromium = pw.chromium || pw.default.chromium;

const APP = 'file:///Users/rohitmishra/pendulum/index.html';

// The proposed fix, applied at run time as an instance overlay so index.html is never
// touched. The bodies here are byte-identical to the diff printed in the report.
const OVERLAY = () => {
  const a = window.__pdl.app;
  const { pulseSec, subOffsets, defaultStates } = window.__pdl;

  // (1) resetGen: give the poly clock its own bar tracker.
  const origReset = a.resetGen.bind(a);
  a.resetGen = function (startAt) { origReset(startAt); this.g.pbar = 0; this.g.ppulse = 0; };

  // (2) resnapPoly: runs ONCE per live edit, never per note.
  a.resnapPoly = function (resetCycle) {
    const g = this.g;
    if (!g) return;
    g.pq.length = 0;                 // drop the pending, not-yet-emitted poly note
    g.pt = g.t;                      // g.t is the next main pulse not yet queued
    const ppb = this.ppb(), wrap = g.beat >= ppb;
    g.pbar = wrap ? g.bar + 1 : g.bar;
    g.ppulse = wrap ? 0 : g.beat;
    if (resetCycle) g.pn = 0;
  };

  // (3) pullMet: main branch byte-identical; poly branch takes its bar from the
  //     incremental tracker instead of dividing total steps by the current ppb.
  a.pullMet = function () {
    const s = this.state, g = this.g;
    if (!g.q.length) {
      const num = this.ppb();
      let states = s.states;
      if (!states || states.length !== num) states = defaultStates(num);
      if (g.beat >= num) { g.beat = 0; g.bar++; }
      if (g.beat === 0) g.barMuted = this.barMutedAt(g.bar);
      const d = pulseSec(s.bpm), st = states[g.beat], sd = Math.max(1, s.subdiv);
      const offs = subOffsets(sd, s.swingMode || 'off', this.swingAmt());
      g.q.push({ t: g.t, k: 'main', a: st === 1 ? (g.beat === 0 ? 2 : 1) : 0, bar: g.bar, beat: g.beat + 1,
        sig: s.num + '/' + s.den, bpm: s.bpm, muted: g.barMuted || st === 2 });
      for (let j = 1; j < sd; j++) g.q.push({ t: g.t + d * offs[j], k: 'sub', sj: j, a: 0, bar: g.bar,
        beat: g.beat + 1, muted: g.barMuted || st === 2 });
      g.t += d; g.beat++;
    }
    const r = this.polyRatio();
    if (r && !g.pq.length) {
      const pos = g.pn % r.x;
      const bar = g.pbar;
      g.pq.push({ t: g.pt, k: 'poly', a: pos === 0 ? 2 : 0, bar, pi: pos, cyc: Math.floor(g.pn / r.x),
        muted: this.barMutedAt(bar) });
      g.pt += pulseSec(s.bpm) * r.y / r.x;      // UNCHANGED expression, same rounding
      g.ppulse += r.y / r.x;
      const ppb = this.ppb();
      while (g.ppulse >= ppb - 1e-9) { g.ppulse -= ppb; g.pbar++; }
      g.pn++;
    }
    if (g.pq.length && (!g.q.length || g.pq[0].t < g.q[0].t)) return g.pq.shift();
    return g.q.shift();
  };

  // (4) componentDidUpdate: resnap on grid changes too, not just ratio changes.
  const snap = () => ({ bpm: a.state.bpm, num: a.state.num, den: a.state.den,
    noteValue: a.state.noteValue, polyKey: a.state.polyKey, polyX: a.state.polyX, polyY: a.state.polyY });
  a.__prevGrid = snap();
  const origCDU = Object.getPrototypeOf(a).componentDidUpdate;
  a.componentDidUpdate = function (...args) {
    const b = this.__prevGrid, s = this.state;
    const gridChanged = b.bpm !== s.bpm || b.num !== s.num || b.den !== s.den || b.noteValue !== s.noteValue;
    const ratioChanged = b.polyKey !== s.polyKey || b.polyX !== s.polyX || b.polyY !== s.polyY;
    origCDU.apply(this, args);
    if (this.playing && this.g && (gridChanged || ratioChanged)) this.resnapPoly(ratioChanged);
    this.__prevGrid = snap();
  };
};

export async function runSuite(applyPatch = false) {
const S = new Suite(`pullMet ${applyPatch ? '(patched)' : '(as shipped)'}`);
const observations = [];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(APP);
await page.waitForFunction(() => window.__pdl && window.__pdl.app);
if (applyPatch) await page.evaluate(OVERLAY);

// Drive the generator. `plan.steps` interleaves state patches with batches of pull()s,
// which is the only way to observe what a mid-playback change does to the poly clock.
const run = plan => page.evaluate(async plan => {
  const a = window.__pdl.app;
  const set = patch => new Promise(r => a.setState(patch, r));
  await set({ songMode: false, countIn: 0, subdiv: 1, patternKey: 'always', ...plan.initial });
  if (plan.playing) a.playing = true;
  a.resetGen(0);
  const out = [];
  for (const step of plan.steps) {
    if (step.patch) await set(step.patch);
    for (let i = 0; i < step.pull; i++) {
      const e = a.pull();
      if (!e) break;
      out.push({ t: e.t, k: e.k, a: e.a, bar: e.bar, beat: e.beat, pi: e.pi, cyc: e.cyc, muted: !!e.muted, mark: step.mark });
    }
  }
  a.playing = false;
  return { events: out, g: { pt: a.g.pt, pn: a.g.pn, t: a.g.t, bar: a.g.bar, beat: a.g.beat } };
}, plan);

const mainsOf = ev => ev.filter(e => e.k === 'main');
const polysOf = ev => ev.filter(e => e.k === 'poly');

// ---------------------------------------------------------------------------
// 1. Drift of the poly clock against the main clock over a long run
// ---------------------------------------------------------------------------
// x poly steps of pulse*y/x should total exactly y pulses, so cycle k must start on
// main pulse k*y. In exact arithmetic there is no drift; in floating point each clock
// accumulates its own rounding and never resnaps, so the question is how fast it grows.
for (const [x, y, label] of [[3, 2, '3:2 (step = 2/3 pulse, inexact)'], [4, 3, '4:3'], [7, 8, '7:8'], [5, 4, '5:4 (step = 4/5 pulse, exact in binary)']]) {
  const bars = 1500, ppb = 4;
  const { events } = await run({
    initial: { bpm: 120, num: 4, den: 4, noteValue: 'quarter', polyKey: 'custom', polyX: x, polyY: y },
    steps: [{ pull: Math.ceil(bars * ppb * (1 + x / y)) + 20 }],
  });
  const mains = mainsOf(events), polys = polysOf(events);
  let worst = 0, worstAt = null;
  for (const p of polys) {
    if (p.pi !== 0) continue;                       // cycle starts only
    const idx = p.cyc * y;                          // cycle k begins on main pulse k*y
    if (idx >= mains.length) break;
    const d = Math.abs(p.t - mains[idx].t);
    if (d > worst) { worst = d; worstAt = { cyc: p.cyc, pulse: idx, polyT: p.t, mainT: mains[idx].t }; }
  }
  const spanMin = (mains[mains.length - 1].t) / 60;
  S.ok(worst < 1e-3, `poly clock stays within 1 ms of the main clock over ${spanMin.toFixed(0)} min — ${label}`,
    `worst divergence ${fmt(worst * 1000)} ms at cycle ${worstAt && worstAt.cyc}`);
  observations.push({ drift: label, ratio: `${x}:${y}`, minutes: +spanMin.toFixed(1), worstMs: worst * 1000, worstAt });
}

// ---------------------------------------------------------------------------
// 1b. Steady state must be untouched: the incremental bar tracker has to reproduce
//     the shipped formula exactly when no edit occurs, and timings must be identical.
// ---------------------------------------------------------------------------
{
  const x = 4, y = 3, ppb = 4;
  const { events } = await run({
    initial: { bpm: 120, num: 4, den: 4, noteValue: 'quarter', polyKey: 'custom', polyX: x, polyY: y },
    steps: [{ pull: 4000 }],
  });
  const polys = polysOf(events);
  let n = 0, bad = 0, firstBad = null;
  for (const p of polys) {
    const shipped = Math.floor((n * y / x) / ppb + 1e-9);   // the formula in index.html
    if (p.bar !== shipped) { bad++; if (!firstBad) firstBad = { step: n, tracker: p.bar, shipped }; }
    n++;
  }
  S.eq(bad, 0, 'steady state: bar numbers identical to the shipped formula',
    `${bad} of ${polys.length} differ; first ${JSON.stringify(firstBad)}`);
  observations.push({ steadyFingerprint: { ratio: `${x}:${y}`, count: polys.length,
    times: polys.map(p => p.t), bars: polys.map(p => p.bar), accents: polys.map(p => p.a) } });
}

// ---------------------------------------------------------------------------
// 2. Cycle starts land on main pulses at constant tempo
// ---------------------------------------------------------------------------
for (const [x, y] of [[3, 2], [4, 3], [5, 4], [2, 3], [7, 8]]) {
  const { events } = await run({
    initial: { bpm: 132, num: 4, den: 4, noteValue: 'quarter', polyKey: 'custom', polyX: x, polyY: y },
    steps: [{ pull: 400 }],
  });
  const mains = mainsOf(events), polys = polysOf(events);
  const starts = polys.filter(p => p.pi === 0).slice(0, 12);
  for (const p of starts) {
    const idx = p.cyc * y;
    if (idx >= mains.length) continue;
    S.near(p.t, mains[idx].t, 1e-9, `${x}:${y} cycle ${p.cyc} starts on main pulse ${idx}`,
      `a cycle spans ${y} pulses, so cycle ${p.cyc} must begin at pulse ${idx}`);
  }
  // Accent placement: every cycle start is accented, nothing else is.
  for (const p of polys.slice(0, 60))
    S.eq(p.a === 2, p.pi === 0, `${x}:${y} accent only on cycle start (pi=${p.pi})`);
}

// ---------------------------------------------------------------------------
// 3. Tempo change mid-playback
// ---------------------------------------------------------------------------
{
  const { events } = await run({
    playing: true,   // componentDidUpdate gates the re-phase on this.playing
    initial: { bpm: 120, num: 4, den: 4, noteValue: 'quarter', polyKey: 'custom', polyX: 3, polyY: 2 },
    steps: [{ pull: 40, mark: 'before' }, { patch: { bpm: 60 }, pull: 60, mark: 'after' }],
  });
  const polys = polysOf(events), mains = mainsOf(events);
  const after = polys.filter(p => p.mark === 'after');
  const mAfter = mains.filter(m => m.mark === 'after');
  // The step must follow the new tempo.
  const gaps = [];
  for (let i = 1; i < after.length; i++) gaps.push(after[i].t - after[i - 1].t);
  const settled = gaps.slice(2);
  const wantStep = (60 / 60) * 2 / 3;   // pulse at 60 BPM is 1 s; step is y/x of it
  S.near(settled[0], wantStep, 1e-9, 'poly step follows a mid-playback tempo change',
    `at 60 BPM a 3:2 step must be 1 s * 2/3 = ${fmt(wantStep)} s`);
  // Does a cycle start still coincide with a main pulse after the change?
  let realigned = 0, checked = 0;
  for (const p of after.filter(p => p.pi === 0)) {
    checked++;
    if (mAfter.some(m => Math.abs(m.t - p.t) < 1e-9)) realigned++;
  }
  // Measure the offset, not just the miss count: how far is each cycle start from the
  // nearest main pulse once the tempo has settled?
  const offsets = after.filter(p => p.pi === 0).map(p => {
    const nearest = mAfter.reduce((b, m) => Math.abs(m.t - p.t) < Math.abs(b - p.t) ? m.t : b, Infinity);
    return p.t - nearest;
  }).filter(Number.isFinite);
  const steady = offsets.slice(2);
  const pulseAfter = 60 / 60;
  const dists = steady.map(o => Math.min(Math.abs(o), pulseAfter - Math.abs(o)));
  S.eq(realigned, checked, 'cycle starts still coincide with main pulses after a tempo change',
    `${realigned} of ${checked} cycle starts landed on a pulse; every later cycle sits ${fmt(dists[0])} s from the nearest pulse (pulse is ${fmt(pulseAfter)} s, so exactly half a beat off), stable to ${fmt(Math.max(...dists) - Math.min(...dists))} s`);
  observations.push({ tempoChange: { gapsAfter: settled.slice(0, 4), realigned, checked, steadyOffset: steady.slice(0, 5) } });
  // Constraint 4: the edit must not emit two poly notes on one instant, nor go backwards.
  const pts = polys.map(p => p.t);
  S.ok(pts.every((t, i) => i === 0 || t > pts[i - 1]), 'tempo edit: poly stream stays strictly increasing',
    `times around the seam ${JSON.stringify(polys.filter(p => p.mark === 'after').slice(0, 3).map(p => +p.t.toFixed(6)))}`);
  S.eq(new Set(pts.map(t => t.toFixed(9))).size, pts.length, 'tempo edit: no two poly notes share a timestamp');
  const allT = events.map(e => e.t);
  S.ok(allT.every((t, i) => i === 0 || t >= allT[i - 1] - 1e-9), 'tempo edit: full event stream never runs backwards');
}

// ---------------------------------------------------------------------------
// 4. Time signature / note value change mid-playback, and the poly bar number
// ---------------------------------------------------------------------------
// barMutedAt(bar) is fed a bar number the poly clock derives itself:
//   bar = floor((pn * y/x) / ppb() + 1e-9)
// That divides TOTAL elapsed poly steps by the CURRENT pulses-per-bar, so a signature
// change retroactively renumbers the whole history.
for (const [from, to, label] of [[[4, 4, 'quarter'], [3, 4, 'quarter'], '4/4 -> 3/4'],
                                 [[4, 4, 'quarter'], [4, 4, '8th'], 'quarter -> 8th note value'],
                                 [[6, 8, '8th'], [6, 8, 'dquarter'], '6/8 eighth -> dotted quarter']]) {
  const { events } = await run({
    initial: { bpm: 120, num: from[0], den: from[1], noteValue: from[2], polyKey: 'custom', polyX: 3, polyY: 2 },
    steps: [{ pull: 60, mark: 'before' }, { patch: { num: to[0], den: to[1], noteValue: to[2] }, pull: 60, mark: 'after' }],
  });
  const polys = polysOf(events), mains = mainsOf(events);
  // The bar a poly note claims must be the bar it actually falls in, per the main clock.
  let mismatches = 0, first = null;
  for (const p of polys) {
    const owning = mains.filter(m => m.t <= p.t + 1e-9).pop();
    if (!owning) continue;
    if (owning.bar !== p.bar) { mismatches++; if (!first) first = { polyT: p.t, claims: p.bar, actual: owning.bar, mark: p.mark }; }
  }
  S.eq(mismatches, 0, `poly bar number matches the main clock across ${label}`,
    `${mismatches} of ${polys.length} poly notes name the wrong bar; first at t=${fmt(first && first.polyT)} claiming bar ${first && first.claims} while the main clock is in bar ${first && first.actual} (${first && first.mark})`);
  observations.push({ sigChange: label, mismatches, total: polys.length, first });
}

// ---------------------------------------------------------------------------
// 5. barMutedAt agreement near a bar line
// ---------------------------------------------------------------------------
for (const [x, y, sig] of [[3, 2, [4, 4]], [4, 3, [4, 4]], [2, 3, [4, 4]], [5, 4, [5, 4]], [7, 8, [7, 8]]]) {
  const { events } = await run({
    initial: { bpm: 120, num: sig[0], den: sig[1], noteValue: sig[1] === 8 ? '8th' : 'quarter',
      polyKey: 'custom', polyX: x, polyY: y, patternKey: 'every', patOn: 1, patOff: 1 },
    steps: [{ pull: 600 }],
  });
  const polys = polysOf(events), mains = mainsOf(events);
  const barMute = new Map();
  for (const m of mains) if (!barMute.has(m.bar)) barMute.set(m.bar, m.muted);
  let bad = 0, firstBad = null, nearLine = 0;
  for (const p of polys) {
    const owning = mains.filter(m => m.t <= p.t + 1e-9).pop();
    if (!owning) continue;
    const barStart = mains.find(m => m.bar === owning.bar).t;
    if (Math.abs(p.t - barStart) < 1e-6) nearLine++;
    const want = barMute.get(owning.bar);
    if (p.muted !== want) { bad++; if (!firstBad) firstBad = { t: p.t, bar: owning.bar, polyMuted: p.muted, mainMuted: want }; }
  }
  S.eq(bad, 0, `poly mute agrees with the main layer, ${x}:${y} in ${sig[0]}/${sig[1]}`,
    `${bad} of ${polys.length} disagree; first ${JSON.stringify(firstBad)}`);
  observations.push({ muteAgreement: `${x}:${y} in ${sig[0]}/${sig[1]}`, bad, total: polys.length, onBarLine: nearLine });
}

// ---------------------------------------------------------------------------
// 6. Reset behaviour: restart, and changing the ratio mid-playback
// ---------------------------------------------------------------------------
{
  // resetGen is what start() calls; it must clear both poly fields.
  const r = await page.evaluate(async () => {
    const a = window.__pdl.app;
    await new Promise(res => a.setState({ songMode: false, countIn: 0, bpm: 120, num: 4, den: 4,
      noteValue: 'quarter', polyKey: 'custom', polyX: 3, polyY: 2 }, res));
    a.resetGen(0);
    for (let i = 0; i < 50; i++) a.pull();
    const mid = { pt: a.g.pt, pn: a.g.pn, t: a.g.t, bar: a.g.bar };
    a.stop();
    const afterStop = { pt: a.g.pt, pn: a.g.pn, t: a.g.t, bar: a.g.bar };
    a.resetGen(0);
    const afterReset = { pt: a.g.pt, pn: a.g.pn, t: a.g.t, bar: a.g.bar };
    const firstPoly = (() => { for (let i = 0; i < 10; i++) { const e = a.pull(); if (e.k === 'poly') return e; } return null; })();
    return { mid, afterStop, afterReset, firstPoly };
  });
  S.ok(r.mid.pn > 0 && r.mid.pt > 0, 'poly clock advances during a run');
  S.eq(r.afterReset.pn, 0, 'restart clears the poly step counter');
  S.eq(r.afterReset.pt, 0, 'restart clears the poly clock');
  S.eq(r.afterReset.t, 0, 'restart clears the main clock');
  S.eq(r.firstPoly && r.firstPoly.t, 0, 'first poly note after restart sits on the downbeat');
  S.ok(r.afterStop.pn === r.mid.pn, 'stop() alone leaves generator state in place (start() is what resets)',
    `pn ${r.afterStop.pn} vs ${r.mid.pn}`);
  observations.push({ reset: r });
}
{
  // componentDidUpdate resets g.pn when the ratio changes mid-playback. It does not
  // reset g.pt, so the new cycle's accent starts wherever the old clock happened to be.
  // Interrupt at several different points. A change that happens to land on a cycle
  // boundary realigns by luck; the honest test is to interrupt mid-cycle too.
  for (const at of [28, 29, 30, 31, 32, 33]) {
    const { events } = await run({
      playing: true,
      initial: { bpm: 120, num: 4, den: 4, noteValue: 'quarter', polyKey: 'custom', polyX: 3, polyY: 2 },
      steps: [{ pull: at, mark: 'before' }, { patch: { polyX: 5, polyY: 4 }, pull: 40, mark: 'after' }],
    });
    const mains = mainsOf(events);
    const firstAfter = polysOf(events).filter(p => p.mark === 'after' && p.pi === 0)[0];
    if (!firstAfter) continue;
    const nearest = mains.reduce((b, m) => Math.abs(m.t - firstAfter.t) < Math.abs(b - firstAfter.t) ? m.t : b, Infinity);
    const off = firstAfter.t - nearest;
    S.ok(Math.abs(off) < 1e-9, `ratio change after ${at} pulls: new cycle starts on a main pulse`,
      `new cycle accent at t=${fmt(firstAfter.t)}, nearest pulse ${fmt(nearest)}, off by ${fmt(off)} s`);
    const pts = polysOf(events).map(p => p.t);
    S.ok(pts.every((t, i) => i === 0 || t > pts[i - 1]), `ratio change after ${at} pulls: poly stream strictly increasing`,
      `${JSON.stringify(pts.slice(0, 3).map(t => +t.toFixed(6)))} ... seam at ${fmt(firstAfter.t)}`);
    S.eq(new Set(pts.map(t => t.toFixed(9))).size, pts.length, `ratio change after ${at} pulls: no duplicate poly timestamps`);
    observations.push({ ratioChangeAt: at, accentT: firstAfter.t, nearestPulse: nearest, offset: off });
  }
}

// ---------------------------------------------------------------------------
// 7. pullMet versus buildTimeline for identical settings
// ---------------------------------------------------------------------------
for (const [x, y, num, den, nv] of [[3, 2, 4, 4, 'quarter'], [4, 3, 4, 4, 'quarter'], [5, 4, 5, 4, 'quarter'],
                                     [2, 3, 4, 4, 'quarter'], [7, 8, 7, 8, '8th'], [3, 4, 6, 8, '8th']]) {
  const bars = 6;
  const { events } = await run({
    initial: { bpm: 120, num, den, noteValue: nv, polyKey: 'custom', polyX: x, polyY: y },
    steps: [{ pull: 900 }],
  });
  const cmp = await page.evaluate(([x, y, num, den, nv, bars]) => {
    const b = window.__pdl.buildTimeline(
      [{ id: 'a', bars, num, den, noteValue: nv, bpm: 120, subdiv: 1, repeat: 1, states: null, poly: { x, y } }],
      { mode: 'off', amount: 50 }, 1);
    return { poly: b.events.filter(e => e.k === 'poly').map(e => ({ t: e.t, a: e.a, pi: e.pi, bar: e.bar })), duration: b.duration };
  }, [x, y, num, den, nv, bars]);

  const live = polysOf(events).filter(p => p.t < cmp.duration - 1e-9).map(p => ({ t: p.t, a: p.a, pi: p.pi }));
  const built = cmp.poly;
  const same = live.length === built.length &&
    live.every((p, i) => Math.abs(p.t - built[i].t) < 1e-9 && p.a === built[i].a);
  S.ok(same, `pullMet and buildTimeline agree for ${x}:${y} in ${num}/${den} ${nv}`,
    `over ${bars} bars pullMet emits ${live.length} poly notes, buildTimeline ${built.length}` +
    (live.length === built.length ? `; first timing difference at ${fmt((live.find((p, i) => Math.abs(p.t - built[i].t) >= 1e-9) || {}).t)}` : ''));
  // Where exactly do they part company? Expressed in bars, so it can be checked against
  // the first bar line the poly cycle fails to land on.
  const barDur = cmp.duration / bars;
  let firstDiff = null;
  for (let i = 0; i < Math.min(live.length, built.length); i++) {
    if (Math.abs(live[i].t - built[i].t) >= 1e-9) {
      firstDiff = { idx: i, live: live[i].t, built: built[i].t, atBar: built[i].t / barDur };
      break;
    }
  }
  // A cycle spans y pulses; the grids can only stay together if y divides the bar.
  const ppbHere = Math.round(barDur / (60 / 120));
  const alignable = ppbHere % y === 0;
  S.eq(firstDiff === null, alignable,
    `${x}:${y} in ${num}/${den}: the two poly algorithms agree iff a cycle tiles the bar`,
    `bar is ${ppbHere} pulses, a cycle is ${y}, ${ppbHere % y === 0 ? 'divides' : 'does not divide'}; ` +
    (firstDiff ? `first divergence at poly note ${firstDiff.idx}, t=${fmt(firstDiff.live)} vs ${fmt(firstDiff.built)}, i.e. bar ${fmt(firstDiff.atBar)}` : 'no divergence'));
  observations.push({
    compare: `${x}:${y} in ${num}/${den} ${nv}`, bars, ppb: ppbHere, cycleSpansPulses: y, alignable,
    livePolyCount: live.length, builtPolyCount: built.length, firstDiff,
    liveFirst8: live.slice(0, 8).map(p => +p.t.toFixed(6)),
    builtFirst8: built.slice(0, 8).map(p => +p.t.toFixed(6)),
  });
}

await browser.close();
return { suite: S, observations };
}

const first = await runSuite(false);
export const observations = first.observations;
export default first.suite;
