/**
 * Number formats for chips (PLAN Appendix F: "Chips shown with thousands separators").
 * English grouping on purpose, whatever the device locale: every string is English (§0.3).
 */
import { en } from '../i18n/en.ts';

/** 2340 → "2,340". */
export function formatChips(n: number): string {
  const digits = String(Math.trunc(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return n < 0 ? `-${digits}` : digits;
}

/** 12 / 10 → "1.2", 20 / 10 → "2" (no trailing ".0"). */
const oneDecimal = (tenths: number): string => String(tenths / 10);

/**
 * Compact chips for seat pods (PLAN §12.4): "950", "1.2k", "12.3k", "123k", "1.2M", "12.3M".
 * Always rounded **down**, so a pod never shows more chips than the seat has.
 */
export function compactChips(n: number): string {
  const v = Math.max(0, Math.trunc(n));
  const { thousands: k, millions: m } = en.chips;
  if (v < 1_000) return String(v);
  if (v < 100_000) return oneDecimal(Math.floor(v / 100)) + k;
  if (v < 1_000_000) return String(Math.floor(v / 1_000)) + k;
  if (v < 100_000_000) return oneDecimal(Math.floor(v / 100_000)) + m;
  return String(Math.floor(v / 1_000_000)) + m;
}

/**
 * A bet chip's label: exact up to "9,999", compact from 10,000 ("12.3k"), so the label always
 * fits the fixed bet slot (`BET` in layout/seats.ts). The screen-reader label keeps the exact number.
 */
export function betChips(n: number): string {
  return n < 10_000 ? formatChips(n) : compactChips(n);
}
