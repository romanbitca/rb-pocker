/**
 * Chip amounts with thousands separators (Appendix F: "Chips shown with thousands separators").
 * English grouping on purpose, whatever the device locale: every string is English (§0.3).
 */

/** 2340 → "2,340". */
export function formatChips(n: number): string {
  const digits = String(Math.trunc(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return n < 0 ? `-${digits}` : digits;
}
