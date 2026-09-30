/**
 * The hand-rankings panel's logic (PLAN §13.2–§13.4), kept pure so it is tested without a DOM.
 * Row 0 is the strongest hand (royal flush), row 9 the weakest (high card).
 */
import { useState } from 'react';
import { parseCard, RANK_NAMES, rankOf, type Card } from '../core/cards.ts';
import { RANKINGS, type RankingRow } from '../data/rankings.ts';
import type { HandInfo } from '../eval/describe.ts';
import type { HandCategory } from '../eval/evaluate.ts';
import { en } from '../i18n/en.ts';
import { formatChips } from './format.ts';
import type { HeroHandView } from './views.ts';

/** A category's row: 0 = royal flush … 9 = high card. */
export function rowIndex(category: HandCategory): number {
  const i = RANKINGS.findIndex((row) => row.key === category);
  if (i < 0) throw new RangeError(`No rankings row for ${category}`);
  return i;
}

/** How a row relates to the hero's hand (§13.3). `null`: between hands, or other rows after a fold. */
export type RowStatus = 'you' | 'folded' | 'beatsYou' | 'youBeat' | null;

export function rowStatus(row: number, hero: HeroHandView | null): RowStatus {
  if (hero === null) return null;
  const mine = rowIndex(hero.category);
  if (row === mine) return hero.folded ? 'folded' : 'you';
  if (hero.folded) return null;
  return row < mine ? 'beatsYou' : 'youBeat';
}

/** 7-card rarity as §13.2 prints it: "0.003%", "0.03%", "0.17%", "2.6%", "23.5%". */
export function formatRarity(percent: number): string {
  const decimals = percent < 0.01 ? 3 : percent < 1 ? 2 : 1;
  return en.rankings.percent(percent.toFixed(decimals));
}

/** "1 in 30,900". */
export function formatOneIn(n: number): string {
  return en.rankings.oneIn(formatChips(n));
}

/** A row's example hand, with its kickers dimmed (§13.2). */
export function exampleCards(row: RankingRow): { card: Card; dim: boolean }[] {
  return row.cards.map((text, i) => ({
    card: parseCard(text),
    dim: i >= row.cards.length - row.kickers,
  }));
}

/** The screen-reader label of a row (§13.4), with its "By river" cell when there is one. */
export function rowLabel(row: number, status: RowStatus, byRiver: string | null = null): string {
  const data = RANKINGS[row] as RankingRow;
  const R = en.rankings;
  const example = data.cards
    .map((text) => RANK_NAMES[rankOf(parseCard(text))] as string)
    .join(R.listSeparator);
  const parts = [R.row(row + 1, data.name, example, data.tip)];
  if (status === 'you') parts.push(R.rowYou);
  if (status === 'folded') parts.push(R.rowFolded);
  if (status === 'beatsYou') parts.push(R.rowBeatsYou);
  if (status === 'youBeat') parts.push(R.rowYouBeat);
  parts.push(R.rowHowOften(formatRarity(data.rarity), formatOneIn(data.oneIn)));
  if (byRiver !== null && byRiver !== '') parts.push(R.rowByRiver(byRiver));
  return parts.join(' ');
}

/**
 * The panel's view of the hero's hand, from `describe(hole, board)` (PLAN §5.4). The store calls
 * this (or builds the same shape) on the main thread whenever a card appears or the hero folds.
 */
export function heroHandView(
  info: Pick<HandInfo, 'category' | 'best5' | 'kickers'>,
  hole: readonly [Card, Card],
  folded: boolean,
  handSeq: number,
): HeroHandView {
  return {
    handSeq,
    category: info.category,
    best5: [...info.best5],
    kickers: [...info.kickers],
    hole: [hole[0], hole[1]],
    folded,
  };
}

/**
 * The "You" line (§13.3): the hero's actual best five, their own cards outlined and kickers
 * dimmed. Preflop there is no best five yet, so it shows the two hole cards.
 */
export function youLine(hero: HeroHandView): { card: Card; used: boolean; dim: boolean }[] {
  const cards = hero.best5.length > 0 ? hero.best5 : hero.hole;
  return cards.map((card) => ({
    card,
    used: hero.hole.includes(card),
    dim: hero.kickers.includes(card),
  }));
}

/**
 * Counts improvements of the hero's category within one hand (§13.3 "On improvement: the row
 * pulses once"): the number changes exactly when the row should pulse. A new hand, a fold or
 * the end of a hand never counts as an improvement.
 */
export function useImprovementPulse(hero: HeroHandView | null): number {
  const handSeq = hero?.handSeq ?? -1;
  const row = hero === null || hero.folded ? -1 : rowIndex(hero.category);
  const [seen, setSeen] = useState({ handSeq, row, pulses: 0 });
  if (seen.handSeq !== handSeq || seen.row !== row) {
    const improved = handSeq === seen.handSeq && seen.row >= 0 && row >= 0 && row < seen.row;
    setSeen({ handSeq, row, pulses: seen.pulses + (improved ? 1 : 0) });
  }
  return seen.pulses;
}

/**
 * The Hands edge tab's accent dot (§13.1): on when the hero's category improved since the drawer
 * was last open (or since the hand began), off again once the drawer opens.
 */
export function useHandsTabDot(hero: HeroHandView | null, open: boolean): boolean {
  const handSeq = hero?.handSeq ?? -1;
  const row = hero === null ? RANKINGS.length : rowIndex(hero.category);
  const [seen, setSeen] = useState({ handSeq, row });
  if (seen.handSeq !== handSeq || (open && seen.row !== row)) {
    setSeen({ handSeq, row });
  }
  return hero !== null && !hero.folded && !open && handSeq === seen.handSeq && row < seen.row;
}
