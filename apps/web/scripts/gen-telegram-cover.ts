/**
 * Draws the photo for the Telegram Mini App (BotFather asks for 640×360, PLAN §19.13) and writes
 * it to `docs/assets/telegram-app-640x360.png`: a green table, two cards and the words
 * "RB Poker Coach", readable at thumbnail size. Everything is drawn in code, the letters too, so
 * no font or other third-party art goes into it (§16.4).
 *
 * Run from apps/web: `npm run gen:telegram-cover`. Commit the PNG it writes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { encodePng, feltAt, inSpade, LIGHT, type Rgb, type RgbaImage } from './gen-icons.ts';

const WIDTH = 640;
const HEIGHT = 360;
/** Samples per pixel along each axis. */
const SUPERSAMPLE = 4;

// Colours from src/ui/styles/tokens.css (PLAN §12.8).
const BACKGROUND: Rgb = [0x0f, 0x15, 0x12];
const RAIL: Rgb = [0x2a, 0x1d, 0x14];
const CARD_FACE: Rgb = [0xff, 0xff, 0xff];
const SPADES: Rgb = [0x11, 0x11, 0x11];
const HEARTS: Rgb = [0xc8, 0x10, 0x2e];
const CARD_EDGE: Rgb = [0xc9, 0xce, 0xcb];

/** A line of points, flat: [x0, y0, x1, y1, …], in glyph units. */
type Stroke = readonly number[];

interface Glyph {
  readonly width: number;
  readonly strokes: readonly Stroke[];
}

/** Points along an ellipse. Angles in degrees, y pointing down: -90 is the top. */
function arc(cx: number, cy: number, rx: number, ry: number, from: number, to: number): number[] {
  const steps = Math.max(2, Math.ceil(Math.abs(to - from) / 8));
  const points: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    points.push(cx + rx * Math.cos(t), cy + ry * Math.sin(t));
  }
  return points;
}

/** The top of the lower-case letters. Capitals run from y = 0 to the baseline at y = 1. */
const X_TOP = 0.3;
const X_MID = (X_TOP + 1) / 2;
const X_RY = (1 - X_TOP) / 2;

/** The stroke font: only the letters this picture uses. */
const GLYPHS: Readonly<Record<string, Glyph>> = {
  R: {
    width: 0.62,
    strokes: [
      [0, 1, 0, 0, 0.33, 0, ...arc(0.33, 0.27, 0.27, 0.27, -90, 90), 0, 0.54],
      [0.3, 0.54, 0.62, 1],
    ],
  },
  B: {
    width: 0.61,
    strokes: [
      [
        0,
        1,
        0,
        0,
        0.31,
        0,
        ...arc(0.31, 0.235, 0.235, 0.235, -90, 90),
        0,
        0.47,
        0.34,
        0.47,
        ...arc(0.34, 0.735, 0.265, 0.265, -90, 90),
        0,
        1,
      ],
    ],
  },
  P: {
    width: 0.62,
    strokes: [[0, 1, 0, 0, 0.33, 0, ...arc(0.33, 0.29, 0.29, 0.29, -90, 90), 0, 0.58]],
  },
  C: { width: 0.9, strokes: [arc(0.5, 0.5, 0.5, 0.5, -40, -320)] },
  A: {
    width: 0.74,
    strokes: [
      [0, 1, 0.37, 0, 0.74, 1],
      [0.13, 0.65, 0.61, 0.65],
    ],
  },
  K: {
    width: 0.6,
    strokes: [
      [0, 0, 0, 1],
      [0.56, 0, 0, 0.6],
      [0.2, 0.42, 0.6, 1],
    ],
  },
  o: { width: 0.62, strokes: [arc(0.31, X_MID, 0.31, X_RY, 0, 360)] },
  k: {
    width: 0.5,
    strokes: [
      [0, 0, 0, 1],
      [0.46, X_TOP, 0, 0.72],
      [0.17, 0.56, 0.5, 1],
    ],
  },
  e: {
    width: 0.62,
    strokes: [[0, X_MID, 0.62, X_MID, ...arc(0.31, X_MID, 0.31, X_RY, 0, -315)]],
  },
  r: {
    width: 0.38,
    strokes: [[0, X_TOP, 0, 1], arc(0.3, 0.62, 0.3, 0.32, 180, 285)],
  },
  a: {
    width: 0.62,
    strokes: [arc(0.31, X_MID, 0.31, X_RY, 0, 360), [0.62, X_TOP, 0.62, 1]],
  },
  c: { width: 0.56, strokes: [arc(0.31, X_MID, 0.31, X_RY, -42, -318)] },
  h: {
    width: 0.54,
    strokes: [
      [0, 0, 0, 1],
      [...arc(0.27, 0.6, 0.27, 0.3, 180, 360), 0.54, 1],
    ],
  },
};

