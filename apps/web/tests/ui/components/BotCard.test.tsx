// @vitest-environment jsdom
// The bot card (PLAN §9.3, Appendix F.6, chunk 5.10): what it says for each personality, what it
// leaves out at Hard and Expert, and how it closes (✕, Esc, the scrim).
import '../../../src/ui/styles/tokens.css';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '../../../src/i18n/en.ts';
import { BotCard, type BotCardProps } from '../../../src/ui/components/BotCard.tsx';
import type { BotCardView, SeatPersonality } from '../../../src/ui/views.ts';
import { controlCount, smallTargets } from '../screens/targets.ts';

afterEach(cleanup);

const PERSONALITIES: readonly SeatPersonality[] = ['rock', 'tag', 'lag', 'station', 'maniac'];

/** Appendix F.6, verbatim: name, description, how to beat them. */
const F6: Readonly<Record<SeatPersonality, readonly [string, string, string]>> = {
  rock: [
    'Careful',
    'Plays few hands. When they bet big, believe them.',
    'Steal their blinds. Fold when they raise.',
  ],
  tag: ['Solid', 'Plays good hands and bets them well.', "Play good hands. Don't bluff too much."],
  lag: [
    'Aggressive',
    'Plays many hands and bets often.',
    'Call them down with good hands. Let them bluff.',
  ],
  station: [
    'Calls a lot',
    'Calls with almost anything. Rarely raises.',
    'Bet your good hands. Almost never bluff.',
  ],
  maniac: [
    'Wild',
    'Bets and raises with anything.',
    'Wait for a good hand. Then let them bet for you.',
  ],
};

const card = (extra: Partial<BotCardView> = {}): BotCardView => ({
  name: 'Anna',
  personality: 'rock',
  stack: 1250,
  seen: null,
  nextLevel: { own: null, table: 'easy' },
  ...extra,
});

function renderCard(extra: Partial<BotCardView> = {}, props: Partial<BotCardProps> = {}) {
  const onClose = vi.fn();
  const onLevel = vi.fn<BotCardProps['onLevel']>();
  const view = render(
    <BotCard card={card(extra)} onLevel={onLevel} onClose={onClose} {...props} />,
  );
  return { onClose, onLevel, ...view };
}

const sheet = () => screen.getByRole('dialog');

describe('BotCard at Easy and Medium', () => {
  it.each(PERSONALITIES)(
    '%s: name, icon, personality, description, "How to beat them" and the stack',
    (personality) => {
      const [label, description, tip] = F6[personality];
      const { container } = renderCard({ name: 'Ben', personality, stack: 12_345 });
      const dialog = sheet();
      expect(within(dialog).getByRole('heading', { level: 2 }).textContent).toBe('Ben');
      expect(within(dialog).getByText(label)).toBeTruthy();
      expect(within(dialog).getByText(description)).toBeTruthy();
      expect(within(dialog).getByRole('heading', { level: 3 }).textContent).toBe(
        'How to beat them',
      );
      expect(within(dialog).getByText(tip)).toBeTruthy();
      expect(within(dialog).getByText('Stack: 12,345')).toBeTruthy();
      // The personality's own shape, as on the pod (shape, not colour, tells them apart).
      expect(container.querySelector(`use[href="#p-${personality}"]`)).not.toBeNull();
      expect(container.querySelectorAll('use[href^="#p-"]')).toHaveLength(1);
      expect(dialog.textContent).not.toContain(en.botCard.unknownStyle);
    },
  );

  it('is a modal dialog named by the bot and its personality, described by what it is like', () => {
    renderCard({ personality: 'station' });
    const dialog = sheet();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('dialog', { name: 'Anna Calls a lot' })).toBe(dialog);
    const description = document.getElementById(dialog.getAttribute('aria-describedby') ?? '');
    expect(description?.textContent).toBe('Calls with almost anything. Rarely raises.');
  });

  it('shows the same text the pod and the PLAN use: en.personality names, F.6 text', () => {
    for (const personality of PERSONALITIES) {
      expect(en.personality[personality]).toBe(F6[personality][0]);
      expect(en.personalityText[personality].description).toBe(F6[personality][1]);
      expect(en.personalityText[personality].tip).toBe(F6[personality][2]);
    }
  });

  it('draws the avatar initial of the name, like the pod, and hides it from screen readers', () => {
    const { container } = renderCard({ name: 'ivan' });
    const avatar = container.querySelector('[class*="avatar"]');
    expect(avatar?.textContent).toBe('I');
    expect(avatar?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows a short stack as it is, and 0 for a bot that is all-in', () => {
    renderCard({ stack: 0 });
    expect(screen.getByText('Stack: 0')).toBeTruthy();
  });
});

