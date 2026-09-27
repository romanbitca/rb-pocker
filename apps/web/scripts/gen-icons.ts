/**
 * Draws the app icons in code and writes them to `public/icons/` (PLAN §15.1; §16.4: all art is
 * drawn in code, no third-party art): a light spade on green felt.
 *
 * Run from apps/web: `npm run gen:icons`. Commit the PNGs it writes. The output is deterministic
 * (only + − × ÷ and sqrt, which JavaScript rounds the same everywhere), and
 * tests/scripts/gen-icons.test.ts checks that the committed files are exactly this output.
 *
 * No dependencies: 4×4 supersampling for smooth edges, 8-bit RGBA PNGs encoded with node:zlib.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

/** `any`: rounded square with transparent corners. `maskable`, `apple`: full-bleed and opaque. */
export type IconKind = 'any' | 'maskable' | 'apple';

export interface IconSpec {
  readonly file: string;
  readonly size: number;
  readonly kind: IconKind;
}

/** The three manifest icons (vite.config.ts) and the apple-touch-icon (index.html). */
export const ICONS: readonly IconSpec[] = [
  { file: 'icon-192.png', size: 192, kind: 'any' },
  { file: 'icon-512.png', size: 512, kind: 'any' },
  { file: 'icon-512-maskable.png', size: 512, kind: 'maskable' },
  { file: 'apple-180.png', size: 180, kind: 'apple' },
];

export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** Row-major, 4 bytes per pixel, straight (not premultiplied) alpha. */
  readonly rgba: Uint8Array;
}

type Rgb = readonly [number, number, number];

// Colours from src/ui/styles/tokens.css (PLAN §12.8): felt, dark felt, text.
const FELT: Rgb = [0x1f, 0x6b, 0x43];
const FELT_DARK: Rgb = [0x15, 0x4d, 0x30];
const LIGHT: Rgb = [0xf2, 0xf5, 0xf3];

/** Samples per pixel along each axis. */
const SUPERSAMPLE = 4;
/** Spade height as a share of the icon. Its farthest point is then 0.32 × size from the centre,
 * inside the maskable safe zone (a circle of radius 0.4 × size). */
const SPADE_SHARE = 0.6;
/** Corner radius of the `any` icons, as a share of the icon. */
const CORNER_SHARE = 0.2;

// The spade in its own units, y pointing down: the tip at y = -1, the foot at y = 1.8.
const SPADE_TOP = -1;
const SPADE_BOTTOM = 1.8;
const STEM_TOP = 0.55;

/** True when (x, y), in spade units, is inside the spade. */
function inSpade(x: number, y: number): boolean {
  // Body: the heart curve (x² + y² − 1)³ = x²y³, used with y pointing down, so the tip is at the
  // top and the two lobes are at the bottom (|x| ≤ 1.139, -1 ≤ y ≤ 1.236).
  const a = x * x + y * y - 1;
  if (a * a * a - x * x * y * y * y <= 0) return true;
  // Stem: a thin neck inside the body that flares into the foot, with curved sides.
  if (y < STEM_TOP || y > SPADE_BOTTOM) return false;
  const t = (y - STEM_TOP) / (SPADE_BOTTOM - STEM_TOP);
  return Math.abs(x) <= 0.07 + 0.38 * t * t;
}

/** True when (u, v), in icon units (0..1), is inside the rounded square of an `any` icon. */
function inRoundedSquare(u: number, v: number): boolean {
  const r = CORNER_SHARE;
  const dx = Math.max(r - u, u - (1 - r), 0);
  const dy = Math.max(r - v, v - (1 - r), 0);
  return dx * dx + dy * dy <= r * r;
}

/** Felt colour at (u, v), in icon units: lighter in the middle, darker towards the edges. */
function feltAt(u: number, v: number): Rgb {
  const du = u - 0.5;
  const dv = v - 0.42;
  const t = Math.min(Math.sqrt(du * du + dv * dv) / 0.72, 1);
  const k = t * t;
  return [
    FELT[0] + (FELT_DARK[0] - FELT[0]) * k,
    FELT[1] + (FELT_DARK[1] - FELT[1]) * k,
    FELT[2] + (FELT_DARK[2] - FELT[2]) * k,
  ];
}

/** Renders one icon. */
export function renderIcon({ size, kind }: IconSpec): RgbaImage {
  const rgba = new Uint8Array(size * size * 4);
  const scale = (SPADE_SHARE * size) / (SPADE_BOTTOM - SPADE_TOP); // pixels per spade unit
  const spadeMiddle = (SPADE_TOP + SPADE_BOTTOM) / 2;
  const samples = SUPERSAMPLE * SUPERSAMPLE;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = px + (sx + 0.5) / SUPERSAMPLE;
          const y = py + (sy + 0.5) / SUPERSAMPLE;
          const u = x / size;
          const v = y / size;
          if (kind === 'any' && !inRoundedSquare(u, v)) continue;
          const spade = inSpade((x - size / 2) / scale, (y - size / 2) / scale + spadeMiddle);
          const colour = spade ? LIGHT : feltAt(u, v);
          r += colour[0];
          g += colour[1];
          b += colour[2];
          covered++;
        }
      }
      if (covered === 0) continue; // fully transparent
      const i = (py * size + px) * 4;
      rgba[i] = Math.round(r / covered);
      rgba[i + 1] = Math.round(g / covered);
      rgba[i + 2] = Math.round(b / covered);
      rgba[i + 3] = Math.round((255 * covered) / samples);
    }
  }
  return { width: size, height: size, rgba };
}

function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft;
  const dLeft = Math.abs(p - left);
  const dUp = Math.abs(p - up);
  const dUpLeft = Math.abs(p - upLeft);
  if (dLeft <= dUp && dLeft <= dUpLeft) return left;
  return dUp <= dUpLeft ? up : upLeft;
}

/**
 * The PNG image data before compression: each row is a filter-type byte (4, Paeth: small numbers
 * on smooth gradients, so it compresses well) and the filtered row.
 */
export function filterScanlines({ width, height, rgba }: RgbaImage): Uint8Array {
  const stride = width * 4;
  const out = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    const prev = row - stride;
    const o = y * (stride + 1);
    out[o] = 4;
    for (let i = 0; i < stride; i++) {
      const left = i >= 4 ? rgba[row + i - 4]! : 0;
      const up = y > 0 ? rgba[prev + i]! : 0;
      const upLeft = y > 0 && i >= 4 ? rgba[prev + i - 4]! : 0;
      out[o + 1 + i] = (rgba[row + i]! - paeth(left, up, upLeft)) & 0xff;
    }
  }
  return out;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(typeAndData.length + 8);
  out.writeUInt32BE(data.length, 0);
  typeAndData.copy(out, 4);
  out.writeUInt32BE(crc32(typeAndData), typeAndData.length + 4);
  return out;
}

/** Encodes an 8-bit RGBA PNG (colour type 6, not interlaced). */
export function encodePng(image: RgbaImage): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: truecolour with alpha
  // Bytes 10-12 stay 0: deflate compression, adaptive filtering, no interlace.
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(filterScanlines(image), { level: 9 })),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
}

if (import.meta.main) {
  const dir = new URL('../public/icons/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  for (const icon of ICONS) {
    const png = encodePng(renderIcon(icon));
    writeFileSync(new URL(icon.file, dir), png);
    console.log(`public/icons/${icon.file}  ${icon.size}x${icon.size}  ${png.length} bytes`);
  }
}
