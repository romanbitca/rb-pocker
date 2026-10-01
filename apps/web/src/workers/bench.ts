/**
 * The `#bench` measurements of `equity.worker` (PLAN §15.4, §7.7), run inside the worker so the
 * numbers are what the game gets on this device:
 *
 * - Evaluator speed: `score7` over 5,000,000 random seven-card hands. The hands come from a
 *   seeded pool of 250,000 (1.75 MB) dealt before the clock starts, each copied into a seven-card
 *   buffer as the equity code does; one untimed pass over the pool warms the JIT first.
 * - Time to the final HUD win chance for three fixed spots (A♥K♥ against 8 opponents before the
 *   flop, the same on Q♥ 7♥ 2♣, and against 1 opponent on that flop), through a job runner of its
 *   own (`createEquityService`, with the game's 8 ms time slices and `setTimeout(0)` pauses), so the
 *   pauses the game pays are counted too. One warm-up run, then the median of three.
 *
 * The bench never changes a result: every job is the seeded, fixed-n computation of §7.3.
 */
import { parseCards, type Card } from '../core/cards.ts';
import { deriveSeed, randInt, rngFromSeed, ZERO_SEED } from '../core/rng.ts';
import { score7 } from '../eval/evaluate.ts';
import { createEquityService, type EquityMath } from './equityService.ts';
import type { EquityBenchResult, EquityReply } from './protocol.ts';

/** §15.4: evaluations timed. */
export const BENCH_EVALS = 5_000_000;
/** Distinct random hands the timed loop cycles through. */
export const BENCH_POOL = 250_000;
/** Timed runs of each equity spot (after one warm-up run); the median is reported. */
export const BENCH_RUNS = 3;

/** The three §15.4 spots. */
export const BENCH_SPOTS = {
  eq8PreflopMs: { hero: 'Ah Kh', board: '', nOpp: 8 },
  eq8FlopMs: { hero: 'Ah Kh', board: 'Qh 7h 2c', nOpp: 8 },
  eq1FlopMs: { hero: 'Ah Kh', board: 'Qh 7h 2c', nOpp: 1 },
} as const;

export interface BenchOptions {
  /** Evaluations timed (default 5,000,000). */
  evals?: number;
  /** Size of the hand pool (default 250,000). */
  pool?: number;
  /** Timed runs per equity spot (default 3). */
  runs?: number;
  /** The clock (default `performance.now`). */
  now?: () => number;
}

// Module-local reference: a hot loop calls it (see the note in analysis/equity.ts).
const score = score7;

/** `pool` random seven-card hands, seeded (the same hands on every device). */
export function handPool(pool: number): Uint8Array {
  const rng = rngFromSeed(deriveSeed(ZERO_SEED, 'bench-hands'));
  const deck = Array.from({ length: 52 }, (_, c) => c);
  const out = new Uint8Array(pool * 7);
  for (let h = 0, o = 0; h < pool; h++, o += 7) {
    // A partial Fisher–Yates: the first seven places get seven different random cards.
    for (let i = 0; i < 7; i++) {
      const j = i + randInt(rng, 52 - i);
      const card = deck[j] as number;
      deck[j] = deck[i] as number;
      deck[i] = card;
      out[o + i] = card;
    }
  }
  return out;
}

/** Evaluations per second: `evals` evaluations cycling through `pool` hands (see the header). */
export function evaluatorSpeed(
  evals: number,
  pool: Uint8Array,
  now: () => number,
): { evalsPerSec: number; checksum: number } {
  const hands = pool.length / 7;
  const buf = new Uint8Array(7);
  const pass = (count: number): number => {
    let acc = 0;
    for (let k = 0, o = 0; k < count; k++, o += 7) {
      if (o === pool.length) o = 0;
      buf[0] = pool[o] as number;
      buf[1] = pool[o + 1] as number;
      buf[2] = pool[o + 2] as number;
      buf[3] = pool[o + 3] as number;
      buf[4] = pool[o + 4] as number;
      buf[5] = pool[o + 5] as number;
      buf[6] = pool[o + 6] as number;
      acc = (acc + score(buf, 7)) | 0;
    }
    return acc;
  };
  pass(hands); // warm-up (JIT)
  const t = now();
  const checksum = pass(evals);
  const ms = Math.max(now() - t, 1e-3);
  return { evalsPerSec: Math.round((evals / ms) * 1000), checksum };
}

/**
 * Ms from the request to the final HUD win chance of one spot, through a job runner of its own
 * (the game's slices and pauses).
 */
export function timeToFinal(
  math: EquityMath,
  hero: readonly Card[],
  board: readonly Card[],
  nOpp: number,
  now: () => number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const started = now();
    const service = createEquityService({
      math,
      now,
      post: (reply: EquityReply) => {
        if (reply.kind === 'error') reject(new Error(reply.message));
        else if (reply.kind === 'equity' && reply.result.final) resolve(now() - started);
      },
    });
    service.handle({
      kind: 'equity',
      jobId: 1,
      epoch: 0,
      hero: [hero[0] as Card, hero[1] as Card],
      board: [...board],
      nOpp,
    });
  });
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

const round1 = (ms: number): number => Math.round(ms * 10) / 10;

/** One spot: a warm-up run, then the median of `runs`. */
async function spotMs(
  math: EquityMath,
  spot: { hero: string; board: string; nOpp: number },
  runs: number,
  now: () => number,
): Promise<number> {
  const hero = parseCards(spot.hero);
  const board = parseCards(spot.board);
  await timeToFinal(math, hero, board, spot.nOpp, now);
  const times: number[] = [];
  for (let i = 0; i < runs; i++) times.push(await timeToFinal(math, hero, board, spot.nOpp, now));
  return round1(median(times));
}

/** Everything the `bench` reply carries (§15.4). */
export async function runBench(
  math: EquityMath,
  options: BenchOptions = {},
): Promise<EquityBenchResult> {
  const now = options.now ?? ((): number => performance.now());
  const runs = options.runs ?? BENCH_RUNS;
  const pool = handPool(options.pool ?? BENCH_POOL);
  const { evalsPerSec } = evaluatorSpeed(options.evals ?? BENCH_EVALS, pool, now);
  const eq8PreflopMs = await spotMs(math, BENCH_SPOTS.eq8PreflopMs, runs, now);
  const eq8FlopMs = await spotMs(math, BENCH_SPOTS.eq8FlopMs, runs, now);
  const eq1FlopMs = await spotMs(math, BENCH_SPOTS.eq1FlopMs, runs, now);
  const ua = typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent;
  return { evalsPerSec, eq8PreflopMs, eq8FlopMs, eq1FlopMs, ua };
}
