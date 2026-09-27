/**
 * Seat geometry (PLAN §12.3–§12.5, §13.1): where the opponents' pods, their bet chips, the board
 * and the pot sit in the table box, for every player count and layout. Pure maths, no DOM: the
 * Table screen measures its box and calls `tableGeometry()` (memoised; it changes only on resize),
 * and the tests check every player count at every target viewport without a browser.
 *
 * Coordinates are CSS pixels relative to the table box (x right, y down), unless a name says
 * "viewport". Seat centres are percentages of the box, as in the PLAN's tables.
 *
 * Changes to the PLAN's numbers (all recorded in PLAN §12.4):
 * - The board's card width also leaves a 72 px column on each side (`boardCardSize`), and the
 *   mid-height side pods of the 3- and 4-opponent tables sit at x = 10 / 90 instead of 12 / 88:
 *   otherwise those pods overlap the board on 360–390 px phones.
 * - Pods are clamped vertically as well as horizontally (tops at 5–8% would poke out of the box)
 *   and stay out of the hero strip's overlap.
 * - Bets start at the §12.4 point (30% of the way to the centre) and move to the nearest free
 *   slot beside the pod when that point is taken (`placeBets`).
 * - The pot sits right above the board instead of at a fixed (50, 34), which leaves room for
 *   the bets of the upper side seats.
 */

export interface Size {
  readonly w: number;
  readonly h: number;
}
export interface Point {
  readonly x: number;
  readonly y: number;
}
export interface Rect extends Point, Size {}

/** PLAN §12.3's layouts, plus `compact` (portrait at most 640 px tall). */
export type TableLayout = 'portrait' | 'compact' | 'landscape' | 'wide';

/** A seat pod (§12.4). */
export const POD: Size = { w: 64, h: 72 };
/** Pods keep this far from the box edges: §12.4's `clamp(4px, calc(var(--x) - 32px), calc(100% - 68px))`. */
export const POD_EDGE = 4;
/** Room reserved for one bet chip: the chip icon plus an amount up to "9,999" or "12.3k". */
export const BET: Size = { w: 56, h: 20 };
/** Room reserved for the pot: "Pot 12,340" over "Main 300 · Side 400". */
export const POT: Size = { w: 136, h: 38 };
/** Space between the pot and the board: a raised core card reaches 9 px above the board. */
export const POT_GAP = 12;
/** Gap between board cards: §12.3's "− 16px" is the 4 gaps of 4 px. */
export const BOARD_GAP = 4;
/** Card height ÷ width (40×56, 36×50, 64×90). */
export const CARD_RATIO = 1.4;

/** The shell around the table (§12.3, §12.5). The Table screen's CSS uses the same numbers. */
export const SHELL = {
  topBar: 44,
  topBarLandscape: 36,
  heroStrip: 112,
  heroStripCompact: 96,
  /** How far the hero's hole cards reach up into the table box. */
  heroOverlap: 24,
  heroOverlapCompact: 20,
  coachStrip: 48,
  actionBar: 64,
  /** Portrait and landscape: the Hands edge tab's gutter at the right edge of the table (§12.3). */
  edgeGutter: 28,
  edgeTab: { w: 28, h: 88 },
  /** Landscape: the right column (label, badge, coach, stacked action buttons). */
  landscapeColumn: 280,
  /** Landscape: the hero's cards, inset at the bottom centre of the felt. */
  landscapeHero: { w: 128, h: 98 },
  /** Wide: the rankings column `clamp(260px, 24vw, 320px)`; the inline coach panel is ≤ 30vh. */
  wideColumn: { min: 260, vw: 0.24, max: 320 },
  wideCoachMax: 0.3,
} as const;

const pt = (x: number, y: number): Point => ({ x, y });

/**
 * Portrait pod centres (x%, y%) of the table box, opponents clockwise from the hero's left
 * (§12.4). Index `i` is seat `i + 1` (the hero is seat 0, bottom centre).
 */
