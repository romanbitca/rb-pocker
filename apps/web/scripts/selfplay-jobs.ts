/**
 * The work of headless self-play (PLAN §9.7, `scripts/selfplay.ts`): whole hands played by the
 * real engine (`startHand`, `step`, `nextTable`) and the real brain (`observe` → `decide` / `hint`)
 * in Node, no workers of the game, no UI. A job plays a run of hands at one table and returns the
 * tallies of every profile that sat there; `selfplay.ts` (`runSelfPlay`) deals the jobs to
 * `worker_threads` and adds the tallies up. This module imports nothing from Node, so tests under
 * the game's own TypeScript settings can use it too.
 *
 * A job is a pure function of its fields (every seed derives from the run's seed and the job's
 * index), so the tallies never depend on the thread count or the finishing order. Only the decision
 * times vary from run to run.
 *
 * Seats, as the game seats them (§9.3): seat i plays `lineup[i mod lineup.length]`, a personality
 * at the run's level (`profileFor`), the coach (`hint`, the HUD number computed as the game does
 * when it has none) or a scripted baseline (`scripts/bots/`). The engine's seat 0 is the hero's
 * slot; here it is played like any other seat. Every bot seat's personality label is visible at
 * Easy and Medium (§9.2), as at a real table; the coach and the baselines show none.
 *
 * Decision seeds are the controller's (§2.4, `app/controller.ts` `botSeed`): from the table seed
 * only, never from the hand seed (§9.6 3b).
 *
 * Stacks (`stacks`):
 * - `reset` (calibration): every hand starts with every seat at the starting stack (100 bb by
 *   default, the game's default 2,000 chips at 10/20), so the numbers are those of full stacks;
 * - `carry`: stacks carry over from hand to hand as in the game, and a seat that busts buys in
 *   again at the starting stack with the same profile;
 * - `random` (legality): every hand at a new random table (blinds from 1/2 to 500/1,000, stacks from
 *   one chip to 500 bb, some seats empty), as the engine's random-play harness draws them.
 *
 * What is counted (`updateSeatStats`, §9.5's definitions, so the game's own seat statistics and
 * these numbers agree): VPIP, PFR, 3-bet, c-bet and WTSD as [done, opportunities]; AF from the
 * postflop bets and raises against calls, with the per-hand moments its standard error needs; the
 * net result in big blinds (bb/100). An illegal action is one the engine refuses (`EngineError`
 * from `step`); the runner counts it and plays the §4.5 safe action instead (check, else fold), as
 * the controller would. An `InvariantError` ends that hand and is counted; so is a hand that does
 * not finish within `MAX_INPUTS` inputs.
 */
import { decide, hint, kindOf } from '../src/brain/decide.ts';
import { updateSeatStats } from '../src/brain/opponentStats.ts';
import { profileFor } from '../src/brain/profiles.ts';
import type { BrainProfile } from '../src/brain/types.ts';
import { EngineError, InvariantError } from '../src/core/assert.ts';
import {
  deriveSeed,
  randInt,
  rngFromSeed,
  seedFromWords,
  type Rng,
  type Seed128,
} from '../src/core/rng.ts';
import { checkInvariants } from '../src/engine/invariants.ts';
import { observe } from '../src/engine/observe.ts';
import { startHand } from '../src/engine/start.ts';
import { step } from '../src/engine/step.ts';
import { createTable, nextTable } from '../src/engine/table.ts';
import {
  PERSONALITY_IDS,
  type BotLevel,
  type HandState,
  type LegalActions,
  type ObserveExtras,
  type Observation,
  type PersonalityId,
  type PlayerAction,
  type PlayerSlot,
  type SeatStats,
  type TableConfig,
  type TableState,
} from '../src/engine/types.ts';
import { callAlwaysAction } from './bots/callAlways.ts';
import { potBettorAction } from './bots/potBettor.ts';
import { raiseAlwaysAction } from './bots/raiseAlways.ts';
import { simpleBotAction } from './bots/simple.ts';

// ── Seats ──────────────────────────────────────────────────────────────────────────────────────

/** The scripted baselines of `scripts/bots/` (§0.1, §9.7). */
export const BASELINES = ['simple', 'raiseAlways', 'callAlways', 'potBettor'] as const;
export type Baseline = (typeof BASELINES)[number];

/** Who plays a seat: a personality (at the run's level), the coach, or a baseline. */
export type SeatSpec = PersonalityId | 'coach' | Baseline;

export const SEAT_SPECS: readonly SeatSpec[] = [...PERSONALITY_IDS, 'coach', ...BASELINES];

