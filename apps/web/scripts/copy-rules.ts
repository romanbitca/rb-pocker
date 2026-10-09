/**
 * The rules of the coach's words (PLAN §8.10 "Language rules", Appendix F.1, F.5, F.9; Known
 * pitfalls 35 and 39), used by `check-copy.ts` and by the tests. Pure: no engine, no Node APIs.
 *
 * 1. **Templates** (`enCoach.coach.templates` against `TEMPLATES` in `brain/explain.ts`): one template
 *    per key and no other; every sentence at most 15 words (a placeholder counts as one word, a
 *    glossary link as its own words, symbols such as "·" and "×" as none); the placeholders are
 *    exactly the key's (none missing, none unused, in every plural form); every `{g:term}` is one
 *    the key declares and one the glossary defines; no decimal number and no stray brace in the
 *    words. Each template is rendered once with sample values (both plural forms).
 * 2. **Glossary** (`enCoach.glossary`, F.9): its keys are exactly `GLOSSARY_KEYS`, each defined once;
 *    every definition sentence at most 15 words (a " / " definition is one part per key).
 * 3. **Hints** (`checkHint`): every line renders with exactly its template's values and glossary
 *    keys, no "{" left and sentences of at most 15 words; the numbers line shows the HUD's
 *    `eRandom` as a whole number (C9); RANGE_ADJUST comes first whenever the two equities differ
 *    by 5 points or more, and shows both; no sentence that compares the win chance with the price
 *    contradicts the numbers it shows ("It is close" only for whole numbers at most 2 apart, "if
 *    you see every card" only at or above the price); a code that does not name a range shows
 *    `eRandom` unless RANGE_ADJUST labelled the range number (pitfall 35); "Why not fold?" only
 *    when the win chance beats the price; the headline is the action.
 */
import {
  CLOSE_POINTS,
  GLOSSARY_KEYS,
  shownPct,
  TEMPLATE_KEYS,
  TEMPLATES,
  templateSpec,
  type ExplainInput,
  type Explanation,
  type Line,
  type Param,
  type TemplateKey,
} from '../src/brain/explain.ts';
import {
  EN_COACH,
  glossaryKeys,
  hintLines,
  lineText,
  parseTemplate,
  pctText,
  renderLine,
  templateForms,
  templateGlossary,
  templateParams,
  type CoachStrings,
  type CoachTemplate,
  type GlossaryEntry,
  type Segment,
} from '../src/i18n/coach.ts';
import { enCoach } from '../src/i18n/enCoach.ts';

/** §8.10: at most 15 words a sentence. */
export const MAX_WORDS = 15;

// ── Words and sentences ────────────────────────────────────────────────────────────────────────

/** A placeholder's value stands for one word. */
const VALUE = '§';

/**
 * The sentences of segments as their words: a value is one word; a token without a letter or a
 * digit ("·", "×", "≈", a lone "%") is none. Sentences end at ".", "?" or "!" before a space.
 */
export function sentenceWords(segments: readonly Segment[]): string[][] {
  const text = segments.map((s) => (s.value === true ? VALUE : s.text)).join('');
  return text
    .split(/(?<=[.?!])\s+/)
    .map((sentence) => sentence.split(/\s+/).filter((w) => /[\p{L}\p{N}§]/u.test(w)))
    .filter((words) => words.length > 0);
}

/** A template form as segments (a placeholder as a value, a glossary link as its words). */
function templateSegments(form: string): Segment[] {
  return parseTemplate(form).map((p) =>
    p.kind === 'text'
      ? { text: p.text }
      : p.kind === 'glossary'
        ? { text: p.key }
        : { text: '', value: true as const },
  );
}

function longSentences(segments: readonly Segment[]): string[] {
  return sentenceWords(segments)
    .filter((words) => words.length > MAX_WORDS)
    .map((words) => `${words.length} words: "${words.join(' ')}"`);
}

const sorted = (xs: Iterable<string>): string[] => [...new Set(xs)].sort();
const minus = (a: readonly string[], b: readonly string[]): string[] =>
  a.filter((x) => !b.includes(x));

// ── 1. Templates ───────────────────────────────────────────────────────────────────────────────

