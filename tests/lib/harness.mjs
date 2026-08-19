// Minimal assertion harness. Failures are recorded, never thrown away, and
// never softened. Every check carries the arithmetic that justifies it.

export class Suite {
  constructor(area) { this.area = area; this.pass = 0; this.fails = []; this.n = 0; }

  ok(cond, name, detail) {
    this.n++;
    if (cond) { this.pass++; return true; }
    this.fails.push({ area: this.area, name, detail });
    return false;
  }

  eq(actual, expected, name, detail) {
    return this.ok(Object.is(actual, expected) || actual === expected, name,
      `expected ${fmt(expected)}, got ${fmt(actual)}${detail ? ' | ' + detail : ''}`);
  }

  near(actual, expected, tol, name, detail) {
    const d = Math.abs(actual - expected);
    return this.ok(Number.isFinite(d) && d <= tol, name,
      `expected ${fmt(expected)} +/- ${tol}, got ${fmt(actual)} (delta ${fmt(d)})${detail ? ' | ' + detail : ''}`);
  }
}

export function fmt(v) {
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 'NaN';
    if (!Number.isFinite(v)) return String(v);
    return Number.isInteger(v) ? String(v) : v.toPrecision(10).replace(/0+$/, '');
  }
  return JSON.stringify(v);
}

export function report(suites) {
  let n = 0, p = 0, f = 0;
  for (const s of suites) { n += s.n; p += s.pass; f += s.fails.length; }
  return { n, p, f };
}
