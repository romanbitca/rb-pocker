// The screen and overlay reducer (PLAN §12.1; app/navigation.ts).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  backCloses,
  currentScreen,
  historyDepth,
  initialNav,
  navigate,
  topOverlay,
  type Nav,
  type NavAction,
  type Overlay,
  type Screen,
} from '../../src/app/navigation.ts';
import { seedWords } from '../../src/core/rng.ts';
import { testSeed } from '../helpers/seed.ts';

const FC_SEED = (seedWords(testSeed('20260929000000000000000000003700'))[0] as number) | 0;

const SCREENS: Screen[] = ['welcome', 'home', 'setup', 'table', 'settings'];
const OVERLAYS: Overlay[] = ['menu', 'outOfChips', 'newTable'];

/** Runs actions from `nav` and returns every state on the way (the start included). */
function run(nav: Nav, ...actions: NavAction[]): Nav[] {
  const states = [nav];
  for (const action of actions) states.push(navigate(states[states.length - 1] as Nav, action));
  return states;
}
const last = (states: Nav[]): Nav => states[states.length - 1] as Nav;
const go = (screen: Screen): NavAction => ({ type: 'go', screen });
const open = (overlay: Overlay): NavAction => ({ type: 'open', overlay });
const back: NavAction = { type: 'back' };

describe('initialNav', () => {
  it('starts on Welcome on the first launch and on Home after that (§12.1)', () => {
    expect(initialNav(true)).toEqual({ screens: ['welcome'], overlays: [] });
    expect(initialNav(false)).toEqual({ screens: ['home'], overlays: [] });
    expect(currentScreen(initialNav(true))).toBe('welcome');
    expect(historyDepth(initialNav(false))).toBe(0);
  });
});

describe('navigate', () => {
  it('Welcome → Play goes straight to the Table, which sits on Home (one tap, §12.1)', () => {
    const nav = navigate(initialNav(true), go('table'));
    expect(nav).toEqual({ screens: ['home', 'table'], overlays: [] });
    expect(navigate(nav, back)).toEqual({ screens: ['home'], overlays: [] });
  });

  it('Setup → Start game replaces Setup with the Table', () => {
    const states = run(initialNav(false), go('setup'), go('table'));
    expect(last(states).screens).toEqual(['home', 'table']);
    expect(run(initialNav(true), go('setup'), go('table')).map(currentScreen)).toEqual([
      'welcome',
      'setup',
      'table',
    ]);
  });

  it('pushes other screens and returns to one already in the stack', () => {
    const nav = last(run(initialNav(false), go('table'), go('settings')));
    expect(nav.screens).toEqual(['home', 'table', 'settings']);
    expect(navigate(nav, go('table')).screens).toEqual(['home', 'table']);
    expect(navigate(nav, go('home')).screens).toEqual(['home']);
    expect(navigate(nav, back).screens).toEqual(['home', 'table']);
  });

  it('a screen change closes every overlay (Menu → Settings)', () => {
    const nav = last(run(initialNav(false), go('table'), open('menu'), go('settings')));
    expect(nav).toEqual({ screens: ['home', 'table', 'settings'], overlays: [] });
  });

  it('Back closes the top-most overlay first, then goes back one screen', () => {
    const states = run(
      initialNav(false),
      go('table'),
      open('menu'),
      open('newTable'),
      back,
      back,
      back,
    );
    expect(states.map((n) => [currentScreen(n), topOverlay(n)])).toEqual([
      ['home', null],
      ['table', null],
      ['table', 'menu'],
      ['table', 'newTable'],
      ['table', 'menu'],
      ['table', null],
      ['home', null],
    ]);
  });

  it('Back never leaves the first screen', () => {
    for (const first of [true, false]) {
      const nav = initialNav(first);
      expect(navigate(nav, back)).toBe(nav);
    }
  });

  it('Back cannot close the out-of-chips dialog: it returns Home (§3.1)', () => {
    expect(backCloses('outOfChips')).toBe(false);
    expect(backCloses('menu')).toBe(true);
    expect(backCloses('newTable')).toBe(true);
    const busted = last(run(initialNav(false), go('table'), open('outOfChips')));
    expect(navigate(busted, back)).toEqual({ screens: ['home'], overlays: [] });
  });

  it('the dialog closes through its own buttons', () => {
    const busted = last(run(initialNav(false), go('table'), open('outOfChips')));
    // Reload
    expect(navigate(busted, { type: 'close', overlay: 'outOfChips' })).toEqual({
      screens: ['home', 'table'],
      overlays: [],
    });
    // Change table: Setup takes the old table's place, so Back from Setup goes Home.
    const setup = navigate(busted, { type: 'replace', screen: 'setup' });
    expect(setup).toEqual({ screens: ['home', 'setup'], overlays: [] });
    expect(navigate(setup, back).screens).toEqual(['home']);
  });

  it('replace on the first screen pushes, and follows the rules of go', () => {
    expect(navigate(initialNav(false), { type: 'replace', screen: 'setup' }).screens).toEqual([
      'home',
      'setup',
    ]);
    expect(navigate(initialNav(true), { type: 'replace', screen: 'home' }).screens).toEqual([
      'home',
    ]);
    const setup = navigate(initialNav(false), go('setup'));
    expect(navigate(setup, { type: 'replace', screen: 'table' }).screens).toEqual([
      'home',
      'table',
    ]);
  });

  it('open moves an open overlay to the top; close takes the named or the top one', () => {
    const nav = last(run(initialNav(false), go('table'), open('menu'), open('newTable')));
    expect(navigate(nav, open('menu')).overlays).toEqual(['newTable', 'menu']);
    expect(navigate(nav, { type: 'close' }).overlays).toEqual(['menu']);
    expect(navigate(nav, { type: 'close', overlay: 'menu' }).overlays).toEqual(['newTable']);
  });

  it('returns the same object when nothing changes', () => {
    const table = last(run(initialNav(false), go('table')));
    expect(navigate(table, go('table'))).toBe(table);
    const menu = navigate(table, open('menu'));
    expect(navigate(menu, open('menu'))).toBe(menu);
    expect(navigate(table, { type: 'close' })).toBe(table);
    expect(navigate(table, { type: 'close', overlay: 'menu' })).toBe(table);
    const home = initialNav(false);
    expect(navigate(home, go('home'))).toBe(home);
  });

  it('never changes its input', () => {
    const nav = Object.freeze({
      screens: Object.freeze(['home', 'table'] as Screen[]),
      overlays: Object.freeze(['menu'] as Overlay[]),
    });
    for (const action of [go('settings'), back, open('newTable'), { type: 'close' } as const]) {
      expect(() => navigate(nav, action)).not.toThrow();
    }
    expect(nav).toEqual({ screens: ['home', 'table'], overlays: ['menu'] });
  });
});

