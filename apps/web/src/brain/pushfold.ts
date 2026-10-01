/**
 * Short stacks (PLAN §8.4): push or fold when `effBB ≤ 12`, from the build-time `pushPct(k, S)`
 * and `callPct(S)` tables (`pushFoldData.ts`). Pure functions of numbers the preflop policy
 * (`preflopPolicy.ts`) reads from the observation; each returns a verdict (`allin`, `call`, `fold`
 * or `check`) and its reason codes, and the policy turns the verdict into a legal action.
 *
 * - **Unopened:** shove if `rankPct ≤ pushPct(k, S)`, else fold (check when free). With limpers:
 *   shove if `rankPct ≤ 0.8 × pushPct` (HEURISTIC). `S = clamp(round(effBB), 1, 15)`,
 *   `k = clamp(k, 1, 8)`.
 * - **Facing a raise:** only fold or all-in. `EV(shove) = Pfold·pot + (1 − Pfold)·(E_called·finalPot
 *   − risk)`; the raiser calls with `min(1, callPct(S) / V)` of their range (the top
 *   `min(V, callPct(S))`% of hands). Shove if `EV(shove) > 0`.
 * - **Facing an all-in:** call if `E vs the shover's range ≥ need` (R = 1). The preflop policy uses
 *   the same rule at every depth (`callVsAllIn`).
 *
 * The `PUSH_FOLD` text (Appendix F.1) says how often they fold and what the hero wins when called.
 * Unopened, those two numbers come from `pushOutcome`: the players behind as the build-time game
 * has them (nothing posted, then the small and the big blind), each calling with the hands that
 * beat its price against the pushing range; it explains the table, it does not decide.
 *
 * Units in `Reason.data`: equities, `need` and `Pfold` are fractions in [0, 1]; `rankPct`,
 * `pushPct` and `V` are percents of the 1,326 combos; `S` is big blinds; `behind` is `k`.
 */
import { className } from '../core/cards.ts';
import { COMBOS_TOTAL, comboCount, RANGE_CLASSES } from '../data/rangesLayout.ts';
import { callPct, pushFoldPlayers, pushFoldStack, pushPct } from './pushFoldData.ts';
import { equityVsTopOfClass } from './rangesData.ts';
import { PUSH_FOLD_MAX_BB, PUSH_LIMPERS_FACTOR } from './tunables.ts';
import type { Features, Reason } from './types.ts';

/** What a push/fold rule decided; the preflop policy makes it a legal action. */
export interface PushFoldVerdict {
  move: 'allin' | 'call' | 'fold' | 'check';
  trace: Reason[];
}

