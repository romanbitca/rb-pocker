// @vitest-environment jsdom
/**
 * Pitfall 37: a component that selects one slice field re-renders only when that field changes.
 * Equity progress (the `equity` slice) and UI changes must not re-render a table component.
 */
import { act, cleanup, render } from '@testing-library/react';
import { memo, Profiler } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appStore,
  selectHand,
  selectMode,
  useAppStore,
  useAppStoreShallow,
} from '../../src/app/store.ts';

afterEach(cleanup);

const Hand = memo(function Hand() {
  const hand = useAppStore(selectHand);
  return <span>{hand === null ? 'no hand' : hand.handSeq}</span>;
});

const Status = memo(function Status() {
  const { mode, screen } = useAppStoreShallow((s) => ({ mode: s.game.mode, screen: s.ui.screen }));
  return (
    <span>
      {mode} {screen}
    </span>
  );
});

describe('narrow selectors (pitfall 37)', () => {
  it('50 equity updates and a toast re-render neither component; a mode change re-renders one', () => {
    const renders = { hand: 0, status: 0 };
    render(
      <>
        <Profiler id="hand" onRender={() => renders.hand++}>
          <Hand />
        </Profiler>
        <Profiler id="status" onRender={() => renders.status++}>
          <Status />
        </Profiler>
      </>,
    );
    const start = { ...renders };
    act(() => {
      for (let i = 0; i < 50; i++) appStore.setState({ equity: { status: 'off' } });
      appStore.setState((s) => ({ ui: { ...s.ui, toasts: [{ id: 1, kind: 'handVoided' }] } }));
    });
    expect(renders).toEqual(start);
    act(() => {
      appStore.setState((s) => ({ game: { ...s.game, mode: 'idle' } }));
    });
    expect(selectMode(appStore.getState())).toBe('idle');
    expect(renders.hand).toBe(start.hand);
    expect(renders.status).toBe(start.status + 1);
  });
});
