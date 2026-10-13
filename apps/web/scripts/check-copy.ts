/**
 * CI check of the coach's words (PLAN §8.10 "Language rules", Appendix F.1, F.5, F.9; Known
 * pitfalls 35 and 39; §18 Stage 5 acceptance 7). The rules are in `copy-rules.ts`; this script
 * runs them on:
 *
 * 1. every template of `enCoach.coach.templates` and the glossary (`checkTemplates`, `checkGlossary`);
 * 2. the hints of generated situations (1,000 by default): random tables and random legal play
 *    with the real engine (only here: the brain never runs the engine), every hero decision
 *    observed and its §8.2 features computed; then the coach's own advice there (`hint`'s
 *    pipeline, chunk 5.7) and every other reason the spot allows, with the data the policies put
 *    in `Reason.data` (chunks 5.3–5.5) and the guardrail reasons, is explained (`explain`),
 *    rendered and checked (`checkHint`).
 *
 * Usage (from apps/web): `npm run check:copy` (= `node scripts/check-copy.ts`), optional
 * `--situations <n>`, `--seed <32 hex>` and `--print <n>` (prints n hints for a reader). Exits
 * with code 1 and lists the problems.
 */
import { equity } from '../src/analysis/equity.ts';
import { preflopEquity } from '../src/analysis/preflop.ts';
import {
  explain,
  explainInput,
  GLOSSARY_KEYS,
  TEMPLATE_KEYS,
  type Line,
  type TemplateKey,
} from '../src/brain/explain.ts';
import { deliberate } from '../src/brain/decide.ts';
import { candidateEVs, confidence } from '../src/brain/ev.ts';
import { coachSeed, features } from '../src/brain/features.ts';
import { preflopPolicy, realisation as preflopRealisation } from '../src/brain/preflopPolicy.ts';
import { guardrails, guardSpot } from '../src/brain/guardrails.ts';
import { liveOpponents } from '../src/brain/ranges.ts';
import { COACH } from '../src/brain/profiles.ts';
import { openPct } from '../src/brain/tunables.ts';
import type { BrainProfile, Decision, EvCandidate, Features, Reason } from '../src/brain/types.ts';
import { classOf, className, rankOf } from '../src/core/cards.ts';
import {
  deriveSeed,
  isSeed128,
  randInt,
  rngFromSeed,
  type Rng,
  type Seed128,
} from '../src/core/rng.ts';
import { legalActions } from '../src/engine/legal.ts';
import { observe } from '../src/engine/observe.ts';
import { startHand } from '../src/engine/start.ts';
import { step } from '../src/engine/step.ts';
import { createTable, initialSlots } from '../src/engine/table.ts';
import type {
  BotLevel,
  HandState,
  LegalActions,
  Observation,
  PersonalityId,
  PlayerAction,
  TableConfig,
} from '../src/engine/types.ts';
import { hintLines, hintText } from '../src/i18n/coach.ts';
import { en } from '../src/i18n/en.ts';
import { checkGlossary, checkHint, checkTemplates } from './copy-rules.ts';

/** Stage 5 acceptance 7: the run covers 1,000 generated situations. */
export const DEFAULT_SITUATIONS = 1000;
export const DEFAULT_SEED: Seed128 = 'c0c0c0c0000000000000000000005006';

// ── Situations: the engine plays, the hero's decisions are observed ────────────────────────────

/** A coach-like profile (Appendix A.5 `COACH`); fewer range trials: the words need no precision. */
export const CHECK_PROFILE: BrainProfile = {
  id: 'coach',
  looseness: 1,
  pfrRatio: 0.82,
  aggressionBias: 0,
  bluffFreq: 0,
  bluff3betFreq: 0,
  stickiness: 1,
  slowplayFreq: 0,
  equityNoiseSD: 0,
  mcTrials: 600,
  rangeModel: 'reweight+stats',
  positionAwareness: 1,
  sizing: 'texture',
  temperature: 0,
  defenseFactor: 1,
  preflopJitter: 0,
  balancedBluffs: false,
  exploit: false,
  deterministic: true,
  neverLimp: true,
};

export interface Situation {
  obs: Observation;
  f: Features;
}

const BIG_BLINDS = [2, 10, 20, 100] as const;

