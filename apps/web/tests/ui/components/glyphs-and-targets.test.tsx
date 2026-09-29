// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { newDeck } from '../../../src/core/cards.ts';
import { Board } from '../../../src/ui/components/Board.tsx';
import { Card, type CardSize } from '../../../src/ui/components/Card.tsx';
import { Pot } from '../../../src/ui/components/Pot.tsx';
import { Seat } from '../../../src/ui/components/Seat.tsx';
import { SvgSprite } from '../../../src/ui/components/SvgSprite.tsx';
import type { SeatView } from '../../../src/ui/views.ts';
import { card } from '../../helpers/cards.ts';
import { interactiveCount, smallTapTargets, SUIT_CODE_POINTS } from '../dom.ts';
import { PLACE, seatView } from '../views.ts';

afterEach(cleanup);

const SIZES: CardSize[] = ['xs', 'sm', 'md', 'lg', 'xl', 'xxl', 'board'];

const SEATS: SeatView[] = [
  seatView(),
  seatView({ folded: true, cards: { kind: 'none' } }),
  seatView({ allIn: true, dealer: true }),
  seatView({ toAct: true, blind: 'bb', personality: 'maniac' }),
  seatView({ lastAction: 'raise', personality: null }),
  seatView({
    winner: true,
    cards: { kind: 'revealed', cards: [{ card: card('As') }, { card: card('Td') }] },
  }),
];

function Everything() {
  return (
    <>
      <SvgSprite />
      {SIZES.flatMap((size) => [
        ...newDeck().map((c) => <Card key={`${size}${c}`} card={c} size={size} />),
        <Card key={`${size}-back`} card={null} size={size} />,
      ])}
      {SEATS.map((view, i) => (
        <Seat key={i} view={view} place={PLACE} onSelect={() => {}} />
      ))}
      <Board
        cards={[{ card: card('Qh') }, { card: card('7c') }, { card: card('2d') }]}
        card={{ w: 40, h: 56 }}
      />
      <Pot pot={{ total: 700, pots: [300, 400] }} />
    </>
  );
}

describe('suit characters (PLAN §13.4, pitfall 31, Stage 3 acceptance 3)', () => {
  it('never appear in the rendered DOM: suits are SVG from one sprite', () => {
    render(<Everything />);
    const html = document.documentElement.outerHTML;
    expect(html).not.toMatch(SUIT_CODE_POINTS);
    // Every face-up card really is drawn from the sprite.
    expect(document.querySelectorAll('use[href^="#s-"]').length).toBeGreaterThan(52 * SIZES.length);
    expect(document.querySelectorAll('symbol[id^="s-"]')).toHaveLength(4);
  });

  it('never appear in the UI source or its strings', () => {
    const sources = import.meta.glob(
      [
        '../../../src/ui/**/*.{ts,tsx,css}',
        '../../../src/i18n/**/*.ts',
        '../../../src/data/**/*.ts',
      ],
      { query: '?raw', import: 'default', eager: true },
    );
    const files = Object.entries(sources);
    expect(files.length).toBeGreaterThan(5);
    const offenders = files.filter(([, text]) => SUIT_CODE_POINTS.test(String(text)));
    expect(offenders.map(([file]) => file)).toEqual([]);
  });
});

describe('tap targets (PLAN §12.12, Stage 3 acceptance 6)', () => {
  it('every interactive seat pod is at least 44×44 px', () => {
    const { container } = render(<Everything />);
    expect(interactiveCount(container)).toBe(SEATS.length);
    expect(smallTapTargets(container)).toEqual([]);
  });
});
