// @vitest-environment jsdom
/**
 * Row A and the sizing tray as the player meets them (PLAN §12.7, §12.12; Stage 3 acceptance 5,
 * 6 and 8): the disabled Fold and its tooltip, the tap guard, opening, using and closing the
 * tray (Android Back included), focus order, accessible names, no suit characters, tap targets.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect, useId, useMemo } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerAction } from '../../../src/engine/types.ts';
import { en } from '../../../src/i18n/en.ts';
import {
  actionBarView,
  useSizing,
  type ActionBarInput,
  type AmountUnit,
} from '../../../src/ui/actionBar.ts';
import { ActionBar, TAP_GUARD_MS } from '../../../src/ui/components/ActionBar.tsx';
import { HOLD_MS, REPEAT_MS, SizingTray } from '../../../src/ui/components/SizingTray.tsx';
import {
  ACTION_SPOT_IDS,
  ACTION_SPOTS,
  type ActionSpotId,
} from '../../../src/ui/dev/actionFixtures.ts';

const spot = (id: ActionSpotId, amounts: AmountUnit = 'chips'): ActionBarInput => ({
  ...ACTION_SPOTS[id],
  amounts,
});

/**
 * The Table screen's wiring, reduced to the bar: the view, `useSizing`, the tray above Row A, and
 * the controller's Android Back handling (PLAN §12.1: Back closes the top-most overlay).
 */