/** A random stack in big blinds: a quarter short (3–15), a quarter medium, half deep. */
function randomStackBB(rng: Rng): number {
  const kind = randInt(rng, 4);
  if (kind === 0) return 3 + randInt(rng, 13);
  if (kind === 1) return 16 + randInt(rng, 45);
  return 60 + randInt(rng, 241);
}

function randomTable(rng: Rng, seed: Seed128): ReturnType<typeof createTable> {
  const bb = BIG_BLINDS[randInt(rng, BIG_BLINDS.length)] as number;
  const seatCount = 2 + randInt(rng, 8);
  const cfg: TableConfig = {
    seatCount,
    sb: bb / 2,
    bb,
    startingStack: 100 * bb,
    botLevel: randInt(rng, 2) === 0 ? 'easy' : 'medium',
    seatLevels: new Array<BotLevel | null>(seatCount).fill(null),
  };
  const slots = initialSlots(cfg, seed, en.app.hero).map((slot) => ({
    ...slot,
    stack: randomStackBB(rng) * bb,
  }));
  return createTable(cfg, slots, seed);
}

/** A "to" amount between the bounds: the minimum, all-in, or anywhere up to about the pot. */
function randomTo(bounds: { min: number; max: number }, pot: number, rng: Rng): number {
  const r = randInt(rng, 10);
  if (r < 4) return bounds.min;
  if (r < 5) return bounds.max;
  const span = Math.max(0, Math.min(bounds.max, bounds.min + pot) - bounds.min);
  return bounds.min + randInt(rng, span + 1);
}

/** Random play that reaches every street often: mostly checks and calls. */
function randomAction(legal: LegalActions, pot: number, rng: Rng): PlayerAction {
  const r = randInt(rng, 100);
  if (legal.canCheck) {
    if (r < 25 && legal.bet !== null) return { type: 'bet', to: randomTo(legal.bet, pot, rng) };
    if (r < 25 && legal.raise !== null) {
      return { type: 'raise', to: randomTo(legal.raise, pot, rng) };
    }
    return { type: 'check' };
  }
  if (r < 15 && legal.raise !== null) return { type: 'raise', to: randomTo(legal.raise, pot, rng) };
  if (r < 40 && legal.canFold) return { type: 'fold' };
  return legal.canCall ? { type: 'call' } : { type: 'fold' };
}

/** The HUD's win chance, faster than the HUD (2,000 trials when the spot is not exact). */
function quickHud(obs: Observation): number {
  const nOpp = liveOpponents(obs).length;
  if (nOpp === 0) return 1;
  if (obs.board.length === 0) return preflopEquity(obs.hole, nOpp).equity;
  return equity({ hero: obs.hole, board: obs.board, nOpp }, { trials: 2000 }).equity;
}

/**
 * `count` hero decisions from random hands played with the real engine: each table is random
 * (2–9 seats, blinds, stacks from 3 to 300 big blinds, labels shown or hidden), every hero
 * decision is observed (the brain's whole input) and its features are computed.
 */
export function generateSituations(count: number, seed: Seed128 = DEFAULT_SEED): Situation[] {
  const rng = rngFromSeed(seed);
  const out: Situation[] = [];
  for (let hand = 0; out.length < count; hand++) {
    const table = randomTable(rng, deriveSeed(seed, 'table', hand));
    const n = table.slots.length;
    const labels = table.slots.map((slot, i) =>
      i > 0 && randInt(rng, 2) === 0 ? (slot.personality as PersonalityId) : null,
    );
    let h: HandState = startHand(table, deriveSeed(seed, 'hand', hand));
    let guard = 0;
    while (h.phase !== 'complete' && out.length < count && guard++ < 400) {
      if (h.phase !== 'betting') {
        h = step(h, { kind: 'advance' });
        continue;
      }
      const seat = h.toAct as number;
      const legal = legalActions(h) as LegalActions;
      if (seat === 0) {
        const obs = observe(h, 0, {
          seatStats: new Array(n).fill(null),
          visiblePersonality: labels,
          seatLevels: new Array<BotLevel>(n).fill(table.config.botLevel),
        });
        const f = features(obs, CHECK_PROFILE, coachSeed(obs), quickHud(obs));
        out.push({ obs, f });
      }
      const pot = h.seats.reduce((sum, s) => sum + s.totalBet, 0);
      h = step(h, { kind: 'act', seat, action: randomAction(legal, pot, rng) });
    }
  }
  return out;
}

