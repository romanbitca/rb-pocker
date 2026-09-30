import { describe, expect, it } from 'vitest';
import {
  dealCount,
  equity,
  equityPlan,
  equitySeed,
  equitySteps,
  EXACT_LIMIT,
  finalTrials,
  PROGRESS_MARKS,
  runoutCost,
  runoutEquity,
  runoutSeed,
  runoutSteps,
} from '../../src/analysis/equity.ts';
import type { EquityResult } from '../../src/analysis/types.ts';
import { parseCards, type Card } from '../../src/core/cards.ts';
import { deriveSeed, ZERO_SEED } from '../../src/core/rng.ts';
import { score7 } from '../../src/eval/evaluate.ts';
import { testSeed } from '../helpers/seed.ts';

const H = (s: string): Card[] => parseCards(s);
const pct = (x: number): number => x * 100;

/** "To 0.01 points": the oracle tables print two decimals, so the true error is at most 0.005. */
function close(actual: number, expected: number, tol: number, label: string): void {
  expect(
    Math.abs(actual - expected),
    `${label}: got ${actual}, want ${expected}`,
  ).toBeLessThanOrEqual(tol);
}
const EXACT_TOL = 0.01 + 1e-9;

// ── Appendix C.2: heads-up preflop, exact over all boards (known hands) ──────────────────────

// hero, villain, win, tie, lose, equity (all in %)
const C2: [string, string, number, number, number, number][] = [
  ['As Ah', 'Ks Kh', 82.36, 0.54, 17.09, 82.64],
  ['As Ah', 'Kc Kd', 81.06, 0.38, 18.55, 81.26],
  ['2c 2d', 'As Kh', 52.75, 0.58, 46.67, 53.04],
  ['Qh Qd', 'As Ks', 53.59, 0.39, 46.02, 53.79],
  ['Qc Qd', 'As Kh', 56.99, 0.34, 42.66, 57.16],
  ['As Kh', 'Ad Qc', 71.72, 4.59, 23.69, 74.02],
  ['Ah Kh', 'Js Ts', 61.02, 0.48, 38.5, 61.26],
  ['7c 2d', 'As Ah', 12.4, 0.36, 87.24, 12.58],
];