function Harness({ input, onAct }: { input: ActionBarInput; onAct: (a: PlayerAction) => void }) {
  const view = useMemo(() => actionBarView(input), [input]);
  const sizing = useSizing(view.tray);
  const trayId = useId();
  const { open, closeTray } = sizing;
  useEffect(() => {
    const onBack = () => {
      if (open) closeTray();
    };
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, [open, closeTray]);
  return (
    <main>
      <p>The table</p>
      {sizing.open && view.tray !== null ? (
        <SizingTray
          id={trayId}
          tray={view.tray}
          amount={sizing.amount}
          onAmount={sizing.setAmount}
          onClose={sizing.closeTray}
        />
      ) : null}
      <ActionBar
        view={view}
        trayOpen={sizing.open}
        amount={sizing.amount}
        trayId={trayId}
        onAct={onAct}
        onOpenTray={sizing.openTray}
        onCloseTray={sizing.closeTray}
      />
    </main>
  );
}

function setup(id: ActionSpotId, amounts: AmountUnit = 'chips') {
  const onAct = vi.fn<(a: PlayerAction) => void>();
  const utils = render(<Harness input={spot(id, amounts)} onAct={onAct} />);
  return { onAct, ...utils };
}

const bar = () => screen.getByRole('group', { name: en.actions.group });
const tray = () => screen.queryByRole('group', { name: /^Choose your/ });
const button = (name: string | RegExp) => within(bar()).getByRole('button', { name });

/** The bar's tap guard reads `performance.now()`; tests move it by hand. */
let now = 10_000;
beforeEach(() => {
  now = 10_000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const later = (ms = TAP_GUARD_MS) => {
  now += ms;
};

describe('the disabled Fold (§12.7, Stage 3 acceptance 5)', () => {
  it('with checking free, Fold is disabled, stays focusable and says why when tapped', () => {
    const { onAct } = setup('check');
    const fold = button('Fold');
    expect(fold.getAttribute('aria-disabled')).toBe('true');
    expect(fold.hasAttribute('disabled')).toBe(false); // focusable, and it can explain itself
    // A screen reader hears the reason with the button.
    const describedBy = fold.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe(en.actions.foldNotNeeded);

    const status = within(bar()).getByRole('status');
    expect(status.textContent).toBe('');
    fireEvent.click(fold);
    expect(status.textContent).toBe('Checking is free. No need to fold.');
    expect(onAct).not.toHaveBeenCalled();

    // A tap anywhere else hides it; tapping Fold again toggles it.
    fireEvent.pointerDown(document.body);
    expect(status.textContent).toBe('');
    fireEvent.click(fold);
    expect(status.textContent).toBe(en.actions.foldNotNeeded);
    fireEvent.pointerDown(fold);
    fireEvent.click(fold);
    expect(status.textContent).toBe('');
  });

  it('the tooltip never survives into the next decision', () => {
    const onAct = vi.fn();
    const { rerender } = render(<Harness input={spot('check')} onAct={onAct} />);
    fireEvent.click(button('Fold'));
    expect(within(bar()).getByRole('status').textContent).toBe(en.actions.foldNotNeeded);
    rerender(<Harness input={spot('waiting')} onAct={onAct} />);
    expect(within(bar()).getByRole('status').textContent).toBe('');
  });

  it('the not-reopened Raise is disabled the same way and explains the rule', () => {
    const { onAct } = setup('notReopened');
    const raise = button('Raise');
    expect(raise.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(raise);
    expect(within(bar()).getByRole('status').textContent).toBe(en.actions.cannotRaise);
    expect(onAct).not.toHaveBeenCalled();
    expect(tray()).toBeNull();
  });
});

describe('acting from Row A', () => {
  it('sends the action on one tap and ignores taps for 250 ms after it', () => {
    const { onAct } = setup('facing');
    fireEvent.click(button('Call 120'));
    expect(onAct).toHaveBeenLastCalledWith({ type: 'call' });
    later(TAP_GUARD_MS - 1);
    fireEvent.click(button('Fold'));
    fireEvent.click(button('Call 120'));
    expect(onAct).toHaveBeenCalledTimes(1);
    later(1);
    fireEvent.click(button('Fold'));
    expect(onAct).toHaveBeenLastCalledWith({ type: 'fold' });
    expect(onAct).toHaveBeenCalledTimes(2);
  });

  it('a short all-in call: "Call all-in 50" with "Pot you can win 150", and no right button', () => {
    const { onAct } = setup('shortCall');
    const callButton = button('Call all-in 50');
    const describedBy = callButton.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe('Pot you can win 150');
    expect(within(bar()).getAllByRole('button')).toHaveLength(2);
    fireEvent.click(callButton);
    expect(onAct).toHaveBeenCalledWith({ type: 'call' });
  });

  it('only one legal amount: "All-in 150" acts at once, no tray', () => {
    const { onAct } = setup('allInOnly');
    const allIn = button('All-in 150');
    expect(allIn.hasAttribute('aria-expanded')).toBe(false);
    fireEvent.click(allIn);
    expect(onAct).toHaveBeenCalledWith({ type: 'raise', to: 150 });
    expect(tray()).toBeNull();
  });

  it("not the hero's turn: every button disabled, Waiting…, taps do nothing", () => {
    const { onAct } = setup('waiting');
    const buttons = within(bar()).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Fold', 'Waiting…', 'Raise']);
    for (const b of buttons) {
      expect(b.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(b);
    }
    expect(onAct).not.toHaveBeenCalled();
    expect(tray()).toBeNull();
  });
});

describe('the sizing tray: open, use, confirm, close (§12.7, Stage 3 acceptance 8)', () => {
  it('Raise ▲ opens the tray at the middle preset; the right button then confirms that amount', () => {
    const { onAct } = setup('facing');
    const raise = button('Raise');
    expect(raise.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(raise);
    const t = tray();
    expect(t).not.toBeNull();
    const confirm = button('Raise to 300');
    expect(confirm).toBe(raise); // the same button, so focus stays put
    expect(confirm.getAttribute('aria-expanded')).toBe('true');
    expect(confirm.getAttribute('aria-controls')).toBe(t?.id);
    expect(
      within(t as HTMLElement)
        .getByRole('button', { name: '2.5 times the bet: 300' })
        .getAttribute('aria-pressed'),
    ).toBe('true');

    fireEvent.click(within(t as HTMLElement).getByRole('button', { name: '3 times the bet: 360' }));
    fireEvent.click(button('Raise to 360'));
    expect(onAct).toHaveBeenCalledWith({ type: 'raise', to: 360 });
    expect(tray()).toBeNull();
    expect(button('Raise').getAttribute('aria-expanded')).toBe('false');
  });

  it('closes with ✕, with Esc and with a tap outside; a tap on the confirm button is not "outside"', () => {
    setup('check');
    const open = () => {
      later();
      fireEvent.click(button(/^Bet/));
      expect(tray()).not.toBeNull();
    };
    open();
    fireEvent.click(within(tray() as HTMLElement).getByRole('button', { name: 'Close' }));
    expect(tray()).toBeNull();

    open();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(tray()).toBeNull();

    open();
    fireEvent.pointerDown(button('Bet 100'));
    expect(tray()).not.toBeNull();
    fireEvent.pointerDown(within(tray() as HTMLElement).getByRole('slider'));
    expect(tray()).not.toBeNull();
    fireEvent.pointerDown(screen.getByText('The table'));
    expect(tray()).toBeNull();
  });

  it('Android Back (popstate) closes the tray, and only the tray', () => {
    setup('facing');
    fireEvent.click(button('Raise'));
    expect(tray()).not.toBeNull();
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(tray()).toBeNull();
    expect(button('Raise')).toBeTruthy();
    expect(screen.getByText('The table')).toBeTruthy();
  });

  it('Fold or Call with the tray open acts and closes the tray', () => {
    const { onAct } = setup('facing');
    fireEvent.click(button('Raise'));
    later();
    fireEvent.click(button('Call 120'));
    expect(onAct).toHaveBeenCalledWith({ type: 'call' });
    expect(tray()).toBeNull();
  });

  it('the slider walks legal amounts; dragged, it snaps to a preset within ±2%', () => {
    setup('check'); // bet: min 20, max 1,940, presets 60 · 100 · 130 · 190 · 1,940
    fireEvent.click(button(/^Bet/));
    const slider = within(tray() as HTMLElement).getByRole('slider', { name: 'Amount' });
    expect(slider.getAttribute('aria-valuetext')).toBe('Bet 100, 5 big blinds');
    // Keyboard (no pointer down): step 189 is exactly 1,910.
    fireEvent.change(slider, { target: { value: '189' } });
    expect(button('Bet 1,910')).toBeTruthy();
    expect(slider.getAttribute('aria-valuetext')).toBe('Bet 1,910, 95.5 big blinds');
    // Dragged: 1,910 is within 2% of all-in (1,940), so it snaps there.
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: '188' } });
    fireEvent.change(slider, { target: { value: '189' } });
    fireEvent.pointerUp(slider);
    expect(button('All-in 1,940')).toBeTruthy();
  });

  it('[−] / [+] step by one small blind; held down they repeat at 8 steps a second', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    setup('facing'); // raise: 240 … 1,940, start 300
    fireEvent.click(button('Raise'));
    const t = tray() as HTMLElement;
    const plus = within(t).getByRole('button', { name: 'Bigger amount' });
    const minus = within(t).getByRole('button', { name: 'Smaller amount' });
    // Keyboard activation (a click with detail 0): one step.
    fireEvent.click(plus, { detail: 0 });
    expect(button('Raise to 310')).toBeTruthy();
    fireEvent.click(minus, { detail: 0 });
    fireEvent.click(minus, { detail: 0 });
    expect(button('Raise to 290')).toBeTruthy();
    // A pointer press steps at once, repeats after HOLD_MS, then every REPEAT_MS.
    fireEvent.pointerDown(plus, { button: 0, pointerId: 1 });
    expect(button('Raise to 300')).toBeTruthy();
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(button('Raise to 310')).toBeTruthy();
    act(() => vi.advanceTimersByTime(REPEAT_MS * 4));
    expect(button('Raise to 350')).toBeTruthy();
    fireEvent.pointerUp(plus, { button: 0, pointerId: 1 });
    act(() => vi.advanceTimersByTime(REPEAT_MS * 4));
    expect(button('Raise to 350')).toBeTruthy();
    // The click that follows a pointer press does not step again.
    fireEvent.click(plus, { detail: 1 });
    expect(button('Raise to 350')).toBeTruthy();
    // At the bottom, [−] is disabled and a long press stops by itself.
    fireEvent.click(within(t).getByRole('button', { name: 'The smallest raise: 240' }));
    expect(minus.getAttribute('aria-disabled')).toBe('true');
    fireEvent.pointerDown(minus, { button: 0, pointerId: 2 });
    act(() => vi.advanceTimersByTime(HOLD_MS + REPEAT_MS * 10));
    expect(button('Raise to 240')).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a typed amount is snapped to the small blind and clamped when the field is left', () => {
    setup('facing');
    fireEvent.click(button('Raise'));
    const field = within(tray() as HTMLElement).getByRole('textbox', {
      name: 'Type an amount in chips',
    });
    expect(field.getAttribute('inputmode')).toBe('numeric');
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '1,234' } });
    expect(button('Raise to 300')).toBeTruthy(); // nothing changes while typing
    fireEvent.blur(field);
    expect(button('Raise to 1,230')).toBeTruthy();
    expect((field as HTMLInputElement).value).toBe('1,230');
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '5' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(button('Raise to 240')).toBeTruthy();
    fireEvent.change(field, { target: { value: '999999' } });
    fireEvent.blur(field);
    expect(button('All-in 1,940')).toBeTruthy();
  });

  it('in big blinds, the field takes decimals', () => {
    setup('facing', 'bb');
    fireEvent.click(button('Raise'));
    const field = within(tray() as HTMLElement).getByRole('textbox', {
      name: 'Type an amount in big blinds',
    });
    expect(field.getAttribute('inputmode')).toBe('decimal');
    expect((field as HTMLInputElement).value).toBe('15');
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '6.5' } });
    fireEvent.blur(field);
    expect(button('Raise to 12 BB')).toBeTruthy(); // 130 is below the 240 minimum: clamped
  });
});

