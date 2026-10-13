/**
 * Headless self-play (PLAN §9.7): bot calibration, legality and speed, with the real engine and
 * brain in Node (`selfplay-jobs.ts` plays the hands; `runSelfPlay` deals its jobs to
 * `worker_threads`, `selfplay-worker.ts`). From apps/web
 * `node scripts/selfplay.ts …`, at the root `npm run selfplay -- …`:
 *
 *   npm run selfplay -- --level medium --players 6 --hands 20000 --seed 1 --calibrate
 *   npm run selfplay -- --level easy --players 6 --hands 20000 --seed 1 --calibrate
 *   npm run selfplay -- --level mixed --players 2-9 --stacks random --hands 100000 --seed 1
 *   npm run selfplay -- --level hard --lineup potBettor,tag,lag,rock,tag,lag --loses potBettor
 *   npm run selfplay -- --lineup tag@medium,tag@expert,lag@medium,lag@expert,rock@medium,rock@expert \
 *     --wins expert
 *
 * It prints, per profile (a personality at its level, the coach, a scripted baseline): VPIP, PFR,
 * AF, WTSD, 3-bet and c-bet with 95% confidence intervals, bb/100 with its interval, decisions;
 * then the illegal actions, invariant violations and unfinished hands, and the decision times
 * (p50, p95, max) per class, and each side's result: the seats of one level, the coach, a baseline
 * (bb/100 per seat with its interval). Exit code 1 when a gate fails: always an illegal action, an
 * invariant violation or a hand that does not finish; with `--calibrate` a personality off its §9.1
 * target (VPIP and PFR within ±4 points, Easy's VPIP within ±8, AF within ±0.7; `--calibrate-stats
 * vpip,pfr` checks only those, as Stage 7 acceptance 2 asks at Hard); with
 * `--max-p95 <ms>` a bot level whose decision p95 is above it; with `--wins <sides>` or
 * `--loses <sides>` a side whose bb/100 interval is not wholly above (below) 0 (§9.7 win rates).
 *
 * Intervals: VPIP, PFR, WTSD, 3-bet and c-bet are proportions over the seat-hands that had the
 * chance (Wilson score interval); AF is a ratio of per-hand counts (delta-method standard error
 * over seat-hands); bb/100 a mean over seat-hands. Each seat-hand counts as one sample; a side's
 * bb/100 is a mean over hands of its seats' mean result (one sample per hand).
 *
 * Options: `--level` easy|medium|hard|expert|mixed (default medium; mixed = Easy or Medium per
 * seat), `--players` 6 | 2-9 | 3,6,9 (table sizes, default 6), `--hands` (default 20,000),
 * `--seed` (a number, a word or 32 hex characters; default 1), `--lineup` (who sits in seats 0, 1,
 * …, cycled: personalities, `coach`, `simple`, `raiseAlways`, `callAlways`, `potBettor`, or a
 * personality at a level of its own, `tag@expert`; default the §9.3 Medium list, which holds all
 * five personalities in its first six seats), `--stacks` reset|carry|random (default reset), `--bb`
 * (default 20) and `--stack-bb` (default 100: the game's default 2,000 chips at 10/20), `--threads`
 * (default one per core), `--job-hands` (default 250), `--calibrate`, `--calibrate-stats` (default
 * vpip,pfr,af), `--max-p95 <ms>`, `--wins <sides>` and `--loses <sides>` (comma-separated: a level,
 * `coach` or a baseline), `--json <file>` (the summary as JSON), `--quiet`.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PERSONALITIES } from '../src/brain/tunables.ts';
import { deriveSeed, isSeed128, ZERO_SEED, type Seed128 } from '../src/core/rng.ts';
import { BOT_LEVELS, PERSONALITY_IDS, type PersonalityId } from '../src/engine/types.ts';
import { defaultThreads, runPool } from './pool.ts';
import {
  DEFAULT_LINEUP,
  isLineupEntry,
  jobsOf,
  mergeResults,
  runJob,
  SEAT_SPECS,
  type Count,
  type JobResult,
  type MeanMoments,
  type LineupEntry,
  type ProfileTally,
  type RatioMoments,
  type RunLevel,
  type RunSpec,
  type StackMode,
} from './selfplay-jobs.ts';

// ── A run ──────────────────────────────────────────────────────────────────────────────────────

const WORKER = fileURLToPath(new URL('./selfplay-worker.ts', import.meta.url));

/**
 * Plays a run on `spec.threads` threads (one thread: here) and returns the summed result. The
 * tallies do not depend on the thread count (each job is a pure function of its seed).
 */
