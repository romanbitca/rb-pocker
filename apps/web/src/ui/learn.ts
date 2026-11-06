/**
 * Learn's logic (PLAN §12.1, Appendix F.8, F.9; chunk 9.2), kept pure so it is tested without a
 * DOM: the glossary search and a lesson picture's cards. The screens are `ui/screens/Learn.tsx`;
 * the F.8 limits on the lessons' words are checked by `scripts/copy-rules.ts` (`checkLessons`).
 */
import type { Screen } from '../app/store.ts';
import { parseCard, type Card } from '../core/cards.ts';
import type { DiagramGroup } from '../data/lessons.ts';

/** Learn's four screens (app/navigation.ts): one lazy chunk draws them all. */
export type LearnPage = Extract<Screen, 'learn' | 'lesson' | 'handRankings' | 'glossary'>;

/** One glossary row as F.9 writes it ("call / check / fold / raise", one definition). */
export interface GlossaryRow {
  readonly term: string;
  readonly definition: string;
}

/**
 * The rows that match `query` (case and spaces at the ends ignored): first those whose term
 * contains it, then those whose definition does, each in F.9 order. An empty query keeps them all.
 */
export function searchGlossary<T extends GlossaryRow>(rows: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...rows];
  const inTerm = rows.filter((r) => r.term.toLowerCase().includes(q));
  const inText = rows.filter((r) => !inTerm.includes(r) && r.definition.toLowerCase().includes(q));
  return [...inTerm, ...inText];
}

/** A picture's cards: `card` null is face down; `dim` ones do not count (drawn at 45%). */
export function diagramCards(group: DiagramGroup): { card: Card | null; dim: boolean }[] {
  return group.cards.map((text, i) => ({
    card: text === null ? null : parseCard(text),
    dim: group.dim?.includes(i) ?? false,
  }));
}