describe('BotCard at Hard and Expert (the personality is hidden)', () => {
  it('says "Style: unknown." with the name and the stack, and no personality text', () => {
    const { container } = renderCard({ personality: null });
    const dialog = sheet();
    expect(within(dialog).getByRole('heading', { level: 2 }).textContent).toBe('Anna');
    expect(within(dialog).getByText('Style: unknown.')).toBeTruthy();
    expect(within(dialog).getByText('Stack: 1,250')).toBeTruthy();
    expect(within(dialog).queryByRole('heading', { level: 3 })).toBeNull();
    expect(container.querySelector('use[href^="#p-"]')).toBeNull();
    for (const personality of PERSONALITIES) {
      const [label, description, tip] = F6[personality];
      for (const text of [label, description, tip]) expect(dialog.textContent).not.toContain(text);
    }
    expect(dialog.hasAttribute('aria-describedby')).toBe(false);
    expect(screen.getByRole('dialog', { name: 'Anna Style: unknown.' })).toBe(dialog);
    // Not seen yet (chunk 7.1): it says so, with no numbers.
    expect(within(dialog).getByText('You have not seen them play yet.')).toBeTruthy();
    expect(dialog.textContent).not.toContain('Here is what you have seen:');
    expect(dialog.textContent).not.toContain('%');
  });

  it('says what the player has seen it do, in plain words (§9.3, chunk 7.1)', () => {
    renderCard({
      personality: null,
      seen: { hands: 41, plays: 34, raises: 20, aggression: 'betsOften' },
    });
    const dialog = sheet();
    expect(within(dialog).getByText('Style: unknown.')).toBeTruthy();
    expect(within(dialog).getByText('Here is what you have seen:')).toBeTruthy();
    expect(within(dialog).getByText('Plays 34% of hands · Raises 20% · Bets often')).toBeTruthy();
    expect(within(dialog).getByText('Hands seen: 41')).toBeTruthy();
    expect(within(dialog).getByText('Stack: 1,250')).toBeTruthy();
  });

  it.each([
    ['betsSometimes', 'Plays 12% of hands · Raises 9% · Bets sometimes'],
    ['mostlyCalls', 'Plays 12% of hands · Raises 9% · Mostly calls'],
    [null, 'Plays 12% of hands · Raises 9%'],
  ] as const)('aggression %s: "%s"', (aggression, line) => {
    renderCard({ personality: null, seen: { hands: 1200, plays: 12, raises: 9, aggression } });
    expect(within(sheet()).getByText(line)).toBeTruthy();
    expect(within(sheet()).getByText('Hands seen: 1,200')).toBeTruthy();
  });
});

