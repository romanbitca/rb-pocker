/**
 * Lookup tables over 13-bit rank masks (PLAN §5.3 step 6). Bit r stands for rank r (bit 0 = Two,
 * bit 12 = Ace). Built at module load (8,192 entries each, well under 5 ms), never shipped as data.
 */

export const MASK_COUNT = 1 << 13;

/** Number of ranks in the mask. */
export const POPCOUNT = new Uint8Array(MASK_COUNT);

/**
 * Rank index of the high card of the best straight in the mask, or −1. The wheel A-2-3-4-5
 * (`mask & 0x100F`) counts as five-high (3). Q-K-A-2-3 is not a straight: the Ace plays only at
 * the ends.
 */
export const STRAIGHT_HIGH = new Int8Array(MASK_COUNT);

/**
 * The top five ranks of the mask, highest first, as left-aligned nibbles
 * `n0 << 16 | n1 << 12 | n2 << 8 | n3 << 4 | n4` (missing ranks are 0). `TOP5[m] >> 8` is the top
 * three, `>> 12` the top two, `>> 16` the highest.
 */
export const TOP5 = new Int32Array(MASK_COUNT);

const WHEEL = 0x100f;

for (let mask = 0; mask < MASK_COUNT; mask++) {
  let count = 0;
  let top = 0;
  for (let r = 12; r >= 0; r--) {
    if ((mask & (1 << r)) === 0) continue;
    if (count < 5) top |= r << (16 - 4 * count);
    count++;
  }
  POPCOUNT[mask] = count;
  TOP5[mask] = top;

  let high = -1;
  for (let h = 12; h >= 4; h--) {
    const run = 0x1f << (h - 4);
    if ((mask & run) === run) {
      high = h;
      break;
    }
  }
  if (high < 0 && (mask & WHEEL) === WHEEL) high = 3;
  STRAIGHT_HIGH[mask] = high;
}
