/**
 * Headless self-play (PLAN §9.7, `scripts/selfplay.ts`, `selfplay-jobs.ts`) and the scripted
 * baselines (`scripts/bots/`). The CI-sized smoke plays 500 Medium hands 6-handed on two threads:
 * no illegal action, no invariant violation, every hand finished, every personality counted. The
 * full runs (20,000 hands per level for the §9.7 calibration, 100,000 hands over 2–9 seats for
 * legality) are the weekly `slow` workflow's `selfplay` jobs.
 */
import { describe, expect, it } from 'vitest';
import { deriveSeed, ZERO_SEED } from '../../src/core/rng.ts';
import { observe } from '../../src/engine/observe.ts';
import { startHand } from '../../src/engine/start.ts';
import { step } from '../../src/engine/step.ts';
import type {
  EngineInput,
  HandState,
  ObserveExtras,
  Observation,
  PlayerAction,
} from '../../src/engine/types.ts';
import { callAlwaysAction } from '../../scripts/bots/callAlways.ts';
import { potBettorAction } from '../../scripts/bots/potBettor.ts';
import { raiseAlwaysAction } from '../../scripts/bots/raiseAlways.ts';
import {
  DEFAULT_LINEUP,
  jobsOf,
  mergeResults,
  runJob,
  type JobResult,
  type ProfileTally,
  type RunSpec,
  type SelfPlayJob,
} from '../../scripts/selfplay-jobs.ts';
import {
  calibrationGates,
  formatReport,
  legalityGates,
  mean,
  parseOptions,
  parseSeatCounts,
  profileRows,
  proportion,
  quantile,
  ratio,
  runSelfPlay,
  seedFromText,
  selfPlay,
  speedGates,
  timeRows,
  type ProfileRow,
} from '../../scripts/selfplay.ts';
import { tableWith } from '../engine/helpers.ts';

const SEED = deriveSeed(ZERO_SEED, 'selfplay-test');

const spec = (over: Partial<RunSpec> = {}): RunSpec => ({
  seed: SEED,
  hands: 40,
  seatCounts: [6],
  lineup: DEFAULT_LINEUP,
  level: 'medium',
  stacks: 'reset',
  bb: 20,
  startingStack: 2000,
  jobHands: 20,
  threads: 1,
  ...over,
});

/** The tallies without the decision times (which vary from run to run). */
const tallies = (r: JobResult) => ({
  hands: r.hands,
  illegal: r.illegal,
  invariant: r.invariant,
  unfinished: r.unfinished,
  profiles: r.profiles,
  decisions: Object.fromEntries(Object.entries(r.times).map(([k, t]) => [k, t.length])),
});