/** Focusable elements in tab order (no positive tabindex anywhere, so tab order = DOM order). */
function tabOrder(root: HTMLElement): string[] {
  const all = [...root.querySelectorAll<HTMLElement>('button, input, [tabindex]')];
  for (const el of all) expect(Number(el.getAttribute('tabindex') ?? 0)).toBeLessThanOrEqual(0);
  return all
    .filter((el) => !(el as HTMLButtonElement).disabled && el.getAttribute('tabindex') !== '-1')
    .map((el) => el.getAttribute('aria-label') ?? el.textContent ?? el.tagName);
}

describe('keyboard focus order (§12.12)', () => {
  it('Row A: Fold → Check/Call → Bet/Raise, disabled buttons included', () => {
    setup('check');
    expect(tabOrder(bar())).toEqual(['Fold', 'Check', 'Bet']);
    cleanup();
    setup('waiting');
    expect(tabOrder(bar())).toEqual(['Fold', 'Waiting…', 'Raise']);
  });

  it('the tray: presets, then [−], the slider, [+], the amount and ✕', () => {
    setup('facing');
    fireEvent.click(button('Raise'));
    expect(tabOrder(tray() as HTMLElement)).toEqual([
      'The smallest raise: 240',
      '2.5 times the bet: 300',
      '3 times the bet: 360',
      'The size of the pot: 550',
      'All your chips: 1,940',
      'Smaller amount',
      'Amount',
      'Bigger amount',
      'Type an amount in chips',
      'Close',
    ]);
  });

  it('keyboard play: focus the right button, press it to open, press it again to confirm', () => {
    const { onAct } = setup('open');
    const right = button('Raise');
    right.focus();
    fireEvent.click(right, { detail: 0 });
    expect(document.activeElement).toBe(right);
    expect(right.getAttribute('aria-label')).toBe('Raise to 50');
    fireEvent.click(right, { detail: 0 });
    expect(onAct).toHaveBeenCalledWith({ type: 'raise', to: 50 });
  });
});

