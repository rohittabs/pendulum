// tests/extract.mjs
// Loads Pendulum's pure engine at run time, so tests always execute against
// current source rather than a copy that silently rots.
//
// Two sources are supported, tried in order:
//   1. Pendulum_dc.html  - the Claude Design source, plain text, preferred.
//   2. index.html        - the deployed bundle, where the same script is stored
//                          double-escaped inside a JSON string. Used as a fallback
//                          so the tests still run on a checkout that only has the
//                          deployed files.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');

const NAMES = [
  'SOUND_NAMES', 'MARKINGS', 'marking',
  'NOTE_VALUES', 'NV', 'NV_LABEL', 'DEN_NOTE', 'denNote',
  'pulseSec', 'pulsesPerBar', 'ppbSafe',
  'SWING_SUBDIV', 'subOffsets', 'slotDurs',
  'resizeStates', 'clampBpm', 'cycleState', 'defaultStates',
  'statesFromGrouping', 'groupingFromStates',
  'isMuted', 'mulberry32', 'silentBar', 'tapTempo',
  'buildTimeline',
];

function preludeFromSource(html) {
  const m = html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  const cut = m[1].indexOf('const LSK=');
  return cut < 0 ? null : m[1].slice(0, cut);
}

function preludeFromBundle(html) {
  // In the bundle the script lives inside a JSON string, so newlines arrive as
  // "\\n", quotes as '\\"', and so on. Find the span and unescape it.
  const start = html.indexOf('const SOUND_NAMES=');
  if (start < 0) return null;
  const end = html.indexOf('const LSK=', start);
  if (end < 0) return null;
  let s = html.slice(start, end);
  for (let i = 0; i < 4; i++) {
    const next = s
      .replace(/\\\\n/g, '\n').replace(/\\n/g, '\n')
      .replace(/\\\\t/g, '\t')
      .replace(/\\\\"/g, '"').replace(/\\"/g, '"')
      .replace(/\\\\'/g, "'").replace(/\\'/g, "'")
      .replace(/\\\\\\\\/g, '\\');
    if (next === s) break;
    s = next;
  }
  return s;
}

export function loadEngine() {
  const dcPath = join(ROOT, 'Pendulum_dc.html');
  const bundlePath = join(ROOT, 'index.html');

  let prelude = null;
  let source = null;

  if (existsSync(dcPath)) {
    prelude = preludeFromSource(readFileSync(dcPath, 'utf8'));
    if (prelude) source = 'Pendulum_dc.html';
  }
  if (!prelude && existsSync(bundlePath)) {
    prelude = preludeFromBundle(readFileSync(bundlePath, 'utf8'));
    if (prelude) source = 'index.html (bundled fallback)';
  }
  if (!prelude) {
    throw new Error(
      'Could not find the engine. Put Pendulum_dc.html in the repo root, ' +
      'or make sure index.html is the bundled build.'
    );
  }

  let engine;
  try {
    engine = new Function(`${prelude}\n;return {${NAMES.join(',')}};`)();
  } catch (err) {
    throw new Error(`prelude from ${source} failed to evaluate: ${err.message}`);
  }
  for (const n of NAMES) {
    if (engine[n] === undefined) {
      throw new Error(`export "${n}" missing from ${source}; the source may have been restructured`);
    }
  }
  engine.__source = source;
  return engine;
}

export function section(o = {}) {
  return { bars: 1, num: 4, den: 4, bpm: 120, noteValue: 'quarter', states: null, subdiv: 1, ...o };
}

export function build(engine, sections, swing, loop = 1) {
  return engine.buildTimeline(sections, swing ?? { mode: 'off', amount: 50 }, loop);
}

// Analytic reference, written independently of the engine so it can disagree with it.
// If this and buildTimeline ever differ, one of them is wrong, and that is the point.
export function expectedBarDuration(engine, { num, den, noteValue, bpm }) {
  return engine.ppbSafe(num, den, noteValue) * (60 / bpm);
}