/** The level of the personality seats: one of the four, or Easy/Medium drawn per seat. */
export type RunLevel = BotLevel | 'mixed';

export type StackMode = 'reset' | 'carry' | 'random';

/** §9.3's Medium list: it holds all five personalities in its first six entries. */
export const DEFAULT_LINEUP: readonly SeatSpec[] = [
  'tag',
  'station',
  'lag',
  'rock',
  'station',
  'maniac',
  'tag',
  'station',
];

const BASELINE_ACTIONS: Readonly<Record<Baseline, (obs: Observation) => PlayerAction>> = {
  simple: simpleBotAction,
  raiseAlways: raiseAlwaysAction,
  callAlways: callAlwaysAction,
  potBettor: potBettorAction,
};

const isPersonality = (s: SeatSpec): s is PersonalityId =>
  PERSONALITY_IDS.includes(s as PersonalityId);

/**
 * §2.4, the controller's `botSeed`: `deriveSeed(deriveSeed(tableSeed, 'bots'), 'bot', handSeq,
 * seat, log.length)`. Copied rather than imported (the controller module pulls in the store); a
 * test keeps the two equal.
 */
export function botSeed(tableSeed: Seed128, handSeq: number, seat: number, logLength: number) {
  return deriveSeed(deriveSeed(tableSeed, 'bots'), 'bot', handSeq, seat, logLength);
}

/** One seat's player for a table: its tally key, its timing class and how it acts. */
interface Player {
  /** The tally key: "tag/medium", "coach", "potBettor"… */
  key: string;
  /** Decision-time class: the bot level ("medium"), "coach" or "scripted". */
  timing: string;
  /** Shown to the other seats (§9.2: personality labels at Easy and Medium). */
  label: PersonalityId | null;
  level: BotLevel;
  act(obs: Observation, seed: Seed128): { action: PlayerAction; kind: string };
}

function playerFor(spec: SeatSpec, level: BotLevel): Player {
  if (isPersonality(spec)) {
    const profile: BrainProfile = profileFor(spec, level);
    return {
      key: profile.id,
      timing: level,
      label: level === 'easy' || level === 'medium' ? spec : null,
      level,
      act: (obs, seed) => {
        const d = decide(obs, profile, seed);
        return { action: d.action, kind: d.kind };
      },
    };
  }
  if (spec === 'coach') {
    return {
      key: 'coach',
      timing: 'coach',
      label: null,
      level,
      act: (obs) => {
        const d = hint(obs, null);
        return { action: d.action, kind: d.kind };
      },
    };
  }
  const fn = BASELINE_ACTIONS[spec];
  return {
    key: spec,
    timing: 'scripted',
    label: null,
    level,
    act: (obs) => {
      const action = fn(obs);
      return { action, kind: kindOf(obs.legal, action) };
    },
  };
}

// ── Jobs and tallies ───────────────────────────────────────────────────────────────────────────

export interface SelfPlayJob {
  /** The run's root seed; the job's own seeds derive from it and `index`. */
  readonly seed: Seed128;
  readonly index: number;
  readonly hands: number;
  /** Global number of the job's first hand (`random` rotates table sizes per hand with it). */
  readonly firstHand: number;
  /** Table sizes; a `reset`/`carry` job plays `seatCounts[index mod length]` seats. */
  readonly seatCounts: readonly number[];
  readonly lineup: readonly SeatSpec[];
  readonly level: RunLevel;
  readonly stacks: StackMode;
  /** Blinds and starting stack (chips) of `reset` and `carry` tables. */
  readonly bb: number;
  readonly startingStack: number;
}

/** [done, opportunities]. */
export type Count = [number, number];

/** Sums for a ratio `A / P` of per-hand counts and its standard error. */
export interface RatioMoments {
  n: number;
  a: number;
  p: number;
  aa: number;
  pp: number;
  ap: number;
}

/** Sums for a mean of per-hand values and its standard error. */
export interface MeanMoments {
  n: number;
  sum: number;
  sumSq: number;
}

/** Everything counted for one profile (summed over its seats, hands and jobs). */
export interface ProfileTally {
  /** Seat-hands dealt in. */
  hands: number;
  vpip: Count;
  pfr: Count;
  threeBet: Count;
  cbet: Count;
  wtsd: Count;
  /** Postflop bets and raises (a) against calls (p), per seat-hand. */
  af: RatioMoments;
  /** Net result per seat-hand in big blinds. */
  net: MeanMoments;
  decisions: number;
  /** Decisions by `Decision.kind` (fold, check, call, bet, raise, allin). */
  kinds: Record<string, number>;
}

export interface Problem {
  job: number;
  hand: number;
  detail: string;
}