describe('Appendix C.2: exact heads-up preflop equity (1,712,304 boards each)', () => {
  it.each(C2)('%s vs %s', { timeout: 60_000 }, (hero, villain, win, tie, lose, eq) => {
    const [h, v] = runoutEquity({ hands: [H(hero), H(villain)], board: [] }, { mode: 'exact' });
    const label = `${hero} vs ${villain}`;
    expect(h?.n).toBe(1_712_304);
    expect(h?.exact && h.final).toBe(true);
    close(pct(h?.win ?? NaN), win, EXACT_TOL, `${label} win`);
    close(pct(2 * (h?.split ?? NaN)), tie, EXACT_TOL, `${label} tie`);
    close(pct(v?.win ?? NaN), lose, EXACT_TOL, `${label} lose`);
    close(pct(h?.equity ?? NaN), eq, EXACT_TOL, `${label} equity`);
    expect(h?.equity).toBe((h?.win ?? NaN) + (h?.split ?? NaN)); // equity = win + split always
  });

  // "All suit combinations": every combination is worth the same, and the evaluator is symmetric
  // in the suits, so one representative per suit-permutation class (with its weight) is enough.
  const PERMS: number[][] = [];
  const permute = (rest: number[], acc: number[]): void => {
    if (rest.length === 0) PERMS.push(acc);
    else
      rest.forEach((x, i) =>
        permute(
          rest.filter((_, j) => j !== i),
          [...acc, x],
        ),
      );
  };
  permute([0, 1, 2, 3], []);
  const canonical = (hands: Card[][]): string =>
    PERMS.map((p) =>
      hands
        .map((h) =>
          h
            .map((c) => (c >> 2) * 4 + (p[c & 3] as number))
            .sort((a, b) => a - b)
            .join(','),
        )
        .join('/'),
    )
      .sort()
      .at(0) as string;
  const pairsOf = (cards: Card[]): Card[][] =>
    cards.flatMap((a, i) => cards.slice(i + 1).map((b) => [a, b]));
  function averaged(as: Card[][], bs: Card[][]): { win: number; tie: number; eq: number } {
    const groups = new Map<string, { hands: Card[][]; weight: number }>();
    for (const a of as) {
      for (const b of bs) {
        const key = canonical([a, b]);
        const g = groups.get(key);
        if (g) g.weight++;
        else groups.set(key, { hands: [a, b], weight: 1 });
      }
    }
    let total = 0;
    let win = 0;
    let tie = 0;
    let eq = 0;
    for (const { hands, weight } of groups.values()) {
      const [r] = runoutEquity({ hands, board: [] }, { mode: 'exact' });
      total += weight;
      win += weight * pct(r?.win ?? NaN);
      tie += weight * pct(2 * (r?.split ?? NaN));
      eq += weight * pct(r?.equity ?? NaN);
    }
    return { win: win / total, tie: tie / total, eq: eq / total };
  }

  it(
    'AA vs KK, all suit combinations: 81.71 / 0.46 / 17.82, equity 81.95',
    { timeout: 60_000 },
    () => {
      const r = averaged(pairsOf([48, 49, 50, 51]), pairsOf([44, 45, 46, 47]));
      close(r.win, 81.71, EXACT_TOL, 'win');
      close(r.tie, 0.46, EXACT_TOL, 'tie');
      close(100 - r.win - r.tie, 17.82, EXACT_TOL, 'lose');
      close(r.eq, 81.95, EXACT_TOL, 'equity');
    },
  );

  it(
    '22 vs AKo, all suit combinations: 52.34 / 0.62 / 47.04, equity 52.65',
    { timeout: 60_000 },
    () => {
      const akOff: Card[][] = [];
      for (let a = 0; a < 4; a++)
        for (let k = 0; k < 4; k++) if (a !== k) akOff.push([48 + a, 44 + k]);
      const r = averaged(pairsOf([0, 1, 2, 3]), akOff);
      close(r.win, 52.34, EXACT_TOL, 'win');
      close(r.tie, 0.62, EXACT_TOL, 'tie');
      close(100 - r.win - r.tie, 47.04, EXACT_TOL, 'lose');
      close(r.eq, 52.65, EXACT_TOL, 'equity');
    },
  );
});

// ── Appendix C.3: three-way and postflop ─────────────────────────────────────────────────────

