/**
 * Coach text with glossary links (PLAN §12.6, Appendix F.9): `{g:term}` parts are dotted-underlined
 * buttons; a tap opens the term's one-line definition in a popover under the text (Esc, a press
 * outside or a second tap close it). A popover is not a sheet: it closes no gate (§12.6).
 * `plain`: the terms as plain text (inside another button, e.g. the coach strip, §12.6).
 *
 * DOM (§15.3): one element per paragraph, plus one per term; the definition only while open.
 */
import { memo, useCallback, useId, useMemo, useRef, useState } from 'react';
import { lookupTerm, parseTerms, plainText } from '../glossary.ts';
import { useDismiss } from '../hooks.ts';
import styles from './GlossaryText.module.css';

export interface GlossaryTextProps {
  readonly text: string;
  /** The element to render (default `p`). */
  readonly as?: 'p' | 'li' | 'span';
  readonly className?: string | undefined;
}

export const GlossaryText = memo(function GlossaryText({
  text,
  as: Tag = 'p',
  className,
}: GlossaryTextProps) {
  const parts = useMemo(() => parseTerms(text), [text]);
  const [open, setOpen] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const setRoot = useCallback((el: HTMLElement | null) => {
    rootRef.current = el;
  }, []);
  const popId = useId();
  const close = useCallback(() => setOpen(null), []);
  useDismiss(open !== null, rootRef, close);
  if (parts.every((p) => p.kind === 'text')) {
    return <Tag className={className}>{plainText(text)}</Tag>;
  }
  const entry = open === null ? null : lookupTerm(open);
  return (
    <Tag ref={setRoot} className={`${styles.root} ${className ?? ''}`}>
      {parts.map((part, i) =>
        part.kind === 'text' ? (
          part.text
        ) : (
          <button
            key={i}
            type="button"
            className={styles.term}
            data-glossary={part.key}
            aria-expanded={open === part.key}
            aria-controls={open === part.key ? popId : undefined}
            onClick={() => setOpen(open === part.key ? null : part.key)}
          >
            {part.text}
          </button>
        ),
      )}
      {entry !== null && (
        <span id={popId} role="note" className={styles.pop}>
          {entry.term}: {entry.text}
        </span>
      )}
    </Tag>
  );
});
