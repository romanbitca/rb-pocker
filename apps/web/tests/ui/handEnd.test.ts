/**
 * The hand-end banner's lines (PLAN §12.9, §12.11) and the toasts' text, in the PLAN's own words:
 * every line below is quoted from docs/PLAN.md.
 */
import { describe, expect, it } from 'vitest';
import type { HandEndView } from '../../src/app/store.ts';
import { parseCards } from '../../src/core/cards.ts';
import { en } from '../../src/i18n/en.ts';
import { toastText } from '../../src/ui/components/Notices.tsx';
import { handEndLines, joinNames } from '../../src/ui/handEnd.ts';

const PLAN = Object.values(
  import.meta.glob<string>('../../../../docs/PLAN.md', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
)[0] as string;

const view = (v: Partial<HandEndView>): HandEndView => ({
  handSeq: 12,
  endedBy: 'showdown',
  winners: [],
  shown: [],
  heroNet: 0,
  ...v,
});

const shown = (
  seat: number,
  name: string,
  handName: string,
  category: HandEndView['shown'][number]['category'],
) => ({
  seat,
  name,
  handName,
  category,
  best5: parseCards('As Ks Qs Js 9s'),
});

describe('handEndLines', () => {
  it('a bot wins at the showdown', () => {
    const lines = handEndLines(
      view({
        winners: [{ seat: 2, name: 'Ben', amount: 340 }],
        shown: [
          shown(2, 'Ben', 'Two Pair, Kings and Sevens', 'twoPair'),
          shown(0, 'You', 'Pair of Kings', 'pair'),
        ],
      }),
    );
    expect(lines).toEqual(['Ben wins 340 with Two Pair, Kings and Sevens.']);
    expect(PLAN).toContain(`"${lines[0]}"`);
  });

  it('the hero wins at the showdown: one line per beaten hand shown (at most two)', () => {
    const lines = handEndLines(
      view({
        winners: [{ seat: 0, name: 'You', amount: 340 }],
        shown: [
          shown(0, 'You', 'Flush, Ace-high', 'flush'),
          shown(2, 'Ben', 'Two Pair, Kings and Sevens', 'twoPair'),
          shown(3, 'Anna', 'Pair of Aces', 'pair'),
          shown(4, 'Carla', 'Ace-high', 'highCard'),
        ],
      }),
    );
    expect(lines).toEqual([
      'You win 340!',
      'Ben: Two Pair — loses to your Flush',
      'Anna: Pair — loses to your Flush',
    ]);
    expect(PLAN).toContain(`"${lines[0]}"`);
    expect(PLAN).toContain(`"${lines[1]}"`);
  });

  it('the same category names the full hands', () => {
    const lines = handEndLines(
      view({
        winners: [{ seat: 0, name: 'You', amount: 200 }],
        shown: [shown(0, 'You', 'Pair of Aces', 'pair'), shown(1, 'Ben', 'Pair of Kings', 'pair')],
      }),
    );
    expect(lines[1]).toBe('Ben: Pair of Kings — loses to your Pair of Aces');
  });

  it('a split pot, the hero included', () => {
    const lines = handEndLines(
      view({
        winners: [
          { seat: 0, name: 'You', amount: 170 },
          { seat: 3, name: 'Ben', amount: 170 },
        ],
      }),
    );
    expect(lines).toEqual(['Split pot: you and Ben each win 170.']);
    expect(PLAN).toContain(`"${lines[0]}"`);
  });

  it('different amounts (side pots, an odd chip): one line per winner', () => {
    const lines = handEndLines(
      view({
        winners: [
          { seat: 0, name: 'You', amount: 300 },
          { seat: 3, name: 'Ben', amount: 400 },
          { seat: 5, name: 'Nora', amount: 25 },
        ],
        shown: [shown(3, 'Ben', 'Straight, Five-high', 'straight')],
      }),
    );
    expect(lines).toEqual([
      'You win 300!',
      'Ben wins 400 with Straight, Five-high.',
      'Nora wins 25.',
    ]);
  });

  it('everyone folded: no cards named', () => {
    expect(
      handEndLines(view({ endedBy: 'fold', winners: [{ seat: 0, name: 'You', amount: 120 }] })),
    ).toEqual(['Everyone folded. You win 120.']);
    expect(
      handEndLines(view({ endedBy: 'fold', winners: [{ seat: 4, name: 'Ben', amount: 1250 }] })),
    ).toEqual(['Ben wins 1,250. Everyone else folded.']);
    expect(PLAN).toContain('"Everyone folded. You win 120."');
    expect(PLAN).toContain(`"${en.handEnd.winsFold('{name}', '{x}')}"`);
  });

  it('no winner yet: no lines', () => {
    expect(handEndLines(view({}))).toEqual([]);
  });

  it('joinNames', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['you'])).toBe('you');
    expect(joinNames(['you', 'Ben'])).toBe('you and Ben');
    expect(joinNames(['you', 'Ben', 'Anna'])).toBe('you, Ben and Anna');
  });
});

describe('toastText (§12.11)', () => {
  it('bots joining', () => {
    expect(toastText({ id: 1, kind: 'botsJoined', names: ['Nora'] })).toBe('Nora sits down.');
    expect(toastText({ id: 1, kind: 'botsJoined', names: ['Nora', 'Ben', 'Sam'] })).toBe(
      'Nora, Ben and Sam sit down.',
    );
    expect(PLAN).toContain('toast "Nora sits down."');
  });

  it('the other toasts are the PLAN words', () => {
    for (const kind of ['handVoided', 'handNotRestored', 'dataRecovered'] as const) {
      expect(PLAN).toContain(toastText({ id: 1, kind }));
    }
    expect(PLAN).toContain(en.storage.banner);
  });
});

describe('Table copy comes from docs/PLAN.md', () => {
  it.each([
    ['top bar', `"${en.table.blinds('10', '20')}${en.table.separator}${en.table.hand('12')}"`],
    ['hero chips', `"${en.table.heroChips('2,340')}"`],
    ['folded', `"${en.table.folded}"`],
    ['next hand', `[${en.handEnd.nextHand} ›]`],
    ['heading', `"${en.table.heading}"`],
    ['label hint', `"${en.table.labelHint}"`],
    ['your bet', `"${en.table.yourBet('{x}')}"`],
    ['winner without a shown hand', `"${en.handEnd.winsNoHand('{name}', '{x}')}"`],
    [
      'category names',
      Object.values(en.handEnd.category)
        .map((c) => `"${c}"`)
        .join(' · '),
    ],
  ])('%s', (_name, words) => {
    expect(PLAN).toContain(words);
  });
});
