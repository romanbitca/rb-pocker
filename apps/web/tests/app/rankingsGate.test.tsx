// @vitest-environment jsdom
/**
 * The rankings drawer wired to the store and the controller (PLAN §13.1, A.8, Stage 3
 * acceptance 3): `useOverlay('rankings')` gives the drawer its `open` / `onOpenChange`; while it is
 * open the `sheet` gate is closed and no bot acts; Esc, ✕ and Android Back close it (Back through
 * the lifecycle's history handler) and play goes on.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSimpleBrain } from '../../src/app/brain.ts';
import { createTableController, type TableController } from '../../src/app/controller.ts';
import { installBackHandler } from '../../src/app/lifecycle.ts';
import {
  appStore,
  selectHeroHandView,
  useAppStore,
  useOverlay,
  type AppState,
} from '../../src/app/store.ts';
import { RankingsDrawer } from '../../src/ui/components/RankingsDrawer.tsx';
import type { LegalActions, PlayerAction } from '../../src/engine/types.ts';

function DrawerHost() {
  const [open, setOpen] = useOverlay('rankings');
  const hero = useAppStore(selectHeroHandView);
  return (
    <div style={{ position: 'relative' }}>
      <RankingsDrawer open={open} onOpenChange={(next) => setOpen(next)} hero={hero} />
    </div>
  );
}

const passive = (legal: LegalActions): PlayerAction =>
  legal.canCheck ? { type: 'check' } : { type: 'call' };
const state = (): AppState => appStore.getState();
const inputs = (c: TableController): number => c.snapshot().inputs.length;

let controller: TableController;
let unhook: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, '');
  controller = createTableController({
    store: appStore,
    brain: createSimpleBrain(),
    heroName: 'You',
  });
  controller.boot();
  unhook = installBackHandler(window, appStore);
});

afterEach(() => {
  cleanup();
  unhook();
  controller.dispose();
  vi.useRealTimers();
});

/** Plays (hero passive) until a bot is to act. */
async function toBotTurn(): Promise<void> {
  for (let i = 0; i < 200 && state().game.mode !== 'botTurn'; i++) {
    const s = state();
    if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
      act(() => s.dispatch({ type: 'act', action: passive(s.game.legal as LegalActions) }));
    } else {
      await act(async () => {
        await vi.advanceTimersToNextTimerAsync();
      });
    }
  }
  expect(state().game.mode).toBe('botTurn');
}

async function elapse(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('the rankings drawer and the sheet gate', () => {
  it('no bot acts while it is open; Esc closes it and play goes on', async () => {
    act(() => state().dispatch({ type: 'play' }));
    render(<DrawerHost />);
    await toBotTurn();
    const before = inputs(controller);
    act(() => state().dispatch({ type: 'open', overlay: 'rankings' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(state().ui.gates).toEqual(['sheet']);
    await elapse(30_000);
    expect(inputs(controller)).toBe(before);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(state().ui.overlays).toEqual([]);
    expect(state().ui.gates).toEqual([]);
    await elapse(4000);
    expect(inputs(controller)).toBeGreaterThan(before);
  });

  it('Android Back closes it (history), never the table', async () => {
    act(() => state().dispatch({ type: 'play' }));
    render(<DrawerHost />);
    await toBotTurn();
    act(() => state().dispatch({ type: 'open', overlay: 'rankings' }));
    expect(window.history.state).toEqual({ pc: 'back-guard' });
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    });
    expect(state().ui.overlays).toEqual([]);
    expect(state().ui.screen).toBe('table');
    await elapse(300);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the drawer highlights the hero hand from the store', async () => {
    act(() => state().dispatch({ type: 'play' }));
    render(<DrawerHost />);
    act(() => state().dispatch({ type: 'open', overlay: 'rankings' }));
    const hero = selectHeroHandView(state());
    expect(hero).not.toBeNull();
    expect(hero?.hole).toEqual(state().game.hand?.seats[0]?.hole);
    expect(screen.getByRole('dialog').querySelector('[aria-current]')).not.toBeNull();
  });
});
