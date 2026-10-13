/**
 * The HUD numbers in words (PLAN §6.2–§6.6, §7.6, §0.3, §10.2, §13.2, Appendix F.3, F.10): the
 * win badge with its hysteresis and popover, the price chip, the draw chips, the big-move line and
 * the "By river" cells. Pure functions over the store's data views (`app/equityViews.ts`), so every
 * display rule is tested without a DOM; the one hook keeps the badge's hysteresis memory.
 *
 * Percentages are whole numbers (Appendix F), and never claim more than is known: a chance above 0
 * never reads "0%" and a chance below 100 never reads "100%" ("<1%", ">99%").
 */
import { useState } from 'react';
import {
  LEVEL_RULES,
  type ActionBarInputData,
  type BigMoveData,
  type DrawChipData,
  type DrawChipsData,
  type WinBadgeData,
} from '../app/store.ts';
import type { Card } from '../core/cards.ts';
import type { HandCategory } from '../eval/evaluate.ts';
import { en } from '../i18n/en.ts';
import { formatAmount, priceOf } from './actionBar.ts';
import { formatChips } from './format.ts';

type CoachLevel = 'beginner' | 'intermediate' | 'advanced' | 'exam';

/**
 * A chance (0–100) as a whole-number percentage: "62%"; "0%" and "100%" only when exact, else
 * "<1%" and ">99%".
 */
export function percentText(points: number): string {
  if (points <= 0) return '0%';
  if (points < 0.5) return '<1%';
  if (points >= 100) return '100%';
  if (points >= 99.5) return '>99%';
  return `${Math.round(points)}%`;
}

// ---------------------------------------------------------------------------------------------
// Win badge (§7.6)

/** The badge's memory: the value on show for one situation (the hysteresis, §7.6). */
export interface BadgeMemory {
  readonly key: string;
  /** The unrounded value on show, 0–100. */
  readonly shown: number;
}

/**
 * Hysteresis (§7.6): while provisional, the shown number moves only when the new unrounded value
 * is at least 1.0 point away from the whole number on show; a final value always shows.
 */
export function hysteresis(shown: number, value: number, final: boolean): number {
  if (final) return value;
  return Math.abs(value - Math.round(shown)) >= 1 ? value : shown;
}

/** The next memory for `data` (the same object when nothing changes). */
export function nextBadgeMemory(
  memory: BadgeMemory | null,
  data: WinBadgeData,
): BadgeMemory | null {
  const result = data.result;
  if (result === null) return memory === null || memory.key === data.key ? memory : null;
  const value = 100 * result.equity;
  if (memory === null || memory.key !== data.key) return { key: data.key, shown: value };
  const shown = hysteresis(memory.shown, value, result.final);
  return shown === memory.shown ? memory : { key: data.key, shown };
}

export interface BadgePopover {
  /** "Wins 60% · splits 4% · vs 3 players (any cards) · 40,000 deals"; null for known hands. */
  readonly stats: string | null;
  /** The "How is this calculated?" answer; null when there is no number. */
  readonly how: string | null;
  /** "Win chance is not available right now" (§12.14), else null. */
  readonly unavailable: string | null;
}

export interface BadgeView {
  /** skeleton "--%" · value "62%" / "~62%" · none "—" · folded "Folded". */
  readonly state: 'skeleton' | 'value' | 'none' | 'folded';
  readonly text: string;
  /** Provisional (not final, truncated, or timed out): the "~" prefix. */
  readonly approx: boolean;
  /** The screen-reader name. */
  readonly label: string;
  /** What a tap shows; null = the badge is not a button. */
  readonly popover: BadgePopover | null;
}

const NONE: BadgePopover = { stats: null, how: null, unavailable: en.badge.unavailable };

/** What the badge shows for `data`, with `memory` from `nextBadgeMemory` (null = no badge). */
export function badgeView(data: WinBadgeData, memory: BadgeMemory | null): BadgeView | null {
  const B = en.badge;
  switch (data.status) {
    case 'off':
      return null;
    case 'folded':
      return {
        state: 'folded',
        text: B.folded,
        approx: false,
        label: B.labelFolded,
        popover: null,
      };
    case 'unavailable':
      return { state: 'none', text: B.none, approx: false, label: B.labelNone, popover: NONE };
    default:
      break;
  }
  const result = data.result;
  if (result === null || memory === null || memory.key !== data.key) {
    return data.status === 'timedOut'
      ? { state: 'none', text: B.none, approx: false, label: B.labelNone, popover: NONE }
      : {
          state: 'skeleton',
          text: B.skeleton,
          approx: false,
          label: B.labelComputing,
          popover: null,
        };
  }
  const approx = !result.final || result.truncated || data.status === 'timedOut';
  const pct = percentText(memory.shown);
  const stats = data.known
    ? null
    : B.stats(
        percentText(100 * result.win),
        percentText(100 * result.split),
        data.nOpp,
        formatChips(result.n),
      );
  return {
    state: 'value',
    text: approx ? B.approx(pct) : pct,
    approx,
    label: approx ? B.labelApprox(pct) : B.label(pct),
    popover: { stats, how: data.known ? null : B.how(pct), unavailable: null },
  };
}

