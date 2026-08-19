// Independent musical reference. Everything here is derived from first
// principles and deliberately written WITHOUT consulting the app's arithmetic,
// so that a disagreement between this file and the engine is informative.
//
// Derivations:
//   * A dot adds half the note's value      -> dotted = 3/2 x
//   * A triplet fits 3 in the space of 2    -> triplet = 2/3 x
//   * Measured in quarter notes, a whole note is 4.
//   * A signature num/den holds `num` notes of length 1/den whole notes,
//     so the bar is num * (4/den) quarter notes long.
//   * BPM counts the SELECTED note value, so one pulse lasts 60/bpm seconds.

const W = 4; // quarter notes in a whole note
export const NV_Q = {
  whole:    W,
  dhalf:    (W / 2) * 3 / 2,
  half:     W / 2,
  dquarter: 1 * 3 / 2,
  quarter:  1,
  tquarter: 1 * 2 / 3,
  d8th:     (1 / 2) * 3 / 2,
  '8th':    1 / 2,
  t8th:     (1 / 2) * 2 / 3,
  d16th:    (1 / 4) * 3 / 2,
  '16th':   1 / 4,
  t16th:    (1 / 4) * 2 / 3,
  '32nd':   1 / 8,
};
export const NV_KEYS = Object.keys(NV_Q);

export const SIGS = [[2,2],[2,4],[3,4],[4,4],[5,4],[6,4],[3,8],[5,8],[6,8],[7,8],[9,8],[12,8]];
export const POLY_PRESETS = [[3,2],[4,3],[5,4],[3,4],[5,3],[7,8],[2,3]];

export const barQuarters = (num, den) => num * (W / den);

// Integer pulses per bar, or null when the note value does not tile the bar.
// The tolerance exists because 1/3 and 1/6 are not exact in binary.
export function ppb(num, den, nv) {
  const q = NV_Q[nv];
  if (!q) return null;
  const raw = barQuarters(num, den) / q;
  const r = Math.round(raw);
  return (r >= 1 && Math.abs(raw - r) < 1e-9) ? r : null;
}

// What the app falls back to when the chosen note value does not fit.
export const DEN_NV = { 1: 'whole', 2: 'half', 4: 'quarter', 8: '8th', 16: '16th', 32: '32nd' };
export function ppbEffective(num, den, nv) {
  return ppb(num, den, nv) ?? ppb(num, den, DEN_NV[den] || 'quarter') ?? Math.max(1, num);
}

export const barSeconds = (num, den, nv, bpm) => ppbEffective(num, den, nv) * (60 / bpm);

// x poly notes span y main pulses, so a bar of P pulses ideally holds P*x/y notes
// spaced y/x pulses apart.
export const polyIdeal = (P, x, y) => P * x / y;
export const polySpacingPulses = (x, y) => y / x;

export const nearestIntError = v => Math.abs(v - Math.round(v));