describe('Appendix C.3: exact three-way and postflop equity', () => {
  const THREE: [string[], number[]][] = [
    [
      ['As Ah', 'Ks Kh', 'Qs Qh'],
      [67.67, 17.23, 15.1],
    ],
    [
      ['Ac Kd', 'Qs Qh', 'Jd Tc'],
      [39.25, 47.19, 13.56],
    ],
  ];
  it.each(THREE)('3-way %j', { timeout: 60_000 }, (hands, expected) => {
    const rs = runoutEquity({ hands: hands.map(H), board: [] }, { mode: 'exact' });
    expect(rs.map((r) => r.n)).toEqual([1_370_754, 1_370_754, 1_370_754]);
    rs.forEach((r, i) => close(pct(r.equity), expected[i] as number, EXACT_TOL, `player ${i}`));
    expect(rs.reduce((s, r) => s + r.equity, 0)).toBeCloseTo(1, 9);
  });

  // hero, board, equity, win, tie (the flop has 1,070,190 deals: Monte Carlo in the app, so exact
  // is forced here)
  const POST: [string, string, number, number | null, number | null][] = [
    ['Ah Kh', 'Qh 7h 2c', 72.68, 72.32, 0.72],
    ['Ah Kh', 'Qh 7h 2c 3d', 59.73, null, null],
    ['Ah Kh', 'Qh 7h 2c 3d 5s', 36.41, null, null],
    ['9s 8s', '7d 6c 2h', 49.5, null, null],
  ];
  it.each(POST)('%s on %s vs 1 random hand', (hero, board, eq, win, tie) => {
    const r = equity({ hero: H(hero), board: H(board), nOpp: 1 }, { mode: 'exact' });
    expect(r.exact && r.final && !r.truncated).toBe(true);
    close(pct(r.equity), eq, EXACT_TOL, 'equity');
    if (win !== null) close(pct(r.win), win, EXACT_TOL, 'win');
    if (tie !== null) close(pct(2 * r.split), tie, EXACT_TOL, 'tie');
  });

  it('turn and river are exact by default, with the §7.2 sizes', () => {
    const turn = equity({ hero: H('Ah Kh'), board: H('Qh 7h 2c 3d'), nOpp: 1 });
    const river = equity({ hero: H('Ah Kh'), board: H('Qh 7h 2c 3d 5s'), nOpp: 1 });
    expect([turn.n, turn.exact]).toEqual([45_540, true]);
    expect([river.n, river.exact]).toEqual([990, true]);
    const two = equity({ hero: H('Ah Kh'), board: H('Qh 7h 2c 3d 5s'), nOpp: 2 });
    expect([two.n, two.exact]).toEqual([446_985, true]);
  });

  it('two opponents on the river equals an independent enumeration of all opponent sets', () => {
    const hero = H('Ah Kh');
    const board = H('Qh 7h 2c 3d 5s');
    const rest: Card[] = [];
    for (let c = 0; c < 52; c++) if (![...hero, ...board].includes(c)) rest.push(c);
    const hs = score7([...hero, ...board], 7);
    let deals = 0;
    let wins = 0;
    let share = 0;
    const s = (a: Card, b: Card): number => score7([a, b, ...board], 7);
    // every 4 cards can be split into two hands in 3 ways: each unordered set of two hands once
    for (let w = 0; w < rest.length; w++)
      for (let x = w + 1; x < rest.length; x++)
        for (let y = x + 1; y < rest.length; y++)
          for (let z = y + 1; z < rest.length; z++) {
            const [a, b, c, d] = [rest[w], rest[x], rest[y], rest[z]] as [Card, Card, Card, Card];
            for (const [s1, s2] of [
              [s(a, b), s(c, d)],
              [s(a, c), s(b, d)],
              [s(a, d), s(b, c)],
            ] as [number, number][]) {
              deals++;
              const best = Math.max(s1, s2);
              if (hs > best) wins++;
              else if (hs === best)
                share += 1 / (1 + (s1 === best ? 1 : 0) + (s2 === best ? 1 : 0));
            }
          }
    const r = equity({ hero, board, nOpp: 2 });
    expect(r.n).toBe(deals);
    expect(r.win).toBeCloseTo(wins / deals, 12);
    expect(r.split).toBeCloseTo(share / deals, 12);
  });

  it('a k-way tie is worth 1/k (the board is a royal flush: everyone ties)', () => {
    const board = H('As Ks Qs Js Ts');
    for (const nOpp of [1, 2]) {
      const r = equity({ hero: H('2c 3d'), board, nOpp });
      expect(r.win).toBe(0);
      expect(r.split).toBeCloseTo(1 / (nOpp + 1), 12);
      expect(r.equity).toBeCloseTo(1 / (nOpp + 1), 12);
    }
    // three opponents on the river is Monte Carlo: every trial is a 4-way tie
    const mc = equity({ hero: H('2c 3d'), board, nOpp: 3 });
    expect([mc.exact, mc.win, mc.split, mc.equity]).toEqual([false, 0, 0.25, 0.25]);
  });
});

// ── Monte Carlo (PLAN §7.7) ──────────────────────────────────────────────────────────────────

