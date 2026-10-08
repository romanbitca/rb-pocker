/**
 * Renders the coach's lines (PLAN §8.10, Appendix F.1, F.5, F.9): `brain/explain.ts` gives a
 * template key and its values, `en.ts` the template. In a template, `{name}` is a value (a number,
 * an amount, a hand name, or another template rendered in place) and `{g:term}` a glossary link
 * (the UI underlines it and opens a one-line popover, §12.6). The result is a list of segments, so
 * the UI can make the links; `lineText` joins them. The first letter of every sentence is upper
 * case (a draw name can start one: "Flush draw: 9 outs.").
 *
 * Numbers as the HUD shows them (§7.6): whole-number percentages, "<1" and ">99" at the ends
 * (`pctText` is `ui/equity.ts` `percentText` without the "%", a test keeps them equal); a
 * starting-hand percentile rounded up ("top 1%" for AA, §8.3); chips with thousands separators;
 * big blinds with one decimal only when needed ("2.5 BB", Appendix F).
 *
 * `i18n` imports only types (PLAN §2.1): this file and `en.ts` are the whole module.
 */
import type { DrawKind } from '../analysis/types.ts';
import type { Explanation, GlossaryKey, Line, Param, TemplateKey } from '../brain/explain.ts';
import { en } from './en.ts';
import { enCoach } from './enCoach.ts';

/** A template: one string, or a form for a count of 1 and one for every other count. */
export type CoachTemplate =
  string | { readonly count: string; readonly one: string; readonly other: string };

/** What the renderer reads: the templates and the words its values need. */
export interface CoachStrings {
  readonly templates: Readonly<Record<TemplateKey, CoachTemplate>>;
  readonly drawNames: Readonly<Record<DrawKind, string>>;
  readonly genericDraw: string;
  readonly size: (to: string, bb: string) => string;
}

export const EN_COACH: CoachStrings = {
  templates: enCoach.coach.templates,
  drawNames: en.draws.name,
  genericDraw: enCoach.coach.genericDraw,
  size: enCoach.coach.size,
};

/** One piece of a rendered line. */
export interface Segment {
  readonly text: string;
  /** A glossary link (Appendix F.9): `text` is the linked word. */
  readonly glossary?: GlossaryKey;
  /** A placeholder's value: one word for the sentence-length rule (§8.10). */
  readonly value?: true;
}

// ── Templates ──────────────────────────────────────────────────────────────────────────────────

export type TemplatePart =
  | { kind: 'text'; text: string }
  | { kind: 'param'; name: string }
  | { kind: 'glossary'; key: string };

const TOKEN = /\{(g:)?([^{}]+)\}/g;

/** A template as text, placeholders and glossary links, in order. */
export function parseTemplate(template: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  let at = 0;
  for (const m of template.matchAll(TOKEN)) {
    if (m.index > at) parts.push({ kind: 'text', text: template.slice(at, m.index) });
    const body = m[2] as string;
    parts.push(m[1] === 'g:' ? { kind: 'glossary', key: body } : { kind: 'param', name: body });
    at = m.index + m[0].length;
  }
  if (at < template.length) parts.push({ kind: 'text', text: template.slice(at) });
  return parts;
}

/** Every form of a template. */
export function templateForms(template: CoachTemplate): string[] {
  return typeof template === 'string' ? [template] : [template.one, template.other];
}

const uniqueSorted = (xs: Iterable<string>): string[] => [...new Set(xs)].sort();

/** The placeholder names of a template (all forms), sorted. */
export function templateParams(template: CoachTemplate): string[] {
  return uniqueSorted(
    templateForms(template).flatMap((form) =>
      parseTemplate(form).flatMap((p) => (p.kind === 'param' ? [p.name] : [])),
    ),
  );
}

/** The glossary keys a template links (all forms), sorted. */
export function templateGlossary(template: CoachTemplate): string[] {
  return uniqueSorted(
    templateForms(template).flatMap((form) =>
      parseTemplate(form).flatMap((p) => (p.kind === 'glossary' ? [p.key] : [])),
    ),
  );
}

// ── Numbers ────────────────────────────────────────────────────────────────────────────────────

/** A chance (0–100 points) as the HUD shows it, without the "%": "62", "<1", ">99", "0", "100". */
export function pctText(points: number): string {
  if (points <= 0) return '0';
  if (points < 0.5) return '<1';
  if (points >= 100) return '100';
  if (points >= 99.5) return '>99';
  return String(Math.round(points));
}

/** A starting-hand percentile (0–100): rounded up and at least 1, so AA (0.45) is "top 1%". */
export function topText(points: number): string {
  return String(Math.min(100, Math.max(1, Math.ceil(points - 1e-9))));
}