export async function runSelfPlay(
  spec: RunSpec,
  onDone?: (jobsDone: number, jobs: number) => void,
): Promise<JobResult> {
  const jobs = jobsOf(spec);
  const results = await runPool(WORKER, runJob, jobs, spec.threads, (done) =>
    onDone?.(done, jobs.length),
  );
  return mergeResults(results);
}

// ── Statistics ─────────────────────────────────────────────────────────────────────────────────

/** z of a two-sided 95% interval. */
const Z95 = 1.959964;

/** An estimate and the half-width of its 95% interval (NaN when there is no data). */
export interface Estimate {
  value: number;
  half: number;
}

/** A proportion `x / n` with the half-width of its Wilson score interval. */
export function proportion([x, n]: Count): Estimate {
  if (n === 0) return { value: NaN, half: NaN };
  const p = x / n;
  const z2 = Z95 * Z95;
  const half = (Z95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { value: p, half };
}

/**
 * The ratio `A / P` of per-sample counts (AF = bets and raises / calls), with the delta-method
 * standard error `√(n/(n−1) · Σ(aᵢ − R·pᵢ)²) / P`.
 */
export function ratio(m: RatioMoments): Estimate {
  if (m.p === 0 || m.n < 2) return { value: m.p === 0 ? NaN : m.a / m.p, half: NaN };
  const r = m.a / m.p;
  const ss = Math.max(0, m.aa - 2 * r * m.ap + r * r * m.pp);
  return { value: r, half: (Z95 * Math.sqrt((m.n / (m.n - 1)) * ss)) / m.p };
}

/** A mean with the half-width of its normal 95% interval. */
export function mean(m: MeanMoments): Estimate {
  if (m.n < 2) return { value: m.n === 0 ? NaN : m.sum / m.n, half: NaN };
  const mu = m.sum / m.n;
  const variance = Math.max(0, (m.sumSq - m.n * mu * mu) / (m.n - 1));
  return { value: mu, half: Z95 * Math.sqrt(variance / m.n) };
}

/** The `q` quantile (nearest rank) of `values`. */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return NaN;
  const sorted = Float64Array.from(values).sort();
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i] as number;
}

// ── Summary and gates ──────────────────────────────────────────────────────────────────────────

/** §9.1 targets (fractions; AF a ratio) and the §9.7 tolerances. */
export interface Target {
  vpip: number;
  pfr: number;
  af: number;
}

/** §9.7 gates: VPIP and PFR within ±4 points (Easy's VPIP ±8), AF within ±0.7. */
export const TOLERANCE = { vpip: 0.04, vpipEasy: 0.08, pfr: 0.04, af: 0.7 } as const;

export interface ProfileRow {
  key: string;
  hands: number;
  decisions: number;
  vpip: Estimate;
  pfr: Estimate;
  af: Estimate;
  wtsd: Estimate;
  threeBet: Estimate;
  cbet: Estimate;
  /** Big blinds won per 100 hands. */
  bb100: Estimate;
  kinds: Record<string, number>;
  /** The §9.1 targets when the profile is a personality. */
  target: Target | null;
  /** The profile's level when it is a personality ("tag/easy" → easy). */
  level: string | null;
}

/** One side's result (`JobResult.sides`): a level's seats, the coach, a baseline. */
export interface SideRow {
  side: string;
  /** Its seats per hand, on average. */
  seats: number;
  hands: number;
  /** Big blinds won per 100 hands, per seat. */
  bb100: Estimate;
}

export interface TimeRow {
  cls: string;
  n: number;
  p50: number;
  p95: number;
  max: number;
}

export interface Gate {
  name: string;
  pass: boolean;
  detail: string;
}