// ── Decisions: every reason the spot allows, with the policies' data ───────────────────────────

/** A decision as `decide()` will hand it to `explain` (Appendix A.5 fields). */
export type CheckDecision = Pick<
  Decision,
  'action' | 'trace' | 'confidence' | 'alt' | 'eRandom' | 'eRange' | 'need'
>;

const r = (code: Reason['code'], data: Reason['data'] = {}): Reason => ({ code, data });
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const FOLD: PlayerAction = { type: 'fold' };
const CHECK: PlayerAction = { type: 'check' };
const CALL: PlayerAction = { type: 'call' };

/** A legal raise or bet near `to` (snapped to the small blind and the bounds). */
function aggressive(obs: Observation, to: number): PlayerAction | null {
  const type = obs.legal.raise !== null ? 'raise' : obs.legal.bet !== null ? 'bet' : null;
  if (type === null) return null;
  const bounds = obs.legal[type] as { min: number; max: number };
  const snapped = Math.round(to / obs.sb) * obs.sb;
  return { type, to: Math.min(bounds.max, Math.max(bounds.min, snapped)) };
}

function allInAction(obs: Observation): PlayerAction | null {
  if (obs.legal.raise !== null) return { type: 'raise', to: obs.legal.raise.max };
  if (obs.legal.bet !== null) return { type: 'bet', to: obs.legal.bet.max };
  return obs.legal.callIsAllIn ? CALL : null;
}

/**
 * §8.5 step 2 realisation, with R = 1 when the call ends the betting (facing an all-in), as §8.4
 * and the §8.9 EV model read it.
 */
function realisation(f: Features): number {
  if (f.street === 'river' || f.facing === 'allin') return 1;
  const base = f.position === 'IP' ? 1 : f.street === 'flop' ? 0.85 : 0.92;
  return f.nOpp > 1 ? base - 0.05 : base;
}

/** `E_called` trials of the EV model here (800 in the coach): the words need no precision. */
const EV_TRIALS = 100;

const sameAction = (a: PlayerAction, b: PlayerAction): boolean =>
  a.type === b.type &&
  (a.type !== 'bet' && a.type !== 'raise' ? true : a.to === (b as { to: number }).to);

/**
 * Before the flop, the coach's own decision (`preflopPolicy`, chunk 5.3); then every reason the
 * spot allows, each under the condition its policy uses (§8.3–8.5: a call on
 * price only when `E·R` beats the price, a value bet only with a strong hand, …), with an action
 * it explains and the data the chunk 5.3–5.4 policies put in `Reason.data` (sizes as `to`/`bb`
 * before the flop and `size`/`sizeBB` after it, `E` = the policy's range equity, chances as
 * fractions); plus a few proposals past a §8.8 limit (a fold with `p ≥ 0.95`, a fold when checking
 * is free, …). Then, as `decide()` will: the real guardrails (`guardrails.ts`) correct the action
 * and add their reasons, and the real EV model (`ev.ts`, `EV_TRIALS`) gives the Close/Clear
 * confidence and the alternative (the best other candidate).
 */
