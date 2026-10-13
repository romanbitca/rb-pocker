/**
 * The action bar and sizing tray view model (PLAN §12.7), plus the amount maths the two
 * components share. Pure functions of plain data, except the `useSizing` hook at the end.
 *
 * ⚠️ Every amount here is a **"to" amount** (the seat's total for the street), never "raise by"
 * (PLAN §0.3, Known pitfall 1). The legal bounds always come from the engine's `legalActions`
 * (`LegalActions.bet` / `.raise`); this file never derives a bound itself. Preset sizes are
 * targets computed with the §8.7 formulas, rounded to a multiple of the small blind (pitfall 19)
 * and then checked against those bounds: out of range → disabled (§12.7). Whatever the player
 * does (preset, slider, ±, typed amount), `snapAmount` keeps the result a multiple of the small
 * blind inside the bounds; only the bounds themselves (the minimum raise and all-in) may be odd.
 */
import { useCallback, useState } from 'react';
import type { LegalActions, PlayerAction, Street } from '../engine/types.ts';
import { en } from '../i18n/en.ts';

/** `Settings.amounts` (PLAN Appendix A.7): show amounts as chips or as big blinds. */
export type AmountUnit = 'chips' | 'bb';

/**
 * Per seat (index = seat), what the pot maths needs. `HandState.seats` fits as it is. Seats that
 * are not dealt in have `totalBet` 0, so they add nothing.
 */
export interface SeatChips {
  readonly dealtIn: boolean;
  readonly folded: boolean;
  readonly allIn: boolean;
  /** Chips in this hand (PLAN §0.3: `pot` = Σ `totalBet`). */
  readonly totalBet: number;
}

/** What `actionBarView` needs. The Table screen reads it from the store's hand state. */
export interface ActionBarInput {
  /**
   * `legalActions(hand)` while the hero is to act and the controller waits for a tap; `null`
   * otherwise (a bot's turn, grading, an animation, between hands): the bar shows "Waiting…".
   */
  readonly legal: LegalActions | null;
  readonly street: Street;
  /** `HandState.currentBet`: the street total the seat to act faces (0 = nobody has bet). */
  readonly currentBet: number;
  readonly sb: number;
  readonly bb: number;
  readonly seats: readonly SeatChips[];
  /** `Settings.amounts`. */
  readonly amounts: AmountUnit;
}

/** One Row A button (PLAN §12.7). */
export interface BarButton {
  /** The visible text and the accessible name: buttons carry full text ("Call 40", §12.12). */
  readonly label: string;
  /** `false`: drawn at 40% and does not act (PLAN §12.7). */
  readonly enabled: boolean;
  /** What one tap sends. `null`: the button opens the tray, or does nothing (disabled). */
  readonly action: PlayerAction | null;
  /** Why a disabled button is disabled, shown when it is tapped ("Checking is free…"). */
  readonly note: string | null;
}

/** The middle button: Check, Call, Call all-in, or "Waiting…". */
export interface MiddleButton extends BarButton {
  /**
   * A second line, only under a short all-in call: "Pot you can win 150" (PLAN §0.3 `winPot`:
   * the part of the bet the hero cannot match is not theirs to win).
   */
  readonly sub: string | null;
}

/** The right button: "Bet ▲" / "Raise ▲" (opens the tray), "All-in 380", or a disabled "Raise". */
export interface RightButton extends BarButton {
  /** Tapping it opens the sizing tray; with the tray open it confirms the tray's amount. */
  readonly opensTray: boolean;
}

/** The price of calling (PLAN §0.3), for the price chip (§7.6) and the coach. */
export interface PriceView {
  /** What calling puts in: `min(toCall, stack)`. */
  readonly toCall: number;
  /** Every chip in the middle (Σ `totalBet`). */
  readonly pot: number;
  /** The part of the pot the hero can win (§0.3); equals `pot` unless the call is a short all-in. */
  readonly winPot: number;
  /** `toCall / (winPot + toCall)`, 0..1. */
  readonly need: number;
  /** `need` as a whole-number percentage (Appendix F: whole numbers only). */
  readonly needPercent: number;
}

