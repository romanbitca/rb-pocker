/**
 * Glossary links in coach text (PLAN §8.10, §12.6, Appendix F.9): a sentence marks a poker term
 * as `{g:term}`; the coach's places show it dotted-underlined, and a tap opens its one-line
 * definition. Keys (F.9): every name in a term, split at " / ", plus a parenthesised alias, all
 * lower-case ("big blind (BB)" gives `big blind` and `bb`). A plural "s" after the braces
 * (`{g:big blind}s`) stays plain text: the link covers the key only.
 */
import { glossary } from '../i18n/coachUi.ts';

/** A piece of coach text: plain, or a glossary term (`key` is its lower-case glossary key). */
export type TextPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'term'; readonly text: string; readonly key: string };

export interface GlossaryEntry {
  /** The term as F.9 writes it ("big blind (BB)"). */
  readonly term: string;
  readonly text: string;
}

/** The F.9 keys of one glossary term. */
export function glossaryKeys(term: string): string[] {
  const keys: string[] = [];
  for (const name of term.split(' / ')) {
    const alias = /^(.*?)\s*\(([^)]+)\)$/.exec(name);
    if (alias === null) {
      keys.push(name.trim().toLowerCase());
    } else {
      keys.push((alias[1] ?? '').trim().toLowerCase(), (alias[2] ?? '').trim().toLowerCase());
    }
  }
  return keys.filter((k) => k !== '');
}

/** Every key → its entry. */
export const GLOSSARY: ReadonlyMap<string, GlossaryEntry> = new Map(
  glossary.flatMap((entry) => glossaryKeys(entry.term).map((key) => [key, entry] as const)),
);

/** The entry for a key (case-insensitive), or null. */
export function lookupTerm(key: string): GlossaryEntry | null {
  return GLOSSARY.get(key.trim().toLowerCase()) ?? null;
}

const TERM = /\{g:([^}]+)\}/g;

/** Splits text at its `{g:term}` marks. A term missing from the glossary stays plain text. */
export function parseTerms(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let at = 0;
  for (const m of text.matchAll(TERM)) {
    const index = m.index;
    const word = m[1] ?? '';
    if (index > at) parts.push({ kind: 'text', text: text.slice(at, index) });
    const key = word.trim().toLowerCase();
    parts.push(
      GLOSSARY.has(key) ? { kind: 'term', text: word, key } : { kind: 'text', text: word },
    );
    at = index + m[0].length;
  }
  if (at < text.length) parts.push({ kind: 'text', text: text.slice(at) });
  // Neighbouring plain pieces join, so a sentence without terms is one text node.
  return parts.reduce<TextPart[]>((out, part) => {
    const last = out[out.length - 1];
    if (part.kind === 'text' && last?.kind === 'text') {
      out[out.length - 1] = { kind: 'text', text: last.text + part.text };
    } else {
      out.push(part);
    }
    return out;
  }, []);
}

/** The text with its glossary marks removed ("{g:big blind}s" → "big blinds"). */
export function plainText(text: string): string {
  return text.replace(TERM, (_, word: string) => word);
}
