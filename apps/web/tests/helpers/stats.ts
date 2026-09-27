/**
 * Chi-square helpers for the statistical tests (PLAN "Testing strategy": fixed seeds, p > 0.001).
 * The p-value is the regularized upper incomplete gamma function Q(df/2, x/2), computed with the
 * series / continued-fraction pair from Numerical Recipes and a Lanczos log-gamma.
 */

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

export function lnGamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  const w = z - 1;
  let x = LANCZOS[0] as number;
  for (let i = 1; i < LANCZOS.length; i++) x += (LANCZOS[i] as number) / (w + i);
  const t = w + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (w + 0.5) * Math.log(t) - t + Math.log(x);
}

const EPS = 1e-15;
const MAX_ITER = 100_000;

/** Regularized lower incomplete gamma P(a, x) by its series (good for x < a + 1). */
function gammaPSeries(a: number, x: number): number {
  let ap = a;
  let del = 1 / a;
  let sum = del;
  for (let n = 0; n < MAX_ITER; n++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
}

/** Regularized upper incomplete gamma Q(a, x) by Lentz's continued fraction (x ≥ a + 1). */
function gammaQFraction(a: number, x: number): number {
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < MAX_ITER; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

export function gammaQ(a: number, x: number): number {
  if (!(a > 0) || !(x >= 0)) throw new RangeError(`gammaQ(${a}, ${x})`);
  if (x === 0) return 1;
  return x < a + 1 ? 1 - gammaPSeries(a, x) : gammaQFraction(a, x);
}

/** P(X ≥ stat) for X ~ chi-square(df). */
export function chiSquarePValue(stat: number, df: number): number {
  return gammaQ(df / 2, stat / 2);
}

/** Pearson's statistic for observed counts against one common expected count. */
export function chiSquareStat(observed: ArrayLike<number>, expected: number): number {
  let stat = 0;
  for (let i = 0; i < observed.length; i++) {
    const diff = (observed[i] as number) - expected;
    stat += (diff * diff) / expected;
  }
  return stat;
}

/** Significance threshold used by every statistical test (PLAN "Testing strategy" → Rules). */
export const P_MIN = 0.001;
