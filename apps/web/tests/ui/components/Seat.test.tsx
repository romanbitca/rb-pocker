// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RANK_NAMES } from '../../../src/core/cards.ts';
import * as rng from '../../../src/core/rng.ts';
import { en } from '../../../src/i18n/en.ts';
import {
  Seat,
  seatLabel,
  seatPropsEqual,
  seatViewEqual,
} from '../../../src/ui/components/Seat.tsx';
import { card } from '../../helpers/cards.ts';
import { PLACE, seatView } from '../views.ts';

vi.mock(import('../../../src/core/rng.ts'), async (original) => {
  const real = await original();
  return { ...real, fnv1a32: vi.fn(real.fnv1a32) };
});

afterEach(cleanup);

const CARD_NAME =
  /\b(Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Jack|Queen|King|Ace) of (clubs|diamonds|hearts|spades)\b/;

/** Every aria-label in the tree, including aria-hidden parts. */
const labels = (root: HTMLElement): string[] =>
  [...root.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label') ?? '');

describe('Seat (PLAN §12.4, §12.12)', () => {
  it('is one labelled group: name, bot, personality, stack, bet, status', () => {
    const view = seatView({ folded: true });
    render(<Seat view={view} place={PLACE} />);
    const group = screen.getByRole('group');
    expect(group.getAttribute('aria-label')).toBe(
      'Anna, bot, Careful, stack 1,250, bet 50, folded',
    );
    expect(group.getAttribute('aria-label')).toBe(seatLabel(view));
  });

  it('shows the name, a compact stack rounded down, and the bet chip', () => {
    const { container } = render(<Seat view={seatView({ stack: 12_399 })} place={PLACE} />);
    expect(container.textContent).toContain('Anna');
    expect(container.textContent).toContain('12.3k');
    expect(container.textContent).toContain('50');
  });

  it('draws no bet chip without a bet', () => {
    const { container } = render(<Seat view={seatView({ bet: 0 })} place={PLACE} />);
    expect(container.querySelector('use[href="#i-chip"]')).toBeNull();
  });

  it('places the pod and its bet slot from the geometry', () => {
    const { container } = render(<Seat view={seatView()} place={PLACE} />);
    const seat = container.firstElementChild as HTMLElement;
    expect([seat.style.left, seat.style.top]).toEqual(['10px', '20px']);
    const bet = container
      .querySelector('use[href="#i-chip"]')
      ?.closest('span[style]') as HTMLElement;
    expect([bet.style.left, bet.style.top, bet.style.width]).toEqual(['67px', '40px', '56px']);
  });

  it('picks the status tag: folded, then all-in, then thinking, then the last action', () => {
    const tag = (v: Parameters<typeof seatView>[0]) => {
      const { container, unmount } = render(<Seat view={seatView(v)} place={PLACE} />);
      const text = container.textContent ?? '';
      const label = screen.getByRole('group').getAttribute('aria-label');
      unmount();
      return { text, label };
    };
    expect(tag({ folded: true, allIn: true }).text).toContain(en.seat.tag.fold);
    expect(tag({ allIn: true, toAct: true }).text).toContain(en.seat.tag.allIn);
    expect(tag({ toAct: true, lastAction: 'call' }).label).toContain('thinking');
    expect(tag({ lastAction: 'raise' }).text).toContain(en.seat.tag.raise);
    expect(tag({ lastAction: 'check' }).label).toMatch(/checked$/);
  });

  it('shows the dealer disc, else the blind tag', () => {
    const one = render(<Seat view={seatView({ dealer: true, blind: 'sb' })} place={PLACE} />);
    expect(one.container.textContent).toContain(en.seat.dealer);
    expect(screen.getByRole('group').getAttribute('aria-label')).toContain('dealer, small blind');
    one.unmount();
    const two = render(<Seat view={seatView({ blind: 'bb' })} place={PLACE} />);
    expect(two.container.textContent).toContain(en.seat.bigBlind);
  });

  it('⚠️ keeps a bot’s cards face down unless revealed: no rank, suit or name anywhere', () => {
    const { container } = render(<Seat view={seatView()} place={PLACE} />);
    const backs = container.querySelectorAll('[role="img"]');
    expect(backs).toHaveLength(2);
    for (const back of backs) expect(back.getAttribute('aria-label')).toBe(en.cards.hidden);
    expect(container.querySelector('use[href^="#s-"]')).toBeNull();
    expect(labels(container).join(' ')).not.toMatch(CARD_NAME);
    expect(container.innerHTML).not.toMatch(CARD_NAME);
    // No rank word or rank text beyond the name and chip numbers.
    for (const word of RANK_NAMES) expect(container.innerHTML).not.toContain(word);
  });

  it('shows no cards at all after a fold', () => {
    const { container } = render(
      <Seat view={seatView({ folded: true, cards: { kind: 'none' } })} place={PLACE} />,
    );
    expect(container.querySelector('[role="img"]')).toBeNull();
  });

  it('shows revealed cards face up, with best-five highlights, and names them', () => {
    const view = seatView({
      winner: true,
      cards: {
        kind: 'revealed',
        cards: [{ card: card('Kh'), highlight: 'core' }, { card: card('Tc') }],
      },
    });
    const { container } = render(<Seat view={view} place={PLACE} />);
    const faces = [...container.querySelectorAll('[role="img"]')];
    expect(faces.map((f) => f.getAttribute('aria-label'))).toEqual([
      'King of hearts',
      'Ten of clubs',
    ]);
    expect(faces[0]?.className).toMatch(/core/);
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe(
      'Anna, bot, Careful, stack 1,250, bet 50, King of hearts, Ten of clubs, wins',
    );
  });

  it('becomes a button when it can be selected', () => {
    const onSelect = vi.fn();
    render(<Seat view={seatView()} place={PLACE} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /^Anna, bot/ }));
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it('draws the personality badge only when the personality is visible', () => {
    const shown = render(<Seat view={seatView()} place={PLACE} />);
    expect(shown.container.querySelector('use[href="#p-rock"]')).not.toBeNull();
    shown.unmount();
    const hidden = render(<Seat view={seatView({ personality: null })} place={PLACE} />);
    expect(hidden.container.querySelector('use[href^="#p-"]')).toBeNull();
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe(
      'Anna, bot, stack 1,250, bet 50',
    );
  });
});

describe('Seat memo (PLAN §15.3, pitfall 37)', () => {
  it('compares views by value', () => {
    const a = seatView();
    expect(seatViewEqual(a, seatView())).toBe(true);
    expect(seatViewEqual(a, seatView({ stack: 1249 }))).toBe(false);
    expect(seatViewEqual(a, seatView({ cards: { kind: 'none' } }))).toBe(false);
    const shown = (highlight?: 'core') =>
      seatView({
        cards: {
          kind: 'revealed',
          cards: [highlight ? { card: 1, highlight } : { card: 1 }, { card: 2 }],
        },
      });
    expect(seatViewEqual(shown(), shown())).toBe(true);
    expect(seatViewEqual(shown(), shown('core'))).toBe(false);
    expect(
      seatPropsEqual({ view: a, place: PLACE }, { view: seatView(), place: { ...PLACE } }),
    ).toBe(true);
    expect(
      seatPropsEqual(
        { view: a, place: PLACE },
        { view: a, place: { ...PLACE, pod: { ...PLACE.pod, x: 11 } } },
      ),
    ).toBe(false);
  });

  it('does not re-render for a new but equal view, and does for a changed one', () => {
    const renders = vi.mocked(rng.fnv1a32); // Seat hashes the name once per render
    const { rerender } = render(<Seat view={seatView()} place={PLACE} />);
    const before = renders.mock.calls.length;
    for (let i = 0; i < 50; i++) rerender(<Seat view={seatView()} place={{ ...PLACE }} />);
    expect(renders.mock.calls.length).toBe(before);
    rerender(<Seat view={seatView({ stack: 999 })} place={PLACE} />);
    expect(renders.mock.calls.length).toBe(before + 1);
  });
});
