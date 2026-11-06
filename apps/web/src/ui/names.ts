/**
 * A list of names as one phrase (PLAN §12.9, §12.11): "you and Ben", "Nora, Ben and Sam". The
 * toasts (first paint) and the hand-end lines (`handEnd.ts`, which re-exports it) both use it. A
 * module of its own, so the toasts do not pull the hand-end lines and the chip formats into the
 * initial bundle (§15.3, pitfall 47).
 */
import { en } from '../i18n/en.ts';

/** "you and Ben", "Ben and Anna", "you, Ben and Anna". */
export function joinNames(names: readonly string[]): string {
  const T = en.handEnd;
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(T.comma)}${T.and}${names[names.length - 1] ?? ''}`;
}