/** The sizing tray's preset chips (PLAN §12.7). */
export type PresetId =
  'third' | 'half' | 'twoThirds' | 'pot' | 'bb25' | 'bb3' | 'bb4' | 'min' | 'x25' | 'x3' | 'allIn';

export interface PresetView {
  readonly id: PresetId;
  /** Chip text: "½ pot", "2.5×", "3 BB", "All-in". */
  readonly label: string;
  /** For screen readers: "Half the pot". */
  readonly spoken: string;
  /** The "to" amount. A multiple of the small blind, except the minimum raise and all-in. */
  readonly amount: number;
  /** `amount` formatted in the player's unit ("60" or "3 BB"). */
  readonly amountText: string;
  /** Out-of-range presets are disabled (PLAN §12.7). */
  readonly enabled: boolean;
}

/** Everything the sizing tray shows and needs. Present only when the right button opens it. */
export interface TrayView {
  readonly kind: 'bet' | 'raise';
  /** Legal "to" bounds, from `legalActions` (never computed here). `min < max`. */
  readonly min: number;
  readonly max: number;
  readonly sb: number;
  readonly bb: number;
  readonly amounts: AmountUnit;
  /** Equal amounts are merged; the order is the §12.7 order. */
  readonly presets: readonly PresetView[];
  /** Where the tray starts: the middle preset (bet ½ pot, open 2.5 BB, raise 2.5×), clamped. */
  readonly start: number;
}

export interface ActionBarView {
  /** Not the hero's turn: every button disabled at 40%, the middle one reads "Waiting…". */
  readonly waiting: boolean;
  readonly fold: BarButton;
  readonly middle: MiddleButton;
  /** `null`: hidden, and the middle button takes its place (a call that puts the hero all-in). */
  readonly right: RightButton | null;
  /** Present exactly when `right.opensTray` is true and the bar is not waiting. */
  readonly tray: TrayView | null;
  /** Present when the hero faces a bet. The bar itself shows only `middle.sub` from it. */
  readonly price: PriceView | null;
}

const FOLD: PlayerAction = { type: 'fold' };
const CHECK: PlayerAction = { type: 'check' };
const CALL: PlayerAction = { type: 'call' };

// ---------------------------------------------------------------------------------------------
// Formatting

