// Learn's pure logic (PLAN §12.1, Appendix F.8, F.9; chunk 9.2; ui/learn.ts): the glossary search
// and a lesson picture's cards.
import { describe, expect, it } from 'vitest';
import { parseCard } from '../../src/core/cards.ts';
import { enCoach } from '../../src/i18n/enCoach.ts';
import { diagramCards, searchGlossary } from '../../src/ui/learn.ts';

const terms = (query: string): string[] =>
  searchGlossary(enCoach.glossary, query).map((r) => r.term);

describe('searchGlossary (F.9)', () => {
  it('an empty or blank search keeps every row, in F.9 order', () => {
    expect(terms('')).toEqual(enCoach.glossary.map((r) => r.term));
    expect(terms('   ')).toHaveLength(enCoach.glossary.length);
    expect(enCoach.glossary.length).toBe(33);
  });

  it('finds a term whatever the case, a part of a term, and an alias', () => {
    expect(terms('Kicker')).toEqual(['kicker']);
    expect(terms('SPR')).toEqual(['SPR']);
    expect(terms('spr')).toEqual(['SPR']);
    expect(terms('c-bet')).toEqual(['continuation bet (c-bet)']);
    expect(terms('turn')[0]).toBe('flop / turn / river');
  });

  it('terms that hold the words come before definitions that do', () => {
    const found = terms('pot');
    // "pot", "pot odds", "side pot", "split pot" by their names first, in F.9 order …
    expect(found.slice(0, 4)).toEqual(['need % / pot odds', 'pot', 'side pot', 'split pot']);
    // … then rows that only say "pot" in their definition ("all the chips bet", "start the pot").
    expect(found).toContain('blinds');
    expect(found.indexOf('blinds')).toBeGreaterThan(3);
    expect(new Set(found).size).toBe(found.length);
  });

  it('a search that matches nothing finds nothing', () => {
    expect(terms('zebra')).toEqual([]);
  });
});

describe('diagramCards', () => {
  it('parses the cards, keeps face-down ones as null and marks the dimmed ones', () => {
    expect(diagramCards({ label: 'x', cards: ['Ks', null, 'Td'], dim: [2] })).toEqual([
      { card: parseCard('Ks'), dim: false },
      { card: null, dim: false },
      { card: parseCard('Td'), dim: true },
    ]);
    expect(diagramCards({ label: 'y', cards: ['2c'] })).toEqual([
      { card: parseCard('2c'), dim: false },
    ]);
  });
});
