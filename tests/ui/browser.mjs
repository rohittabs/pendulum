// Area 3, completed in a real browser.
//
// Drives index.html in Chromium so the paths the pure-engine tests could not reach
// are actually executed: FileReader-based import, the export download, localStorage
// rehydration, and the bar-map seek.
//
// Run:  NODE_PATH=<scratchpad>/node_modules node tests/ui/browser.mjs
// Playwright is installed outside the repo on purpose; nothing here is added to
// the project's dependencies.

import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Suite, fmt } from '../lib/harness.mjs';

// Playwright is resolved by absolute path so it never has to be installed into the
// project. Point PLAYWRIGHT_DIR at any node_modules that has it.
const PW_DIR = process.env.PLAYWRIGHT_DIR
  || '/private/tmp/claude-501/-Users-rohitmishra-pendulum/a3488d50-d186-4e37-8eaa-689e5ef2f66e/scratchpad/node_modules';
const pw = await import(`${PW_DIR}/playwright/index.js`);
const chromium = pw.chromium || pw.default.chromium;

const S = new Suite('Song mode (browser)');
export const observations = [];
const APP = 'file:///Users/rohitmishra/pendulum/index.html';
const tmp = mkdtempSync(join(tmpdir(), 'pdl-'));
let pageErrors = [];

const writeJson = (name, text) => {
  const p = join(tmp, name);
  writeFileSync(p, typeof text === 'string' ? text : JSON.stringify(text, null, 2));
  return p;
};

async function boot(browser, { storage } = {}) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  if (storage) {
    await page.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch (e) {} },
      ['pendulm.v1', storage]);
  }
  await page.goto(APP);
  await page.waitForFunction(() => window.__pdl && window.__pdl.app);
  await page.evaluate(() => window.__pdl.app.setState({ panel: 'song' }));
  await page.waitForTimeout(250);
  return { ctx, page };
}

// Everything the app itself thinks about the current song, read from live state.
const probe = page => page.evaluate(() => {
  const a = window.__pdl.app, s = a.state;
  let built = null, err = null;
  try {
    const b = a.buildSong();
    const ts = b.events.map(e => e.t);
    built = {
      events: b.events.length,
      bars: b.bars,
      duration: b.duration,
      finiteDuration: Number.isFinite(b.duration),
      nonFinite: ts.filter(t => !Number.isFinite(t)).length,
      monotonic: ts.every((t, i) => i === 0 || t >= ts[i - 1]),
      poly: b.events.filter(e => e.k === 'poly').length,
      muted: b.events.filter(e => e.muted).length,
      maxBpm: b.events.reduce((m, e) => e.bpm != null && e.bpm > m ? e.bpm : m, -Infinity),
      minBpm: b.events.reduce((m, e) => e.bpm != null && e.bpm < m ? e.bpm : m, Infinity),
    };
  } catch (e) { err = String(e); }
  return {
    toast: s.toast, songMode: s.songMode,
    name: s.song && s.song.name,
    sections: s.song && s.song.sections ? s.song.sections.length : null,
    sec0: s.song && s.song.sections && s.song.sections[0] ? s.song.sections[0] : null,
    loop: s.song && s.song.loop,
    swingAmount: s.swingAmount, swingAmt: a.swingAmt(),
    built, err,
  };
});

const browser = await chromium.launch({ headless: true });

// ---------------------------------------------------------------------------
// A. Import validation through the real FileReader path
// ---------------------------------------------------------------------------
const GOOD = {
  format: 'pendulum-song-1',
  song: { name: 'Baseline', loop: 1, sections: [
    { id: 'a', name: 'A', bars: 4, num: 4, den: 4, noteValue: 'quarter', bpm: 120, bpmEnd: null, subdiv: 1, repeat: 1, states: [1, 0, 0, 0], pattern: null },
  ] },
};