/** 2340 → "2,340": English grouping whatever the device locale (every string is English, §0.3). */
export function formatChips(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Chips as big blinds with one decimal only when needed (Appendix F: "2.5 BB"): 130 at a big blind
 * of 20 → "6.5"; 120 → "6". Rounded to the nearest tenth.
 */
export function formatBigBlinds(chips: number, bb: number): string {
  const tenths = Math.round((chips * 10) / bb);
  const whole = formatChips(Math.floor(tenths / 10));
  const decimal = tenths % 10;
  return decimal === 0 ? whole : `${whole}.${decimal}`;
}

/** An amount in the player's unit: "2,340" or "117 BB". */
export function formatAmount(chips: number, bb: number, unit: AmountUnit): string {
  return unit === 'bb' ? en.amounts.bb(formatBigBlinds(chips, bb)) : formatChips(chips);
}

// ---------------------------------------------------------------------------------------------
// Pot maths (PLAN §0.3)

/** Every chip in the middle: Σ `totalBet`. */
export function potOf(seats: readonly SeatChips[]): number {
  return seats.reduce((sum, s) => sum + s.totalBet, 0);
}

/**
 * ⚠️ The pot the hero can win (PLAN §0.3): `hero.totalBet + Σ over the other dealt-in seats of
 * min(s.totalBet, T)`, with `T = hero.totalBet + callAmount` the hero's total after calling
 * (`callAmount` already capped at the stack). Equal to the pot unless the hero cannot cover the
 * bet (pitfall 18). Folded seats count: their chips are in the pot.
 */
export function winPot(seats: readonly SeatChips[], hero: number, callAmount: number): number {
  const heroTotal = seats[hero]?.totalBet ?? 0;
  const total = heroTotal + callAmount;
  return seats.reduce(
    (sum, s, i) => (i !== hero && s.dealtIn ? sum + Math.min(s.totalBet, total) : sum),
    heroTotal,
  );
}

/** The price of calling `callAmount` (PLAN §0.3): `need = toCall / (winPot + toCall)`. */
export function priceOf(seats: readonly SeatChips[], hero: number, callAmount: number): PriceView {
  const pot = potOf(seats);
  const canWin = winPot(seats, hero, callAmount);
  const need = callAmount === 0 ? 0 : callAmount / (canWin + callAmount);
  return { toCall: callAmount, pot, winPot: canWin, need, needPercent: Math.round(need * 100) };
}

// ---------------------------------------------------------------------------------------------
// Amounts: snapping, the slider's steps, presets

/** Legal bounds and the small blind: what the amount helpers need from a `TrayView`. */
export type Bounds = Pick<TrayView, 'min' | 'max' | 'sb'>;

/** The nearest multiple of the small blind (pitfall 19: no fractional chips reach the engine). */
export function roundToSmallBlind(amount: number, sb: number): number {
  return Math.round(amount / sb) * sb;
}

/**
 * Any amount → the nearest legal "to" amount: a multiple of the small blind inside `[min, max]`,
 * or a bound itself (the minimum raise and all-in may be odd amounts). Past a bound → that bound.
 * Halfway between two → the larger, like `Math.round`.
 */
export function snapAmount(amount: number, t: Bounds): number {
  if (!(amount > t.min)) return t.min; // also NaN
  if (amount >= t.max) return t.max;
  const down = Math.floor(amount / t.sb) * t.sb;
  let best = t.min;
  for (const c of [down, down + t.sb, t.max]) {
    const gap = Math.abs(amount - c);
    const bestGap = Math.abs(amount - best);
    if (c >= t.min && c <= t.max && (gap < bestGap || (gap === bestGap && c > best))) best = c;
  }
  return best;
}

/** The smallest multiple of the small blind above `min`. */
const firstStep = (t: Bounds): number => (Math.floor(t.min / t.sb) + 1) * t.sb;
/** The largest multiple of the small blind below `max`. */
const lastStep = (t: Bounds): number => (Math.ceil(t.max / t.sb) - 1) * t.sb;

/**
 * How many positions the slider has: `min`, every multiple of the small blind strictly between
 * the bounds, and `max` (PLAN §12.7 "step = SB"). The positions are computed, never listed, so a
 * 1,000,000-chip stack costs nothing.
 */
export function stepCount(t: Bounds): number {
  if (t.max <= t.min) return 1;
  const first = firstStep(t);
  const last = lastStep(t);
  return (last >= first ? (last - first) / t.sb + 1 : 0) + 2;
}

/** The amount at slider position `index` (clamped to the ends). */
export function amountAt(t: Bounds, index: number): number {
  const last = stepCount(t) - 1;
  if (index <= 0) return t.min;
  if (index >= last) return t.max;
  return firstStep(t) + (Math.round(index) - 1) * t.sb;
}

/** The slider position of `amount` (the nearest one when it is between two). */
export function indexOfAmount(t: Bounds, amount: number): number {
  const last = stepCount(t) - 1;
  if (!(amount > t.min)) return 0;
  if (amount >= t.max) return last;
  const index = Math.round((amount - firstStep(t)) / t.sb) + 1;
  return Math.min(last, Math.max(0, index));
}

/** One slider step from `amount` (± one small blind, PLAN §12.7 [−] / [+]). */
export function stepAmount(t: Bounds, amount: number, delta: number): number {
  return amountAt(t, indexOfAmount(t, amount) + delta);
}

/** While dragging, the slider snaps to an enabled preset within ±2% of it (PLAN §12.7). */
export function snapToPreset(t: TrayView, amount: number): number {
  let best = amount;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const p of t.presets) {
    const gap = Math.abs(amount - p.amount);
    if (p.enabled && gap <= p.amount * 0.02 && gap < bestGap) {
      best = p.amount;
      bestGap = gap;
    }
  }
  return best;
}