export function profileRows(result: JobResult): ProfileRow[] {
  return Object.entries(result.profiles)
    .map(([key, t]) => profileRow(key, t))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function profileRow(key: string, t: ProfileTally): ProfileRow {
  const [personality, level] = key.split('/');
  const known = PERSONALITY_IDS.includes(personality as PersonalityId) && level !== undefined;
  const p = known ? PERSONALITIES[personality as PersonalityId] : null;
  const net = mean(t.net);
  return {
    key,
    hands: t.hands,
    decisions: t.decisions,
    vpip: proportion(t.vpip),
    pfr: proportion(t.pfr),
    af: ratio(t.af),
    wtsd: proportion(t.wtsd),
    threeBet: proportion(t.threeBet),
    cbet: proportion(t.cbet),
    bb100: { value: 100 * net.value, half: 100 * net.half },
    kinds: { ...t.kinds },
    target: p === null ? null : { vpip: p.vpip, pfr: p.pfr, af: p.af },
    level: known ? (level as string) : null,
  };
}

export function sideRows(result: JobResult): SideRow[] {
  return Object.entries(result.sides)
    .map(([side, t]) => {
      const net = mean(t.net);
      return {
        side,
        seats: t.hands === 0 ? 0 : t.seatHands / t.hands,
        hands: t.hands,
        bb100: { value: 100 * net.value, half: 100 * net.half },
      };
    })
    .sort((a, b) => a.side.localeCompare(b.side));
}

export function timeRows(result: JobResult): TimeRow[] {
  return Object.entries(result.times)
    .map(([cls, times]) => ({
      cls,
      n: times.length,
      p50: quantile(times, 0.5),
      p95: quantile(times, 0.95),
      max: times.reduce((m, t) => Math.max(m, t), 0),
    }))
    .sort((a, b) => a.cls.localeCompare(b.cls));
}

/** Zero illegal actions, zero invariant violations, every hand finished (§9.7). */
export function legalityGates(result: JobResult): Gate[] {
  return [
    { name: 'illegal actions', pass: result.illegal === 0, detail: String(result.illegal) },
    {
      name: 'invariant violations',
      pass: result.invariant === 0,
      detail: String(result.invariant),
    },
    { name: 'unfinished hands', pass: result.unfinished === 0, detail: String(result.unfinished) },
  ];
}

/** The statistics `--calibrate` checks (`--calibrate-stats`). */
export const CALIBRATION_STATS = ['vpip', 'pfr', 'af'] as const;
export type CalibrationStat = (typeof CALIBRATION_STATS)[number];

/** §9.7 calibration: every personality row against its §9.1 target, for each of `stats`. */
export function calibrationGates(
  rows: readonly ProfileRow[],
  stats: readonly CalibrationStat[] = CALIBRATION_STATS,
): Gate[] {
  const gates: Gate[] = [];
  const pts = (x: number): string => (100 * x).toFixed(1);
  for (const row of rows) {
    if (row.target === null) continue;
    const vpipTol = row.level === 'easy' ? TOLERANCE.vpipEasy : TOLERANCE.vpip;
    const checks: [CalibrationStat, Estimate, number, number, (x: number) => string][] = [
      ['vpip', row.vpip, row.target.vpip, vpipTol, pts],
      ['pfr', row.pfr, row.target.pfr, TOLERANCE.pfr, pts],
      ['af', row.af, row.target.af, TOLERANCE.af, (x) => x.toFixed(2)],
    ];
    for (const [id, est, target, tol, show] of checks) {
      if (!stats.includes(id)) continue;
      const stat = id.toUpperCase();
      const off = est.value - target;
      gates.push({
        name: `${row.key} ${stat}`,
        pass: Number.isFinite(off) && Math.abs(off) <= tol + 1e-12,
        detail: `${show(est.value)} (target ${show(target)} ± ${show(tol)}, off ${off >= 0 ? '+' : ''}${show(off)})`,
      });
    }
  }
  return gates;
}

/**
 * §9.7 win rates (Stage 7 acceptance 1): each side of `wins` wins, its bb/100 interval wholly above
 * 0; each side of `loses` loses, wholly below. A side that did not play fails.
 */
export function winRateGates(
  sides: readonly SideRow[],
  wins: readonly string[],
  loses: readonly string[],
): Gate[] {
  const gate = (side: string, sign: 1 | -1): Gate => {
    const row = sides.find((r) => r.side === side);
    const est = row?.bb100 ?? { value: NaN, half: NaN };
    const low = est.value - est.half;
    const high = est.value + est.half;
    return {
      name: `${side} ${sign > 0 ? 'wins' : 'loses'}`,
      pass: sign > 0 ? low > 0 : high < 0,
      detail:
        row === undefined
          ? 'did not play'
          : `${est.value.toFixed(1)} ±${est.half.toFixed(1)} bb/100 per seat (95%: ${low.toFixed(1)} to ${high.toFixed(1)})`,
    };
  };
  return [...wins.map((s) => gate(s, 1)), ...loses.map((s) => gate(s, -1))];
}

/** Bot decisions at each level within `maxMs` at the 95th percentile (Stage 5 acceptance 6). */
export function speedGates(times: readonly TimeRow[], maxMs: number): Gate[] {
  return times
    .filter((t) => (BOT_LEVELS as readonly string[]).includes(t.cls))
    .map((t) => ({
      name: `${t.cls} decision p95`,
      pass: t.p95 <= maxMs,
      detail: `${t.p95.toFixed(1)} ms (budget ${maxMs} ms)`,
    }));
}

// ── Report ─────────────────────────────────────────────────────────────────────────────────────

const pct = (e: Estimate): string =>
  Number.isNaN(e.value) ? '-' : `${(100 * e.value).toFixed(1)} ±${(100 * e.half).toFixed(1)}`;
const num = (e: Estimate, digits = 2): string =>
  Number.isNaN(e.value)
    ? '-'
    : `${e.value.toFixed(digits)} ±${Number.isNaN(e.half) ? '?' : e.half.toFixed(digits)}`;

function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: readonly string[]) =>
    cells
      .map((c, i) => (i === 0 ? c.padEnd(widths[i] as number) : c.padStart(widths[i] as number)))
      .join('  ');
  return [line(header), ...rows.map(line)];
}