const cases = [
  { key: 'malformed-json', file: '{ not json at all', graceful: true,
    why: 'unparseable text' },
  { key: 'not-a-song', file: { hello: 'world', count: 3 }, graceful: true,
    why: 'valid JSON with no sections' },
  { key: 'zero-sections', file: { format: 'pendulum-song-1', song: { name: 'Empty', loop: 1, sections: [] } }, graceful: true,
    why: 'a song with no sections' },
  { key: 'section-missing-fields', file: { song: { name: 'Sparse', sections: [{}] } }, graceful: false,
    why: 'every field defaulted' },
  { key: 'notevalue-not-dividing', file: { song: { name: 'Bad NV', sections: [
      { num: 5, den: 4, noteValue: 'dhalf', bars: 2, bpm: 120 }] } }, graceful: false,
    why: 'dotted half does not tile 5/4' },
  { key: 'swing-amount-400', file: { song: { name: 'Swingy', swingAmount: 400, sections: [
      { num: 4, den: 4, bars: 2, bpm: 120, subdiv: 2 }] } }, graceful: false,
    why: 'out-of-range swing riding in the song' },
  { key: 'fractional-bars', file: { song: { name: 'Frac bars', sections: [
      { num: 4, den: 4, bars: 1.7, bpm: 60, bpmEnd: 120 }] } }, graceful: false,
    why: 'lead 5, plus the ramp overshoot' },
  { key: 'half-bar-ramp', file: { song: { name: 'Half bar', sections: [
      { num: 4, den: 4, bars: 0.5, bpm: 60, bpmEnd: 120 }] } }, graceful: false,
    why: 'worst ramp overshoot' },
  { key: 'negative-bars', file: { song: { name: 'Neg bars', sections: [
      { num: 4, den: 4, bars: -3, bpm: 120 }] } }, graceful: false,
    why: 'negative length' },
  { key: 'negative-bpm', file: { song: { name: 'Neg bpm', sections: [
      { num: 4, den: 4, bars: 2, bpm: -120 }] } }, graceful: false,
    why: 'backwards time' },
  { key: 'bpmend-zero', file: { song: { name: 'Zero end', sections: [
      { num: 4, den: 4, bars: 2, bpm: 100, bpmEnd: 0 }] } }, graceful: false,
    why: 'infinite duration' },
  { key: 'fractional-subdiv', file: { song: { name: 'Frac sub', sections: [
      { num: 4, den: 4, bars: 2, bpm: 120, subdiv: 2.5 }] } }, graceful: false,
    why: 'NaN event times' },
  { key: 'huge-subdiv', file: { song: { name: 'Big sub', sections: [
      { num: 4, den: 4, bars: 2, bpm: 120, subdiv: 5000 }] } }, graceful: false,
    why: 'event explosion' },
  { key: 'fractional-repeat', file: { song: { name: 'Frac rep', sections: [
      { num: 4, den: 4, bars: 2, bpm: 120, repeat: 2.5 }] } }, graceful: false,
    why: 'fractional replay count' },
  { key: 'negative-repeat', file: { song: { name: 'Neg rep', sections: [
      { num: 4, den: 4, bars: 2, bpm: 120, repeat: -2 }] } }, graceful: false,
    why: 'negative replay count' },
  { key: 'loop-negative', file: { song: { name: 'Neg loop', loop: -5, sections: [
      { num: 4, den: 4, bars: 2, bpm: 120 }] } }, graceful: false,
    why: 'negative whole-song loop' },
  { key: 'very-large', file: { song: { name: 'Huge', sections:
      Array.from({ length: 1500 }, (_, i) => ({ id: 's' + i, num: 4, den: 4, bars: 8, bpm: 120 })) } }, graceful: false,
    why: '1500 sections x 8 bars' },
];