/** The action the tray's amount sends: `{ type: 'bet' | 'raise', to }`, always legal. */
export function trayAction(t: TrayView, amount: number): PlayerAction {
  return { type: t.kind, to: snapAmount(amount, t) };
}

/** Row A's right button while the tray is open: "Bet 120", "Raise to 120" or "All-in 2,340". */
export function trayActionLabel(t: TrayView, amount: number): string {
  const to = snapAmount(amount, t);
  const text = formatAmount(to, t.bb, t.amounts);
  if (to === t.max) return en.actions.allIn(text);
  return t.kind === 'bet' ? en.actions.betTo(text) : en.actions.raiseTo(text);
}

/** The slider's `aria-valuetext` (PLAN §12.7): "Raise to 120, 6 big blinds". */
export function sliderValueText(t: TrayView, amount: number): string {
  const to = snapAmount(amount, t);
  const other =
    t.amounts === 'bb'
      ? en.sizing.chips(formatChips(to))
      : en.sizing.bigBlinds(formatBigBlinds(to, t.bb), to === t.bb);
  return en.sizing.valueText(trayActionLabel(t, to), other);
}

/** The typed-amount field's text: "2,340" (chips) or "6.5" (big blinds). */
export function amountFieldText(t: TrayView, amount: number): string {
  return t.amounts === 'bb' ? formatBigBlinds(amount, t.bb) : formatChips(amount);
}

/**
 * A typed amount → a legal "to" amount (clamped, PLAN §12.7), or `null` when there is no number.
 * Chips: every non-digit is dropped ("2,340" → 2340). Big blinds: "6.5" or "6,5".
 */
export function parseAmount(text: string, t: TrayView): number | null {
  if (t.amounts === 'bb') {
    const value = Number.parseFloat(text.replace(',', '.').replace(/[^\d.]/g, ''));
    return Number.isFinite(value) ? snapAmount(Math.round(value * t.bb), t) : null;
  }
  const digits = text.replace(/\D/g, '');
  return digits === '' ? null : snapAmount(Number(digits), t);
}

interface PresetSpec {
  readonly id: PresetId;
  /** The target "to" amount before rounding. */
  readonly target: number;
  /** A bound itself (the minimum raise, all-in): used as it is, never rounded. */
  readonly exact?: boolean;
}

/**
 * The §12.7 preset list for this spot, with the §8.7 formulas: bet fraction f → `to = f × pot`;
 * raise fraction f → `to = currentBet + f × (pot + toCall)` (Pot: f = 1); 2.5× and 3× = that many
 * times the bet faced; preflop opens in big blinds. `currentBet` here is only a sizing reference:
 * the bounds still come from `legalActions`.
 */
function presetSpecs(
  kind: 'bet' | 'raise',
  bounds: { min: number; max: number },
  input: ActionBarInput,
  toCall: number,
): { specs: PresetSpec[]; middle: PresetId } {
  const pot = potOf(input.seats);
  const allIn: PresetSpec = { id: 'allIn', target: bounds.max, exact: true };
  if (kind === 'bet') {
    return {
      specs: [
        { id: 'third', target: pot / 3 },
        { id: 'half', target: pot / 2 },
        { id: 'twoThirds', target: (pot * 2) / 3 },
        { id: 'pot', target: pot },
        allIn,
      ],
      middle: 'half',
    };
  }
  // An open: preflop, nobody has raised the big blind yet (limpers or the big blind's option).
  if (input.street === 'preflop' && input.currentBet <= input.bb) {
    return {
      specs: [
        { id: 'bb25', target: 2.5 * input.bb },
        { id: 'bb3', target: 3 * input.bb },
        { id: 'bb4', target: 4 * input.bb },
        allIn,
      ],
      middle: 'bb25',
    };
  }
  return {
    specs: [
      { id: 'min', target: bounds.min, exact: true },
      { id: 'x25', target: 2.5 * input.currentBet },
      { id: 'x3', target: 3 * input.currentBet },
      { id: 'pot', target: input.currentBet + pot + toCall },
      allIn,
    ],
    middle: 'x25',
  };
}

