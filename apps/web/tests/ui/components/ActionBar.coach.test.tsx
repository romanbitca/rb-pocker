// @vitest-environment jsdom
// The coach on Row A and in the sizing tray (chunk 5.9, PLAN §10.2, §12.7): the recommended
// button's 3 px accent ring and "Coach" badge, the tray starting at the coach's size, and the
// coach's amount ringed (a preset) or shown as a sixth "Coach" chip.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useId, useMemo } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerAction } from '../../../src/engine/types.ts';
import { en } from '../../../src/i18n/en.ts';
import { actionBarView, useSizing, type ActionBarInput } from '../../../src/ui/actionBar.ts';
import { ActionBar } from '../../../src/ui/components/ActionBar.tsx';
import { SizingTray } from '../../../src/ui/components/SizingTray.tsx';
import { ACTION_SPOTS, type ActionSpotId } from '../../../src/ui/dev/actionFixtures.ts';
import { smallTapTargets } from '../dom.ts';

afterEach(cleanup);

const spot = (id: ActionSpotId): ActionBarInput => ({ ...ACTION_SPOTS[id], amounts: 'chips' });

function Bar({
  id,
  recommended,
  coachStart = null,
}: {
  id: ActionSpotId;
  recommended: 'fold' | 'middle' | 'right' | null;
  coachStart?: number | null;
}) {
  const view = useMemo(() => actionBarView(spot(id)), [id]);
  const sizing = useSizing(view.tray, coachStart);
  const trayId = useId();
  return (
    <>
      {sizing.open && view.tray !== null && (
        <SizingTray
          id={trayId}
          tray={view.tray}
          amount={sizing.amount}
          onAmount={sizing.setAmount}
          onClose={sizing.closeTray}
          coachAmount={coachStart}
        />
      )}
      <ActionBar
        view={view}
        trayOpen={sizing.open}
        amount={sizing.amount}
        trayId={trayId}
        onAct={vi.fn<(a: PlayerAction) => void>()}
        onOpenTray={sizing.openTray}
        onCloseTray={sizing.closeTray}
        recommended={recommended}
      />
    </>
  );
}

const ringed = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-coach]')];

describe('the recommended button (§12.7)', () => {
  it('has the ring and the "Coach" badge, which describes it to screen readers', () => {
    render(<Bar id="facing" recommended="middle" />);
    const [button] = ringed();
    expect(ringed()).toHaveLength(1);
    expect(button?.getAttribute('data-slot')).toBe('middle');
    expect(button?.className).toMatch(/coach/);
    const badgeId = button?.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(badgeId)?.textContent).toBe(en.coachUi.badge);
    // The accessible name stays the action's full text (§12.12).
    expect(button?.getAttribute('aria-label')).toMatch(/^Call /);
    expect(smallTapTargets(document.body)).toEqual([]);
  });

  it('never on a disabled button, nor while waiting', () => {
    render(<Bar id="check" recommended="fold" />);
    expect(ringed()).toEqual([]);
    cleanup();
    render(<Bar id="waiting" recommended="middle" />);
    expect(ringed()).toEqual([]);
    cleanup();
    render(<Bar id="facing" recommended={null} />);
    expect(ringed()).toEqual([]);
  });
});

describe('the coach’s size in the tray (§12.7)', () => {
  it('the tray starts at the coach’s size and shows it as a sixth chip', () => {
    // Bet presets for the 'check' spot are ⅓ · ½ · ⅔ · Pot · All-in; 70 is none of them.
    const view = actionBarView(spot('check'));
    const presets = view.tray?.presets.map((p) => p.amount) ?? [];
    const coach = 70;
    expect(presets).not.toContain(coach);
    render(<Bar id="check" recommended="right" coachStart={coach} />);
    fireEvent.click(
      within(screen.getByRole('group', { name: en.actions.group })).getByRole('button', {
        name: /Bet/,
      }),
    );
    const chip = screen.getByRole('button', { name: en.coachUi.chipName('70') });
    expect(chip.getAttribute('data-coach')).toBe('');
    expect(chip.getAttribute('aria-pressed')).toBe('true'); // the tray opened at 70
    expect(chip.textContent).toBe(`${en.coachUi.chip}70`);
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toMatch(/^Bet 70,/);
  });

  it('rings the preset that has the coach’s amount, without a sixth chip', () => {
    const view = actionBarView(spot('check'));
    const half = view.tray?.presets.find((p) => p.id === 'half');
    if (half === undefined) throw new Error('no ½ pot preset');
    render(<Bar id="check" recommended="right" coachStart={half.amount} />);
    fireEvent.click(screen.getByRole('button', { name: /^Bet/ }));
    const tray = screen.getByRole('group', { name: en.sizing.label.bet });
    const coachChips = [...tray.querySelectorAll('[data-coach]')];
    expect(coachChips).toHaveLength(1);
    expect(coachChips[0]?.getAttribute('aria-label')).toMatch(/^Half the pot/);
    expect(screen.queryByRole('button', { name: /Coach's amount/ })).toBeNull();
  });

  it('without the coach’s size the tray starts at the middle preset, with no coach chip', () => {
    render(<Bar id="check" recommended={null} />);
    fireEvent.click(screen.getByRole('button', { name: /^Bet/ }));
    expect(document.querySelector('[data-coach]')).toBeNull();
    const half = screen.getByRole('button', { name: /^Half the pot/ });
    expect(half.getAttribute('aria-pressed')).toBe('true');
  });

  it('the coach chip sets the amount', () => {
    render(<Bar id="check" recommended="right" coachStart={70} />);
    fireEvent.click(screen.getByRole('button', { name: /^Bet/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Half the pot/ }));
    const chip = screen.getByRole('button', { name: en.coachUi.chipName('70') });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
  });
});
