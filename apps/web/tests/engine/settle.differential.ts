/**
 * The settlement differential (PLAN §18 Stage 2, acceptance criterion 3): random multi-way all-in
 * hands played through the real engine (`createTable` → `startHand` → `step` until 'complete'),
 * then the engine's refunds, pots, winners, shares and payouts compared with the independent
 * chip-layer oracle (`settle.oracle.ts`, written from §3.8 alone).
 *
 * Each scenario is a pure function of its seed, so a failure names the seed that reproduces it.
 */
import { deriveSeed, randInt, rngFromSeed, type Rng, type Seed128 } from '../../src/core/rng.ts';
import type { Card } from '../../src/core/cards.ts';
import { score7 } from '../../src/eval/evaluate.ts';
import { checkInvariants } from '../../src/engine/invariants.ts';
import { legalActions } from '../../src/engine/legal.ts';
import { startHand } from '../../src/engine/start.ts';
import { step } from '../../src/engine/step.ts';
import type { EngineInput, HandState, LegalActions } from '../../src/engine/types.ts';
import { rigDeck, tableWith } from './helpers.ts';
import { settleOracle, type OracleInput } from './settle.oracle.ts';

const BIG_BLINDS = [2, 10, 20, 100] as const;

/** Board rigs that make ties: everyone plays a royal flush; quads on the board (kickers decide). */
const TIE_BOARDS = ['As Ks Qs Js Ts', '2c 2d 2h 2s Kd', '9c 9d 9h 5s 5c'] as const;

/**
 * A stack for an all-in scenario: sometimes none (not dealt in), tiny (below a bb), a round
 * number of big blinds (so totals often meet at the same level), or any odd amount.
 */
function stackFor(rng: Rng, bb: number, pool: readonly number[]): number {
  const r = randInt(rng, 20);
  if (r === 0) return 0;
  if (r <= 3) return 1 + randInt(rng, bb);
  if (r <= 8) return pool[randInt(rng, pool.length)] as number;
  return 1 + randInt(rng, 200 * bb);
}

/**
 * The all-in-heavy policy: facing a bet, shove (a raise to the maximum) 35% of the time when a
 * raise is allowed, fold 20%, otherwise call; with no bet, shove 30% of the time, otherwise
 * check. Some raises are minimum raises, so short and full raises mix.
 */
function allInAction(legal: LegalActions, rng: Rng): EngineInput {
  const seat = legal.seat;
  const r = randInt(rng, 100);
  const act = (action: Extract<EngineInput, { kind: 'act' }>['action']): EngineInput => ({
    kind: 'act',
    seat,
    action,
  });
  if (legal.canCheck) {
    if (legal.bet !== null && r < 30) {
      return act({ type: 'bet', to: r < 25 ? legal.bet.max : legal.bet.min });
    }
    return act({ type: 'check' });
  }
  if (legal.raise !== null && r < 35) {
    return act({ type: 'raise', to: r < 28 ? legal.raise.max : legal.raise.min });
  }
  if (r < 55) return act({ type: 'fold' });
  return act({ type: 'call' });
}

/** One random multi-way all-in hand, played to 'complete' through the real engine. */
export function allInHand(seed: Seed128): HandState {
  const rng = rngFromSeed(deriveSeed(seed, 'policy'));
  const n = 2 + randInt(rng, 8);
  const bb = BIG_BLINDS[randInt(rng, BIG_BLINDS.length)] as number;
  const pool = [1, 2, 3, 5, 8, 13, 20].map((x) => x * bb + randInt(rng, 2));
  const stacks = Array.from({ length: n }, () => stackFor(rng, bb, pool));
  if (stacks.filter((s) => s > 0).length < 2) {
    stacks[0] = 7 * bb + 1;
    stacks[1] = 3 * bb;
  }
  const startingStack = Math.min(1_000_000, Math.max(200, 100 * bb));
  const table = tableWith(stacks, {
    sb: bb / 2,
    bb,
    startingStack,
    tableSeed: deriveSeed(seed, 'table'),
  });
  let h = startHand(table, deriveSeed(seed, 'hand'));
  const rig = randInt(rng, 10);
  if (rig < TIE_BOARDS.length) h = rigDeck(h, { board: TIE_BOARDS[rig] as string });
  for (let inputs = 0; h.phase !== 'complete'; inputs++) {
    if (inputs > 400) throw new Error(`scenario ${seed}: more than 400 inputs`);
    const legal = legalActions(h);
    h = step(h, legal === null ? { kind: 'advance' } : allInAction(legal, rng));
  }
  return h;
}

/** Chips each seat got back as uncalled bets, from the log. */
export function refundsOf(h: HandState): number[] {
  const refunds = new Array<number>(h.seats.length).fill(0);
  for (const ev of h.log) {
    if (ev.e === 'refund') refunds[ev.seat] = (refunds[ev.seat] as number) + ev.amount;
  }
  return refunds;
}

/**
 * The oracle's input for a finished hand. `beforeRefunds`: each seat's chips as it put them in
 * (the engine's totals plus its refunds), so the oracle must find the refunds itself; otherwise
 * the engine's totals after refunds, so the oracle must find none. Strengths are the live
 * seats' `score7` at a showdown; a hand won by folds compares nothing.
 */