export function candidateDecisions(s: Situation, rng: Rng): CheckDecision[] {
  const { obs, f } = s;
  const legal = obs.legal;
  const proposals: [PlayerAction, Reason[]][] = [];
  const add = (action: PlayerAction | null, trace: Reason[]): void => {
    if (action !== null) proposals.push([action, trace]);
  };
  const hand = className(classOf(obs.hole[0], obs.hole[1]));
  const pair = rankOf(obs.hole[0]) === rankOf(obs.hole[1]);
  const bb = obs.bb;
  const heroBet = obs.streetBets[obs.seat] as number;
  const currentBet = heroBet + legal.toCall;
  const noisy = (): number => clamp01(f.eRange + (randInt(rng, 17) - 8) / 100);
  const fold = legal.canFold && !legal.canCheck ? FOLD : null;
  const call = legal.canCall ? CALL : null;
  const check = legal.canCheck ? CHECK : null;
  const sized = (a: PlayerAction | null): Reason['data'] =>
    a !== null && (a.type === 'bet' || a.type === 'raise') ? { to: a.to, bb } : {};
  const sizedPost = (a: PlayerAction | null): Reason['data'] =>
    a !== null && (a.type === 'bet' || a.type === 'raise') ? { size: a.to, sizeBB: a.to / bb } : {};

  if (f.street === 'preflop') {
    // The coach's own decision first (chunk 5.3, the real policy), then every other reason.
    const coach = preflopPolicy(obs, f);
    add(coach.action, coach.trace);
    const headsUp = obs.dealtIn.filter(Boolean).length === 2;
    const open = openPct(f.k, headsUp);
    if (f.facing === 'none' || f.facing === 'limpers') {
      const raise = aggressive(obs, 2.5 * bb + bb * (f.facing === 'limpers' ? 1 : 0));
      const base = { hand, rankPct: f.rankPct, behind: f.k, openPct: open };
      add(raise, [r('OPEN_RANGE', { ...base, ...sized(raise) })]);
      add(fold, [r('FOLD_RANGE', base)]);
      add(check, [r('CHECK_FREE')]);
      if (f.facing === 'limpers') {
        add(raise, [r('ISOLATE', { hand, rankPct: f.rankPct, limpers: 1, ...sized(raise) })]);
      }
    } else if (f.facing === 'allin') {
      // §8.4: call if E ≥ need against the shover's range (R = 1).
      const E = noisy();
      const data = { hand, E, need: f.need, V: 12 };
      add(E >= f.need ? call : fold, [r(E >= f.need ? 'CALL_ALLIN' : 'FOLD_ALLIN', data)]);
    } else {
      // §8.3: re-raise for value with E ≥ 0.58; call when EV(call) > 0 (a pocket pair adds the
      // set-mining implied odds); fold on range.
      const E = noisy();
      const R = f.position === 'IP' ? 0.95 : 0.8;
      const numbers = { hand, E, need: f.need, V: 15, R, evCall: 1 };
      const reraise = aggressive(obs, 3 * currentBet);
      if (E >= 0.58) {
        add(reraise, [
          r(f.facing === 'open' ? 'THREE_BET_VALUE' : 'FOUR_BET_VALUE', {
            ...numbers,
            ...sized(reraise),
          }),
        ]);
      }
      if (E * R > f.need || pair) {
        add(call, [r('CALL_PREFLOP', { ...numbers, implied: pair ? 3 * bb : 0 })]);
      }
      if (pair) add(call, [r('SET_MINING', { ...numbers, implied: 3 * bb })]);
      add(fold, [r('FOLD_VS_RAISE', numbers)]);
    }
    if (f.effBB <= 12) {
      const S = Math.min(15, Math.max(1, Math.round(f.effBB)));
      const shove = allInAction(obs);
      const data = { S, behind: Math.min(8, Math.max(1, f.k)), hand, rankPct: f.rankPct };
      add(shove, [r('PUSH_FOLD', { action: 'allin', ...data, Pfold: 0.55, E: noisy() })]);
      add(fold, [r('PUSH_FOLD', { action: 'fold', ...data, Pfold: 0.3, E: noisy() })]);
    }
    if (f.facing === 'allin' && f.eRange >= f.need + 0.15) add(fold, [r('FOLD_ALLIN', { hand })]);
    return finish(s, proposals);
  }

  // §8.5: the bucket from p, the price from E·R (+ implied odds for a draw), §8.8 guardrails.
  const E = f.eRange;
  const need = f.need;
  const R = realisation(f);
  const p = f.p;
  const handName = f.handInfo.name;
  const largest = f.draws.reduce<Features['draws'][number] | null>(
    (best, d) => (best === null || d.outs > best.outs ? d : best),
    null,
  );
  const madeDraw =
    largest !== null &&
    ['flush', 'nutFlush', 'oesd', 'doubleGutshot', 'gutshot'].includes(largest.kind);
  if (f.toCall > 0) {
    const raise = aggressive(obs, 3 * currentBet);
    const shove = allInAction(obs);
    if (p >= 0.65) {
      add(raise, [r('VALUE_RAISE', sizedPost(raise))]);
      add(raise, [r('RAISE_PROTECT', sizedPost(raise))]);
      add(shove, [r('VALUE_RAISE', sizedPost(shove)), r('COMMITTED', { handName, E, need })]);
    }
    if (p >= 0.85) add(raise, [r('NUTS', sizedPost(raise))]);
    if (f.spr <= 6 && p >= 0.6) add(call, [r('COMMITTED', { handName, E, need })]);
    if (f.facing === 'allin') {
      const calls = E * R > need;
      add(calls ? call : fold, [r(calls ? 'CALL_ALLIN' : 'FOLD_ALLIN', { E, need })]);
      // Past the §8.8 rule 4 limits: the guardrails turn these around.
      if (E >= need + 0.15) add(fold, [r('FOLD_ALLIN', { E, need })]);
      if (E < need - 0.25) add(call, [r('CALL_ALLIN', { E, need })]);
    } else if (E * R > need) {
      add(call, [r('CALL_PROFITABLE', { E, need, toCall: f.toCall, pot: f.winPot })]);
    } else {
      add(fold, [r('FOLD_PRICE', { E, need })]);
      if (madeDraw && largest !== null) {
        // Just enough implied odds to make the call pay (§8.5 step 3).
        const implied = f.toCall - E * R * (f.winPot + f.toCall) + 0.05 * f.toCall;
        const needImplied = f.toCall / (f.winPot + f.toCall + implied);
        add(call, [r('IMPLIED', { E, need, needImplied, draw: largest.kind })]);
      }
    }
    if (f.handInfo.playsTheBoard) add(fold, [r('BOARD_PLAYS')]);
    // Past the §8.8 rule 2 and 3 limits: the guardrails turn these around.
    if (p >= 0.95) add(fold, [r('FOLD_PRICE', { E, need })]);
    if (f.street === 'river' && E < 0.03) {
      add(call, [r('CALL_PROFITABLE', { E, need, toCall: f.toCall, pot: f.winPot })]);
    }
  } else {
    const bet = aggressive(obs, f.pot / 2);
    const third = aggressive(obs, f.pot / 3);
    const category = f.handInfo.category;
    if (p >= 0.65) add(bet, [r('VALUE_BET', { handName, category, E, ...sizedPost(bet) })]);
    if (p >= 0.85) add(bet, [r('NUTS', { handName, category, E, ...sizedPost(bet) })]);
    if (p >= 0.45 && p < 0.65) add(third, [r('THIN_VALUE', { handName, E, ...sizedPost(third) })]);
    if (p >= 0.45) add(check, [r('POT_CONTROL', { handName })]);
    if (p < 0.45) {
      add(third, [r('CBET_DRY', sizedPost(third))]);
      add(check, [r(f.street === 'river' ? 'CHECK_FREE' : 'CHECK_WEAK')]);
      if (f.street !== 'river' && f.outs >= 8) {
        const hits = { hitNext: 0.2, hitRiver: 0.35 };
        const data = { draw: largest?.kind ?? '', outs: f.outs, ...hits, ...sizedPost(bet) };
        add(bet, [r('SEMI_BLUFF', data)]);
      }
    }
    if (f.handInfo.playsTheBoard) add(check, [r('BOARD_PLAYS')]);
    // A fold when checking is free: §8.8 rule 1 makes it a check.
    add(FOLD, [r('FOLD_PRICE', { E, need })]);
  }
  return finish(s, proposals);
}