describe('accessible names (§12.12)', () => {
  it('groups, full-text buttons, labelled controls', () => {
    setup('check');
    expect(bar().getAttribute('aria-label')).toBe('Your actions');
    fireEvent.click(button(/^Bet/));
    const t = tray() as HTMLElement;
    expect(t.getAttribute('aria-label')).toBe('Choose your bet');
    const chips = within(t)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    expect(chips).toEqual([
      'One third of the pot: 60',
      'Half the pot: 100',
      'Two thirds of the pot: 130',
      'The size of the pot: 190',
      'All your chips: 1,940',
      'Smaller amount',
      'Bigger amount',
      'Close',
    ]);
    // Every icon is decoration; every name is text.
    for (const svg of document.querySelectorAll('svg')) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('the chip with the current amount is pressed; out-of-range chips are disabled buttons', () => {
    setup('threeBet'); // raise 100 … 2,000: every preset legal, start 2.5× = 150
    fireEvent.click(button('Raise'));
    const pressed = within(tray() as HTMLElement)
      .getAllByRole('button', { pressed: true })
      .map((b) => b.getAttribute('aria-label'));
    expect(pressed).toEqual(['2.5 times the bet: 150']);
    cleanup();
    // 150 behind on a pot of 190: the Pot chip is out of range.
    const short: ActionBarInput = {
      ...spot('check'),
      legal: { ...ACTION_SPOTS.check.legal, bet: { min: 20, max: 150 } },
    };
    render(<Harness input={short} onAct={() => {}} />);
    fireEvent.click(button(/^Bet/));
    const pot = within(tray() as HTMLElement).getByRole('button', {
      name: 'The size of the pot: 190',
    });
    expect((pot as HTMLButtonElement).disabled).toBe(true);
    expect(pot.getAttribute('aria-pressed')).toBe('false');
    expect(
      within(tray() as HTMLElement).getByRole('button', { name: 'All your chips: 150' }),
    ).toBeTruthy();
  });
});

/** The Unicode suit characters U+2660–U+2667 (they can render as emoji, pitfall 31). */
const SUITS = /[♠-♧]/u;

describe('no suit characters (pitfall 31)', () => {
  it('in any spot, with the tray open or closed, in both units', () => {
    for (const id of ACTION_SPOT_IDS) {
      for (const unit of ['chips', 'bb'] as const) {
        setup(id, unit);
        const right = within(bar()).queryByRole('button', { expanded: false });
        if (right !== null && right.getAttribute('aria-disabled') !== 'true')
          fireEvent.click(right);
        expect(document.body.innerHTML).not.toMatch(SUITS);
        cleanup();
      }
    }
  });

  it('in the sources and strings of the bar', () => {
    const sources = import.meta.glob(
      [
        '../../../src/ui/actionBar.ts',
        '../../../src/ui/components/{ActionBar,SizingTray}.{tsx,module.css}',
        '../../../src/ui/dev/{ActionsPreview,actionFixtures}.{ts,tsx}',
        '../../../src/i18n/en.ts',
      ],
      { query: '?raw', import: 'default', eager: true },
    );
    const files = Object.entries(sources);
    expect(files.length).toBe(8);
    expect(files.filter(([, text]) => SUITS.test(String(text))).map(([f]) => f)).toEqual([]);
  });
});

/** The size an element's own CSS gives it (jsdom has no layout: sizes are declared in px). */
function declared(el: Element): { w: number; h: number } {
  const cs = getComputedStyle(el);
  const px = (v: string) => (v.endsWith('px') ? parseFloat(v) : 0);
  return {
    w: Math.max(px(cs.width), px(cs.minWidth)),
    h: Math.max(px(cs.height), px(cs.minHeight)),
  };
}

describe('tap targets (§12.12, Stage 3 acceptance 6)', () => {
  it('Row A buttons are at least 56 px tall; every tray control at least 44×44', () => {
    for (const id of ['check', 'facing', 'shortCall', 'deep'] as const) {
      setup(id);
      for (const b of within(bar()).getAllByRole('button')) {
        expect(declared(b).h, b.getAttribute('aria-label') ?? '').toBeGreaterThanOrEqual(56);
        expect(declared(b).w).toBeGreaterThanOrEqual(44);
      }
      const right = within(bar()).queryByRole('button', { expanded: false });
      if (right !== null) {
        fireEvent.click(right);
        const controls = (tray() as HTMLElement).querySelectorAll('button, input');
        expect(controls.length).toBeGreaterThanOrEqual(8);
        for (const c of controls) {
          const { w, h } = declared(c);
          const name = c.getAttribute('aria-label') ?? c.tagName;
          expect(w, name).toBeGreaterThanOrEqual(44);
          expect(h, name).toBeGreaterThanOrEqual(44);
        }
        // The typed amount is at least 16 px, or iOS zooms in (§12.13).
        const field = within(tray() as HTMLElement).getByRole('textbox');
        expect(parseFloat(getComputedStyle(field).fontSize)).toBeGreaterThanOrEqual(16);
      }
      cleanup();
    }
  });

  it('the tray is 104 px tall above Row A, and overlays the table in compact mode', () => {
    setup('facing');
    fireEvent.click(button('Raise'));
    const t = tray() as HTMLElement;
    expect(getComputedStyle(t).height).toBe('104px');
    expect(getComputedStyle(t).position).not.toBe('absolute');
    cleanup();
    const view = actionBarView(spot('facing'));
    if (view.tray === null) throw new Error('no tray');
    render(
      <SizingTray
        tray={view.tray}
        amount={300}
        onAmount={() => {}}
        onClose={() => {}}
        placement="overlay"
      />,
    );
    const overlay = tray() as HTMLElement;
    expect(getComputedStyle(overlay).position).toBe('absolute');
    expect(['0', '0px']).toContain(getComputedStyle(overlay).bottom);
    expect(getComputedStyle(overlay).height).toBe('104px');
  });
});
