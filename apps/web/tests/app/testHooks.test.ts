// @vitest-environment jsdom
/**
 * Test hooks (PLAN "Testing strategy" → Rules, §18 Stage 3): `?seed=<hex>` fixes the table and
 * hand seeds; `window.__pc` exposes state, dispatch and logs. (That they are absent from the
 * production bundle is testHooks.bundle.test.ts.)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveSeed } from '../../src/core/rng.ts';
import { startApp } from '../../src/app/boot.ts';
import * as hooks from '../../src/app/testHooks.ts';
import {
  fixedSeeds,
  seedFromSearch,
  TEST_HOOKS_MARKER,
  type PcHooks,
} from '../../src/app/testHooks.ts';

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear(); // startApp saves the profile and the session (jsdom's localStorage)
});

describe('?seed=<hex>', () => {
  it('takes 1 to 32 hex digits, any case, left-padded to 32', () => {
    expect(seedFromSearch('?seed=abc')).toBe(`${'0'.repeat(29)}abc`);
    expect(seedFromSearch('?seed=DEADBEEF&x=1')).toBe(`${'0'.repeat(24)}deadbeef`);
    const full = '0123456789abcdef0123456789abcdef';
    expect(seedFromSearch(`?seed=${full}`)).toBe(full);
  });

  it('ignores a missing, empty, too long or non-hex seed', () => {
    for (const search of [
      '',
      '?x=1',
      '?seed=',
      '?seed=xyz',
      `?seed=${'a'.repeat(33)}`,
      '?seed=-1',
    ]) {
      expect(seedFromSearch(search)).toBeNull();
    }
  });

  it('fixes the table seeds (the first is the seed itself) and the hand seeds by handSeq', () => {
    const seed = '0123456789abcdef0123456789abcdef';
    const a = fixedSeeds(seed);
    const b = fixedSeeds(seed);
    expect([a.tableSeed(), a.tableSeed(), a.tableSeed()]).toEqual([
      seed,
      deriveSeed(seed, 'table', 1),
      deriveSeed(seed, 'table', 2),
    ]);
    expect(b.tableSeed()).toBe(seed);
    expect(a.handSeed(7)).toBe(deriveSeed(seed, 'hand', 7));
    expect(a.handSeed(7)).toBe(b.handSeed(7));
    expect(a.handSeed(8)).not.toBe(a.handSeed(7));
  });
});

describe('window.__pc and startApp', () => {
  it('a dev/E2E start with ?seed= deals from that seed and exposes state, dispatch and logs', () => {
    vi.useFakeTimers();
    const seed = '00000000000000000000000000c0ffee';
    window.history.replaceState(null, '', `/?seed=c0ffee`);
    const controller = startApp({ heroName: 'You', hooks });
    try {
      const pc = (window as Window & { __pc?: PcHooks }).__pc;
      if (pc === undefined) throw new Error('window.__pc is missing');
      expect(pc.marker).toBe(TEST_HOOKS_MARKER);
      expect(pc.seed).toBe(seed);
      expect(pc.state().game.mode).toBe('idle');
      pc.dispatch({ type: 'play' });
      const s = pc.state();
      expect(s.ui.screen).toBe('table');
      expect(s.game.table?.tableSeed).toBe(seed);
      expect(s.game.hand?.seed).toBe(deriveSeed(seed, 'hand', s.game.hand?.handSeq as number));
      expect(pc.snapshot().hand).toBe(s.game.hand);
      expect(pc.logs().events.some((e) => e.what === 'hand start')).toBe(true);
    } finally {
      controller.dispose();
      window.history.replaceState(null, '', '/');
    }
  });

  it('without hooks there is no window.__pc and seeds are random', () => {
    vi.useFakeTimers();
    delete (window as Window & { __pc?: PcHooks }).__pc;
    window.history.replaceState(null, '', `/?seed=c0ffee`);
    const controller = startApp({ heroName: 'You' });
    try {
      expect((window as Window & { __pc?: PcHooks }).__pc).toBeUndefined();
      controller.dispatch({ type: 'play' });
      expect(controller.snapshot().table?.tableSeed).not.toBe(`${'0'.repeat(26)}c0ffee`);
    } finally {
      controller.dispose();
      window.history.replaceState(null, '', '/');
    }
  });
});