describe('self-play smoke (CI-sized; the full runs are weekly)', () => {
  it(
    '500 Medium hands 6-handed on two threads: no illegal action, every personality counted',
    { timeout: 120_000 },
    async () => {
      const report = await selfPlay({
        ...parseOptions(['--hands', '500', '--threads', '2', '--seed', 'smoke', '--quiet']),
      });
      expect(report.hands).toBe(500);
      expect(report.gates.every((g) => g.pass)).toBe(true);
      expect(report.gates.map((g) => g.name)).toEqual([
        'illegal actions',
        'invariant violations',
        'unfinished hands',
      ]);
      const keys = report.profiles.map((r) => r.key);
      expect(keys).toEqual([
        'lag/medium',
        'maniac/medium',
        'rock/medium',
        'station/medium',
        'tag/medium',
      ]);
      for (const row of report.profiles) {
        // Two stations sit at the table, one of each other personality: every seat every hand.
        expect(row.hands).toBe(row.key === 'station/medium' ? 1000 : 500);
        expect(row.decisions).toBeGreaterThan(row.hands);
        expect(row.vpip.value).toBeGreaterThan(0);
        expect(row.vpip.value).toBeLessThan(1);
        expect(row.pfr.value).toBeLessThanOrEqual(row.vpip.value);
        expect(row.af.value).toBeGreaterThan(0);
        expect(row.target).not.toBeNull();
      }
      const medium = report.times.find((t) => t.cls === 'medium');
      expect(medium?.n).toBe(report.profiles.reduce((n, r) => n + r.decisions, 0));
      const text = formatReport(report);
      expect(text).toContain('PASS  illegal actions: 0');
      expect(text).toMatch(/tag\/medium +500 /);
    },
  );

  it(
    'the tallies are a pure function of the seed: the same on one thread or two',
    {
      timeout: 60_000,
    },
    async () => {
      const one = await runSelfPlay(spec({ threads: 1 }));
      const two = await runSelfPlay(spec({ threads: 2 }));
      expect(tallies(two)).toEqual(tallies(one));
      const other = await runSelfPlay(spec({ seed: deriveSeed(SEED, 'other'), threads: 1 }));
      expect(tallies(other)).not.toEqual(tallies(one));
    },
  );

  it(
    'every table size, random stacks and blinds, Easy and Medium, the coach and the baselines: always legal',
    { timeout: 120_000 },
    () => {
      const lineup = [
        'coach',
        'raiseAlways',
        'tag',
        'callAlways',
        'maniac',
        'potBettor',
        'simple',
        'rock',
        'station',
      ] as const;
      const r = mergeResults(
        jobsOf(
          spec({
            hands: 160,
            jobHands: 80,
            seatCounts: [2, 3, 4, 5, 6, 7, 8, 9],
            lineup: [...lineup],
            level: 'mixed',
            stacks: 'random',
          }),
        ).map(runJob),
      );
      expect(r.hands).toBe(160);
      expect(r.problems).toEqual([]);
      expect([r.illegal, r.invariant, r.unfinished]).toEqual([0, 0, 0]);
      for (const key of ['coach', 'raiseAlways', 'callAlways', 'potBettor', 'simple']) {
        expect(r.profiles[key]?.decisions ?? 0).toBeGreaterThan(20);
      }
      const levels = new Set(Object.keys(r.profiles).map((k) => k.split('/')[1]));
      expect(levels).toEqual(new Set([undefined, 'easy', 'medium']));
      expect(Object.keys(r.times).sort()).toEqual(['coach', 'easy', 'medium', 'scripted']);
    },
  );

  it(
    'carry: stacks carry over and a bust buys in again, with the same lineup',
    {
      timeout: 30_000,
    },
    () => {
      const [job] = jobsOf(spec({ stacks: 'carry', hands: 60, jobHands: 60 }));
      const r = runJob(job as SelfPlayJob);
      expect([r.hands, r.illegal, r.invariant, r.unfinished]).toEqual([60, 0, 0, 0]);
      const seatHands = Object.values(r.profiles).reduce((n, t) => n + t.hands, 0);
      expect(seatHands).toBe(6 * 60);
    },
  );
});

describe('seeds', () => {
  it('--seed: 32 hex as it is, a number or a word through deriveSeed', () => {
    expect(seedFromText(SEED)).toBe(SEED);
    expect(seedFromText('1')).toBe(deriveSeed(ZERO_SEED, 'selfplay', 1));
    expect(seedFromText('1')).not.toBe(seedFromText('2'));
    expect(seedFromText('weekly')).toBe(deriveSeed(ZERO_SEED, 'selfplay|weekly'));
  });
});

describe('statistics', () => {
  it('a proportion with its Wilson 95% half-width', () => {
    const p = proportion([50, 100]);
    expect(p.value).toBe(0.5);
    expect(p.half).toBeCloseTo(0.09617, 4);
    expect(proportion([0, 0]).value).toBeNaN();
    // Large n: the normal approximation.
    expect(proportion([2200, 10000]).half).toBeCloseTo(1.96 * Math.sqrt((0.22 * 0.78) / 10000), 4);
  });

  it('AF = ΣA / ΣP with the delta-method interval over seat-hands', () => {
    // Per-hand (bets + raises, calls): the ratio of totals and its standard error by hand.
    const hands: [number, number][] = [
      [2, 1],
      [0, 1],
      [3, 0],
      [1, 2],
      [0, 0],
      [2, 1],
    ];
    const m = { n: 0, a: 0, p: 0, aa: 0, pp: 0, ap: 0 };
    for (const [a, p] of hands) {
      m.n++;
      m.a += a;
      m.p += p;
      m.aa += a * a;
      m.pp += p * p;
      m.ap += a * p;
    }
    const r = ratio(m);
    expect(r.value).toBeCloseTo(8 / 5, 12);
    const ss = hands.reduce((s, [a, p]) => s + (a - 1.6 * p) ** 2, 0);
    expect(r.half).toBeCloseTo((1.959964 * Math.sqrt((6 / 5) * ss)) / 5, 10);
    expect(ratio({ n: 3, a: 2, p: 0, aa: 4, pp: 0, ap: 0 }).value).toBeNaN();
  });

  it('a mean with its normal interval, and nearest-rank quantiles', () => {
    const xs = [1, 2, 3, 4, 5];
    const m = mean({ n: 5, sum: 15, sumSq: xs.reduce((s, x) => s + x * x, 0) });
    expect(m.value).toBe(3);
    expect(m.half).toBeCloseTo(1.959964 * Math.sqrt(2.5 / 5), 10);
    expect(quantile([5, 1, 4, 2, 3], 0.5)).toBe(3);
    expect(
      quantile(
        Array.from({ length: 100 }, (_, i) => i + 1),
        0.95,
      ),
    ).toBe(95);
    expect(quantile([], 0.95)).toBeNaN();
  });
});