export interface Report {
  spec: Omit<RunSpec, 'threads' | 'seed'> & { seed: string; threads: number };
  seconds: number;
  hands: number;
  profiles: ProfileRow[];
  sides: SideRow[];
  times: TimeRow[];
  gates: Gate[];
  problems: JobResult['problems'];
}

/** The report in plain text (the terminal) or Markdown (the GitHub job summary). */
export function formatReport(report: Report, markdown = false): string {
  const { spec } = report;
  const out: string[] = [];
  const sizes = spec.seatCounts.join(',');
  out.push(
    `Self-play: level ${spec.level}, ${sizes} players, ${report.hands} hands, stacks ${spec.stacks}` +
      `${spec.stacks === 'random' ? '' : ` (${spec.startingStack / spec.bb} bb)`}, seed ${spec.seed}, ` +
      `lineup ${spec.lineup.join(',')}; ${spec.threads} threads, ${report.seconds.toFixed(0)} s`,
  );
  const target = (r: ProfileRow, f: (t: Target) => string) =>
    r.target === null ? '' : f(r.target);
  const header = [
    'profile',
    'seat-hands',
    'VPIP %',
    '(target)',
    'PFR %',
    '(target)',
    'AF',
    '(target)',
    'WTSD %',
    '3-bet %',
    'c-bet %',
    'bb/100',
    'decisions',
  ];
  const rows = report.profiles.map((r) => [
    r.key,
    String(r.hands),
    pct(r.vpip),
    target(r, (t) => (100 * t.vpip).toFixed(0)),
    pct(r.pfr),
    target(r, (t) => (100 * t.pfr).toFixed(0)),
    num(r.af),
    target(r, (t) => t.af.toFixed(1)),
    pct(r.wtsd),
    pct(r.threeBet),
    pct(r.cbet),
    num(r.bb100, 1),
    String(r.decisions),
  ]);
  const sideHeader = ['side', 'seats', 'hands', 'bb/100 per seat'];
  const sideBody = report.sides.map((r) => [
    r.side,
    r.seats.toFixed(1),
    String(r.hands),
    num(r.bb100, 1),
  ]);
  const timeHeader = ['decisions of', 'count', 'p50 ms', 'p95 ms', 'max ms'];
  const timeBody = report.times.map((t) => [
    t.cls,
    String(t.n),
    t.p50.toFixed(2),
    t.p95.toFixed(2),
    t.max.toFixed(1),
  ]);
  const gateLines = report.gates.map((g) => `${g.pass ? 'PASS' : 'FAIL'}  ${g.name}: ${g.detail}`);
  if (markdown) {
    const md = (h: readonly string[], body: readonly (readonly string[])[]) => [
      `| ${h.join(' | ')} |`,
      `|${h.map(() => '---').join('|')}|`,
      ...body.map((r) => `| ${r.join(' | ')} |`),
    ];
    out[0] = `### ${out[0]}`;
    out.push('', ...md(header, rows), '', ...md(sideHeader, sideBody), '');
    out.push(...md(timeHeader, timeBody), '', ...gateLines.map((l) => `- ${l}`));
  } else {
    out.push('', ...table(header, rows), '', ...table(sideHeader, sideBody));
    out.push('', ...table(timeHeader, timeBody), '', ...gateLines);
  }
  for (const p of report.problems)
    out.push(`${markdown ? '- ' : ''}job ${p.job} hand ${p.hand}: ${p.detail}`);
  return out.join('\n');
}