export const PORTRAIT_SEATS: readonly (readonly Point[])[] = [
  [],
  [pt(50, 10)],
  [pt(22, 14), pt(78, 14)],
  [pt(10, 42), pt(50, 8), pt(90, 42)],
  [pt(10, 58), pt(22, 14), pt(78, 14), pt(90, 58)],
  [pt(10, 64), pt(12, 30), pt(50, 7), pt(88, 30), pt(90, 64)],
  [pt(10, 70), pt(10, 42), pt(28, 10), pt(72, 10), pt(90, 42), pt(90, 70)],
  [pt(10, 74), pt(10, 48), pt(18, 20), pt(50, 6), pt(82, 20), pt(90, 48), pt(90, 74)],
  [pt(10, 78), pt(10, 56), pt(12, 32), pt(32, 8), pt(68, 8), pt(88, 32), pt(90, 56), pt(90, 78)],
];

function checkOpponents(opponents: number): void {
  if (!Number.isInteger(opponents) || opponents < 1 || opponents > 8) {
    throw new RangeError(`opponents must be 1..8, got ${String(opponents)}`);
  }
}

/**
 * Landscape and wide (§12.4): for `m` opponents, `θj = 90° + j·360°/(m+1)` (j = 1..m; y down,
 * θ = 90° is the hero at the bottom), `x = 50 + 44·cos θ`, `y = 50 + 38·sin θ` (percent).
 */
export function ellipseSeats(opponents: number): Point[] {
  checkOpponents(opponents);
  return Array.from({ length: opponents }, (_, i) => {
    const theta = ((90 + ((i + 1) * 360) / (opponents + 1)) * Math.PI) / 180;
    return pt(50 + 44 * Math.cos(theta), 50 + 38 * Math.sin(theta));
  });
}

/** Pod centres in percent of the table box, opponents clockwise from the hero's left. */
export function seatCentres(layout: TableLayout, opponents: number): Point[] {
  checkOpponents(opponents);
  if (layout === 'landscape' || layout === 'wide') return ellipseSeats(opponents);
  return [...(PORTRAIT_SEATS[opponents] as readonly Point[])];
}

/** §12.3's layout media queries, first match wins (plus compact: portrait ≤ 640 px tall). */
export function layoutFor(viewport: Size): TableLayout {
  if (viewport.w >= 900 && viewport.h >= 560) return 'wide';
  if (viewport.w > viewport.h && viewport.h <= 559) return 'landscape';
  return viewport.h <= 640 ? 'compact' : 'portrait';
}

/** The table box and the Hands edge tab for a viewport (safe-area insets taken as 0). */
export interface TableFrame {
  readonly layout: TableLayout;
  /** The table box in viewport coordinates, without the edge-tab gutter. */
  readonly box: Rect;
  /** The Hands edge tab in viewport coordinates; `null` on wide screens (the column replaces it). */
  readonly tab: Rect | null;
}

/** Wide-layout options for `tableFrame`. */
export interface FrameOptions {
  /** The inline coach panel's height (default: its 30vh maximum, the tightest case). */
  readonly coachPanel?: number;
  /** The rankings column is collapsed to its 44 px rail (`settings.handsPanel`, §13.1). */
  readonly handsCollapsed?: boolean;
}

/** The collapsed rankings rail (§12.5). */
export const HANDS_RAIL = 44;

/** Where the table box sits for a viewport, from the §12.3 / §12.5 shell sizes. */
export function tableFrame(viewport: Size, options: FrameOptions = {}): TableFrame {
  const layout = layoutFor(viewport);
  const { w: W, h: H } = viewport;
  const tabAt = (right: number, top: number, height: number): Rect => ({
    x: right - SHELL.edgeTab.w,
    y: top + height / 2 - SHELL.edgeTab.h / 2,
    ...SHELL.edgeTab,
  });
  switch (layout) {
    case 'wide': {
      const { min, vw, max } = SHELL.wideColumn;
      const column =
        options.handsCollapsed === true ? HANDS_RAIL : Math.min(max, Math.max(min, vw * W));
      const coach = options.coachPanel ?? Math.round(SHELL.wideCoachMax * H);
      const h = H - SHELL.topBar - SHELL.heroStrip - coach - SHELL.actionBar;
      return { layout, box: { x: 0, y: SHELL.topBar, w: W - column, h }, tab: null };
    }
    case 'landscape': {
      const right = W - SHELL.landscapeColumn;
      const h = H - SHELL.topBarLandscape;
      return {
        layout,
        box: { x: 0, y: SHELL.topBarLandscape, w: right - SHELL.edgeGutter, h },
        tab: tabAt(right, SHELL.topBarLandscape, h),
      };
    }
    case 'compact':
    case 'portrait': {
      const strips =
        layout === 'compact'
          ? SHELL.heroStripCompact + SHELL.actionBar
          : SHELL.heroStrip + SHELL.coachStrip + SHELL.actionBar;
      const h = H - SHELL.topBar - strips;
      return {
        layout,
        box: { x: 0, y: SHELL.topBar, w: W - SHELL.edgeGutter, h },
        tab: tabAt(W, SHELL.topBar, h),
      };
    }
  }
}