describe('gates', () => {
  const tally = (vpip: number, pfr: number, agg: number, calls: number): ProfileTally => ({
    hands: 1000,
    vpip: [Math.round(vpip * 1000), 1000],
    pfr: [Math.round(pfr * 1000), 1000],
    threeBet: [0, 0],
    cbet: [0, 0],
    wtsd: [0, 0],
    af: { n: 1000, a: agg, p: calls, aa: agg, pp: calls, ap: 0 },
    net: { n: 1000, sum: 0, sumSq: 0 },
    decisions: 2000,
    kinds: {},
  });
  const result = (profiles: Record<string, ProfileTally>): JobResult => ({
    hands: 1000,
    profiles,
    illegal: 0,
    invariant: 0,
    unfinished: 0,
    problems: [],
    times: { medium: [1, 2, 3, 120], coach: [500] },
  });
  const verdicts = (rows: readonly ProfileRow[]) =>
    Object.fromEntries(calibrationGates(rows).map((g) => [g.name, g.pass]));

  it('§9.7: VPIP and PFR within ±4 points (Easy VPIP ±8), AF within ±0.7', () => {
    const rows = profileRows(
      result({
        'tag/medium': tally(0.26, 0.14, 318, 100), // +4, −4, +0.68: on the edge, passes
        'rock/medium': tally(0.165, 0.09, 150, 100), // VPIP +4.5: fails
        'lag/easy': tally(0.39, 0.31, 421, 100), // VPIP +7 at Easy passes; PFR +5 fails; AF +0.71 fails
        coach: tally(0.2, 0.18, 300, 100), // no target: no gate
      }),
    );
    expect(verdicts(rows)).toEqual({
      'lag/easy VPIP': true,
      'lag/easy PFR': false,
      'lag/easy AF': false,
      'rock/medium VPIP': false,
      'rock/medium PFR': true,
      'rock/medium AF': true,
      'tag/medium VPIP': true,
      'tag/medium PFR': true,
      'tag/medium AF': true,
    });
    expect(rows.find((r) => r.key === 'coach')?.target).toBeNull();
  });

  it('legality: any illegal action, invariant violation or unfinished hand fails', () => {
    const ok = result({});
    expect(legalityGates(ok).every((g) => g.pass)).toBe(true);
    for (const field of ['illegal', 'invariant', 'unfinished'] as const) {
      expect(legalityGates({ ...ok, [field]: 1 }).some((g) => !g.pass)).toBe(true);
    }
  });

  it('speed: the p95 of each bot level against the budget (the coach is only reported)', () => {
    const times = timeRows(result({}));
    expect(times.map((t) => [t.cls, t.n, t.p50, t.p95])).toEqual([
      ['coach', 1, 500, 500],
      ['medium', 4, 2, 120],
    ]);
    expect(speedGates(times, 100)).toEqual([
      { name: 'medium decision p95', pass: false, detail: '120.0 ms (budget 100 ms)' },
    ]);
    expect(speedGates(times, 150).every((g) => g.pass)).toBe(true);
  });
});