/** A sample value for a placeholder name (every name `TEMPLATES` uses). */
function sampleParam(name: string, n: number): Param {
  switch (name) {
    case 'hand':
      return { kind: 'name', text: 'Ace-King suited' };
    case 'handName':
      return { kind: 'name', text: 'Two Pair, Kings and Sevens' };
    case 'rankPct':
      return { kind: 'top', value: 4.2 };
    case 'size':
      return { kind: 'size', to: 1250, bb: 12.5 };
    case 'toCall':
    case 'pot':
    case 'amount':
      return { kind: 'chips', value: 1250 };
    case 'behind':
    case 'S':
    case 'n':
    case 'outs':
      return { kind: 'count', value: n };
    case 'draw':
      return { kind: 'draw', draw: 'oesd' };
    case 'example':
      return { kind: 'line', line: { key: 'example.twoPair', params: {}, glossary: [] } };
    case 'actionDescription':
      return { kind: 'line', line: { key: 'villain.betsBig', params: {}, glossary: [] } };
    case 'detail':
      return { kind: 'line', line: { key: 'detail.tooStrongToFold', params: {}, glossary: [] } };
    case 'alt':
      return {
        kind: 'line',
        line: { key: 'alt.call', params: { amount: { kind: 'chips', value: 40 } }, glossary: [] },
      };
    default:
      return { kind: 'pct', value: 37.4 };
  }
}

/** A line of `key` with sample values, its plural count set to `n`. */
export function sampleLine(key: TemplateKey, n = 2): Line {
  const spec = templateSpec(key);
  const params: Record<string, Param> = {};
  for (const name of spec.params) params[name] = sampleParam(name, n);
  return { key, params, glossary: spec.glossary ?? [] };
}

/** Every problem of the templates (see the header, part 1). */
export function checkTemplates(
  strings: CoachStrings = EN_COACH,
  glossary: readonly GlossaryEntry[] = enCoach.glossary,
): string[] {
  const problems: string[] = [];
  const known = new Set(glossary.flatMap((g) => glossaryKeys(g.term)));
  const templates = strings.templates as Readonly<Record<string, CoachTemplate | undefined>>;
  for (const key of Object.keys(templates)) {
    if (!Object.prototype.hasOwnProperty.call(TEMPLATES, key)) {
      problems.push(`${key}: a template that no code uses`);
    }
  }
  for (const key of TEMPLATE_KEYS) {
    const template = templates[key];
    if (template === undefined) {
      problems.push(`${key}: no template`);
      continue;
    }
    const spec = templateSpec(key);
    const want = sorted(spec.params);
    for (const form of templateForms(template)) {
      const have = templateParams(form);
      for (const x of minus(want, have)) problems.push(`${key}: missing {${x}} in "${form}"`);
      for (const x of minus(have, want)) problems.push(`${key}: unused {${x}} in "${form}"`);
      for (const long of longSentences(templateSegments(form))) {
        problems.push(`${key}: a sentence of ${long}`);
      }
      for (const part of parseTemplate(form)) {
        if (part.kind !== 'text') continue;
        if (/[{}]/.test(part.text)) problems.push(`${key}: a stray brace in "${form}"`);
        if (/\d\.\d/.test(part.text)) {
          problems.push(`${key}: a decimal number in "${form}" (percentages are whole numbers)`);
        }
      }
    }
    if (typeof template !== 'string' && !spec.params.includes(template.count)) {
      problems.push(`${key}: its plural count {${template.count}} is not one of its values`);
    }
    const links = templateGlossary(template);
    const declared = sorted(spec.glossary ?? []);
    for (const x of minus(links, declared)) problems.push(`${key}: links {g:${x}}, not declared`);
    for (const x of minus(declared, links)) problems.push(`${key}: declares {g:${x}}, not linked`);
    for (const x of links) {
      if (!known.has(x)) problems.push(`${key}: {g:${x}} is not in the glossary`);
    }
    for (const n of typeof template === 'string' ? [2] : [1, 2]) {
      try {
        const text = lineText(sampleLine(key, n), strings);
        if (/[{}]/.test(text)) problems.push(`${key}: renders with a brace: "${text}"`);
      } catch (error) {
        problems.push(`${key}: does not render: ${(error as Error).message}`);
      }
    }
  }
  return problems;
}