/** The part of the table box the hero strip covers (§12.3: the hole cards reach up into it). */
export function heroArea(layout: TableLayout, size: Size): Rect {
  switch (layout) {
    case 'landscape': {
      const { w, h } = SHELL.landscapeHero;
      return { x: Math.round((size.w - w) / 2), y: size.h - h, w, h };
    }
    case 'compact':
      return { x: 0, y: size.h - SHELL.heroOverlapCompact, w: size.w, h: SHELL.heroOverlapCompact };
    default:
      return { x: 0, y: size.h - SHELL.heroOverlap, w: size.w, h: SHELL.heroOverlap };
  }
}

/** CSS `clamp(lo, v, hi)`: `lo` wins when `hi < lo`. */
const clamp = (lo: number, v: number, hi: number): number => Math.max(lo, Math.min(v, hi));

/** Pod boxes: centred on the seat point, then clamped into the box (and above the hero strip). */
export function podRects(layout: TableLayout, size: Size, opponents: number): Rect[] {
  const reserve = layout === 'landscape' ? 0 : heroArea(layout, size).h;
  return seatCentres(layout, opponents).map(({ x, y }) => ({
    x: Math.round(clamp(POD_EDGE, (x / 100) * size.w - POD.w / 2, size.w - POD.w - POD_EDGE)),
    y: Math.round(
      clamp(POD_EDGE, (y / 100) * size.h - POD.h / 2, size.h - POD.h - POD_EDGE - reserve),
    ),
    w: POD.w,
    h: POD.h,
  }));
}

/**
 * Board card size: §12.3's `min(48px, (tableWidth × 0.6 − 16px) / 5)` (36 px in compact mode),
 * and never wider than the room between the side columns of pods (72 px on each side).
 */
export function boardCardSize(layout: TableLayout, size: Size): Size {
  const max = layout === 'compact' ? 36 : 48;
  const byTable = (size.w * 0.6 - 4 * BOARD_GAP) / 5;
  const bySides = (size.w - 2 * (POD_EDGE + POD.w + POD_EDGE) - 4 * BOARD_GAP) / 5;
  const w = Math.max(20, Math.floor(Math.min(max, byTable, bySides)));
  return { w, h: Math.round(w * CARD_RATIO) };
}

const overlaps = (a: Rect, b: Rect, margin = 0): boolean =>
  a.x < b.x + b.w + margin &&
  b.x < a.x + a.w + margin &&
  a.y < b.y + b.h + margin &&
  b.y < a.y + a.h + margin;

const overlapArea = (a: Rect, b: Rect): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

const insideBox = (r: Rect, size: Size): boolean =>
  r.x >= 0 && r.y >= 0 && r.x + r.w <= size.w && r.y + r.h <= size.h;

/** Whether two rectangles overlap (touching edges do not count). */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return overlaps(a, b);
}

const slot = (cx: number, cy: number, s: Size): Rect => ({
  x: Math.round(cx - s.w / 2),
  y: Math.round(cy - s.h / 2),
  w: s.w,
  h: s.h,
});

