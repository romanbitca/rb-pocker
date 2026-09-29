import { describe, expect, it } from 'vitest';
import {
  BET,
  boardCardSize,
  ellipseSeats,
  layoutFor,
  POD,
  PORTRAIT_SEATS,
  rectsOverlap,
  seatCentres,
  tableFrame,
  tableGeometry,
  type FrameOptions,
  type Rect,
  type Size,
} from '../../../src/ui/layout/seats.ts';

/** PLAN §18 Stage 3, acceptance 1–2: the target viewports. */
const TARGETS: Size[] = [
  { w: 375, h: 667 },
  { w: 360, h: 740 },
  { w: 390, h: 844 },
  { w: 844, h: 390 },
  { w: 1280, h: 800 },
];
/** More real screens: tablet landscape (§13.1), iPhone SE in Safari (compact), big phones. */
const EXTRA: Size[] = [
  { w: 1024, h: 768 },
  { w: 375, h: 548 },
  { w: 430, h: 932 },
  { w: 768, h: 1024 },
];

const name = (v: Size): string => `${v.w}×${v.h}`;
const shift = (r: Rect, by: Rect): Rect => ({ ...r, x: r.x + by.x, y: r.y + by.y });
const inside = (r: Rect, outer: Size): boolean =>
  r.x >= 0 && r.y >= 0 && r.x + r.w <= outer.w && r.y + r.h <= outer.h;

/** Every pairwise and fixed-element overlap for one table, as readable strings. */
function pod_problems(viewport: Size, opponents: number): string[] {
  const frame = tableFrame(viewport);
  const g = tableGeometry(frame.layout, frame.box, opponents);
  const problems: string[] = [];
  if (!inside(frame.box, viewport)) problems.push('table box outside the viewport');
  g.pods.forEach((pod, i) => {
    if (!inside(pod, frame.box)) problems.push(`pod ${i} outside the table box`);
    if (!inside(shift(pod, frame.box), viewport)) problems.push(`pod ${i} outside the viewport`);
    if (rectsOverlap(pod, g.board)) problems.push(`pod ${i} × board`);
    if (rectsOverlap(pod, g.hero)) problems.push(`pod ${i} × hero strip`);
    if (rectsOverlap(pod, g.pot)) problems.push(`pod ${i} × pot`);
    if (frame.tab !== null && rectsOverlap(shift(pod, frame.box), frame.tab)) {
      problems.push(`pod ${i} × Hands tab`);
    }
    g.pods.forEach((other, j) => {
      if (j > i && rectsOverlap(pod, other)) problems.push(`pod ${i} × pod ${j}`);
    });
  });
  return problems;
}

function bet_problems(viewport: Size, opponents: number): string[] {
  const frame = tableFrame(viewport);
  const g = tableGeometry(frame.layout, frame.box, opponents);
  const problems: string[] = [];
  g.bets.forEach((bet, i) => {
    if (!inside(bet, frame.box)) problems.push(`bet ${i} outside the table box`);
    if (rectsOverlap(bet, g.board)) problems.push(`bet ${i} × board`);
    if (rectsOverlap(bet, g.pot)) problems.push(`bet ${i} × pot`);
    if (rectsOverlap(bet, g.hero)) problems.push(`bet ${i} × hero strip`);
    g.pods.forEach((pod, j) => {
      if (rectsOverlap(bet, pod)) problems.push(`bet ${i} × pod ${j}`);
    });
    g.bets.forEach((other, j) => {
      if (j > i && rectsOverlap(bet, other)) problems.push(`bet ${i} × bet ${j}`);
    });
  });
  if (!inside(g.board, frame.box)) problems.push('board outside the table box');
  if (!inside(g.pot, frame.box)) problems.push('pot outside the table box');
  if (rectsOverlap(g.pot, g.board)) problems.push('pot × board');
  return problems;
}