// ── 2. Glossary ────────────────────────────────────────────────────────────────────────────────

/** Every problem of the glossary (see the header, part 2). */
export function checkGlossary(glossary: readonly GlossaryEntry[] = enCoach.glossary): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const entry of glossary) {
    for (const key of glossaryKeys(entry.term)) {
      const before = seen.get(key);
      if (before !== undefined) problems.push(`glossary: "${key}" is defined twice`);
      seen.set(key, entry.term);
    }
    const parts = entry.term.includes(' / ') ? entry.definition.split(' / ') : [entry.definition];
    for (const part of parts) {
      for (const long of longSentences([{ text: part }])) {
        problems.push(`glossary "${entry.term}": a sentence of ${long}`);
      }
    }
  }
  const keys = [...seen.keys()];
  for (const x of minus([...GLOSSARY_KEYS], keys)) problems.push(`glossary: no entry for "${x}"`);
  for (const x of minus(keys, [...GLOSSARY_KEYS])) {
    problems.push(`glossary: "${x}" is not in GLOSSARY_KEYS (brain/explain.ts)`);
  }
  return problems;
}

// ── 3. Hints ───────────────────────────────────────────────────────────────────────────────────

const GLOSSARY_SET: ReadonlySet<string> = new Set(GLOSSARY_KEYS);

/** Every problem of one line as built by `explain` (values, glossary keys, rendering, length). */
export function checkLine(line: Line, strings: CoachStrings = EN_COACH): string[] {
  const problems: string[] = [];
  const template = (strings.templates as Readonly<Record<string, CoachTemplate | undefined>>)[
    line.key
  ];
  if (template === undefined) return [`${line.key}: no template`];
  const spec = templateSpec(line.key);
  const have = sorted(Object.keys(line.params));
  const want = sorted(spec.params);
  for (const x of minus(want, have)) problems.push(`${line.key}: no value for {${x}}`);
  for (const x of minus(have, want)) problems.push(`${line.key}: unused value {${x}}`);
  const glossary = sorted(line.glossary);
  const links = templateGlossary(template);
  if (glossary.join() !== links.join()) {
    problems.push(`${line.key}: glossary keys [${glossary.join()}], template [${links.join()}]`);
  }
  for (const x of glossary) {
    if (!GLOSSARY_SET.has(x)) problems.push(`${line.key}: unknown glossary key "${x}"`);
  }
  for (const p of Object.values(line.params)) {
    if (p.kind === 'line') problems.push(...checkLine(p.line, strings));
  }
  try {
    const segments = renderLine(line, strings);
    const text = segments.map((s) => s.text).join('');
    if (/[{}]/.test(text)) problems.push(`${line.key}: unresolved placeholder in "${text}"`);
    for (const long of longSentences(segments)) problems.push(`${line.key}: a sentence of ${long}`);
  } catch (error) {
    problems.push(`${line.key}: does not render: ${(error as Error).message}`);
  }
  return problems;
}

/** The base code of a key: "FOLD_PRICE.close" → "FOLD_PRICE". */
const baseOf = (key: TemplateKey): string => key.split('.')[0] as string;

/** Codes whose `{E}` is a range number labelled by their own sentence (Appendix F.1). */
const RANGE_SENTENCES: ReadonlySet<string> = new Set([
  'CALL_PREFLOP',
  'FOLD_VS_RAISE',
  'THREE_BET_VALUE',
  'FOUR_BET_VALUE',
  'CALL_ALLIN',
  'FOLD_ALLIN',
  'PUSH_FOLD',
]);

/** How each comparing sentence (the F.1 wording, not its variants) relates `{E}` to `{need}`. */
const COMPARES: Readonly<Partial<Record<TemplateKey, 'more' | 'atLeast' | 'less'>>> = {
  CALL_PROFITABLE: 'more',
  CALL_PREFLOP: 'atLeast',
  CALL_ALLIN: 'atLeast',
  FOLD_PRICE: 'less',
  FOLD_ALLIN: 'less',
  WHY_NOT_CALL: 'less',
};

