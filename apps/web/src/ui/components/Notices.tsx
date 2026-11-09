/**
 * Messages over every screen (PLAN §12.11, §12.14):
 * - `Toasts`: short messages from the controller ("Nora sits down."). The controller removes each
 *   after 4 s; a tap removes it at once. A polite live region reads them. The launch's own words
 *   are on the first screen (`enStart.toast`); the others come after a tap, so they load with the
 *   screens' words (`i18n/en.ts`, chunk 9.7): a toast shows once its words are there (at once in
 *   practice: the screens chunk has loaded them by then). On the Table (`place`) they sit over the
 *   top bar's title, between its buttons, one at a time (the newest; the older ones close), so a
 *   toast never covers a seat, the board, the hero's hand, the coach, Row A or a button of the bar
 *   (§12.11 notes, 1.3.86 and 1.3.91); elsewhere they stack under the top edge.
 * - `StorageBanner`: "Stats can't be saved in this browser mode…", once per launch when the
 *   browser storage fails (§14.6); [OK] hides it. The game stays playable in memory.
 */
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
import type { SessionSummary, Toast } from '../../app/store.ts';
import { enStart as en } from '../../i18n/start.ts';
import { formatChips } from '../format.ts';
import { joinNames } from '../names.ts';
import styles from './Notices.module.css';

/** The words of the toasts that come after a tap: `en`, a lazy chunk (see the module note). */
export type LaterWords = typeof import('../../i18n/en.ts').en;

let later: LaterWords | null = null;
let asked = false;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const laterWords = (): LaterWords | null => later;

/** Loads `en` once (again after a failure); the toasts waiting for it then show. */
function loadLaterWords(): void {
  if (later !== null || asked) return;
  asked = true;
  import('../../i18n/en.ts').then(
    (m) => {
      later = m.en;
      for (const listener of listeners) listener();
    },
    () => {
      asked = false;
    },
  );
}

/**
 * A toast's text (§12.11): each kind is a key of `en.toast` (Leave table's line, chunk 8.2, is
 * built; the collection moment, §12.9, names the category as the hand-end banner does). Null for
 * a toast that comes after a tap while `words` (the lazy `en`) are not there yet.
 */
export function toastText(toast: Toast, words: LaterWords | null = later): string | null {
  switch (toast.kind) {
    case 'handNotRestored':
    case 'dataRecovered':
    case 'dataRestored':
    case 'offlineReady':
      return en.toast[toast.kind];
  }
  if (words === null) return null;
  const t = words.toast;
  switch (toast.kind) {
    case 'botsJoined':
      return t.botsJoined(joinNames(toast.names), toast.names.length === 1);
    case 'collection':
      return t.collection(words.handEnd.category[toast.category]);
    case 'session':
      return sessionText(words, toast.session);
    case 'mpNotice':
      return null; // chunk 10.9: the words are in `i18n/mp.ts`, and no table exists before it
    default:
      return t[toast.kind];
  }
}

/** Leave table (§14.4): "This session: 45 hands · +640 chips · Decision score 82 · 4 mistakes." */
function sessionText(words: LaterWords, s: SessionSummary): string {
  const t = words.toast;
  const net = s.netChips;
  const chips = net > 0 ? `+${formatChips(net)}` : net < 0 ? `−${formatChips(-net)}` : '0';
  const parts = [t.sessionHands(s.hands, formatChips(s.hands)), t.sessionChips(chips)];
  if (s.decisionScore !== null) parts.push(t.sessionScore(Math.round(s.decisionScore)));
  if (s.decisions > 0) parts.push(t.sessionMistakes(s.mistakes + s.blunders));
  return t.session(parts.join(t.separator));
}

/**
 * Over the Table's top bar, one at a time: which bar ('portrait' the whole width; 'landscape' the
 * table column's; 'wide' the play column's, 'rail' when the rankings column is folded to its rail).
 */
export type ToastPlace = 'portrait' | 'landscape' | 'wide' | 'rail';