describe('seat tables (PLAN §12.4)', () => {
  it('has one portrait centre per opponent for 1–8 opponents, clockwise from the left', () => {
    for (let m = 1; m <= 8; m++) {
      const seats = PORTRAIT_SEATS[m] ?? [];
      expect(seats).toHaveLength(m);
      // The first opponent is on the hero's left, the last on the right.
      expect((seats[0] as { x: number }).x).toBeLessThanOrEqual(50);
      expect((seats[m - 1] as { x: number }).x).toBeGreaterThanOrEqual(50);
    }
    expect(PORTRAIT_SEATS[8]).toEqual([
      { x: 10, y: 78 },
      { x: 10, y: 56 },
      { x: 12, y: 32 },
      { x: 32, y: 8 },
      { x: 68, y: 8 },
      { x: 88, y: 32 },
      { x: 90, y: 56 },
      { x: 90, y: 78 },
    ]);
  });

  it('puts landscape and wide seats on the §12.4 ellipse', () => {
    const [only] = ellipseSeats(1);
    expect(only?.x).toBeCloseTo(50, 9); // θ = 270°: straight across the table
    expect(only?.y).toBeCloseTo(12, 9);

    const three = ellipseSeats(3); // θ = 180°, 270°, 360°
    expect(three.map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([
      [6, 50],
      [50, 12],
      [94, 50],
    ]);

    for (let m = 1; m <= 8; m++) {
      ellipseSeats(m).forEach((p, i) => {
        const theta = ((90 + ((i + 1) * 360) / (m + 1)) * Math.PI) / 180;
        expect(p.x).toBeCloseTo(50 + 44 * Math.cos(theta), 9);
        expect(p.y).toBeCloseTo(50 + 38 * Math.sin(theta), 9);
      });
    }
    expect(seatCentres('wide', 5)).toEqual(ellipseSeats(5));
    expect(seatCentres('landscape', 5)).toEqual(ellipseSeats(5));
    expect(seatCentres('compact', 5)).toEqual(PORTRAIT_SEATS[5]);
  });

  it('rejects player counts outside 2–9', () => {
    expect(() => seatCentres('portrait', 0)).toThrow(RangeError);
    expect(() => seatCentres('portrait', 9)).toThrow(RangeError);
  });
});

describe('layouts and the table box (PLAN §12.3, §12.5)', () => {
  it('picks the §12.3 layout for each viewport', () => {
    expect(TARGETS.map(layoutFor)).toEqual([
      'portrait',
      'portrait',
      'portrait',
      'landscape',
      'wide',
    ]);
    expect(layoutFor({ w: 1024, h: 768 })).toBe('wide');
    expect(layoutFor({ w: 375, h: 548 })).toBe('compact');
    expect(layoutFor({ w: 899, h: 700 })).toBe('portrait');
  });

  it('keeps the seat area left of the 28 px edge-tab gutter in portrait and landscape', () => {
    expect(tableFrame({ w: 375, h: 667 })).toEqual({
      layout: 'portrait',
      box: { x: 0, y: 44, w: 347, h: 399 },
      tab: { x: 347, y: 199.5, w: 28, h: 88 },
    });
    const landscape = tableFrame({ w: 844, h: 390 });
    expect(landscape.box).toEqual({ x: 0, y: 36, w: 536, h: 354 });
    expect(landscape.tab).toEqual({ x: 536, y: 169, w: 28, h: 88 });
    expect(tableFrame({ w: 1280, h: 800 }).tab).toBeNull();
  });

  it('gives the wide table the rankings column’s room when it collapses to its 44 px rail', () => {
    expect(tableFrame({ w: 1280, h: 800 }).box.w).toBe(1280 - 0.24 * 1280);
    expect(tableFrame({ w: 1280, h: 800 }, { handsCollapsed: true }).box.w).toBe(1280 - 44);
    expect(tableFrame({ w: 1280, h: 800 }, { coachPanel: 0 }).box.h).toBe(800 - 44 - 112 - 64);
  });

  it('sizes board cards by §12.3, leaving room for the side pods', () => {
    expect(boardCardSize('wide', { w: 973, h: 340 })).toEqual({ w: 48, h: 67 });
    expect(boardCardSize('portrait', { w: 332, h: 472 })).toEqual({ w: 34, h: 48 });
    expect(boardCardSize('compact', { w: 347, h: 344 }).w).toBeLessThanOrEqual(36);
  });
});

describe('pods (Stage 3 acceptance 2)', () => {
  for (const viewport of [...TARGETS, ...EXTRA]) {
    it(`never overlap each other, the board, the pot, the hero strip or the tab at ${name(viewport)}`, () => {
      for (let opponents = 1; opponents <= 8; opponents++) {
        expect(pod_problems(viewport, opponents), `${opponents + 1} players`).toEqual([]);
      }
    });
  }

  it('are 64×72 and clamped 4 px inside the box (§12.4)', () => {
    const g = tableGeometry('portrait', { w: 347, h: 399 }, 8);
    for (const pod of g.pods) {
      expect([pod.w, pod.h]).toEqual([POD.w, POD.h]);
      expect(pod.x).toBeGreaterThanOrEqual(4);
      expect(pod.y).toBeGreaterThanOrEqual(4);
      expect(pod.x + pod.w).toBeLessThanOrEqual(347 - 4);
    }
    // (10, 78) → centre (34.7, 311.2): the left clamp moves it to x = 4.
    expect(g.pods[0]).toEqual({ x: 4, y: 275, w: 64, h: 72 });
  });

  it('face the table centre on their inner side (dealer disc, blind tag)', () => {
    const g = tableGeometry('portrait', { w: 347, h: 399 }, 8);
    expect(g.inner).toEqual(['right', 'right', 'right', 'right', 'left', 'left', 'left', 'left']);
  });
});

describe('pods with the sizing tray open (§12.7: inline, the table row is 104 px shorter)', () => {
  const TRAY = 104;
  // Portrait and wide place the tray above Row A (compact overlays it, landscape puts it in the
  // right column: neither changes the table). Wide as built in Stage 3: no inline coach panel yet.
  // Acceptance 2 asks that nothing needed for the decision is covered: the board, the pot and the
  // hero's cards. (Side pods of an 8- or 9-player table may touch each other while sizing at
  // 375×667: the box is 295 px tall for four 72 px pods a side.)
  const CASES: { viewport: Size; options?: FrameOptions }[] = [
    { viewport: { w: 375, h: 667 } },
    { viewport: { w: 360, h: 740 } },
    { viewport: { w: 390, h: 844 } },
    { viewport: { w: 768, h: 1024 } },
    { viewport: { w: 1280, h: 800 }, options: { coachPanel: 0 } },
    { viewport: { w: 1024, h: 768 }, options: { coachPanel: 0 } },
  ];
  for (const { viewport, options } of CASES) {
    it(`never cover the board, the pot or the hero strip at ${name(viewport)}`, () => {
      const frame = tableFrame(viewport, options);
      const box = { w: frame.box.w, h: frame.box.h - TRAY };
      for (let opponents = 1; opponents <= 8; opponents++) {
        const g = tableGeometry(frame.layout, box, opponents);
        const problems: string[] = [];
        g.pods.forEach((pod, i) => {
          if (!inside(pod, box)) problems.push(`pod ${i} outside the table box`);
          if (rectsOverlap(pod, g.board)) problems.push(`pod ${i} × board`);
          if (rectsOverlap(pod, g.pot)) problems.push(`pod ${i} × pot`);
          if (rectsOverlap(pod, g.hero)) problems.push(`pod ${i} × hero strip`);
        });
        if (!inside(g.board, box)) problems.push('board outside the table box');
        if (rectsOverlap(g.pot, g.board)) problems.push('pot × board');
        expect(problems, `${opponents + 1} players`).toEqual([]);
        expect(g.boardCard.w, `${opponents + 1} players`).toBeGreaterThanOrEqual(30);
      }
    });
  }
});

describe('bets (§12.4)', () => {
  for (const viewport of TARGETS) {
    it(`never overlap pods, the board, the pot or each other at ${name(viewport)}`, () => {
      for (let opponents = 1; opponents <= 8; opponents++) {
        expect(bet_problems(viewport, opponents), `${opponents + 1} players`).toEqual([]);
      }
    });
  }

  it('sit 30% of the way from the seat to the centre when that spot is free', () => {
    const size = { w: 362, h: 576 }; // 390×844
    const g = tableGeometry('portrait', size, 2);
    const pod = g.pods[0] as Rect;
    const cx = pod.x + pod.w / 2 + 0.3 * (size.w / 2 - (pod.x + pod.w / 2));
    const cy = pod.y + pod.h / 2 + 0.3 * (size.h / 2 - (pod.y + pod.h / 2));
    expect(g.bets[0]).toEqual({
      x: Math.round(cx - BET.w / 2),
      y: Math.round(cy - BET.h / 2),
      ...BET,
    });
  });
});