export function oracleInput(h: HandState, beforeRefunds: boolean): OracleInput {
  const r = h.result;
  if (r === null) throw new Error('the hand is not complete');
  const refunds = refundsOf(h);
  return {
    seatCount: h.seats.length,
    button: h.button,
    seats: h.seats.map((s, i) => {
      const live = s.dealtIn && !s.folded;
      return {
        contributed: s.dealtIn ? s.totalBet + (beforeRefunds ? (refunds[i] as number) : 0) : 0,
        folded: !live,
        strength:
          live && r.endedBy === 'showdown'
            ? score7([...(s.hole as [Card, Card]), ...h.board], 7)
            : null,
      };
    }),
  };
}

/**
 * Compares a complete hand's settlement with the oracle, both ways (before and after refunds).
 * Returns null when they agree, else a description of the first difference.
 */
export function differenceFromOracle(h: HandState): string | null {
  const r = h.result;
  if (r === null) return 'the hand is not complete';
  const refunds = refundsOf(h);
  const awards = r.pots.map((_, p) => {
    const ev = h.log.find((e) => e.e === 'award' && e.pot === p);
    return ev?.e === 'award' ? ev.amounts : null;
  });
  const engine = (beforeRefunds: boolean): string =>
    JSON.stringify({
      refunds: beforeRefunds ? refunds : refunds.map(() => 0),
      pots: r.pots.map((pot, p) => ({
        amount: pot.amount,
        eligible: pot.eligible,
        winners: r.potWinners[p],
        shares: awards[p],
      })),
      payouts: r.payouts.map((x, i) => x + (beforeRefunds ? (refunds[i] as number) : 0)),
    });
  for (const beforeRefunds of [true, false]) {
    const o = settleOracle(oracleInput(h, beforeRefunds));
    const oracle = JSON.stringify({
      refunds: o.refunds,
      pots: o.pots.map((pot) => ({
        amount: pot.amount,
        eligible: pot.eligible,
        winners: pot.winners,
        shares: pot.shares,
      })),
      payouts: o.payouts,
    });
    const mine = engine(beforeRefunds);
    if (mine !== oracle) {
      return `${beforeRefunds ? 'before' : 'after'} refunds:\n engine ${mine}\n oracle ${oracle}`;
    }
  }
  return null;
}

/** How often the scenarios hit each settlement feature (so agreement means something). */
export interface Coverage {
  hands: number;
  showdowns: number;
  foldWins: number;
  sidePots: number; // hands with two or more pots
  threePlusPots: number;
  splitPots: number; // pots with two or more winners
  oddChips: number; // split pots with a remainder
  foldedMoney: number; // hands where a folded seat's chips are in a pot
  refundToFolded: number;
  notDealtIn: number;
}

export function emptyCoverage(): Coverage {
  return {
    hands: 0,
    showdowns: 0,
    foldWins: 0,
    sidePots: 0,
    threePlusPots: 0,
    splitPots: 0,
    oddChips: 0,
    foldedMoney: 0,
    refundToFolded: 0,
    notDealtIn: 0,
  };
}

export function count(c: Coverage, h: HandState): void {
  const r = h.result;
  if (r === null) return;
  c.hands++;
  if (r.endedBy === 'showdown') c.showdowns++;
  else c.foldWins++;
  if (r.pots.length >= 2) c.sidePots++;
  if (r.pots.length >= 3) c.threePlusPots++;
  r.pots.forEach((pot, p) => {
    const k = (r.potWinners[p] as number[]).length;
    if (k >= 2) c.splitPots++;
    if (k >= 2 && pot.amount % k !== 0) c.oddChips++;
  });
  if (h.seats.some((s) => s.folded && s.totalBet > 0)) c.foldedMoney++;
  const refunds = refundsOf(h);
  if (h.seats.some((s, i) => s.folded && (refunds[i] as number) > 0)) c.refundToFolded++;
  if (h.seats.some((s) => !s.dealtIn)) c.notDealtIn++;
}

/**
 * Runs scenarios `from` .. `from + hands − 1` of `root` and checks each against the oracle and the
 * invariants (the log replay included). Throws with the scenario seed on the first disagreement.
 */
export function runDifferential(root: Seed128, from: number, hands: number): Coverage {
  const c = emptyCoverage();
  for (let i = from; i < from + hands; i++) {
    const seed = deriveSeed(root, 'settle-diff', i);
    const h = allInHand(seed);
    checkInvariants(h, { replayLog: true });
    const diff = differenceFromOracle(h);
    if (diff !== null) throw new Error(`scenario ${i} (seed ${seed}) disagrees: ${diff}`);
    count(c, h);
  }
  return c;
}

/**
 * Each settlement feature must show up in at least this share of the hands, so that agreement
 * with the oracle means something (the rates seen on 100,000 hands are several times higher).
 */
const MIN_SHARE: Record<Exclude<keyof Coverage, 'hands'>, number> = {
  showdowns: 0.3,
  foldWins: 0.05,
  sidePots: 0.2,
  threePlusPots: 0.05,
  splitPots: 0.05,
  oddChips: 0.01,
  foldedMoney: 0.2,
  refundToFolded: 0.001,
  notDealtIn: 0.05,
};

/** Calls `check(name, count, min)` for every feature's count and its required minimum. */
export function expectEveryFeature(
  c: Coverage,
  check: (name: string, count: number, min: number) => void,
): void {
  for (const [name, share] of Object.entries(MIN_SHARE)) {
    check(name, c[name as keyof typeof MIN_SHARE], Math.floor(share * c.hands));
  }
}