/** Short-stack mode: preflop with an effective stack of at most 12 big blinds (§8.4). */
export function pushFoldApplies(f: Pick<Features, 'street' | 'effBB'>): boolean {
  return f.street === 'preflop' && f.effBB <= PUSH_FOLD_MAX_BB;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** The blinds' dead money and the posted chips of the players behind (the §8.4 game). */
const BLINDS = 1.5;

/**
 * What happens to a push from `k` players behind with `S` big blinds when the pushing range is
 * the top `pushRangePct`% of hands: the chance that everyone folds and the hero's equity when
 * called (a weighted mean over who calls first). Each player behind calls with the classes whose
 * equity against the pushing range beats its price (`cost / pot`: `S` against `2S + 1.5` with
 * nothing posted, `S − 0.5` against `2S + 1` in the small blind, `S − 1` against `2S + 0.5` in the
 * big blind; heads-up the pusher is the small blind and the big blind calls `S − 1` for `2S`);
 * a calling range of x% reads as the top x% for the hero's equity. Card removal is left out.
 */
export function pushOutcome(
  cls: number,
  k: number,
  S: number,
  pushRangePct: number,
): { pfold: number; eCalled: number } {
  const players = pushFoldPlayers(k);
  const stack = pushFoldStack(S);
  const pusherPosted = players === 1 ? 0.5 : 0;
  const posted: number[] =
    players === 1 ? [1] : [...new Array<number>(players - 2).fill(0), 0.5, 1];
  const share = new Map<number, number>();
  for (const p of new Set(posted)) {
    const pot = 2 * stack + (BLINDS - p - pusherPosted);
    const cost = stack - p;
    let combos = 0;
    for (let c = 0; c < RANGE_CLASSES; c++) {
      if (equityVsTopOfClass(c, pushRangePct) * pot - cost > 0) combos += comboCount(c);
    }
    share.set(p, combos / COMBOS_TOTAL);
  }
  let reach = 1;
  let calledMass = 0;
  let calledEquity = 0;
  for (const p of posted) {
    const s = share.get(p) as number;
    const first = reach * s;
    if (first > 0) {
      calledMass += first;
      calledEquity += first * equityVsTopOfClass(cls, 100 * s);
    }
    reach *= 1 - s;
  }
  return { pfold: reach, eCalled: calledMass > 0 ? calledEquity / calledMass : 0 };
}

export interface UnopenedPushInput {
  cls: number;
  rankPct: number;
  /** Players still to act behind the hero (§8.2 `k`) and the effective stack in big blinds. */
  k: number;
  effBB: number;
  /** Someone limped: shove only the top `0.8 × pushPct`. */
  limped: boolean;
  /** The hero can check (the big blind facing limpers): a non-shove checks instead of folding. */
  canCheck: boolean;
  /** `PreflopStyle.thresholdFactor` (1 for the coach). */
  thresholdFactor: number;
}

/** Unopened or limped pot, short stack: shove the top `pushPct(k, S)`, else fold or check. */
export function unopenedPush(input: UnopenedPushInput): PushFoldVerdict {
  const S = pushFoldStack(input.effBB);
  const behind = pushFoldPlayers(input.k);
  const table = pushPct(behind, S);
  const threshold = Math.min(
    100,
    (input.limped ? PUSH_LIMPERS_FACTOR : 1) * table * input.thresholdFactor,
  );
  const shove = input.rankPct <= threshold;
  if (!shove && input.canCheck) return { move: 'check', trace: [{ code: 'CHECK_FREE', data: {} }] };
  const { pfold, eCalled } = pushOutcome(input.cls, behind, S, table);
  return {
    move: shove ? 'allin' : 'fold',
    trace: [
      {
        code: 'PUSH_FOLD',
        data: {
          action: shove ? 'allin' : 'fold',
          S,
          behind,
          hand: className(input.cls),
          rankPct: input.rankPct,
          pushPct: threshold,
          Pfold: pfold,
          E: eCalled,
        },
      },
    ],
  };
}

export interface ShoveVsRaiseInput {
  cls: number;
  effBB: number;
  /** The raiser's range in percent (§8.3 `V`). */
  V: number;
  /** Chips in the middle now, what the shove risks (chips added that a call can win), and the
   * pot when the raiser calls. */
  pot: number;
  risk: number;
  finalPot: number;
  /** `PreflopStyle.equityNoise` (0 for the coach). */
  equityNoise: number;
}

/** Facing a raise with a short stack: all-in when `EV(shove) > 0`, else fold (§8.4). */
export function shoveVsRaise(input: ShoveVsRaiseInput): PushFoldVerdict & { ev: number } {
  const S = pushFoldStack(input.effBB);
  const calls = callPct(S);
  const share = Math.min(1, calls / input.V);
  const pfold = 1 - share;
  const eCalled = clamp01(
    equityVsTopOfClass(input.cls, Math.min(input.V, calls)) + input.equityNoise,
  );
  const ev = pfold * input.pot + (1 - pfold) * (eCalled * input.finalPot - input.risk);
  const shove = ev > 0;
  return {
    move: shove ? 'allin' : 'fold',
    ev,
    trace: [
      {
        code: 'PUSH_FOLD',
        data: {
          action: shove ? 'allin' : 'fold',
          S,
          hand: className(input.cls),
          V: input.V,
          Pfold: pfold,
          E: eCalled,
          ev,
        },
      },
    ],
  };
}

export interface CallVsAllInInput {
  cls: number;
  /** The hero's equity against the shover's range (and any callers), before noise. */
  E: number;
  need: number;
  /** The shover's range in percent, for the explanation (null when E is a multiway estimate). */
  V: number | null;
  equityNoise: number;
}

/** Facing an all-in: call if `E ≥ need` (R = 1, no implied odds), else fold (§8.4). */
export function callVsAllIn(input: CallVsAllInInput): PushFoldVerdict {
  const E = clamp01(input.E + input.equityNoise);
  const call = E >= input.need;
  const data: Record<string, number | string> = {
    hand: className(input.cls),
    E,
    need: input.need,
  };
  if (input.V !== null) data.V = input.V;
  return {
    move: call ? 'call' : 'fold',
    trace: [{ code: call ? 'CALL_ALLIN' : 'FOLD_ALLIN', data }],
  };
}