describe('options', () => {
  it('defaults: Medium, 6 players, 20,000 hands, seed 1, the §9.3 Medium lineup, 100 bb at 10/20', () => {
    const o = parseOptions([]);
    expect(o).toMatchObject({
      level: 'medium',
      seatCounts: [6],
      hands: 20000,
      seed: seedFromText('1'),
      stacks: 'reset',
      bb: 20,
      startingStack: 2000,
      jobHands: 250,
      calibrate: false,
      maxP95: null,
    });
    expect(o.lineup).toEqual([
      'tag',
      'station',
      'lag',
      'rock',
      'station',
      'maniac',
      'tag',
      'station',
    ]);
  });

  it('table sizes, lineups and levels are checked', () => {
    expect(parseSeatCounts('2-9')).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(parseSeatCounts('3,6')).toEqual([3, 6]);
    expect(() => parseSeatCounts('1-4')).toThrow(RangeError);
    expect(() => parseSeatCounts('10')).toThrow(RangeError);
    expect(parseOptions(['--lineup', 'coach,potBettor']).lineup).toEqual(['coach', 'potBettor']);
    expect(() => parseOptions(['--lineup', 'tag,shark'])).toThrow(/unknown player "shark"/);
    expect(() => parseOptions(['--level', 'pro'])).toThrow(RangeError);
    expect(() => parseOptions(['--stacks', 'deep'])).toThrow(RangeError);
    expect(() => parseOptions(['--bb', '15'])).toThrow(RangeError);
    expect(parseOptions(['--calibrate', '--max-p95', '100'])).toMatchObject({
      calibrate: true,
      maxP95: 100,
    });
  });

  it('jobs split the hands; the last job is shorter', () => {
    const jobs = jobsOf(spec({ hands: 45, jobHands: 20 }));
    expect(jobs.map((j) => [j.index, j.firstHand, j.hands])).toEqual([
      [0, 0, 20],
      [1, 20, 20],
      [2, 40, 5],
    ]);
  });
});

// ── The scripted baselines (§9.7) ──────────────────────────────────────────────────────────────

const EXTRAS: ObserveExtras = {
  seatStats: new Array(6).fill(null),
  visiblePersonality: new Array(6).fill(null),
  seatLevels: new Array(6).fill('medium'),
};

/** A 6-max hand at 50/100 with 10,000 each, button on seat 0 (UTG is seat 3), after `inputs`. */
function spot(inputs: readonly EngineInput[]): { h: HandState; obs: Observation } {
  let h = startHand(tableWith(new Array(6).fill(10_000), { button: 0 }), SEED);
  for (const input of inputs) h = step(h, input);
  return { h, obs: observe(h, h.toAct as number, EXTRAS) };
}
const act = (seat: number, action: PlayerAction): EngineInput => ({ kind: 'act', seat, action });
const ADVANCE: EngineInput = { kind: 'advance' };

describe('scripted baselines', () => {
  it('first to act before the flop: min-raise, call, pot-size raise (to 350 at 50/100)', () => {
    const { obs } = spot([]);
    expect(obs.seat).toBe(3);
    expect(raiseAlwaysAction(obs)).toEqual({ type: 'raise', to: 200 });
    expect(callAlwaysAction(obs)).toEqual({ type: 'call' });
    expect(potBettorAction(obs)).toEqual({ type: 'raise', to: 350 });
  });

  it('facing a raise: raise again (min), call, call', () => {
    const { obs } = spot([act(3, { type: 'raise', to: 300 })]);
    expect(raiseAlwaysAction(obs)).toEqual({ type: 'raise', to: 500 });
    expect(callAlwaysAction(obs)).toEqual({ type: 'call' });
    expect(potBettorAction(obs)).toEqual({ type: 'call' });
  });

  it('after the flop, checked to: min bet, check, pot-size bet; facing a bet: min-raise, call, call', () => {
    const preflop = [
      act(3, { type: 'call' }),
      act(4, { type: 'fold' }),
      act(5, { type: 'fold' }),
      act(0, { type: 'fold' }),
      act(1, { type: 'call' }),
      act(2, { type: 'check' }),
      ADVANCE,
    ];
    const { obs } = spot(preflop);
    expect([obs.street, obs.seat, obs.pot]).toEqual(['flop', 1, 300]);
    expect(raiseAlwaysAction(obs)).toEqual({ type: 'bet', to: 100 });
    expect(callAlwaysAction(obs)).toEqual({ type: 'check' });
    expect(potBettorAction(obs)).toEqual({ type: 'bet', to: 300 });
    const facing = spot([...preflop, act(1, { type: 'bet', to: 150 })]).obs;
    expect(raiseAlwaysAction(facing)).toEqual({ type: 'raise', to: 300 });
    expect(callAlwaysAction(facing)).toEqual({ type: 'call' });
    expect(potBettorAction(facing)).toEqual({ type: 'call' });
  });

  it('a pot-size bet is clamped to the stack: all-in', () => {
    const { obs, h } = spot([]);
    const short = observe(
      { ...h, seats: h.seats.map((s, i) => (i === 3 ? { ...s, stack: 250 } : s)) },
      3,
      EXTRAS,
    );
    expect(obs.legal.raise?.max).toBe(10_000);
    expect(potBettorAction(short)).toEqual({ type: 'raise', to: short.legal.raise?.max });
  });
});