for (const c of cases) {
  const { ctx, page } = await boot(browser);
  const before = await probe(page);
  const path = writeJson(c.key + '.json', c.file);
  const t0 = Date.now();
  await page.setInputFiles('input[type=file]', path);
  // The toast is transient: toast() clears it after 1800 ms. Wait for it to APPEAR
  // rather than sleeping, or a slow import is scored on an already-dismissed message.
  let toast = null;
  try {
    await page.waitForFunction(() => window.__pdl.app.state.toast != null, { timeout: 8000 });
    toast = await page.evaluate(() => window.__pdl.app.state.toast);
  } catch (e) { /* left null, asserted below */ }
  const after = { ...(await probe(page)), toast };
  const ms = Date.now() - t0;

  // Every import must leave the app alive and the page free of uncaught errors.
  S.eq(pageErrors.length, 0, `import ${c.key}: no uncaught page error`, pageErrors.join(' | '));
  S.ok(after.err === null, `import ${c.key}: buildSong does not throw afterwards`, after.err);

  if (c.graceful) {
    // These must be rejected with a message and must not disturb the loaded song.
    S.eq(after.toast, 'That file is not a Pendulum song', `import ${c.key}: rejected with a message`,
      `toast was ${fmt(after.toast)} (${c.why})`);
    S.eq(after.sections, before.sections, `import ${c.key}: leaves the existing song untouched`);
  } else {
    // These are accepted. Whatever they produce must still be a playable timeline.
    S.ok(after.sections >= 1 && after.songMode, `import ${c.key}: accepted into song state`,
      `${fmt(after.sections)} sections, songMode ${after.songMode}`);
    S.ok(after.toast && after.toast.startsWith('Imported'), `import ${c.key}: confirms with a message`,
      `toast was ${fmt(after.toast)}`);
    const b = after.built;
    if (b) {
      S.eq(b.nonFinite, 0, `import ${c.key}: timeline has no non-finite times`,
        `${b.nonFinite} of ${b.events} events (${c.why})`);
      S.ok(b.monotonic, `import ${c.key}: timeline never runs backwards`, c.why);
      S.ok(b.finiteDuration && b.duration >= 0, `import ${c.key}: duration is finite and non-negative`,
        `duration ${fmt(b.duration)} (${c.why})`);
      S.ok(b.events < 500000, `import ${c.key}: event count stays bounded`, `${b.events} events`);
    }
  }
  observations.push({ case: c.key, ms, toast: after.toast, sec0: after.sec0, built: after.built, loop: after.loop });
  await ctx.close();
}

// The ramp overshoot, asserted against the tempo the app itself scheduled.
for (const [key, want] of [['fractional-bars', 120], ['half-bar-ramp', 120]]) {
  const o = observations.find(o => o.case === key);
  if (o && o.built) S.ok(o.built.maxBpm <= want + 1e-9,
    `import ${key}: ramp never exceeds its requested end tempo`,
    `requested ceiling ${want} BPM, app scheduled up to ${fmt(o.built.maxBpm)} BPM`);
}

// A swing amount carried in a song must not be able to poison global swing.
{
  const o = observations.find(o => o.case === 'swing-amount-400');
  observations.push({ note: 'swingAmount in song file is ignored by importSong', value: o && o.toast });
}

// ---------------------------------------------------------------------------
// B. Export -> import round trip, through the real download
// ---------------------------------------------------------------------------
{
  const { ctx, page } = await boot(browser);
  await page.evaluate(g => { window.__pdl.app.setState({ song: g, songMode: true }); }, GOOD.song);
  await page.waitForTimeout(200);
  const original = await page.evaluate(() => JSON.parse(JSON.stringify(window.__pdl.app.state.song)));
  const dl = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => window.__pdl.app.exportSong()),
  ]).then(([d]) => d);
  const saved = join(tmp, 'roundtrip.json');
  await dl.saveAs(saved);
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(saved, 'utf8');
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { /* asserted below */ }
  S.ok(parsed !== null, 'export produces parseable JSON');
  S.eq(parsed && parsed.format, 'pendulum-song-1', 'export carries its format tag');
  S.eq(JSON.stringify(parsed && parsed.song), JSON.stringify(original), 'exported song equals live song');
  S.ok(!('swingAmount' in (parsed?.song || {})), 'export does not carry swingAmount',
    'the lead claims swing travels in exported songs');

  await page.setInputFiles('input[type=file]', saved);
  await page.waitForTimeout(400);
  const back = await page.evaluate(() => JSON.parse(JSON.stringify(window.__pdl.app.state.song)));
  S.eq(back.sections.length, original.sections.length, 'round trip preserves section count');
  for (const k of ['bars', 'num', 'den', 'noteValue', 'bpm', 'bpmEnd', 'subdiv', 'repeat']) {
    S.eq(JSON.stringify(back.sections[0][k]), JSON.stringify(original.sections[0][k]),
      `round trip preserves section.${k}`);
  }
  S.eq(JSON.stringify(back.sections[0].states), JSON.stringify(original.sections[0].states),
    'round trip preserves states');
  S.eq(back.loop, original.loop, 'round trip preserves loop');
  observations.push({ roundTrip: { original: original.sections[0], returned: back.sections[0] } });
  await ctx.close();
}