/**
 * What `decide()` does after the policy: the guardrails correct the proposed action and add their
 * reasons; the EV model's candidates (once per spot) give the confidence and the alternative.
 */
function finish(s: Situation, proposals: readonly [PlayerAction, Reason[]][]): CheckDecision[] {
  const { obs, f } = s;
  const R = f.street === 'preflop' ? preflopRealisation(f.position, obs.hole) : realisation(f);
  let ranked: EvCandidate[];
  try {
    const evs = candidateEVs({ obs, f, R, implied: 0, seed: coachSeed(obs), trials: EV_TRIALS });
    ranked = [...evs].sort((a, b) => b.ev - a.ev);
  } catch {
    ranked = []; // no opponent can act: nothing to bet into
  }
  const conf = confidence(
    ranked.map((c) => c.ev),
    f.pot,
  );
  return proposals.map(([proposed, reasons]) => {
    const g = guardrails(guardSpot(obs, f), proposed);
    const alt = ranked.find((c) => !sameAction(c.action, g.action))?.action ?? null;
    return {
      action: g.action,
      trace: [...reasons, ...g.trace],
      confidence: conf,
      alt,
      eRandom: f.eRandom,
      eRange: f.eRange,
      need: f.need,
    };
  });
}

// ── The run ────────────────────────────────────────────────────────────────────────────────────

