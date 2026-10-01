/**
 * Bet sizing (PLAN §8.7, §8.2 `act = sizing(f, act)`): turns a rule action into a legal "raise
 * to" amount. The coach and Hard bots use the texture table ('texture'; Expert's
 * 'texture+exploit' sizes the same way until the Stage 7 exploits); Easy bots bet 1/2 pot
 * ('half') and Medium bots 1/2 pot or a pot ('two'), §9.2.
 *
 * Formulas (§8.7): a bet fraction f → `to = f × pot`; a raise fraction f →
 * `to = currentBet + f × (pot + toCall)`; the texture table's raise vs a bet → `to = 3 × the bet`
 * in position, 3.5× out of position ("the bet" = the street's highest bet, the amount a call
 * matches). With a texture size set a bet or raise goes all-in when `spr ≤ 1` or when it would
 * leave less than 25% of the pot behind (the effective stack after the bet, against the pot after
 * the bet and one call). Then the amount is rounded to a multiple of the small blind and clamped
 * to the `legalActions` bounds; at or below the call amount the action becomes a call (a check
 * when nothing is to call). Every amount is an integer "to" amount (Known pitfalls 1 and 19).
 */
import { rankOf, suitOf, type Card } from '../core/cards.ts';
import type { LegalActions, PlayerAction } from '../engine/types.ts';
import {
  ALL_IN_BEHIND_SHARE,
  ALL_IN_SPR,
  RAISE_MULT_IP,
  RAISE_MULT_OOP,
  RIVER_POT_SPR,
  SIZE_CBET,
  SIZE_DRY,
  SIZE_DRY_LATE_VALUE,
  SIZE_HALF,
  SIZE_POT,
  SIZE_RIVER_BLUFF,
  SIZE_RIVER_MONSTER,
  SIZE_RIVER_MONSTER_LOW_SPR,
  SIZE_SEMI_BLUFF_DRY,
  SIZE_SEMI_BLUFF_WET,
  SIZE_THIN_VALUE,
  SIZE_VERY_WET,
  SIZE_WET,
  TWO_SIZES_POT_FROM,
} from './tunables.ts';
import type {
  BetPurpose,
  Decision,
  Features,
  PolicyIntent,
  PostflopSpot,
  SizeSet,
  Texture,
} from './types.ts';

/** `Decision.kind`: an all-in bet or raise is 'allin'; a call is 'call' even when it is all-in. */
export type ActionKind = Decision['kind'];

export interface SizedAction {
  action: PlayerAction;
  kind: ActionKind;
}

/** The features the sizing reads. */
export type SizingFeatures = Pick<
  Features,
  'street' | 'pot' | 'toCall' | 'effStack' | 'spr' | 'position' | 'bucket' | 'texture'
>;

const isTextureSet = (sizing: SizeSet): boolean =>
  sizing === 'texture' || sizing === 'texture+exploit';

/** Four distinct board ranks inside one five-rank window (the Ace plays low and high). */
export function fourToAStraight(board: readonly Card[]): boolean {
  let ranks = 0;
  for (const c of board) ranks |= 1 << rankOf(c);
  // Positions 0..13: 0 = Ace low, r + 1 = rank r.
  const line = (ranks << 1) | ((ranks >> 12) & 1);
  for (let low = 0; low + 5 <= 14; low++) {
    let n = 0;
    for (let i = low; i < low + 5; i++) if ((line >> i) & 1) n++;
    if (n >= 4) return true;
  }
  return false;
}

/**
 * The texture row of the §8.7 table: the §8.2 class, except that the boards the "Very wet" row
 * names, monotone (every board card one suit) or four to a straight, size as Very wet even when
 * their W is lower (a disconnected monotone flop scores 2, Wet).
 */
export function sizingTexture(board: readonly Card[], texture: Texture): Texture {
  if (texture === 'veryWet' || board.length === 0) return texture;
  const suit = suitOf(board[0] as Card);
  if (board.every((c) => suitOf(c) === suit) || fourToAStraight(board)) return 'veryWet';
  return texture;
}

/**
 * The texture table's pot fraction for a bet (§8.7; the §8.5 rules name the semi-bluff, thin
 * value and continuation-bet sizes). A value bet on the river: Monster 3/4 pot (a full pot when
 * `spr ≤ 1.5`); any other value bet (Strong) by texture, a Dry board taking the turn's value size
 * (1/2). A bot's river bluff: 2/3 pot; on the flop or turn a bluff takes the texture row.
 */
export function textureBetFraction(
  purpose: BetPurpose,
  f: Pick<Features, 'street' | 'texture' | 'bucket' | 'spr'>,
  board: readonly Card[],
): number {
  const texture = f.texture ?? 'dry';
  const value = purpose === 'value' || purpose === 'protect';
  if (purpose === 'thinValue') return SIZE_THIN_VALUE;
  if (purpose === 'cbet') return SIZE_CBET;
  if (purpose === 'semiBluff') return texture === 'dry' ? SIZE_SEMI_BLUFF_DRY : SIZE_SEMI_BLUFF_WET;
  if (f.street === 'river') {
    if (purpose === 'bluff') return SIZE_RIVER_BLUFF;
    if (f.bucket === 'monster') {
      return f.spr <= RIVER_POT_SPR ? SIZE_RIVER_MONSTER_LOW_SPR : SIZE_RIVER_MONSTER;
    }
  }
  const row = sizingTexture(board, texture);
  if (row === 'veryWet') return SIZE_VERY_WET;
  if (row === 'wet') return SIZE_WET;
  return value && f.street !== 'flop' ? SIZE_DRY_LATE_VALUE : SIZE_DRY;
}

