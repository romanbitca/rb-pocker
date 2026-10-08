/**
 * Synthetic postflop decisions for the policy and sizing tests: real cards (so the hand, draws,
 * outs and texture are the real §6 / §8.2 values), with the equity, pot, price, stacks and
 * position chosen by the test. `legal` follows the engine's rules (§3.5): a bet from the big
 * blind to all-in when nothing is to call; facing a bet, a raise from a full raise to all-in when
 * the hero has more than the call.
 */
import { countBeaters, findDraws, findOuts } from '../../src/analysis/handinfo.ts';
import { bucketOf, textureOf } from '../../src/brain/features.ts';
import type { Facing, Features, PostflopSpot, Position } from '../../src/brain/types.ts';
import { parseCards, type Card } from '../../src/core/cards.ts';
import type { LegalActions, Street } from '../../src/engine/types.ts';
import { describe as describeHand } from '../../src/eval/describe.ts';

export interface SynthSpec {
  /** "Ah Kh". */
  hole: string;
  /** Three to five cards. */
  board: string;
  /** eRange (also eRandom). */
  E: number;
  nOpp?: number;
  /** Σ totalBet, the bet faced included. */
  pot: number;
  /** The chips a call puts in (0: nothing to call). */
  toCall?: number;
  /** Defaults to `pot`. */
  winPot?: number;
  /** Defaults to 10. */
  spr?: number;
  /** Defaults to `spr × (pot − street bets)`. */
  effStack?: number;
  position?: Position;
  aggressor?: boolean;
  /** Defaults to 'none' / 'bet'. */
  facing?: Facing;
  /** Chips behind before acting (default 10,000). */
  heroStack?: number;
  heroStreetBet?: number;
  /** Defaults to `heroStreetBet + toCall`. */
  currentBet?: number;
  /** Defaults to min(heroStack − call, 10,000). */
  stackBehind?: number;
  heroBetStreets?: number;
  /** Default: the call is all-in, or the hero faces the all-in of its only opponent. */
  callEndsBetting?: boolean;
  bb?: number;
  /** Overrides for the computed legal actions. */
  legal?: Partial<LegalActions>;
}

export interface Synth {
  f: Features;
  spot: PostflopSpot;
}

const STREETS: Record<number, Street> = { 3: 'flop', 4: 'turn', 5: 'river' };

export function synthLegal(
  toCall: number,
  heroStack: number,
  heroStreetBet: number,
  currentBet: number,
  bb: number,
): LegalActions {
  const allInTo = heroStreetBet + heroStack;
  const raiseInc = Math.max(bb, currentBet);
  return {
    seat: 0,
    toCall,
    callAmount: Math.min(toCall, heroStack),
    callIsAllIn: toCall > 0 && heroStack <= toCall,
    canFold: toCall > 0,
    canCheck: toCall === 0,
    canCall: toCall > 0,
    bet: toCall === 0 && currentBet === 0 ? { min: Math.min(bb, allInTo), max: allInTo } : null,
    raise:
      toCall > 0 && heroStack > toCall
        ? { min: Math.min(currentBet + raiseInc, allInTo), max: allInTo }
        : null,
  };
}

export function synth(spec: SynthSpec): Synth {
  const hole = parseCards(spec.hole) as [Card, Card];
  const board = parseCards(spec.board);
  const street = STREETS[board.length] as Street;
  const nOpp = spec.nOpp ?? 1;
  const toCall = spec.toCall ?? 0;
  const winPot = spec.winPot ?? spec.pot;
  const bb = spec.bb ?? 100;
  const heroStack = spec.heroStack ?? 10000;
  const heroStreetBet = spec.heroStreetBet ?? 0;
  const currentBet = spec.currentBet ?? heroStreetBet + toCall;
  const spr = spec.spr ?? 10;
  const streetBets = heroStreetBet + currentBet;
  const effStack = spec.effStack ?? Math.round(spr * Math.max(1, spec.pot - streetBets));
  const p = nOpp === 0 ? 1 : spec.E ** (1 / nOpp);
  const draws = street === 'river' ? [] : findDraws(hole, board);
  const outCards = street === 'river' ? [] : findOuts(hole, board);
  const legal = { ...synthLegal(toCall, heroStack, heroStreetBet, currentBet, bb), ...spec.legal };
  const beaters = countBeaters(hole, board);
  const f: Features = {
    street,
    pot: spec.pot,
    toCall,
    winPot,
    need: toCall > 0 ? toCall / (winPot + toCall) : 0,
    effStack,
    effBB: effStack / bb,
    spr,
    k: 0,
    position: spec.position ?? 'IP',
    nOpp,
    eRandom: spec.E,
    eRange: spec.E,
    p,
    bucket: bucketOf(p, outCards.length, street),
    texture: textureOf(board),
    facing: spec.facing ?? (toCall > 0 ? 'bet' : 'none'),
    wasPreflopAggressor: spec.aggressor ?? false,
    handInfo: describeHand(hole, board),
    draws,
    outs: outCards.length,
    rankPct: 50,
    rangeAdjust: false,
    ranges: [],
  };
  const spot: PostflopSpot = {
    hole,
    board,
    sb: bb / 2,
    bb,
    legal,
    currentBet,
    heroStreetBet,
    heroStack,
    stackBehind: spec.stackBehind ?? Math.max(0, Math.min(heroStack - legal.callAmount, 10000)),
    outCards,
    nuts: beaters !== null && beaters.count === 0,
    heroBetStreets: spec.heroBetStreets ?? 0,
    callEndsBetting:
      spec.callEndsBetting ?? (legal.callIsAllIn || (f.facing === 'allin' && nOpp === 1)),
  };
  return { f, spot };
}