// ── Command line ───────────────────────────────────────────────────────────────────────────────

/** The sides of `--wins` and `--loses`: the bot levels, the coach and the baselines. */
const SIDES: readonly string[] = [
  ...BOT_LEVELS,
  ...SEAT_SPECS.filter((s) => !(PERSONALITY_IDS as readonly string[]).includes(s)),
];

export interface Options extends RunSpec {
  seedText: string;
  calibrate: boolean;
  /** What `--calibrate` checks (default VPIP, PFR and AF). */
  calibrateStats: CalibrationStat[];
  maxP95: number | null;
  /** Sides that must win (lose): a level, `coach` or a baseline (§9.7 win rates). */
  wins: string[];
  loses: string[];
  json: string | null;
  quiet: boolean;
}

/** `--seed`: 32 hex characters as they are, a whole number or any word through `deriveSeed`. */
export function seedFromText(text: string): Seed128 {
  if (isSeed128(text)) return text;
  if (/^\d+$/.test(text) && Number.isSafeInteger(Number(text))) {
    return deriveSeed(ZERO_SEED, 'selfplay', Number(text));
  }
  return deriveSeed(ZERO_SEED, `selfplay|${text}`);
}

/** `--players`: "6", "2-9" or "3,6,9" (each 2 to 9). */
export function parseSeatCounts(text: string): number[] {
  const range = /^(\d)-(\d)$/.exec(text);
  const counts = range
    ? Array.from(
        { length: Number(range[2]) - Number(range[1]) + 1 },
        (_, i) => Number(range[1]) + i,
      )
    : text.split(',').map(Number);
  if (counts.length === 0 || counts.some((n) => !Number.isInteger(n) || n < 2 || n > 9)) {
    throw new RangeError(
      `--players must be table sizes from 2 to 9 ("6", "2-9", "3,6"), got ${text}`,
    );
  }
  return counts;
}

function positiveInt(text: string, name: string): number {
  const n = Number(text);
  if (!Number.isSafeInteger(n) || n < 1)
    throw new RangeError(`${name} must be a whole number ≥ 1, got ${text}`);
  return n;
}