/**
 * A profile's pot fraction for a bet (§9.2 "Sizes"): 'half' always 1/2; 'two' a pot where the
 * texture table says 3/4 or more, else 1/2; the texture sets the table itself.
 */
export function betFraction(
  purpose: BetPurpose,
  f: Pick<Features, 'street' | 'texture' | 'bucket' | 'spr'>,
  board: readonly Card[],
  sizing: SizeSet,
): number {
  if (sizing === 'half') return SIZE_HALF;
  const fraction = textureBetFraction(purpose, f, board);
  if (sizing === 'two') return fraction >= TWO_SIZES_POT_FROM - 1e-9 ? SIZE_POT : SIZE_HALF;
  return fraction;
}

/**
 * The raw raise-to amount (before the all-in rule, rounding and clamping): the texture sets raise
 * to 3× the bet in position and 3.5× out of position; 'half' raises 1/2 pot and 'two' a pot (a
 * Monster's value raise) or 1/2 pot, as raise fractions `currentBet + f × (pot + toCall)`.
 */
export function raiseTarget(
  purpose: BetPurpose,
  f: Pick<Features, 'pot' | 'toCall' | 'position' | 'bucket'>,
  currentBet: number,
  sizing: SizeSet,
): number {
  if (isTextureSet(sizing)) {
    return (f.position === 'IP' ? RAISE_MULT_IP : RAISE_MULT_OOP) * currentBet;
  }
  const big = sizing === 'two' && purpose === 'value' && f.bucket === 'monster';
  return currentBet + (big ? SIZE_POT : SIZE_HALF) * (f.pot + f.toCall);
}

/**
 * §8.7 "Any bet leaving < 25% of the pot behind, or `spr ≤ 1`: all-in". Behind = the effective
 * stack after betting `to` (`effStack − to`); the pot = the pot after this bet and one call.
 */
export function allInByRule(
  to: number,
  f: Pick<Features, 'pot' | 'effStack' | 'spr'>,
  heroStreetBet: number,
  currentBet: number,
): boolean {
  if (f.spr <= ALL_IN_SPR) return true;
  const potAfter = f.pot + (to - heroStreetBet) + (to - currentBet);
  return f.effStack - to < ALL_IN_BEHIND_SHARE * potAfter;
}

/** Check when that is free, else call. */
export function passiveAction(legal: LegalActions): SizedAction {
  return legal.canCheck
    ? { action: { type: 'check' }, kind: 'check' }
    : { action: { type: 'call' }, kind: 'call' };
}

/** The hero's all-in bet or raise (a call when no bet or raise is legal). */
export function allInAction(legal: LegalActions): SizedAction {
  const bounds = legal.bet ?? legal.raise;
  if (bounds === null) return passiveAction(legal);
  return {
    action: { type: legal.bet !== null ? 'bet' : 'raise', to: bounds.max },
    kind: 'allin',
  };
}

/**
 * §8.7 snapping: round `to` to a multiple of the small blind; at or below the call amount ("to":
 * the hero's street bet + the call) the action becomes a call (a check when nothing is to call),
 * as it does when no bet or raise is legal; otherwise clamp to the legal bounds. The legal maximum
 * is the hero's all-in (`kind` 'allin').
 */
export function snapToLegal(
  to: number,
  legal: LegalActions,
  sb: number,
  heroStreetBet: number,
): SizedAction {
  const bounds = legal.bet ?? legal.raise;
  const rounded = Math.round(to / sb) * sb;
  if (bounds === null || !(rounded > heroStreetBet + legal.callAmount)) return passiveAction(legal);
  const t = Math.min(bounds.max, Math.max(bounds.min, rounded));
  const type = legal.bet !== null ? 'bet' : 'raise';
  return { action: { type, to: t }, kind: t === bounds.max ? 'allin' : type };
}

/**
 * The legal action for a rule action (§8.7): fold only when there is something to call (never
 * when checking is free, C6); check or call; a bet or raise sized by the profile's size set, or
 * all-in when the rule asks for it (or, with a texture set, when §8.7's all-in row applies).
 */
export function sizeIntent(
  intent: PolicyIntent,
  f: SizingFeatures,
  spot: Pick<PostflopSpot, 'board' | 'sb' | 'legal' | 'currentBet' | 'heroStreetBet'>,
  sizing: SizeSet = 'texture',
): SizedAction {
  const { legal } = spot;
  if (intent.kind === 'fold') {
    return legal.canFold ? { action: { type: 'fold' }, kind: 'fold' } : passiveAction(legal);
  }
  if (intent.kind === 'check' || intent.kind === 'call') return passiveAction(legal);
  if (legal.bet === null && legal.raise === null) return passiveAction(legal);
  if (intent.allIn) return allInAction(legal);
  const purpose = intent.purpose ?? 'value';
  const to =
    legal.bet !== null
      ? betFraction(purpose, f, spot.board, sizing) * f.pot
      : raiseTarget(purpose, f, spot.currentBet, sizing);
  if (isTextureSet(sizing) && allInByRule(to, f, spot.heroStreetBet, spot.currentBet)) {
    return allInAction(legal);
  }
  return snapToLegal(to, legal, spot.sb, spot.heroStreetBet);
}
