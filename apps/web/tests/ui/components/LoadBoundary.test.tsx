// @vitest-environment jsdom
// The guard around a lazy sheet (chunk 5.10): a failed load or a render error closes the sheet's
// overlay instead of taking the app down or leaving a closed gate over an empty screen.
import { act, cleanup, render, screen } from '@testing-library/react';
import { lazy, Suspense, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoadBoundary } from '../../../src/ui/components/LoadBoundary.tsx';

beforeEach(() => {
  // React logs every error a boundary catches; these tests make them on purpose.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });

function Boom(): ReactNode {
  throw new Error('render failed');
}

describe('LoadBoundary', () => {
  it('shows its children and stays quiet while they work', () => {
    const onError = vi.fn();
    render(
      <LoadBoundary onError={onError}>
        <p>fine</p>
      </LoadBoundary>,
    );
    expect(screen.getByText('fine')).toBeTruthy();
    expect(onError).not.toHaveBeenCalled();
  });

  it('shows nothing and calls onError once when a child throws while rendering', () => {
    const onError = vi.fn();
    const { container } = render(
      <LoadBoundary onError={onError}>
        <Boom />
      </LoadBoundary>,
    );
    expect(container.innerHTML).toBe('');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('does the same when a lazy chunk cannot be loaded', async () => {
    const onError = vi.fn();
    const Broken = lazy<() => ReactNode>(() => Promise.reject(new Error('chunk is gone')));
    const { container } = render(
      <LoadBoundary onError={onError}>
        <Suspense fallback={null}>
          <Broken />
        </Suspense>
      </LoadBoundary>,
    );
    expect(onError).not.toHaveBeenCalled(); // still loading
    await settle();
    expect(container.innerHTML).toBe('');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('shows a lazy chunk that loads', async () => {
    const onError = vi.fn();
    const Fine = lazy(() => Promise.resolve({ default: () => <p>loaded</p> }));
    render(
      <LoadBoundary onError={onError}>
        <Suspense fallback={null}>
          <Fine />
        </Suspense>
      </LoadBoundary>,
    );
    await settle();
    expect(screen.getByText('loaded')).toBeTruthy();
    expect(onError).not.toHaveBeenCalled();
  });
});