/** "It is close" is honest only for whole numbers at most `CLOSE_POINTS` apart (explain.ts). */
const CLOSE_VARIANTS: ReadonlySet<string> = new Set([
  'CALL_PROFITABLE.close',
  'CALL_PREFLOP.close',
  'CALL_ALLIN.close',
  'FOLD_PRICE.close',
  'FOLD_ALLIN.close',
]);
const pointsOf = (p: Param | undefined): number | null => (p?.kind === 'pct' ? p.value : null);

/** Every problem of one hint (see the header, part 3). */
export function checkHint(
  e: Explanation,
  input: ExplainInput,
  strings: CoachStrings = EN_COACH,
): string[] {
  const problems: string[] = [];
  for (const line of hintLines(e)) problems.push(...checkLine(line, strings));
  const hud = `${pctText(100 * input.eRandom)}%`;
  const numbers = lineText(e.numbers, strings);
  if (!numbers.includes(hud)) problems.push(`numbers line "${numbers}" lacks the HUD's ${hud}`);

  const adjustAt = e.reasons.findIndex((l) => baseOf(l.key) === 'RANGE_ADJUST');
  if (Math.abs(input.eRange - input.eRandom) >= 0.05 - 1e-9 && adjustAt !== 0) {
    problems.push(
      `eRandom ${hud} and eRange ${pctText(100 * input.eRange)}% differ by 5+ points, but RANGE_ADJUST does not come first`,
    );
  }
  if (adjustAt > 0) problems.push('RANGE_ADJUST is not the first reason');
  if (adjustAt >= 0) {
    const text = lineText(e.reasons[adjustAt] as Line, strings);
    const range = `${pctText(100 * (e.shown.eRange ?? Number.NaN))}%`;
    if (!text.includes(hud) || !text.includes(range)) {
      problems.push(`RANGE_ADJUST "${text}" does not show both ${hud} and ${range}`);
    }
  }

  const head = e.headline;
  const a = input.action;
  const kind = head.key.split('.')[1];
  const sizeTo = head.params.size?.kind === 'size' ? head.params.size.to : null;
  const amount = head.params.amount?.kind === 'chips' ? head.params.amount.value : null;
  const headOk =
    a.type === 'fold'
      ? kind === 'fold'
      : a.type === 'check'
        ? kind === 'check'
        : a.type === 'call'
          ? (kind === 'call' || kind === 'callAllIn') && amount === input.toCall
          : (kind === a.type || kind === 'allIn') && sizeTo === a.to;
  if (!headOk) problems.push(`headline ${head.key} does not match the action ${JSON.stringify(a)}`);

  const adjusted = adjustAt >= 0;
  for (const line of [...e.reasons, ...e.whyNot]) {
    const E = pointsOf(line.params.E);
    const need = pointsOf(line.params.need);
    const direction = COMPARES[line.key];
    if (E !== null && need !== null) {
      const x = shownPct(E / 100);
      const y = shownPct(need / 100);
      const said = (): string => `${line.key}: "${lineText(line, strings)}"`;
      if (direction !== undefined) {
        const ok = direction === 'more' ? x > y : direction === 'atLeast' ? x >= y : x < y;
        if (!ok) problems.push(`${said()} contradicts its numbers`);
      }
      if (CLOSE_VARIANTS.has(line.key) && Math.abs(x - y) > CLOSE_POINTS) {
        problems.push(`${said()} says "close", but ${x}% and ${y}% are not`);
      }
      // "You win about E% if you see every card": only a fold with at least the price.
      if (line.key === 'FOLD_PRICE.realise' && x < y) {
        problems.push(`${said()}: ${x}% is below ${y}%, so it is not about later bets`);
      }
    }
    if (E !== null && !RANGE_SENTENCES.has(baseOf(line.key)) && !adjusted) {
      if (shownPct(E / 100) !== shownPct(input.eRandom)) {
        problems.push(`${line.key}: shows ${pctText(E)}% with no label, not the HUD's ${hud}`);
      }
    }
  }
  if (e.whyNot.some((l) => l.key === 'WHY_NOT_FOLD')) {
    if (!(shownPct(e.shown.win) > shownPct(input.need))) {
      problems.push('WHY_NOT_FOLD is shown but the win chance does not beat the price');
    }
  }
  return problems;
}