// ---------------------------------------------------------------------------
// C. localStorage rehydration of swingAmount
// ---------------------------------------------------------------------------
for (const bad of [400, -50, 0, 'abc', null]) {
  const stored = JSON.stringify({ swingMode: '8th', swingAmount: bad, subdiv: 2, bpm: 120 });
  const { ctx, page } = await boot(browser, { storage: stored });
  const r = await page.evaluate(() => {
    const a = window.__pdl.app, s = a.state;
    const offs = window.__pdl.subOffsets(2, s.swingMode || 'off', a.swingAmt());
    const durs = window.__pdl.slotDurs(offs);
    return { stored: s.swingAmount, used: a.swingAmt(), offs, durs };
  });
  S.ok(r.used >= 50 && r.used <= 75, `localStorage swingAmount ${fmt(bad)} is clamped on load`,
    `stored ${fmt(r.stored)}, scheduler used ${fmt(r.used)}`);
  S.ok(r.offs.every(Number.isFinite), `localStorage swingAmount ${fmt(bad)} yields finite offsets`,
    `offsets ${JSON.stringify(r.offs)}`);
  S.ok(r.durs.every(d => d > 0), `localStorage swingAmount ${fmt(bad)} yields positive slots`,
    `slots ${JSON.stringify(r.durs)}`);
  observations.push({ storedSwing: bad, used: r.used, offs: r.offs, durs: r.durs });
  await ctx.close();
}

// ---------------------------------------------------------------------------
// D. Bar map seek indexing
// ---------------------------------------------------------------------------
{
  const { ctx, page } = await boot(browser);
  const song = { name: 'Seek', loop: 1, sections: [
    { id: 'a', name: 'A', bars: 4, num: 4, den: 4, noteValue: 'quarter', bpm: 120, bpmEnd: null, subdiv: 1, repeat: 1, states: [1, 0, 0, 0], pattern: null },
    { id: 'b', name: 'B', bars: 3, num: 3, den: 4, noteValue: 'quarter', bpm: 120, bpmEnd: null, subdiv: 1, repeat: 1, states: [1, 0, 0], pattern: null },
  ] };
  await page.evaluate(g => window.__pdl.app.setState({ song: g, songMode: true }), song);
  await page.waitForTimeout(200);
  const seek = n => page.evaluate(k => {
    const a = window.__pdl.app;
    if (!a.songEv) a.buildSong();
    const i = a.songEv.findIndex(e => e.bar >= k);
    return { idx: i, bar: i < 0 ? null : a.songEv[i].bar, t: i < 0 ? null : a.songEv[i].t, total: a.songBars };
  }, n);
  const total = (await seek(0)).total;
  S.eq(total, 7, 'seek fixture has 7 bars', '4 bars of 4/4 + 3 bars of 3/4');
  for (let n = 0; n < total; n++) {
    const r = await seek(n);
    S.eq(r.bar, n, `bar map: tapping tick ${n} lands on bar ${n}`, `landed on bar ${fmt(r.bar)}`);
  }
  const past = await seek(total);
  S.ok(past.idx >= 0, `bar map: tick past the last bar does not fall back to the start`,
    `findIndex returned ${past.idx}, and jumpToBar turns that into bar 0`);
  observations.push({ seekPastEnd: past, total });
  await ctx.close();
}

