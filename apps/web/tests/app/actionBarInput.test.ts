/**
 * The store feeds the action bar (chunk 3.5): `actionBarView(selectActionBarInput(state))` works on
 * every hero turn, waits otherwise, and what its buttons send is an action the controller accepts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectActionBarInput, type ActionBarInputData } from '../../src/app/store.ts';
import type { PlayerAction } from '../../src/engine/types.ts';
import { actionBarView, trayAction, type ActionBarInput } from '../../src/ui/actionBar.ts';
import { makeHarness, SEED, tick } from './harness.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// The app builds a structurally equal object (app may not import ui, §2.1): it must fit.
const fits = (x: ActionBarInputData): ActionBarInput => x;

describe('selectActionBarInput → actionBarView (§12.7)', () => {
  it('waits on bot turns; on hero turns every enabled button sends a legal action', async () => {
    const h = makeHarness({ seed: SEED, settings: { players: 6, amounts: 'bb' } });
    h.dispatch({ type: 'play' });
    let heroTurns = 0;
    let rotate = 0;
    for (let i = 0; i < 3000 && heroTurns < 40; i++) {
      const s = h.state();
      const input = selectActionBarInput(s);
      if (input === null) {
        await tick();
        continue;
      }
      const view = actionBarView(fits(input));
      if (s.game.mode !== 'heroTurn') {
        expect(view.waiting).toBe(true);
        await tick();
        continue;
      }
      heroTurns++;
      expect(view.waiting).toBe(false);
      expect(input.legal).toBe(s.game.legal);
      // Take the buttons in turn: fold, middle, right (a direct action or the tray's start amount).
      const choices: PlayerAction[] = [];
      if (view.fold.enabled && view.fold.action !== null) choices.push(view.fold.action);
      if (view.middle.enabled && view.middle.action !== null) choices.push(view.middle.action);
      if (view.right?.enabled === true) {
        if (view.right.action !== null) choices.push(view.right.action);
        else if (view.tray !== null) choices.push(trayAction(view.tray, view.tray.start));
      }
      expect(choices.length).toBeGreaterThan(0);
      const action = choices[rotate++ % choices.length] as PlayerAction;
      const before = h.controller.snapshot().inputs.length;
      h.dispatch({ type: 'act', action });
      expect(h.controller.snapshot().inputs.length).toBe(before + 1);
      expect(h.state().game.diag.engineErrors).toBe(0);
      if (h.state().game.mode === 'handEnd') h.dispatch({ type: 'nextHand' });
    }
    expect(heroTurns).toBe(40);
  }, 60_000);
});