/** 2340 → "2,340" (English grouping, whatever the device locale: every string is English). */
export function chipsText(n: number): string {
  const digits = String(Math.trunc(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return n < 0 ? `-${digits}` : digits;
}

/** Big blinds with one decimal only when needed: 2.5 → "2.5", 3 → "3", 1250 → "1,250". */
export function bbText(bb: number): string {
  const tenths = Math.round(bb * 10);
  const tenth = Math.abs(tenths % 10);
  const whole = chipsText(Math.trunc(tenths / 10));
  return tenth === 0 ? whole : `${whole}.${tenth}`;
}

// ── Rendering ──────────────────────────────────────────────────────────────────────────────────

function valueText(p: Param, strings: CoachStrings): string {
  switch (p.kind) {
    case 'pct':
      return pctText(p.value);
    case 'top':
      return topText(p.value);
    case 'chips':
      return chipsText(p.value);
    case 'size':
      return strings.size(chipsText(p.to), bbText(p.bb));
    case 'count':
      return chipsText(p.value);
    case 'name':
      return p.text;
    case 'draw':
      return (p.draw === null ? strings.genericDraw : strings.drawNames[p.draw]).toLowerCase();
    case 'line':
      // Rendered as written: only the outer line knows where its sentences start.
      return segmentsOf(p.line, strings)
        .map((s) => s.text)
        .join('');
  }
}

/** The form of a template for these values (the `one` form when its count is 1). */
function formFor(template: CoachTemplate, line: Line): string {
  if (typeof template === 'string') return template;
  const p = line.params[template.count];
  const n = p !== undefined && (p.kind === 'count' || p.kind === 'chips') ? p.value : Number.NaN;
  return n === 1 ? template.one : template.other;
}

/** Upper-case the first letter of every sentence (the line's start, and after ". ", "? ", "! "). */
function capitalise(segments: Segment[]): Segment[] {
  let start = true;
  return segments.map((s) => {
    let text = s.text;
    if (start) {
      const i = text.search(/\S/);
      if (i >= 0) text = text.slice(0, i) + text.charAt(i).toUpperCase() + text.slice(i + 1);
    }
    if (/\S/.test(text)) start = /[.?!]\s*$/.test(text);
    return text === s.text ? s : { ...s, text };
  });
}

/** Joins neighbouring plain-text segments. */
function merge(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    const last = out[out.length - 1];
    const plain = (x: Segment): boolean => x.glossary === undefined && x.value === undefined;
    if (last !== undefined && plain(last) && plain(s))
      out[out.length - 1] = { text: last.text + s.text };
    else if (s.text !== '') out.push(s);
  }
  return out;
}

/**
 * A line as segments. Throws when its template is missing or a placeholder has no value: every
 * line `brain/explain.ts` builds has exactly its template's values (`check-copy` and the tests).
 */
export function renderLine(line: Line, strings: CoachStrings = EN_COACH): Segment[] {
  return merge(capitalise(segmentsOf(line, strings)));
}

function segmentsOf(line: Line, strings: CoachStrings): Segment[] {
  const template = strings.templates[line.key] as CoachTemplate | undefined;
  if (template === undefined) throw new Error(`coach text: no template for ${line.key}`);
  const out: Segment[] = [];
  for (const part of parseTemplate(formFor(template, line))) {
    if (part.kind === 'text') out.push({ text: part.text });
    else if (part.kind === 'glossary') {
      out.push({ text: part.key, glossary: part.key as GlossaryKey });
    } else {
      const p = line.params[part.name];
      if (p === undefined)
        throw new Error(`coach text: ${line.key} has no value for {${part.name}}`);
      out.push({ text: valueText(p, strings), value: true });
    }
  }
  return out;
}

/** A line as plain text. */
export function lineText(line: Line, strings: CoachStrings = EN_COACH): string {
  return renderLine(line, strings)
    .map((s) => s.text)
    .join('');
}

/**
 * A hint's lines in reading order (§8.10 hint structure): headline, reasons, numbers line, "Why
 * not …?" lines, the close call, the rule of 2 and 4.
 */
export function hintLines(e: Explanation): Line[] {
  return [
    e.headline,
    ...e.reasons,
    e.numbers,
    ...e.whyNot,
    ...(e.close === null ? [] : [e.close]),
    ...e.trick,
  ];
}

/** A hint as plain text, one string per line. */
export function hintText(e: Explanation, strings: CoachStrings = EN_COACH): string[] {
  return hintLines(e).map((l) => lineText(l, strings));
}

// ── Glossary ───────────────────────────────────────────────────────────────────────────────────

export interface GlossaryEntry {
  readonly term: string;
  readonly definition: string;
}

/**
 * The keys of a glossary term (Appendix F.9): each name split at " / ", and a parenthesised alias
 * as one more key, all lower case. "big blind (BB)" → `big blind`, `bb`.
 */
export function glossaryKeys(term: string): string[] {
  const keys: string[] = [];
  for (const part of term.split(' / ')) {
    const alias = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(part);
    if (alias === null) keys.push(part.trim().toLowerCase());
    else keys.push((alias[1] as string).trim().toLowerCase(), (alias[2] as string).toLowerCase());
  }
  return keys;
}

/** The entry that defines a glossary key, or null. */
export function glossaryEntry(
  key: string,
  glossary: readonly GlossaryEntry[] = enCoach.glossary,
): GlossaryEntry | null {
  return glossary.find((g) => glossaryKeys(g.term).includes(key)) ?? null;
}
