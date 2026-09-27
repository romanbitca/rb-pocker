import { readFileSync } from 'node:fs';
import { crc32, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  ICONS,
  filterScanlines,
  renderIcon,
  type IconSpec,
  type RgbaImage,
} from '../../scripts/gen-icons.ts';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface PngFile {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colourType: number;
  /** The inflated IDAT data: filtered scanlines. */
  readonly data: Buffer;
}

/** A minimal PNG reader: checks the signature and every chunk's CRC. */
function readPng(bytes: Buffer): PngFile {
  expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE), 'PNG signature').toBe(true);
  let header: Buffer | undefined;
  const idat: Buffer[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    const typeAndData = bytes.subarray(offset + 4, offset + 8 + length);
    expect(bytes.readUInt32BE(offset + 8 + length), `${type} CRC`).toBe(crc32(typeAndData));
    if (type === 'IHDR') header = typeAndData.subarray(4);
    if (type === 'IDAT') idat.push(typeAndData.subarray(4));
    offset += length + 12;
  }
  if (header === undefined) throw new Error('no IHDR chunk');
  return {
    width: header.readUInt32BE(0),
    height: header.readUInt32BE(4),
    bitDepth: header[8] ?? -1,
    colourType: header[9] ?? -1,
    data: inflateSync(Buffer.concat(idat)),
  };
}

function committed(icon: IconSpec): Buffer {
  return readFileSync(new URL(`../../public/icons/${icon.file}`, import.meta.url));
}

function alphaAt(image: RgbaImage, x: number, y: number): number {
  return image.rgba[(y * image.width + x) * 4 + 3] ?? -1;
}

describe('app icons (public/icons, drawn by scripts/gen-icons.ts)', () => {
  it.each(ICONS)('$file is the generator output, $size x $size RGBA', (icon) => {
    const png = readPng(committed(icon));
    expect([png.width, png.height, png.bitDepth, png.colourType]).toEqual([
      icon.size,
      icon.size,
      8,
      6,
    ]);
    // Compared after inflating, so a different zlib version cannot cause a false failure.
    // On failure: run `npm run gen:icons -w @rb/web` and commit the PNGs.
    expect(png.data.equals(filterScanlines(renderIcon(icon)))).toBe(true);
  });

  it('maskable and apple-touch icons are fully opaque (iOS shows transparency as black)', () => {
    for (const icon of ICONS.filter((i) => i.kind !== 'any')) {
      const image = renderIcon(icon);
      let seeThrough = 0;
      for (let i = 3; i < image.rgba.length; i += 4) if (image.rgba[i] !== 255) seeThrough++;
      expect(seeThrough, icon.file).toBe(0);
    }
  });

  it('"any" icons are a rounded square: transparent corners, opaque centre', () => {
    for (const icon of ICONS.filter((i) => i.kind === 'any')) {
      const image = renderIcon(icon);
      const last = icon.size - 1;
      expect([alphaAt(image, 0, 0), alphaAt(image, last, last)]).toEqual([0, 0]);
      expect(alphaAt(image, icon.size >> 1, icon.size >> 1)).toBe(255);
    }
  });

  it('the maskable icon keeps the spade inside the safe zone (radius 0.4 x size)', () => {
    const icon = ICONS.find((i) => i.kind === 'maskable');
    if (icon === undefined) throw new Error('no maskable icon');
    const image = renderIcon(icon);
    const centre = icon.size / 2;
    let lightPixels = 0;
    let farthest = 0;
    for (let y = 0; y < icon.size; y++) {
      for (let x = 0; x < icon.size; x++) {
        const red = image.rgba[(y * icon.size + x) * 4] ?? 0;
        if (red <= 0x40) continue; // felt (red ≤ 0x1f)
        lightPixels++;
        farthest = Math.max(farthest, Math.hypot(x + 0.5 - centre, y + 0.5 - centre));
      }
    }
    expect(lightPixels).toBeGreaterThan(0.1 * icon.size * icon.size); // the spade is really there
    expect(farthest).toBeLessThan(0.4 * icon.size);
  });
});