// ---------------------------------------------------------------------------
// E. Poly / pattern / random in song mode, observed in the live app
// ---------------------------------------------------------------------------
{
  const { ctx, page } = await boot(browser);
  const r = await page.evaluate(() => {
    const a = window.__pdl.app;
    a.setState({ polyKey: 'custom', polyX: 3, polyY: 2, patternKey: 'every', patOn: 1, patOff: 1, randomPct: 50, songMode: true });
    const b = a.buildSong();
    const dots = document.querySelectorAll('[aria-label^="Poly"], [aria-label^="Beat"]').length;
    return {
      polyRatio: a.polyRatio(),
      polyEventsInSong: b.events.filter(e => e.k === 'poly').length,
      mutedInSong: b.events.filter(e => e.muted).length,
      sectionHasPoly: 'poly' in (a.state.song.sections[0] || {}),
      sectionPattern: a.state.song.sections[0].pattern,
      sectionRandom: a.state.song.sections[0].randomPct ?? null,
    };
  });
  S.ok(r.polyRatio !== null, 'poly is switched on in state');
  S.ok(r.polyEventsInSong > 0, 'polyrhythm still plays once Song mode is on',
    `polyRatio() reports ${JSON.stringify(r.polyRatio)} but the song timeline holds ${r.polyEventsInSong} poly events`);
  S.ok(r.mutedInSong > 0, 'bar mute pattern still applies once Song mode is on',
    `pattern 1-on/1-off and 50% random are set, yet ${r.mutedInSong} events are muted`);
  observations.push({ songModeFeatures: r });
  await ctx.close();
}

// ---------------------------------------------------------------------------
// F. presetToSection: what a preset carries that a section loses
// ---------------------------------------------------------------------------
{
  const { ctx, page } = await boot(browser);
  const r = await page.evaluate(async () => {
    const a = window.__pdl.app;
    // Configure the metronome with every bar-level feature switched on, save a preset.
    a.setState({ num: 5, den: 4, noteValue: 'quarter', bpm: 137, subdiv: 3, decimals: true,
      swingMode: '16th', swingAmount: 71, patternKey: 'every', patOn: 2, patOff: 1, randomPct: 40,
      polyKey: 'custom', polyX: 5, polyY: 4, countIn: 2,
      mainSound: 'Cowbell', polySound: 'Claves', mainVol: 0.5, polyVol: 0.4 });
    await new Promise(r => setTimeout(r, 120));
    a.savePreset();
    await new Promise(r => setTimeout(r, 120));
    const preset = a.state.presets[a.state.presets.length - 1];
    const before = a.state.song.sections.length;
    a.presetToSection(preset);
    await new Promise(r => setTimeout(r, 150));
    const sec = a.state.song.sections[a.state.song.sections.length - 1];
    return { cfgKeys: Object.keys(preset.cfg).sort(), secKeys: Object.keys(sec).sort(), sec, added: a.state.song.sections.length - before };
  });
  S.eq(r.added, 1, 'presetToSection appends a section');
  observations.push({ presetCfgKeys: r.cfgKeys, sectionKeys: r.secKeys, section: r.sec });

  // Keys the engine would honour on a section but the conversion discards.
  const material = { poly: ['polyKey', 'polyX', 'polyY'], pattern: ['patternKey', 'patOn', 'patOff'], randomPct: ['randomPct'] };
  for (const [field, cfgKeys] of Object.entries(material)) {
    const present = r.sec[field] != null;
    S.ok(present, `presetToSection carries ${field} (from ${cfgKeys.join('/')})`,
      `buildTimeline reads section.${field}, but the converted section has ${fmt(r.sec[field])}`);
  }
  // Keys the preset holds that a section has no schema slot for at all.
  const unrepresentable = ['swingMode', 'swingAmount', 'countIn', 'mainSound', 'polySound', 'mainVol', 'polyVol', 'decimals', 'subLabel'];
  observations.push({ droppedButUnrepresentable: unrepresentable.filter(k => r.cfgKeys.includes(k)) });
  await ctx.close();
}

await browser.close();
export default S;