const LETTER_GAP = 0.2;
const SPACE = 0.42;
/** Half the stroke, as a share of the capital height. */
const STROKE = 0.085;

/** Line segments in picture units: [x0, y0, x1, y1] each, with their bounding box. */
interface TextRun {
  readonly segments: readonly number[];
  readonly radius: number;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Lays out `text` with its capital height `size`, its left edge at x and its capitals' top at y. */
function layoutText(text: string, x: number, y: number, size: number): TextRun {
  const segments: number[] = [];
  let cursor = x;
  for (const ch of text) {
    if (ch === ' ') {
      cursor += SPACE * size;
      continue;
    }
    const glyph = GLYPHS[ch];
    if (glyph === undefined) throw new Error(`no glyph for "${ch}"`);
    for (const stroke of glyph.strokes) {
      for (let i = 0; i + 3 < stroke.length; i += 2) {
        segments.push(
          cursor + stroke[i]! * size,
          y + stroke[i + 1]! * size,
          cursor + stroke[i + 2]! * size,
          y + stroke[i + 3]! * size,
        );
      }
    }
    cursor += (glyph.width + LETTER_GAP) * size;
  }
  const radius = STROKE * size;
  return {
    segments,
    radius,
    left: x - radius,
    top: y - radius,
    right: cursor - LETTER_GAP * size + radius,
    bottom: y + size + radius,
  };
}

function inText(run: TextRun, x: number, y: number): boolean {
  if (x < run.left || x > run.right || y < run.top || y > run.bottom) return false;
  const limit = run.radius * run.radius;
  const s = run.segments;
  for (let i = 0; i < s.length; i += 4) {
    const dx = s[i + 2]! - s[i]!;
    const dy = s[i + 3]! - s[i + 1]!;
    const px = x - s[i]!;
    const py = y - s[i + 1]!;
    const len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.min(1, Math.max(0, (px * dx + py * dy) / len));
    const ex = px - t * dx;
    const ey = py - t * dy;
    if (ex * ex + ey * ey <= limit) return true;
  }
  return false;
}

/** Signed distance to a rounded box centred on the origin: below 0 inside. */
function roundedBox(x: number, y: number, halfW: number, halfH: number, r: number): number {
  const qx = Math.abs(x) - halfW + r;
  const qy = Math.abs(y) - halfH + r;
  const outside = Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2);
  return outside + Math.min(Math.max(qx, qy), 0) - r;
}

/** The heart curve with y pointing down: the two lobes at the top, the tip at the bottom. */
function inHeart(x: number, y: number): boolean {
  const a = x * x + y * y - 1;
  return a * a * a + x * x * y * y * y <= 0;
}

const CARD_W = 108;
const CARD_H = 152;
const CARD_R = 11;
const CARD_EDGE_WIDTH = 1.5;
const RANK_SIZE = 32;

interface Card {
  readonly cx: number;
  readonly cy: number;
  readonly cos: number;
  readonly sin: number;
  readonly rank: TextRun;
  readonly ink: Rgb;
  readonly inPip: (x: number, y: number) => boolean;
}

function makeCard(
  rank: string,
  cx: number,
  cy: number,
  degrees: number,
  ink: Rgb,
  inPip: Card['inPip'],
): Card {
  const a = (degrees * Math.PI) / 180;
  const run = layoutText(rank, -CARD_W / 2 + 10, -CARD_H / 2 + 11, RANK_SIZE);
  return { cx, cy, cos: Math.cos(a), sin: Math.sin(a), rank: run, ink, inPip };
}