describe('Monte Carlo', () => {
  const seed = (fixed: string): string => testSeed(fixed);

  it(
    '200,000 trials are within ±0.4 points of the exact postflop values',
    { timeout: 60_000 },
    () => {
      const spots: [string, string, number][] = [
        ['Ah Kh', 'Qh 7h 2c', 72.68],
        ['Ah Kh', 'Qh 7h 2c 3d', 59.73],
        ['Ah Kh', 'Qh 7h 2c 3d 5s', 36.41],
        ['9s 8s', '7d 6c 2h', 49.5],
      ];
      for (const [hero, board, exact] of spots) {
        const r = equity(
          { hero: H(hero), board: H(board), nOpp: 1 },
          { mode: 'montecarlo', trials: 200_000, seed: seed('0123456789abcdef0123456789abcdef') },
        );
        expect([r.n, r.exact, r.final]).toEqual([200_000, false, true]);
        close(pct(r.equity), exact, 0.4, `${hero} on ${board}`);
      }
    },
  );

  // Appendix C.3, equity vs N random hands (2M-trial Monte Carlo); test tolerance ±0.5
  const TABLE: [string, number[]][] = [
    ['As Ah', [85.24, 73.48, 63.9, 55.86, 49.24, 43.6, 38.7, 34.63]],
    ['Kh Kd', [82.35, 68.84, 58.19, 49.76, 42.97, 37.46, 32.83, 29.17]],
    ['As Kh', [65.32, 48.26, 38.55, 32.3, 27.87, 24.37, 21.58, 19.23]],
    ['2c 2d', [50.28, 30.63, 21.91, 17.72, 15.49, 14.15, 13.2, 12.51]],
    ['7c 2d', [34.58, 20.46, 14.25, 10.76, 8.61, 7.2, 6.17, 5.39]],
  ];
  it.each(TABLE)(
    '%s against 1 to 8 random hands, preflop',
    { timeout: 120_000 },
    (hero, expected) => {
      expected.forEach((want, i) => {
        const r = equity(
          { hero: H(hero), board: [], nOpp: i + 1 },
          { trials: 200_000, seed: seed('fedcba9876543210fedcba9876543210') },
        );
        close(pct(r.equity), want, 0.5, `${hero} vs ${i + 1}`);
      });
    },
  );

  it('A♥K♥ against 1 random hand: 67.04', { timeout: 60_000 }, () => {
    const r = equity({ hero: H('Ah Kh'), board: [], nOpp: 1 }, { trials: 200_000 });
    close(pct(r.equity), 67.04, 0.5, 'AhKh vs 1');
  });

  it('the default schedule: n = 40,000 for 1-3 opponents, 20,000 for 4-8, marks 2,500 and 10,000', () => {
    expect([1, 2, 3].map(finalTrials)).toEqual([40_000, 40_000, 40_000]);
    expect([4, 5, 8].map(finalTrials)).toEqual([20_000, 20_000, 20_000]);
    for (const [nOpp, total] of [
      [2, 40_000],
      [6, 20_000],
    ] as const) {
      const results: EquityResult[] = [];
      for (const step of equitySteps({ hero: H('As Kh'), board: [], nOpp })) {
        if (step !== null) results.push(step);
      }
      expect(results.map((r) => r.n)).toEqual([...PROGRESS_MARKS, total]);
      expect(results.map((r) => r.final)).toEqual([false, false, true]);
      expect(results.every((r) => !r.exact && !r.truncated)).toBe(true);
    }
  });

  it('progress values are close to the final value (4 sigma)', () => {
    const results: EquityResult[] = [];
    for (const step of equitySteps({ hero: H('Ah Kh'), board: H('Qh 7h 2c'), nOpp: 1 })) {
      if (step !== null) results.push(step);
    }
    for (const r of results) {
      expect(Math.abs(r.equity - 0.7268)).toBeLessThan((4 * 0.5) / Math.sqrt(r.n));
    }
  });

  it('the method and n never depend on the device: no timer, same steps every time', () => {
    const req = { hero: H('Ts 9s'), board: H('8s 7h 2d'), nOpp: 5 };
    const a = [...equitySteps(req)];
    const b = [...equitySteps(req)];
    expect(a.length).toBeGreaterThan(3);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ── Determinism, plan and shape ─────────────────────────────────────────────────────────────

describe('same request, same bits', () => {
  it('two calls return bit-identical results, in exact and Monte Carlo mode', () => {
    const reqs = [
      { hero: H('Ah Kh'), board: H('Qh 7h 2c'), nOpp: 3 },
      { hero: H('Ah Kh'), board: H('Qh 7h 2c 3d'), nOpp: 1 },
      { hero: H('Ah Kh'), board: H('Qh 7h 2c 3d 5s'), nOpp: 2 },
      { hero: H('7c 2d'), board: [], nOpp: 8 },
    ];
    for (const req of reqs) {
      const a = equity(req);
      const b = equity(req);
      for (const key of ['n', 'win', 'split', 'equity'] as const)
        expect(Object.is(a[key], b[key])).toBe(true);
      expect(a).toEqual(b);
      expect(a.equity).toBe(a.win + a.split);
    }
  });

  it('the order of the cards does not matter: the same situation shows the same number', () => {
    const a = equity({ hero: H('Ah Kh'), board: H('Qh 7h 2c'), nOpp: 3 });
    const b = equity({ hero: H('Kh Ah'), board: H('2c Qh 7h'), nOpp: 3 });
    expect(b).toEqual(a);
  });

  it('the seed is deriveSeed(ZERO_SEED, "eq|" + hero + "|" + board + "|" + nOpp), cards as text', () => {
    expect(equitySeed(H('Kh Ah'), H('2c Qh 7h'), 3)).toBe(
      deriveSeed(ZERO_SEED, 'eq|AhKh|Qh7h2c|3'),
    );
    expect(equitySeed(H('Ah Kh'), [], 8)).toBe(deriveSeed(ZERO_SEED, 'eq|AhKh||8'));
    expect(runoutSeed([H('Ks Kh'), H('As Ah')], [])).toBe(runoutSeed([H('Ah As'), H('Kh Ks')], []));
    expect(equitySeed(H('Ah Kh'), [], 3)).not.toBe(equitySeed(H('Ah Kh'), [], 4));
  });

  it('a different seed gives a different estimate (the seed is really used)', () => {
    const req = { hero: H('Ah Kh'), board: [], nOpp: 2 };
    const a = equity(req);
    const b = equity(req, { seed: '0123456789abcdef0123456789abcdef' });
    expect(b.equity).not.toBe(a.equity);
  });
});

describe('method by situation (PLAN §7.2)', () => {
  it('deal counts', () => {
    expect(dealCount(4, 1)).toBe(45_540);
    expect(dealCount(5, 1)).toBe(990);
    expect(dealCount(5, 2)).toBe(446_985);
    expect(dealCount(3, 1)).toBe(1_070_190);
    expect(dealCount(5, 3)).toBeGreaterThan(EXACT_LIMIT);
    expect(runoutCost(2, 3)).toBe(990 * 2); // flop: 990 boards
    expect(runoutCost(2, 4)).toBe(44 * 2); // turn: 44 boards
  });

  it('exact within 500,000 deals, Monte Carlo above, whatever the device', () => {
    expect(equityPlan(5, 1)).toEqual({ exact: true, n: 990 });
    expect(equityPlan(4, 1)).toEqual({ exact: true, n: 45_540 });
    expect(equityPlan(5, 2)).toEqual({ exact: true, n: 446_985 });
    expect(equityPlan(3, 1)).toEqual({ exact: false, n: 40_000 });
    expect(equityPlan(4, 2)).toEqual({ exact: false, n: 40_000 });
    expect(equityPlan(5, 3)).toEqual({ exact: false, n: 40_000 });
    expect(equityPlan(0, 1)).toEqual({ exact: false, n: 40_000 });
    expect(equityPlan(0, 7)).toEqual({ exact: false, n: 20_000 });
  });

  it('run-outs with known hands: exact on the flop (990 boards) and turn (44), 20,000 trials preflop', () => {
    const flop = runoutEquity({ hands: [H('As Ah'), H('Ks Kh')], board: H('2c 7d 9h') });
    expect(flop.map((r) => [r.n, r.exact])).toEqual([
      [990, true],
      [990, true],
    ]);
    const turn = runoutEquity({ hands: [H('As Ah'), H('Ks Kh')], board: H('2c 7d 9h Kd') });
    expect(turn.map((r) => r.n)).toEqual([44, 44]);
    const pre = runoutEquity({ hands: [H('As Ah'), H('Ks Kh')], board: [] });
    expect(pre.map((r) => [r.n, r.exact, r.final])).toEqual([
      [20_000, false, true],
      [20_000, false, true],
    ]);
    close(pct(pre[0]?.equity ?? NaN), 82.64, 1.5, 'AA vs KK, 20,000 trials');
  });

  it('run-out equities of all players add up to 1 (exact and Monte Carlo)', () => {
    const cases: [string[], string, boolean][] = [
      [['As Ah', 'Ks Kh', 'Qs Qh'], '', true], // Monte Carlo (preflop, three players)
      [['As Kh', 'Qd Qc', 'Jd Tc', '9s 9h'], '2c 7d 9d', false],
      [['As Kh', 'Qd Qc'], '2c 7d 9d Ts', false],
    ];
    for (const [hands, board, mc] of cases) {
      const rs = runoutEquity({ hands: hands.map(H), board: H(board) });
      expect(rs.every((r) => r.exact === !mc)).toBe(true);
      expect(Math.abs(rs.reduce((s, r) => s + r.equity, 0) - 1)).toBeLessThan(1e-9);
      for (const r of rs) expect(r.equity).toBe(r.win + r.split);
    }
  });
});

describe('the generator shape (for the equity worker)', () => {
  it('Monte Carlo: null checkpoints between the marks, results at 2,500, 10,000 and the end', () => {
    const steps = [...equitySteps({ hero: H('As Ah'), board: [], nOpp: 2 })];
    expect(steps.length).toBe(21); // 2,000, 2,500, 4,000 ... 38,000 and 40,000 (10,000 is a mark)
    expect(steps.filter((s) => s === null).length).toBe(18);
    expect(steps.at(-1)?.final).toBe(true);
  });

  it('exact: the last step is the exact final result; earlier steps are null checkpoints', () => {
    const steps = [...equitySteps({ hero: H('Ah Kh'), board: H('Qh 7h 2c 3d 5s'), nOpp: 2 })];
    expect(steps.slice(0, -1).every((s) => s === null)).toBe(true);
    expect(steps.length).toBeGreaterThan(5); // 446,985 deals: a checkpoint every ~20,000
    const last = steps.at(-1);
    expect([last?.exact, last?.final, last?.truncated]).toEqual([true, true, false]);
    expect(steps.filter((s) => s !== null).length).toBe(1);
  });

  it('stopping the iteration cancels the job: nothing more is computed or posted', () => {
    const gen = equitySteps({ hero: H('As Ah'), board: [], nOpp: 2 });
    let first: EquityResult | null = null;
    while (first === null) {
      const step = gen.next();
      expect(step.done).toBe(false);
      first = (step.value as EquityResult | null) ?? null;
    }
    expect(first.n).toBe(2_500);
    expect(gen.return()).toEqual({ done: true, value: undefined });
    expect(gen.next()).toEqual({ done: true, value: undefined });
  });

  it('runoutSteps has the same shape', () => {
    const steps = [...runoutSteps({ hands: [H('As Ah'), H('Ks Kh')], board: [] })];
    const results = steps.filter((s) => s !== null);
    expect(results.map((r) => r[0]?.n)).toEqual([2_500, 10_000, 20_000]);
    expect(results.at(-1)?.every((r) => r.final)).toBe(true);
  });
});

describe('bad requests are refused at once', () => {
  it('throws RangeError', () => {
    const ok = { hero: H('Ah Kh'), board: H('Qh 7h 2c'), nOpp: 2 };
    expect(() => equitySteps({ ...ok, nOpp: 0 })).toThrow(RangeError);
    expect(() => equitySteps({ ...ok, nOpp: 9 })).toThrow(RangeError);
    expect(() => equitySteps({ ...ok, nOpp: 1.5 })).toThrow(RangeError);
    expect(() => equitySteps({ ...ok, hero: H('Ah') })).toThrow(RangeError);
    expect(() => equitySteps({ ...ok, hero: H('Ah Qh') })).toThrow(RangeError); // Qh is on the board
    expect(() => equitySteps({ ...ok, board: H('Qh 7h') })).toThrow(RangeError);
    expect(() => equitySteps({ ...ok, hero: [1, 99] })).toThrow(RangeError);
    expect(() => equitySteps(ok, { mode: 'montecarlo', trials: 0 })).toThrow(RangeError);
    expect(() => runoutSteps({ hands: [H('Ah Kh')], board: [] })).toThrow(RangeError);
    expect(() => runoutSteps({ hands: [H('Ah Kh'), H('Ah Qh')], board: [] })).toThrow(RangeError);
    expect(() =>
      runoutSteps(
        { hands: [H('Ah Kh'), H('Qs Qh')], board: [] },
        { mode: 'montecarlo', trials: 1.5 },
      ),
    ).toThrow(RangeError);
  });
});
