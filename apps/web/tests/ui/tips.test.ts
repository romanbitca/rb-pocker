/**
 * The first-table tips' pure parts (PLAN §12.11, chunk 9.3, `ui/tips.ts`, `ui/tipPlace.ts`): which
 * tip is due (once each, in order, never before the hero's cards are dealt, never over a layer or
 * at a hand's end), and where its bubble goes (beside what it explains, inside the window, never
 * over the action bar).
 */
import { describe, expect, it } from 'vitest';
import type { HandState } from '../../src/engine/types.ts';
import { placeTip, type Box, type PlaceInput } from '../../src/ui/tipPlace.ts';
import { dueTip, TIP_ORDER, type TipInput } from '../../src/ui/tips.ts';
import { foldBy, handAtStart, headsUpFlop } from '../engine/fixtures.ts';

/** Three players, the hero (seat 0) first to act before the flop. */
const preflop = (): HandState => handAtStart({ stacks: [2000, 2000, 2000], button: 0 });

const input = (over: Partial<TipInput> = {}): TipInput => ({
  seen: {},
  screen: 'table',
  overlays: [],
  mode: 'heroTurn',
  hand: preflop(),
  undo: 'disabled',
  ...over,
});

describe('dueTip (§12.11: once each, one at a time)', () => {
  it('at the first hero turn: the hero strip, then the coach', () => {
    expect(dueTip(input())).toBe('heroStrip');
    expect(dueTip(input({ seen: { heroStrip: true } }))).toBe('coachStrip');
    expect(dueTip(input({ seen: { heroStrip: true, coachStrip: true } }))).toBeNull();
  });

  it('after an action, Undo while it can take the action back', () => {
    const seen = { heroStrip: true, coachStrip: true };
    expect(dueTip(input({ seen, mode: 'botTurn', undo: 'enabled' }))).toBe('undo');
    expect(dueTip(input({ seen, mode: 'botTurn', undo: 'disabled' }))).toBeNull();
    // Advanced and Exam show no toolbar Undo: no tip about it.
    expect(dueTip(input({ seen, mode: 'botTurn', undo: 'hidden' }))).toBeNull();
  });

  it('after a flop the hero still plays: the gold edge on the board, then the Hands tab', () => {
    const seen = { heroStrip: true, coachStrip: true, undo: true };
    const flop = headsUpFlop();
    // The first time the hero has a best five (1.3.97): its gold edge is explained first.
    expect(dueTip(input({ seen, mode: 'botTurn', hand: flop }))).toBe('bestFive');
    expect(dueTip(input({ seen, mode: 'heroTurn', hand: flop }))).toBe('bestFive');
    const after = { ...seen, bestFive: true };
    expect(dueTip(input({ seen: after, mode: 'botTurn', hand: flop }))).toBe('handsTab');
    for (const s of [seen, after]) {
      expect(dueTip(input({ seen: s, mode: 'botTurn' }))).toBeNull(); // no flop yet: no best five
      const folded = headsUpFlop();
      foldBy(folded, 0);
      expect(dueTip(input({ seen: s, mode: 'botTurn', hand: folded }))).toBeNull();
    }
  });

  it('the order when two are due together: hero strip, coach, Undo, gold edge, Hands tab', () => {
    expect(TIP_ORDER).toEqual(['heroStrip', 'coachStrip', 'undo', 'bestFive', 'handsTab']);
    expect(dueTip(input({ hand: headsUpFlop(), undo: 'enabled' }))).toBe('heroStrip');
    expect(
      dueTip(
        input({
          seen: { heroStrip: true, coachStrip: true },
          hand: headsUpFlop(),
          undo: 'enabled',
        }),
      ),
    ).toBe('undo');
  });

  it('never: tips off, seen, off the Table, over a layer, before the deal, at the hand end', () => {
    expect(dueTip(input({ seen: null }))).toBeNull();
    const all = Object.fromEntries(TIP_ORDER.map((t) => [t, true]));
    expect(dueTip(input({ seen: all, hand: headsUpFlop(), undo: 'enabled' }))).toBeNull();
    expect(dueTip(input({ screen: 'home' }))).toBeNull();
    for (const overlay of ['menu', 'tray', 'coach', 'rankings', 'feedback', 'tip'] as const) {
      expect(dueTip(input({ overlays: [overlay] }))).toBeNull();
    }
    expect(dueTip(input({ hand: null }))).toBeNull();
    const notDealt = preflop();
    const hero = notDealt.seats[0];
    if (hero === undefined) throw new Error('no hero seat');
    notDealt.seats[0] = { ...hero, dealtIn: false, hole: null };
    expect(dueTip(input({ hand: notDealt }))).toBeNull();
    const over = preflop();
    over.phase = 'complete';
    expect(dueTip(input({ hand: over, mode: 'handEnd' }))).toBeNull();
    // At the hand end the gold edge marks the winner's five, not "your hand": no tip about it.
    const ended = headsUpFlop();
    ended.phase = 'complete';
    const seen = { heroStrip: true, coachStrip: true, undo: true };
    expect(dueTip(input({ seen, hand: ended, mode: 'handEnd' }))).toBeNull();
  });
});