/**
 * A big spade: the same one as the app icon. It sits left of the middle of its card, or the card
 * in front of it would hide half of it.
 */
const bigSpade = (x: number, y: number) => inSpade((x + 13) / 21, (y - 18) / 21 + 0.4);
/** A big heart, on the middle of its card. */
const bigHeart = (x: number, y: number) => inHeart(x / 28, (y - 18) / 28);

/** Back to front. */
const CARDS: readonly Card[] = [
  makeCard('A', 106, 182, -14, SPADES, bigSpade),
  makeCard('K', 178, 188, 12, HEARTS, bigHeart),
];

const TITLE: readonly TextRun[] = [
  layoutText('RB Poker', 262, 110, 58),
  layoutText('Coach', 262, 196, 58),
];

function cardLocal(card: Card, x: number, y: number): readonly [number, number] {
  const dx = x - card.cx;
  const dy = y - card.cy;
  return [dx * card.cos + dy * card.sin, -dx * card.sin + dy * card.cos];
}

/** How much of the light `card`'s soft shadow takes away at (x, y): 0 to 0.5. */
function shadowOf(card: Card, x: number, y: number): number {
  const [lx, ly] = cardLocal(card, x - 3, y - 5);
  const d = roundedBox(lx, ly, CARD_W / 2, CARD_H / 2, CARD_R);
  return 0.5 * Math.min(1, Math.max(0, (8 - d) / 16));
}

/** The card's colour at (x, y), or null outside it. */
function cardAt(card: Card, x: number, y: number): Rgb | null {
  const [lx, ly] = cardLocal(card, x, y);
  const d = roundedBox(lx, ly, CARD_W / 2, CARD_H / 2, CARD_R);
  if (d > 0) return null;
  if (d > -CARD_EDGE_WIDTH) return CARD_EDGE;
  if (inText(card.rank, lx, ly) || card.inPip(lx, ly)) return card.ink;
  return CARD_FACE;
}

function tableAt(x: number, y: number): Rgb {
  const px = x - WIDTH / 2;
  const py = y - HEIGHT / 2;
  if (roundedBox(px, py, WIDTH / 2 - 8, HEIGHT / 2 - 8, 120) > 0) return BACKGROUND;
  if (roundedBox(px, py, WIDTH / 2 - 22, HEIGHT / 2 - 22, 106) > 0) return RAIL;
  return feltAt(x / WIDTH, y / HEIGHT);
}

function colourAt(x: number, y: number): Rgb {
  let colour = tableAt(x, y);
  for (const card of CARDS) {
    const light = 1 - shadowOf(card, x, y);
    colour = [colour[0] * light, colour[1] * light, colour[2] * light];
    colour = cardAt(card, x, y) ?? colour;
  }
  for (const run of TITLE) if (inText(run, x, y)) return LIGHT;
  return colour;
}

/** Renders the picture: opaque, 8-bit RGBA. */
export function renderCover(): RgbaImage {
  const rgba = new Uint8Array(WIDTH * HEIGHT * 4);
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let py = 0; py < HEIGHT; py++) {
    for (let px = 0; px < WIDTH; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const colour = colourAt(px + (sx + 0.5) / SUPERSAMPLE, py + (sy + 0.5) / SUPERSAMPLE);
          r += colour[0];
          g += colour[1];
          b += colour[2];
        }
      }
      const i = (py * WIDTH + px) * 4;
      rgba[i] = Math.round(r / samples);
      rgba[i + 1] = Math.round(g / samples);
      rgba[i + 2] = Math.round(b / samples);
      rgba[i + 3] = 255;
    }
  }
  return { width: WIDTH, height: HEIGHT, rgba };
}

if (import.meta.main) {
  const dir = new URL('../../../docs/assets/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  const png = encodePng(renderCover());
  writeFileSync(new URL('telegram-app-640x360.png', dir), png);
  console.log(`docs/assets/telegram-app-640x360.png  ${WIDTH}x${HEIGHT}  ${png.length} bytes`);
}