export function parseOptions(argv: readonly string[]): Options {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      level: { type: 'string', default: 'medium' },
      players: { type: 'string', default: '6' },
      hands: { type: 'string', default: '20000' },
      seed: { type: 'string', default: '1' },
      lineup: { type: 'string' },
      stacks: { type: 'string', default: 'reset' },
      bb: { type: 'string', default: '20' },
      'stack-bb': { type: 'string', default: '100' },
      threads: { type: 'string' },
      'job-hands': { type: 'string', default: '250' },
      calibrate: { type: 'boolean', default: false },
      'calibrate-stats': { type: 'string', default: CALIBRATION_STATS.join(',') },
      'max-p95': { type: 'string' },
      wins: { type: 'string' },
      loses: { type: 'string' },
      json: { type: 'string' },
      quiet: { type: 'boolean', default: false },
    },
    strict: true,
  });
  const level = values.level as RunLevel;
  if (![...BOT_LEVELS, 'mixed'].includes(level)) {
    throw new RangeError(
      `--level must be easy, medium, hard, expert or mixed, got ${values.level}`,
    );
  }
  const stacks = values.stacks as StackMode;
  if (!['reset', 'carry', 'random'].includes(stacks)) {
    throw new RangeError(`--stacks must be reset, carry or random, got ${values.stacks}`);
  }
  const lineup = values.lineup === undefined ? [...DEFAULT_LINEUP] : values.lineup.split(',');
  for (const entry of lineup) {
    if (!isLineupEntry(entry)) {
      throw new RangeError(
        `--lineup: unknown player "${entry}" (one of ${SEAT_SPECS.join(', ')}, or a personality ` +
          `at a level, e.g. tag@expert)`,
      );
    }
  }
  const sides = (text: string | undefined, name: string): string[] => {
    if (text === undefined) return [];
    const list = text.split(',');
    for (const side of list) {
      if (!SIDES.includes(side)) {
        throw new RangeError(`${name}: unknown side "${side}" (one of ${SIDES.join(', ')})`);
      }
    }
    return list;
  };
  const calibrateStats = values['calibrate-stats'].split(',');
  for (const stat of calibrateStats) {
    if (!(CALIBRATION_STATS as readonly string[]).includes(stat)) {
      throw new RangeError(`--calibrate-stats: unknown statistic "${stat}" (vpip, pfr, af)`);
    }
  }
  const bb = positiveInt(values.bb, '--bb');
  if (bb < 2 || bb % 2 !== 0) throw new RangeError(`--bb must be even and ≥ 2, got ${bb}`);
  const stackBB = positiveInt(values['stack-bb'], '--stack-bb');
  const maxP95 = values['max-p95'] === undefined ? null : Number(values['max-p95']);
  if (maxP95 !== null && !(maxP95 > 0))
    throw new RangeError(`--max-p95 must be a positive number of ms`);
  return {
    seed: seedFromText(values.seed),
    seedText: values.seed,
    hands: positiveInt(values.hands, '--hands'),
    seatCounts: parseSeatCounts(values.players),
    lineup: lineup as LineupEntry[],
    level,
    stacks,
    bb,
    startingStack: bb * stackBB,
    jobHands: positiveInt(values['job-hands'], '--job-hands'),
    threads:
      values.threads === undefined ? defaultThreads() : positiveInt(values.threads, '--threads'),
    calibrate: values.calibrate,
    calibrateStats: calibrateStats as CalibrationStat[],
    maxP95,
    wins: sides(values.wins, '--wins'),
    loses: sides(values.loses, '--loses'),
    json: values.json ?? null,
    quiet: values.quiet,
  };
}

/** Runs the self-play `options` describe and returns its report (gates included). */
export async function selfPlay(
  options: Options,
  progress?: (done: number, jobs: number) => void,
): Promise<Report> {
  const started = performance.now();
  const result = await runSelfPlay(options, progress);
  const seconds = (performance.now() - started) / 1000;
  const profiles = profileRows(result);
  const sides = sideRows(result);
  const times = timeRows(result);
  const gates = [
    ...legalityGates(result),
    ...(options.calibrate ? calibrationGates(profiles, options.calibrateStats) : []),
    ...(options.maxP95 === null ? [] : speedGates(times, options.maxP95)),
    ...winRateGates(sides, options.wins, options.loses),
  ];
  return {
    spec: {
      seed: options.seedText,
      hands: options.hands,
      seatCounts: options.seatCounts,
      lineup: options.lineup,
      level: options.level,
      stacks: options.stacks,
      bb: options.bb,
      startingStack: options.startingStack,
      jobHands: options.jobHands,
      threads: options.threads,
    },
    seconds,
    hands: result.hands,
    profiles,
    sides,
    times,
    gates,
    problems: result.problems,
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  let shown = -1;
  const report = await selfPlay(options, (done, jobs) => {
    const tenth = Math.floor((10 * done) / jobs);
    if (!options.quiet && tenth > shown) {
      shown = tenth;
      process.stderr.write(`  ${done}/${jobs} jobs\n`);
    }
  });
  console.log(formatReport(report));
  if (options.json !== null) writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary !== undefined && summary !== '') {
    appendFileSync(summary, `${formatReport(report, true)}\n\n`);
  }
  if (report.gates.some((g) => !g.pass)) process.exitCode = 1;
}

if (import.meta.main) {
  await main();
}