/** Where a pod's bet chip may go, best first (see `placeBets`). */
function betCandidates(pod: Rect, centre: Point): Rect[] {
  const gap = 3;
  const pc = pt(pod.x + pod.w / 2, pod.y + pod.h / 2);
  const dx = centre.x - pc.x;
  const dy = centre.y - pc.y;
  const along = (t: number): Rect => slot(pc.x + t * dx, pc.y + t * dy, BET);
  const towards = (d: number): number => (d >= 0 ? 1 : -1);
  // Offsets 0, +2, −2, +4, −4 … (toward the centre first), up to `reach`.
  const slide = (reach: number, sign: number): number[] => {
    const out: number[] = [0];
    for (let o = 2; o <= reach; o += 2) out.push(o * sign, -o * sign);
    return out;
  };
  const beside = slide(pod.h / 2, towards(dy)).map((o) =>
    slot(dx >= 0 ? pod.x + pod.w + gap + BET.w / 2 : pod.x - gap - BET.w / 2, pc.y + o, BET),
  );
  const nextTo = (below: boolean): Rect[] =>
    slide(pod.w / 2 + BET.w / 2, towards(dx)).map((o) =>
      slot(pc.x + o, below ? pod.y + pod.h + gap + BET.h / 2 : pod.y - gap - BET.h / 2, BET),
    );
  const sideFirst = Math.abs(dx) / Math.max(1, centre.x) >= Math.abs(dy) / Math.max(1, centre.y);
  return [
    along(0.3), // §12.4: 30% of the way from the seat to the centre
    ...(sideFirst ? [...beside, ...nextTo(dy >= 0)] : [...nextTo(dy >= 0), ...beside]),
    ...[0.35, 0.25, 0.4, 0.45, 0.5, 0.2, 0.55, 0.6].map(along),
    ...nextTo(dy < 0),
  ];
}

/**
 * Bet chip slots, one per pod: the first candidate (the §12.4 point, then slots beside the pod
 * facing the centre, then further along the line) that stays in the box and clears every pod,
 * the board, the pot, the hero area and the bets placed before it. If none is free (tiny boxes
 * only), the least-overlapping candidate.
 */
function placeBets(size: Size, pods: readonly Rect[], board: Rect, pot: Rect, hero: Rect): Rect[] {
  const centre = pt(size.w / 2, size.h / 2);
  const placed: Rect[] = [];
  const obstacles = (r: Rect): number =>
    overlapArea(r, board) +
    overlapArea(r, pot) +
    overlapArea(r, hero) +
    pods.reduce((sum, q) => sum + overlapArea(r, q), 0) +
    placed.reduce((sum, q) => sum + overlapArea(r, q), 0);
  const free = (r: Rect): boolean =>
    insideBox(r, size) &&
    !overlaps(r, board, 4) &&
    !overlaps(r, pot, 2) &&
    !overlaps(r, hero) &&
    pods.every((q) => !overlaps(r, q, 2)) &&
    placed.every((q) => !overlaps(r, q, 2));
  for (const pod of pods) {
    const candidates = betCandidates(pod, centre);
    const best =
      candidates.find(free) ?? candidates.reduce((a, b) => (obstacles(b) < obstacles(a) ? b : a));
    placed.push(best);
  }
  return placed;
}

/** Everything `Table` needs to place the opponents, the board and the pot. */
export interface TableGeometry {
  readonly layout: TableLayout;
  readonly size: Size;
  /** One pod per opponent, clockwise from the hero's left (index `i` = seat `i + 1`). */
  readonly pods: readonly Rect[];
  /** The side of each pod that faces the table centre: the dealer disc and blind tag go there. */
  readonly inner: readonly ('left' | 'right')[];
  /** One bet chip slot per pod (`BET` sized; the chip is centred in it). */
  readonly bets: readonly Rect[];
  readonly board: Rect;
  readonly boardCard: Size;
  readonly pot: Rect;
  /** Where the hero strip reaches into the box; nothing is placed there. */
  readonly hero: Rect;
}

/** The whole table's geometry for `opponents` bots in a box of `size`. */
export function tableGeometry(layout: TableLayout, size: Size, opponents: number): TableGeometry {
  const pods = podRects(layout, size, opponents);
  const boardCard = boardCardSize(layout, size);
  const boardW = 5 * boardCard.w + 4 * BOARD_GAP;
  const board: Rect = {
    x: Math.round((size.w - boardW) / 2),
    y: Math.round((size.h - boardCard.h) / 2),
    w: boardW,
    h: boardCard.h,
  };
  // Right above the board, clear of a raised core card (6 px up, 3 px outline, §6.1).
  const pot: Rect = {
    x: Math.round((size.w - POT.w) / 2),
    y: board.y - POT_GAP - POT.h,
    ...POT,
  };
  const hero = heroArea(layout, size);
  return {
    layout,
    size,
    pods,
    inner: pods.map((p) => (p.x + p.w / 2 <= size.w / 2 ? 'right' : 'left')),
    bets: placeBets(size, pods, board, pot, hero),
    board,
    boardCard,
    pot,
    hero,
  };
}