export interface JobResult {
  hands: number;
  profiles: Record<string, ProfileTally>;
  illegal: number;
  invariant: number;
  unfinished: number;
  /** The first few problems of each kind, to reproduce them. */
  problems: Problem[];
  /** Decision times in ms by timing class ("medium", "easy", "coach", "scripted"). */
  times: Record<string, number[]>;
}

/** A hand that needs more inputs than this does not finish (a two-raiser war takes ~200). */
export const MAX_INPUTS = 2_000;
/** Problems kept per job. */
const MAX_PROBLEMS = 5;

export function emptyTally(): ProfileTally {
  return {
    hands: 0,
    vpip: [0, 0],
    pfr: [0, 0],
    threeBet: [0, 0],
    cbet: [0, 0],
    wtsd: [0, 0],
    af: { n: 0, a: 0, p: 0, aa: 0, pp: 0, ap: 0 },
    net: { n: 0, sum: 0, sumSq: 0 },
    decisions: 0,
    kinds: {},
  };
}

const addCount = (c: Count, d: Count): void => {
  c[0] += d[0];
  c[1] += d[1];
};

/** Adds one seat-hand (its stats for that hand alone, and its net in big blinds). */
function addHand(t: ProfileTally, s: SeatStats, netBB: number): void {
  t.hands++;
  addCount(t.vpip, s.vpip);
  addCount(t.pfr, s.pfr);
  addCount(t.threeBet, s.threeBet);
  addCount(t.cbet, s.cbet);
  addCount(t.wtsd, s.wtsd);
  const a = s.aggActions;
  const p = s.passiveActions;
  t.af.n++;
  t.af.a += a;
  t.af.p += p;
  t.af.aa += a * a;
  t.af.pp += p * p;
  t.af.ap += a * p;
  t.net.n++;
  t.net.sum += netBB;
  t.net.sumSq += netBB * netBB;
}

/** `into += from`, field by field. */
export function mergeTally(into: ProfileTally, from: ProfileTally): void {
  into.hands += from.hands;
  addCount(into.vpip, from.vpip);
  addCount(into.pfr, from.pfr);
  addCount(into.threeBet, from.threeBet);
  addCount(into.cbet, from.cbet);
  addCount(into.wtsd, from.wtsd);
  for (const k of ['n', 'a', 'p', 'aa', 'pp', 'ap'] as const) into.af[k] += from.af[k];
  for (const k of ['n', 'sum', 'sumSq'] as const) into.net[k] += from.net[k];
  into.decisions += from.decisions;
  for (const [kind, n] of Object.entries(from.kinds)) {
    into.kinds[kind] = (into.kinds[kind] ?? 0) + n;
  }
}

// ── Tables ─────────────────────────────────────────────────────────────────────────────────────

/** The engine's slots: the hero's slot is seat 0; a bot slot needs some personality. */
function slotsFor(stacks: readonly number[], lineup: readonly SeatSpec[]): PlayerSlot[] {
  return stacks.map((stack, seat) => {
    if (seat === 0) {
      return { playerId: 'hero', name: 'Seat 0', kind: 'hero', personality: null, stack };
    }
    const spec = lineup[seat % lineup.length] as SeatSpec;
    return {
      playerId: `bot-${seat}`,
      name: `Seat ${seat}`,
      kind: 'bot',
      personality: isPersonality(spec) ? spec : 'tag',
      stack,
    };
  });
}

function configFor(seatCount: number, bb: number, startingStack: number, level: BotLevel) {
  const cfg: TableConfig = {
    seatCount,
    sb: bb / 2,
    bb,
    startingStack,
    botLevel: level,
    seatLevels: new Array<BotLevel | null>(seatCount).fill(null),
  };
  return cfg;
}

const BIG_BLINDS = [2, 10, 20, 100, 1000] as const;

/**
 * A random stack, as the engine's random-play harness draws them: 1 in 12 empty (not dealt in),
 * 2 in 12 tiny (one chip to one big blind), 3 in 12 short (up to 20 bb), 6 in 12 up to 500 bb.
 */
function randomStack(rng: Rng, bb: number): number {
  const kind = randInt(rng, 12);
  if (kind === 0) return 0;
  if (kind <= 2) return 1 + randInt(rng, bb);
  if (kind <= 5) return 1 + randInt(rng, 20 * bb);
  return 1 + randInt(rng, 500 * bb);
}

