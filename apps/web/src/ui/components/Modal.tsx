/**
 * A modal layer (PLAN §12.12): `role="dialog"` (or `alertdialog`) with `aria-modal`, focus moved in
 * and trapped, focus back on the opener when it closes. Esc and a tap on the scrim call
 * `onDismiss`; without it only the buttons inside close the layer (the out-of-chips dialog, §3.1).
 * Android Back is the controller's: `popstate` → `navigate(nav, { type: 'back' })`
 * (app/navigation.ts), which unmounts this.
 *
 * With two layers open, only the top one traps focus and answers Esc.
 */
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import styles from './Modal.module.css';

export interface ModalProps {
  /** 'sheet' rises from the bottom (the Menu); 'dialog' sits in the middle (a question). */
  kind: 'sheet' | 'dialog';
  /** `role="alertdialog"`: a question that must be answered (§3.1). */
  alert?: boolean;
  /** Id of the element that names the layer. */
  labelledBy: string;
  describedBy?: string | undefined;
  /** Esc and the scrim. Absent: only the buttons inside close it. */
  onDismiss?: (() => void) | undefined;
  children: ReactNode;
}

// `a[href]`, not `[href]`: an SVG `<use href>` is not focusable.
const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const focusables = (root: HTMLElement): HTMLElement[] => [
  ...root.querySelectorAll<HTMLElement>(FOCUSABLE),
];

/** Open layers, oldest first: the last one is on top. */
const openLayers: HTMLElement[] = [];
const isTop = (el: HTMLElement): boolean => openLayers[openLayers.length - 1] === el;

export function Modal({
  kind,
  alert = false,
  labelledBy,
  describedBy,
  onDismiss,
  children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // The latest callback, so a parent's inline function never re-runs the effect below.
  const dismiss = useRef(onDismiss);
  useEffect(() => {
    dismiss.current = onDismiss;
  });

  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;
    const opener = document.activeElement;
    const focusIn = () => (focusables(panel)[0] ?? panel).focus();
    openLayers.push(panel);
    focusIn();

    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || !isTop(panel) || dismiss.current === undefined) return;
      e.preventDefault();
      dismiss.current();
    };
    const onFocusIn = (e: FocusEvent) => {
      if (isTop(panel) && e.target instanceof Node && !panel.contains(e.target)) focusIn();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn);
      openLayers.splice(openLayers.indexOf(panel), 1);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  // Tab and Shift+Tab wrap around inside the layer.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const panel = panelRef.current;
    if (e.key !== 'Tab' || panel === null) return;
    const items = focusables(panel);
    const first = items[0];
    const last = items[items.length - 1];
    if (first === undefined || last === undefined) {
      e.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className={`${styles.layer} ${kind === 'sheet' ? styles.bottom : styles.middle}`}>
      <div className={styles.scrim} aria-hidden="true" onClick={() => dismiss.current?.()} />
      <div
        ref={panelRef}
        role={alert ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={kind === 'sheet' ? styles.sheet : styles.dialog}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}