/** The Table's top bar marks its title with this: a toast on the Table goes over that box. */
export const BAR_TITLE = 'data-bar-title';

/**
 * On the Table (§12.11 notes, 1.3.91): the toast region takes the box of the top bar's title, the
 * room between the bar's buttons, so a toast covers the blinds and the hand number and never a
 * button (without the bar, the CSS keeps it clear of them). A toast whose words need more than the
 * bar's height at 15 px takes 13 px (three lines in 44 px); only beyond that it grows under the bar.
 */
function fitToBar(region: HTMLElement, title: Element): void {
  const box = title.getBoundingClientRect();
  region.style.left = `${box.left}px`;
  region.style.width = `${box.width}px`;
  for (const toast of region.children as HTMLCollectionOf<HTMLElement>) {
    toast.removeAttribute('data-fit');
    if (toast.offsetHeight > parseFloat(getComputedStyle(toast).minHeight) + 0.5) {
      toast.setAttribute('data-fit', 'small');
    }
  }
}

/**
 * Keeps the region over the bar's title while a toast shows on the Table, also when the title's
 * box changes (a rotation, the Hands button's width at Large text).
 */
function useBarPlace(region: RefObject<HTMLElement | null>, place: ToastPlace | null, key: string) {
  useLayoutEffect(() => {
    const el = region.current;
    const title = document.querySelector(`[${BAR_TITLE}]`);
    if (el === null) return;
    if (place === null || key === '' || title === null) {
      el.style.left = el.style.width = '';
      return;
    }
    const fit = () => fitToBar(el, title);
    fit();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(fit);
    observer.observe(title);
    return () => observer.disconnect();
  }, [region, place, key]);
}

export interface ToastsProps {
  toasts: readonly Toast[];
  onDismiss: (id: number) => void;
  /** The Table's top bar (see ToastPlace); null or absent: the top of the screen, stacked. */
  place?: ToastPlace | null | undefined;
}

export function Toasts({ toasts, onDismiss, place = null }: ToastsProps) {
  const regionRef = useRef<HTMLDivElement>(null);
  const words = useSyncExternalStore(subscribe, laterWords, laterWords);
  const ready = toasts.flatMap((toast) => {
    const text = toastText(toast, words);
    return text === null ? [] : [{ toast, text }];
  });
  const waiting = ready.length < toasts.length;
  useEffect(() => {
    if (waiting) loadLaterWords();
  }, [waiting]);
  // The Table's top bar holds one: the newest. The older ones close at once (§12.11 notes, 1.3.91):
  // kept hidden, their 4 s ran on unseen, and a tap on the newest uncovered the next older one.
  const shown = place === null ? ready : ready.slice(-1);
  const older = place === null ? [] : ready.slice(0, -1).map(({ toast }) => toast.id);
  const olderKey = older.join();
  useEffect(() => {
    for (const id of older) onDismiss(id);
    // `olderKey` stands for `older` (a new array at every render); `onDismiss` may be a new
    // function at every render too.
  }, [olderKey]);
  useBarPlace(regionRef, place, shown.map(({ toast, text }) => `${toast.id}:${text}`).join('|'));
  // Always mounted: a live region must exist before its text changes.
  return (
    <div
      ref={regionRef}
      className={styles.toasts}
      role="status"
      aria-live="polite"
      data-place={place ?? undefined}
    >
      {shown.map(({ toast, text }) => (
        <button
          key={toast.id}
          type="button"
          className={styles.toast}
          onClick={() => onDismiss(toast.id)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export interface StorageBannerProps {
  onDismiss: () => void;
}

export function StorageBanner({ onDismiss }: StorageBannerProps) {
  return (
    <div className={styles.storage} role="alert">
      <p className={styles.storageText}>{en.storage.banner}</p>
      <button type="button" className={styles.ok} onClick={() => onDismiss()}>
        {en.storage.ok}
      </button>
    </div>
  );
}