function randomTable(seatCount: number, rng: Rng, lineup: readonly SeatSpec[], level: BotLevel) {
  const bb = BIG_BLINDS[randInt(rng, BIG_BLINDS.length)] as number;
  const stacks = Array.from({ length: seatCount }, () => randomStack(rng, bb));
  if (stacks.filter((s) => s > 0).length < 2) {
    stacks[0] = stacks[0] === 0 ? 100 * bb : (stacks[0] as number);
    stacks[1] = stacks[1] === 0 ? 3 * bb : (stacks[1] as number);
  }
  const startingStack = Math.min(1_000_000, Math.max(200, 100 * bb));
  const tableSeed = seedOf(rng);
  return createTable(
    configFor(seatCount, bb, startingStack, level),
    slotsFor(stacks, lineup),
    tableSeed,
  );
}

const seedOf = (rng: Rng): Seed128 => seedFromWords(rng.next(), rng.next(), rng.next(), rng.next());

/** The level of each seat of a table (`mixed`: Easy or Medium per seat, drawn from `rng`). */
function seatLevels(level: RunLevel, seatCount: number, rng: Rng): BotLevel[] {
  if (level !== 'mixed') return new Array<BotLevel>(seatCount).fill(level);
  return Array.from({ length: seatCount }, () => (randInt(rng, 2) === 0 ? 'easy' : 'medium'));
}

/** The players of a table and what `observe` adds for them (labels, levels, seat statistics). */
function seatPlayers(lineup: readonly SeatSpec[], levels: readonly BotLevel[]): Player[] {
  return levels.map((level, seat) => playerFor(lineup[seat % lineup.length] as SeatSpec, level));
}

/** §4.5: the safest legal action, check if legal, else fold. */
const safeAction = (legal: LegalActions): PlayerAction =>
  legal.canCheck ? { type: 'check' } : { type: 'fold' };

// ── One job ────────────────────────────────────────────────────────────────────────────────────

/** Plays the job's hands and returns its tallies. Pure but for the decision times. */
export function runJob(job: SelfPlayJob): JobResult {
  const jobSeed = deriveSeed(job.seed, 'job', job.index);
  const rng = rngFromSeed(jobSeed);
  const result: JobResult = {
    hands: 0,
    profiles: {},
    illegal: 0,
    invariant: 0,
    unfinished: 0,
    problems: [],
    times: {},
  };
  const note = (hand: number, detail: string): void => {
    if (result.problems.length < MAX_PROBLEMS)
      result.problems.push({ job: job.index, hand, detail });
  };

  const fixedSeats = job.seatCounts[job.index % job.seatCounts.length] as number;
  let table: TableState | null = null;
  let players: Player[] = [];
  let stats: (SeatStats | null)[] = [];
  if (job.stacks !== 'random') {
    const levels = seatLevels(job.level, fixedSeats, rng);
    players = seatPlayers(job.lineup, levels);
    stats = new Array<SeatStats | null>(fixedSeats).fill(null);
    const stacks = new Array<number>(fixedSeats).fill(job.startingStack);
    table = createTable(
      configFor(fixedSeats, job.bb, job.startingStack, levels[1] ?? 'medium'),
      slotsFor(stacks, job.lineup),
      deriveSeed(jobSeed, 'table'),
    );
  }

  for (let i = 0; i < job.hands; i++) {
    if (job.stacks === 'random') {
      const n = job.seatCounts[(job.firstHand + i) % job.seatCounts.length] as number;
      const levels = seatLevels(job.level, n, rng);
      players = seatPlayers(job.lineup, levels);
      stats = new Array<SeatStats | null>(n).fill(null);
      table = randomTable(n, rng, job.lineup, levels[1] ?? 'medium');
    }
    const t = table as TableState;
    const extras: ObserveExtras = {
      seatStats: stats,
      visiblePersonality: players.map((p) => p.label),
      seatLevels: players.map((p) => p.level),
    };
    const done = playHand(t, deriveSeed(jobSeed, 'hand', i), players, extras, result, (detail) =>
      note(i, detail),
    );
    result.hands++;
    if (done === null) continue;

    // Tallies and the table's seat statistics (§9.5: updated at hand end).
    const bb = done.bb;
    done.seats.forEach((seat, s) => {
      if (!seat.dealtIn) return;
      const own = updateSeatStats(null, done.log, s);
      const player = players[s] as Player;
      const tally = (result.profiles[player.key] ??= emptyTally());
      addHand(tally, own, ((done.result?.net[s] ?? 0) as number) / bb);
      stats[s] = updateSeatStats(stats[s] ?? null, done.log, s);
    });

    if (job.stacks !== 'random') table = nextHandTable(t, done, job);
  }
  return result;
}

/**
 * The table for the next hand: `nextTable` (button, blinds, counters), then every seat back to
 * its lineup (a busted bot is not replaced by the next personality of the list) and its stack:
 * the starting stack (`reset`), or the final stack with a bust buying in again (`carry`).
 */