export interface CopyReport {
  problems: string[];
  situations: number;
  hints: number;
  /** Template keys that appeared in the generated hints. */
  covered: ReadonlySet<TemplateKey>;
  /** Rendered hints for a reader (`--print n`): every k-th hint. */
  samples: string[][];
}

function keysOf(line: Line, into: Set<TemplateKey>): void {
  into.add(line.key);
  for (const p of Object.values(line.params)) if (p.kind === 'line') keysOf(p.line, into);
}

/**
 * Parts 1–3 over `count` situations. Problems are deduplicated, each with the first spot that
 * shows it. `print` keeps that many rendered hints, spread over the run, for a reader.
 */
export function runCheckCopy(
  count: number = DEFAULT_SITUATIONS,
  seed: Seed128 = DEFAULT_SEED,
  print = 0,
): CopyReport {
  const problems = [...checkTemplates(), ...checkGlossary()];
  const situations = generateSituations(count, seed);
  const rng = rngFromSeed(deriveSeed(seed, 'decisions'));
  const covered = new Set<TemplateKey>();
  const seen = new Set<string>();
  const samples: string[][] = [];
  const every = Math.max(1, Math.floor((6 * count) / Math.max(1, print)));
  let hints = 0;
  for (const s of situations) {
    // The coach's own advice (`hint`, chunk 5.7), then every other reason the spot allows.
    const coach = deliberate(s.obs, COACH, coachSeed(s.obs), s.f.eRandom);
    const decisions: [CheckDecision, Features][] = [
      [coach.decision, coach.f],
      ...candidateDecisions(s, rng).map((d): [CheckDecision, Features] => [d, s.f]),
    ];
    for (const [d, f] of decisions) {
      const input = explainInput(s.obs, f, d);
      let found: string[];
      try {
        const e = explain(input);
        for (const line of hintLines(e)) keysOf(line, covered);
        found = checkHint(e, input);
        if (samples.length < print && hints % every === 0) samples.push(hintText(e));
      } catch (error) {
        found = [`explain failed: ${(error as Error).message}`];
      }
      hints++;
      for (const p of found) {
        if (seen.has(p)) continue;
        seen.add(p);
        const spot = `${s.f.street}, ${d.trace.map((x) => x.code).join('+')} → ${JSON.stringify(d.action)}`;
        problems.push(`${p} [${spot}; hole ${className(classOf(s.obs.hole[0], s.obs.hole[1]))}]`);
      }
    }
  }
  return { problems, situations: situations.length, hints, covered, samples };
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.main) {
  const count = Number(argValue('--situations') ?? DEFAULT_SITUATIONS);
  const seed = argValue('--seed') ?? DEFAULT_SEED;
  const print = Number(argValue('--print') ?? 0);
  if (!Number.isInteger(count) || count < 1 || !isSeed128(seed) || !Number.isInteger(print)) {
    console.error(
      'check-copy: usage: node scripts/check-copy.ts [--situations N] [--seed 32hex] [--print N]',
    );
    process.exit(2);
  }
  const started = performance.now();
  const report = runCheckCopy(count, seed, print);
  for (const sample of report.samples) console.log(`\n${sample.join('\n')}`);
  if (report.samples.length > 0) console.log('');
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const reasonKeys = TEMPLATE_KEYS.filter((k) => !k.includes('.') || /^[A-Z]/.test(k));
  const unseen = reasonKeys.filter((k) => !report.covered.has(k) && !k.startsWith('feedback'));
  console.log(
    `check-copy: ${TEMPLATE_KEYS.length} templates, ${GLOSSARY_KEYS.length} glossary keys; ${report.situations} situations, ${report.hints} hints in ${seconds} s`,
  );
  console.log(
    `check-copy: hint templates seen ${reasonKeys.length - unseen.length}/${reasonKeys.length}${unseen.length > 0 ? ` (not seen: ${unseen.join(', ')})` : ''}`,
  );
  if (report.problems.length > 0) {
    console.error(`check-copy: ${report.problems.length} problems:`);
    for (const p of report.problems.slice(0, 50)) console.error(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log('check-copy: OK');
  }
}