/** The badge's view, keeping its hysteresis memory for as long as the badge is mounted. */
export function useBadgeView(data: WinBadgeData): BadgeView | null {
  const [memory, setMemory] = useState<BadgeMemory | null>(null);
  const next = nextBadgeMemory(memory, data);
  if (next !== memory) setMemory(next); // a render-time update: React renders again at once
  return badgeView(data, next);
}

// ---------------------------------------------------------------------------------------------
// Price chip (§7.6, §0.3)

export interface PriceChipView {
  /** "Call 40 · need 20%", drawn on two lines: `call` and `need`. */
  readonly text: string;
  readonly call: string;
  readonly need: string;
  /** "Pot you can win 150" when the call is a short all-in (§0.3 `winPot` < `pot`). */
  readonly potYouCanWin: string | null;
}

/**
 * The price chip when the hero faces a bet on their turn (§7.6): `need` from the capped `winPot`
 * (§0.3). Shown at Beginner and Intermediate; Advanced has it in the coach's "Why?" only, Exam
 * never (§10.2).
 */
export function priceChipView(
  input: ActionBarInputData | null,
  coachLevel: CoachLevel,
): PriceChipView | null {
  const legal = input?.legal ?? null;
  if (input === null || legal === null || !legal.canCall) return null;
  if (LEVEL_RULES[coachLevel].price !== 'chip') return null;
  const price = priceOf(input.seats, legal.seat, legal.callAmount);
  const call = formatAmount(price.toCall, input.bb, input.amounts);
  const text = en.badge.price(call, percentText(100 * price.need));
  const [first, second] = text.split(en.badge.priceSeparator);
  const potYouCanWin =
    price.winPot < price.pot
      ? en.actions.potYouCanWin(formatAmount(price.winPot, input.bb, input.amounts))
      : null;
  return second === undefined
    ? { text, call: text, need: '', potYouCanWin }
    : { text, call: first ?? text, need: second, potYouCanWin };
}

// ---------------------------------------------------------------------------------------------
// Draw chips (§6.2–§6.4, §6.6, Appendix F.3)

export interface OutCardView {
  readonly card: Card;
  readonly risky: boolean;
}

export interface DrawChipView {
  readonly key: string;
  /** "Flush draw". */
  readonly name: string;
  /** "Flush draw · 9 outs · 35% by river (1 risky)"; the name alone at Exam (§10.2). */
  readonly text: string;
  /** The phone chip: "Flush draw · 35% by river" (a "!" mark stands for the risky outs). */
  readonly short: string;
  /** Risky outs among this draw's cards. */
  readonly risky: number;
  /** The out cards (empty at Exam). */
  readonly cards: readonly OutCardView[];
}

/** One chip's text: Appendix F.3 "{name} · {outs} outs · {pct}% {by river|next card}". */
export function drawChipText(draw: DrawChipData): string {
  const D = en.draws;
  const risky = draw.cards.filter((c) => c.risky).length;
  const when = draw.when === 'byRiver' ? D.byRiver : D.nextCard;
  const text = D.chip(D.name[draw.kind], draw.outs, percentText(draw.pct), when);
  return risky > 0 ? text + D.risky(risky) : text;
}

export function drawChipViews(data: DrawChipsData | null): DrawChipView[] {
  if (data === null) return [];
  return data.draws.map((d) => {
    const name = en.draws.name[d.kind];
    const risky = d.cards.filter((c) => c.risky).length;
    const when = d.when === 'byRiver' ? en.draws.byRiver : en.draws.nextCard;
    return {
      key: d.kind,
      name,
      text: data.namesOnly ? name : drawChipText(d),
      short: data.namesOnly ? name : en.draws.chipShort(name, percentText(d.pct), when),
      risky: data.namesOnly ? 0 : risky,
      cards: data.namesOnly ? [] : d.cards,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// "By river" (§6.6, §13.2)

/** A "By river" cell: "12%", "—" for 0 (on the river only the made hand is not 0: "100%"). */
export function byRiverText(points: number): string {
  return points <= 0 ? en.rankings.byRiverNone : percentText(points);
}

/** The cell for a category, or "" while the hand analysis is on its way. */
export function byRiverCell(
  exactly: Readonly<Record<HandCategory, number>> | null,
  category: HandCategory,
): string {
  return exactly === null ? '' : byRiverText(exactly[category]);
}

// ---------------------------------------------------------------------------------------------
// Big-move line (§7.6)

/** A marker the line's template receives for the card; the component draws a small card there. */
const CARD_SLOT = '\u0000';

export interface BigMoveView {
  readonly key: string;
  /** The text before the card, the card (null: no card), and the text after it. */
  readonly before: string;
  readonly card: Card | null;
  readonly after: string;
}

export function bigMoveView(move: BigMoveData | null): BigMoveView | null {
  if (move === null) return null;
  const M = en.badge.move;
  let text: string;
  switch (move.kind) {
    case 'fold':
      return { key: move.key, before: M.fold(move.name), card: null, after: '' };
    case 'improved':
      text = M.improved(CARD_SLOT, move.handName);
      break;
    case 'danger':
      text = M.danger(CARD_SLOT, M.threat[move.threat]);
      break;
    case 'blank':
      text = M.blank(CARD_SLOT);
      break;
  }
  const [before = '', after = ''] = text.split(CARD_SLOT);
  return { key: move.key, before, card: move.card, after };
}