const actionArb: fc.Arbitrary<NavAction> = fc.oneof(
  fc.constantFrom(...SCREENS).map((screen) => ({ type: 'go', screen }) as const),
  fc.constantFrom(...SCREENS).map((screen) => ({ type: 'replace', screen }) as const),
  fc.constant({ type: 'back' } as const),
  fc.constantFrom(...OVERLAYS).map((overlay) => ({ type: 'open', overlay }) as const),
  fc
    .option(fc.constantFrom(...OVERLAYS), { nil: undefined })
    .map((overlay) =>
      overlay === undefined ? ({ type: 'close' } as const) : ({ type: 'close', overlay } as const),
    ),
);

/** What every reachable state keeps (module note of app/navigation.ts). */
function invariantProblems(nav: Nav): string[] {
  const problems: string[] = [];
  const [root] = nav.screens;
  if (root !== 'welcome' && root !== 'home') problems.push(`root ${String(root)}`);
  if (nav.screens.slice(1).some((s) => s === 'welcome' || s === 'home'))
    problems.push('root above');
  if (new Set(nav.screens).size !== nav.screens.length) problems.push('repeated screen');
  if (new Set(nav.overlays).size !== nav.overlays.length) problems.push('repeated overlay');
  const t = nav.screens.indexOf('table');
  if (t >= 0 && (t !== 1 || root !== 'home')) problems.push('table not on home');
  if (historyDepth(nav) !== nav.screens.length - 1 + nav.overlays.length) problems.push('depth');
  return problems;
}

describe('navigate: properties over random action sequences', () => {
  it('keeps the invariants, and Back always leads to the first screen', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.array(actionArb, { maxLength: 40 }), (first, actions) => {
        const states = run(initialNav(first), ...actions);
        for (const nav of states) expect(invariantProblems(nav)).toEqual([]);
        // At most historyDepth presses of Back reach the first screen (a dialog Back cannot
        // close takes its screen with it, so it can take fewer). There Back stops with nothing
        // open, or under such a dialog: its own buttons close it.
        let nav = last(states);
        for (let i = historyDepth(nav); i > 0; i--) nav = navigate(nav, back);
        expect(nav.screens).toHaveLength(1);
        const top = topOverlay(nav);
        expect(top === null || !backCloses(top)).toBe(true);
        expect(navigate(nav, back)).toBe(nav);
      }),
      { seed: FC_SEED, numRuns: 500 },
    );
  });

  it('one Back lowers historyDepth by one, except over the out-of-chips dialog', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.array(actionArb, { maxLength: 30 }), (first, actions) => {
        const nav = last(run(initialNav(first), ...actions));
        const after = navigate(nav, back);
        const depth = historyDepth(nav);
        if (topOverlay(nav) === 'outOfChips') {
          // It takes its screen with it; on the first screen nothing changes.
          if (nav.screens.length > 1) {
            expect(after).toEqual({ screens: nav.screens.slice(0, -1), overlays: [] });
          } else expect(after).toBe(nav);
        } else if (depth === 0) expect(after).toBe(nav);
        else expect(historyDepth(after)).toBe(depth - 1);
      }),
      { seed: FC_SEED, numRuns: 500 },
    );
  });
});