function trayView(
  kind: 'bet' | 'raise',
  bounds: { min: number; max: number },
  input: ActionBarInput,
  toCall: number,
): TrayView {
  const { sb, bb, amounts } = input;
  const { specs, middle } = presetSpecs(kind, bounds, input, toCall);
  const presets: PresetView[] = [];
  for (const spec of specs) {
    const amount = spec.exact === true ? spec.target : roundToSmallBlind(spec.target, sb);
    const text = en.sizing.preset[spec.id];
    const preset: PresetView = {
      id: spec.id,
      label: text.label,
      spoken: text.spoken,
      amount,
      amountText: formatAmount(amount, bb, amounts),
      enabled: amount >= bounds.min && amount <= bounds.max,
    };
    // Equal amounts are merged (PLAN §12.7); the all-in chip keeps its name, it says the most.
    const same = presets.findIndex((p) => p.amount === amount);
    if (same === -1) presets.push(preset);
    else if (spec.id === 'allIn') presets[same] = preset;
  }
  const middleTarget = specs.find((s) => s.id === middle)?.target ?? bounds.min;
  const t = { min: bounds.min, max: bounds.max, sb };
  return { kind, ...t, bb, amounts, presets, start: snapAmount(middleTarget, t) };
}

// ---------------------------------------------------------------------------------------------
// The view model

const disabled = (label: string, note: string | null = null): BarButton => ({
  label,
  enabled: false,
  action: null,
  note,
});

/**
 * Row A and the tray for this moment (PLAN §12.7):
 *
 * | Situation                        | Left            | Middle              | Right                  |
 * |----------------------------------|-----------------|---------------------|------------------------|
 * | No bet to face                   | Fold (disabled) | Check               | Bet ▲                  |
 * | Facing a bet                     | Fold            | Call 40             | Raise ▲                |
 * | Call puts the hero all-in        | Fold            | Call all-in 380     | hidden; middle widens  |
 * | Raise not allowed (not reopened) | Fold            | Call 40             | Raise (disabled)       |
 * | Only one legal amount            | …               | …                   | All-in 380, one tap    |
 * | Not the hero's turn              | all disabled; middle "Waiting…"                            |
 *
 * When everyone else is all-in there is nobody to raise against, so the right button is hidden
 * too (the engine offers no bet or raise without a responder, §3.5).
 */
/**
 * Row A while the Advanced quiz asks (§10.3): the same buttons with their own labels, all
 * disabled until the quiz is answered or skipped; a tap says why (`note`). The tray stays shut.
 */
export function lockedView(view: ActionBarView, note: string): ActionBarView {
  if (view.waiting) return view;
  const lock = <B extends BarButton>(b: B): B => ({ ...b, enabled: false, action: null, note });
  return {
    ...view,
    fold: lock(view.fold),
    middle: lock(view.middle),
    right: view.right === null ? null : { ...lock(view.right), opensTray: false },
    tray: null,
  };
}