describe('placeTip (beside its anchor, inside the window, never over the action bar)', () => {
  const viewport = { width: 390, height: 844 };
  const bubble = { width: 240, height: 60 };
  /** Portrait: the tray and Row A at the bottom (8 px gutters). */
  const bar: Box = { left: 0, top: 772, width: 390, height: 72 };
  const place = (anchor: Box | null, over: Partial<PlaceInput> = {}) =>
    placeTip({ anchor, bubble, viewport, avoid: bar, prefer: 'above', ...over });
  const box = (p: { left: number; top: number }): Box => ({ ...bubble, ...p });
  const clearOf = (a: Box, b: Box) =>
    a.left + a.width <= b.left ||
    b.left + b.width <= a.left ||
    a.top + a.height <= b.top ||
    b.top + b.height <= a.top;

  it('above the hero strip, its arrow at the strip’s middle', () => {
    const strip: Box = { left: 0, top: 612, width: 390, height: 112 };
    const p = place(strip);
    expect(p.side).toBe('above');
    expect(p.top + bubble.height).toBe(strip.top - 10);
    expect(p.left).toBe(75); // centred: (390 − 240) / 2
    expect(p.arrow).toBe(120);
    expect(clearOf(box(p), bar)).toBe(true);
  });

  it('kept inside the window; the arrow still points at a small anchor near the edge', () => {
    const undo: Box = { left: 8, top: 726, width: 44, height: 44 };
    const p = place(undo);
    expect(p.side).toBe('above');
    expect(p.left).toBe(8);
    expect(p.arrow).toBe(22); // the button's middle, 30 − 8
    expect(clearOf(box(p), bar)).toBe(true);
  });

  it('below an anchor at the top of the window (compact mode: Undo in the top bar)', () => {
    const undo: Box = { left: 300, top: 0, width: 44, height: 44 };
    const p = place(undo);
    expect(p.side).toBe('below');
    expect(p.top).toBe(54);
    expect(p.left).toBe(390 - 8 - 240);
    expect(p.arrow).toBe(322 - (390 - 8 - 240));
  });

  it('below the board (the gold edge tip), its arrow at the board’s middle', () => {
    const board: Box = { left: 72, top: 260, width: 230, height: 52 };
    const p = place(board, { prefer: 'below' });
    expect(p.side).toBe('below');
    expect(p.top).toBe(board.top + board.height + 10);
    expect(p.left).toBe(67); // centred on the board: 187 − 120
    expect(p.arrow).toBe(120);
    expect(clearOf(box(p), bar)).toBe(true);
  });

  it('left of the Hands tab, its arrow at the tab’s middle', () => {
    const tab: Box = { left: 346, top: 300, width: 44, height: 88 };
    const p = place(tab, { prefer: 'left' });
    expect(p.side).toBe('left');
    expect(p.left + bubble.width).toBe(tab.left - 10);
    expect(p.top).toBe(314); // 344 − 30
    expect(p.arrow).toBe(30);
  });

  it('never over the action bar: lifted above it when nothing else fits', () => {
    const wideBubble = { width: 374, height: 200 };
    // A tall bubble at an anchor right above the bar: no side fits.
    const coach: Box = { left: 0, top: 724, width: 390, height: 48 };
    const p = placeTip({
      anchor: coach,
      bubble: wideBubble,
      viewport,
      avoid: bar,
      prefer: 'above',
    });
    expect(p.top + wideBubble.height).toBeLessThanOrEqual(bar.top);
    // Without an anchor: centred, right above the bar.
    const q = place(null);
    expect(q.side).toBeNull();
    expect(q.top + bubble.height).toBe(bar.top - 10);
    expect(q.left).toBe(75);
  });

  it('a bubble below its anchor never reaches the bar either: it goes above instead', () => {
    // An anchor just above the bar with room above: 'below' would cover the bar.
    const anchor: Box = { left: 100, top: 700, width: 40, height: 40 };
    const p = place(anchor, { prefer: 'below' });
    expect(p.side).toBe('above');
    expect(clearOf(box(p), bar)).toBe(true);
  });
});