function nextHandTable(table: TableState, done: HandState, job: SelfPlayJob): TableState {
  const next = nextTable(table, done);
  const fresh = slotsFor(
    done.seats.map((seat) =>
      job.stacks === 'reset' || seat.stack === 0 ? job.startingStack : seat.stack,
    ),
    job.lineup,
  );
  return { ...next, slots: fresh };
}

/**
 * Plays one hand to the end. Returns the finished hand, or null when it broke an invariant or did
 * not finish (counted in `result`).
 */
function playHand(
  table: TableState,
  handSeed: Seed128,
  players: readonly Player[],
  extras: ObserveExtras,
  result: JobResult,
  note: (detail: string) => void,
): HandState | null {
  let h: HandState;
  try {
    h = startHand(table, handSeed);
    for (let inputs = 0; h.phase !== 'complete'; inputs++) {
      if (inputs >= MAX_INPUTS) {
        result.unfinished++;
        note(`unfinished: no end after ${MAX_INPUTS} inputs (hand seed ${handSeed})`);
        return null;
      }
      if (h.phase !== 'betting') {
        h = step(h, { kind: 'advance' });
        continue;
      }
      const seat = h.toAct as number;
      const player = players[seat] as Player;
      const obs = observe(h, seat, extras);
      const seed = botSeed(table.tableSeed, h.handSeq, seat, h.log.length);
      const t0 = performance.now();
      const { action, kind } = player.act(obs, seed);
      const ms = performance.now() - t0;
      (result.times[player.timing] ??= []).push(ms);
      const tally = (result.profiles[player.key] ??= emptyTally());
      tally.decisions++;
      tally.kinds[kind] = (tally.kinds[kind] ?? 0) + 1;
      try {
        h = step(h, { kind: 'act', seat, action });
      } catch (error) {
        if (!(error instanceof EngineError)) throw error;
        result.illegal++;
        note(
          `illegal: ${player.key} at seat ${seat} played ${JSON.stringify(action)} with ` +
            `${JSON.stringify(obs.legal)} on ${obs.street} (${error.code}: ${error.message}; ` +
            `hand seed ${handSeed})`,
        );
        h = step(h, { kind: 'act', seat, action: safeAction(obs.legal) });
      }
    }
    checkInvariants(h, { replayLog: true });
    return h;
  } catch (error) {
    if (!(error instanceof InvariantError)) throw error;
    result.invariant++;
    note(`invariant: ${error.message} (hand seed ${handSeed})`);
    return null;
  }
}

// ── A run ──────────────────────────────────────────────────────────────────────────────────────

export interface RunSpec {
  seed: Seed128;
  hands: number;
  seatCounts: readonly number[];
  lineup: readonly SeatSpec[];
  level: RunLevel;
  stacks: StackMode;
  bb: number;
  startingStack: number;
  /** Hands per job (the unit of work handed to a thread). */
  jobHands: number;
  threads: number;
}

/** The jobs of a run: `hands` split into jobs of `jobHands`, the last one shorter. */
export function jobsOf(spec: RunSpec): SelfPlayJob[] {
  const jobs: SelfPlayJob[] = [];
  for (let first = 0, index = 0; first < spec.hands; first += spec.jobHands, index++) {
    jobs.push({
      seed: spec.seed,
      index,
      hands: Math.min(spec.jobHands, spec.hands - first),
      firstHand: first,
      seatCounts: spec.seatCounts,
      lineup: spec.lineup,
      level: spec.level,
      stacks: spec.stacks,
      bb: spec.bb,
      startingStack: spec.startingStack,
    });
  }
  return jobs;
}

/** The sum of job results (the first few problems, in job order). */
export function mergeResults(results: readonly JobResult[]): JobResult {
  const total: JobResult = {
    hands: 0,
    profiles: {},
    illegal: 0,
    invariant: 0,
    unfinished: 0,
    problems: [],
    times: {},
  };
  for (const r of results) {
    total.hands += r.hands;
    total.illegal += r.illegal;
    total.invariant += r.invariant;
    total.unfinished += r.unfinished;
    total.problems.push(...r.problems);
    for (const [key, tally] of Object.entries(r.profiles)) {
      mergeTally((total.profiles[key] ??= emptyTally()), tally);
    }
    for (const [cls, times] of Object.entries(r.times)) {
      const into = (total.times[cls] ??= []);
      for (const t of times) into.push(t);
    }
  }
  total.problems = total.problems.slice(0, 2 * MAX_PROBLEMS);
  return total;
}