export function actionBarView(input: ActionBarInput): ActionBarView {
  const t = en.actions;
  const { legal } = input;
  if (legal === null) {
    const right = { ...disabled(input.currentBet === 0 ? t.bet : t.raise), opensTray: true };
    return {
      waiting: true,
      fold: disabled(t.fold),
      middle: { ...disabled(t.waiting), sub: null },
      right,
      tray: null,
      price: null,
    };
  }

  const format = (chips: number): string => formatAmount(chips, input.bb, input.amounts);
  const hero = legal.seat;
  const price = legal.canCall ? priceOf(input.seats, hero, legal.callAmount) : null;

  // Folding when a check is free is illegal (§3.5): the slot stays, disabled, and explains why.
  const fold: BarButton = legal.canFold
    ? { label: t.fold, enabled: true, action: FOLD, note: null }
    : disabled(t.fold, t.foldNotNeeded);

  let middle: MiddleButton;
  if (legal.canCheck) {
    middle = { label: t.check, enabled: true, action: CHECK, note: null, sub: null };
  } else {
    const amount = format(legal.callAmount);
    const short = price !== null && price.winPot < price.pot;
    middle = {
      label: legal.callIsAllIn ? t.callAllIn(amount) : t.call(amount),
      enabled: true,
      action: CALL,
      note: null,
      sub: short ? t.potYouCanWin(format(price.winPot)) : null,
    };
  }

  const kind = legal.bet !== null ? 'bet' : 'raise';
  const bounds = legal.bet ?? legal.raise;
  let right: RightButton | null = null;
  let tray: TrayView | null = null;
  if (bounds !== null && bounds.min === bounds.max) {
    // Only one legal amount: all-in, on one tap, no tray (§12.7).
    right = {
      label: t.allIn(format(bounds.max)),
      enabled: true,
      action: { type: kind, to: bounds.max },
      note: null,
      opensTray: false,
    };
  } else if (bounds !== null) {
    right = {
      label: kind === 'bet' ? t.bet : t.raise,
      enabled: true,
      action: null,
      note: null,
      opensTray: true,
    };
    tray = trayView(kind, bounds, input, legal.toCall);
  } else if (legal.canCall && !legal.callIsAllIn && hasResponder(input.seats, hero)) {
    // Chips behind and an opponent who could answer, yet no raise: a short all-in did not
    // reopen the betting (§3.6, TDA r.47).
    right = { ...disabled(t.raise, t.cannotRaise), opensTray: false };
  }

  return { waiting: false, fold, middle, right, tray, price };
}

/** §3.5 "a responder exists": another dealt-in seat that is neither folded nor all-in. */
function hasResponder(seats: readonly SeatChips[], hero: number): boolean {
  return seats.some((s, i) => i !== hero && s.dealtIn && !s.folded && !s.allIn);
}

// ---------------------------------------------------------------------------------------------
// Tray state for the screen that places the bar and the tray

export interface Sizing {
  /** The tray is open (never while the bar has no tray). */
  readonly open: boolean;
  /** The tray's current "to" amount; meaningful while `open`. */
  readonly amount: number;
  readonly openTray: () => void;
  /**
   * Closes the tray. The tray's ✕, Esc and a tap outside call it, and so should the controller's
   * Android Back handling (PLAN §12.1: Back closes the top-most overlay, never the table).
   */
  readonly closeTray: () => void;
  /** Sets the amount; snapped and clamped, so it is always legal. */
  readonly setAmount: (amount: number) => void;
}

/** The decision a tray belongs to: when it changes (an action, a new street), the tray closes. */
const trayKey = (tray: TrayView | null): string | null =>
  tray === null ? null : `${tray.kind}:${tray.min}:${tray.max}`;

/**
 * The tray's open state and amount, for the screen that renders `ActionBar` and `SizingTray`.
 * The tray and Row A may sit in different places (above Row A, over the table in compact mode,
 * in the landscape column), so this state lives with their common parent. Opening starts at
 * `coachStart` when the coach's advice is on show (§12.7 "the coach's size when the
 * recommendation is visible"), else at `tray.start`, always snapped to the legal bounds; a new
 * decision closes the tray.
 */
export function useSizing(tray: TrayView | null, coachStart: number | null = null): Sizing {
  const [open, setOpen] = useState(false);
  const [amount, setAmountState] = useState(tray?.start ?? 0);
  const [key, setKey] = useState(() => trayKey(tray));
  const nextKey = trayKey(tray);
  if (nextKey !== key) {
    // React's "adjust state when a prop changes" pattern: no effect, no extra paint.
    setKey(nextKey);
    setOpen(false);
  }
  const openTray = useCallback(() => {
    if (tray === null) return;
    setAmountState(coachStart === null ? tray.start : snapAmount(coachStart, tray));
    setOpen(true);
  }, [tray, coachStart]);
  const closeTray = useCallback(() => setOpen(false), []);
  const setAmount = useCallback(
    (value: number) => {
      if (tray !== null) setAmountState(snapAmount(value, tray));
    },
    [tray],
  );
  return { open: open && tray !== null && nextKey === key, amount, openTray, closeTray, setAmount };
}