describe('BotCard closing and focus', () => {
  it('✕ closes it', () => {
    const { onClose } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc closes it', () => {
    const { onClose } = renderCard();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a tap on the scrim closes it; a tap inside does not', () => {
    const { onClose, container } = renderCard();
    fireEvent.click(sheet());
    fireEvent.click(screen.getByText('Plays few hands. When they bet big, believe them.'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('[aria-hidden="true"][class*="scrim"]') as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus in (to ✕), keeps Tab inside, and gives focus back to the opener', () => {
    const opener = document.createElement('button');
    opener.textContent = 'Anna';
    document.body.append(opener);
    opener.focus();
    const { unmount } = renderCard();
    const close = screen.getByRole('button', { name: 'Close' });
    expect(document.activeElement).toBe(close);
    // The only control: Tab wraps onto itself instead of leaving the sheet.
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(sheet().contains(document.activeElement)).toBe(true);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('✕ and the five level choices are at least 44×44 px (§12.12), and they are the only controls', () => {
    const { container } = renderCard();
    expect(controlCount(container)).toBe(1 + 5);
    expect(smallTargets(container, () => false)).toEqual([]);
  });
});

describe('BotCard level picker (§9.3 per-seat override, chunk 7.2)', () => {
  const picker = () => within(sheet()).getByRole('group', { name: "This bot's level" });
  const choices = () => within(picker()).getAllByRole('radio') as HTMLInputElement[];

  it('is a group of five radios: Same as table (the table level), then Easy to Expert', () => {
    renderCard({ nextLevel: { own: null, table: 'medium' } });
    expect(choices().map((r) => [r.value, r.labels?.[0]?.textContent])).toEqual([
      ['', 'Same as table (Medium)'],
      ['easy', 'Easy'],
      ['medium', 'Medium'],
      ['hard', 'Hard'],
      ['expert', 'Expert'],
    ]);
    expect(within(picker()).getByText('Changes start with the next hand.')).toBeTruthy();
  });

  it('has exactly one choice checked: the bot’s own level, or "Same as table"', () => {
    const checked = () => choices().map((r) => r.checked);
    const { rerender, onClose, onLevel } = renderCard({ nextLevel: { own: null, table: 'easy' } });
    expect(checked()).toEqual([true, false, false, false, false]);
    const again = (own: BotCardView['nextLevel']['own']) =>
      rerender(
        <BotCard
          card={card({ nextLevel: { own, table: 'easy' } })}
          onLevel={onLevel}
          onClose={onClose}
        />,
      );
    again('easy');
    expect(checked()).toEqual([false, true, false, false, false]);
    again('expert');
    expect(checked()).toEqual([false, false, false, false, true]);
  });

  it('a pick is sent at once: a level, or null for "Same as table"', () => {
    const { onLevel } = renderCard({ nextLevel: { own: 'hard', table: 'easy' } });
    fireEvent.click(within(picker()).getByRole('radio', { name: 'Expert' }));
    expect(onLevel).toHaveBeenLastCalledWith('expert');
    fireEvent.click(within(picker()).getByRole('radio', { name: 'Same as table (Easy)' }));
    expect(onLevel).toHaveBeenLastCalledWith(null);
    fireEvent.click(within(picker()).getByRole('radio', { name: 'Medium' }));
    expect(onLevel).toHaveBeenLastCalledWith('medium');
    expect(onLevel).toHaveBeenCalledTimes(3);
  });

  it('is a controlled group: nothing changes until the card is given the new level', () => {
    renderCard({ nextLevel: { own: null, table: 'easy' } });
    fireEvent.click(within(picker()).getByRole('radio', { name: 'Hard' }));
    expect(choices()[0]?.checked).toBe(true);
    expect(choices()[3]?.checked).toBe(false);
  });

  it('shows at every level: the personality card and the unknown-style card both have it', () => {
    for (const personality of [...PERSONALITIES, null]) {
      const { unmount } = renderCard({ personality });
      expect(choices()).toHaveLength(5);
      unmount();
    }
  });

  it('"Same as table" names the table level, not the bot’s own', () => {
    renderCard({ nextLevel: { own: 'expert', table: 'hard' } });
    expect(choices()[0]?.labels?.[0]?.textContent).toBe('Same as table (Hard)');
  });

  it('tells nothing the pod does not: the hint names no personality and no hole card', () => {
    renderCard({ personality: null, nextLevel: { own: 'expert', table: 'easy' } });
    for (const personality of PERSONALITIES) {
      const [label, description, tip] = F6[personality];
      for (const text of [label, description, tip]) expect(sheet().textContent).not.toContain(text);
    }
  });

  it('is one radio group (arrow keys move through it), and the focus still starts on ✕', () => {
    renderCard();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    expect(new Set(choices().map((r) => r.name)).size).toBe(1); // one radio group
  });
});
