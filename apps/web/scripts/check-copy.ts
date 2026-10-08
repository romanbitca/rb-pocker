/**
 * CI check of the coach's words (PLAN §8.10 "Language rules", Appendix F.1, F.5, F.9; Known
 * pitfalls 35 and 39; §18 Stage 5 acceptance 7). Three parts:
 *
 * 1. **Templates** (`en.coach.templates` against `TEMPLATES` in `brain/explain.ts`): one template
 *    per key and no other; every sentence at most 15 words (a placeholder counts as one word, a
 *    glossary link as its own words, symbols such as "·" and "×" as none); the placeholders are
 *    exactly the key's (none missing, none unused, in every plural form); every `{g:term}` is one
 *    the key declares and one the glossary defines; no decimal number and no stray brace in the
 *    words. Each template is rendered once with sample values (both plural forms).
 * 2. **Glossary** (`en.glossary`, F.9): its keys are exactly `GLOSSARY_KEYS`, each defined once;
 *    every definition sentence at most 15 words (a " / " definition is one part per key).
 * 3. **Hints over generated situations** (1,000 by default): random tables and random legal play
 *    with the real engine (only here: the brain never runs the engine), every hero decision
 *    observed and its §8.2 features computed; then every reason the spot allows, with the data
 *    the policies put in `Reason.data` (chunks 5.3–5.5) and the guardrail reasons, is explained
 *    (`explain`) and rendered. Each hint: every line renders with exactly its template's values
 *    and glossary keys, no "{" left and sentences of at most 15 words; the numbers line shows the
 *    HUD's `eRandom` as a whole number (C9); RANGE_ADJUST comes first whenever the two equities
 *    differ by 5 points or more, and shows both; no sentence that compares the win chance with the
 *    price contradicts the numbers it shows; a code that does not name a range shows `eRandom`
 *    unless RANGE_ADJUST labelled the range number (pitfall 35); the headline is the action.
 *
 * Usage (from apps/web): `npm run check:copy` (= `node scripts/check-copy.ts`), optional
 * `--situations <n>` and `--seed <32 hex>`. Exits with code 1 and lists the problems.
 */
import { equity } from '../src/analysis/equity.ts';
import { preflopEquity } from '../src/analysis/preflop.ts';
import {
  explain,
  explainInput,
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
import { coachSeed, features } from '../src/brain/features.ts';
import { liveOpponents } from '../src/brain/ranges.ts';
import { openPct } from '../src/brain/tunables.ts';
import type { BrainProfile, Decision, Features, Reason } from '../src/brain/types.ts';
import { classOf, className, rankOf } from '../src/core/cards.ts';
import {
  deriveSeed,
  isSeed128,
  randInt,
  rngFromSeed,
  type Rng,
  type Seed128,
} from '../src/core/rng.ts';
import { legalActions } from '../src/engine/legal.ts';
import { observe } from '../src/engine/observe.ts';
import { startHand } from '../src/engine/start.ts';
import { step } from '../src/engine/step.ts';
import { createTable, initialSlots } from '../src/engine/table.ts';
import type {
  BotLevel,
  HandState,
  LegalActions,
  Observation,
  PersonalityId,
  PlayerAction,
  TableConfig,
} from '../src/engine/types.ts';
import {
  EN_COACH,
  glossaryKeys,
  hintLines,
  hintText,
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
import { en } from '../src/i18n/en.ts';

/** §8.10: at most 15 words a sentence. */
export const MAX_WORDS = 15;
/** Stage 5 acceptance 7: the run covers 1,000 generated situations. */
export const DEFAULT_SITUATIONS = 1000;
export const DEFAULT_SEED: Seed128 = 'c0c0c0c0000000000000000000005006';

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
  glossary: readonly GlossaryEntry[] = en.glossary,
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
export function checkGlossary(glossary: readonly GlossaryEntry[] = en.glossary): string[] {
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
    if (direction !== undefined && E !== null && need !== null) {
      const x = shownPct(E / 100);
      const y = shownPct(need / 100);
      const ok = direction === 'more' ? x > y : direction === 'atLeast' ? x >= y : x < y;
      if (!ok) problems.push(`${line.key}: "${lineText(line, strings)}" contradicts its numbers`);
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

// ── Situations: the engine plays, the hero's decisions are observed ────────────────────────────

/** A coach-like profile (Appendix A.5 `COACH`); fewer range trials: the words need no precision. */
export const CHECK_PROFILE: BrainProfile = {
  id: 'coach',
  looseness: 1,
  pfrRatio: 0.82,
  aggressionBias: 0,
  bluffFreq: 0,
  bluff3betFreq: 0,
  stickiness: 1,
  slowplayFreq: 0,
  equityNoiseSD: 0,
  mcTrials: 600,
  rangeModel: 'reweight+stats',
  positionAwareness: 1,
  sizing: 'texture',
  temperature: 0,
  defenseFactor: 1,
  preflopJitter: 0,
  exploit: false,
  deterministic: true,
  neverLimp: true,
};

export interface Situation {
  obs: Observation;
  f: Features;
}

const BIG_BLINDS = [2, 10, 20, 100] as const;

/** A random stack in big blinds: a quarter short (3–15), a quarter medium, half deep. */
function randomStackBB(rng: Rng): number {
  const kind = randInt(rng, 4);
  if (kind === 0) return 3 + randInt(rng, 13);
  if (kind === 1) return 16 + randInt(rng, 45);
  return 60 + randInt(rng, 241);
}

function randomTable(rng: Rng, seed: Seed128): ReturnType<typeof createTable> {
  const bb = BIG_BLINDS[randInt(rng, BIG_BLINDS.length)] as number;
  const seatCount = 2 + randInt(rng, 8);
  const cfg: TableConfig = {
    seatCount,
    sb: bb / 2,
    bb,
    startingStack: 100 * bb,
    botLevel: randInt(rng, 2) === 0 ? 'easy' : 'medium',
    seatLevels: new Array<BotLevel | null>(seatCount).fill(null),
  };
  const slots = initialSlots(cfg, seed, en.app.hero).map((slot) => ({
    ...slot,
    stack: randomStackBB(rng) * bb,
  }));
  return createTable(cfg, slots, seed);
}

/** A "to" amount between the bounds: the minimum, all-in, or anywhere up to about the pot. */
function randomTo(bounds: { min: number; max: number }, pot: number, rng: Rng): number {
  const r = randInt(rng, 10);
  if (r < 4) return bounds.min;
  if (r < 5) return bounds.max;
  const span = Math.max(0, Math.min(bounds.max, bounds.min + pot) - bounds.min);
  return bounds.min + randInt(rng, span + 1);
}

/** Random play that reaches every street often: mostly checks and calls. */
function randomAction(legal: LegalActions, pot: number, rng: Rng): PlayerAction {
  const r = randInt(rng, 100);
  if (legal.canCheck) {
    if (r < 25 && legal.bet !== null) return { type: 'bet', to: randomTo(legal.bet, pot, rng) };
    if (r < 25 && legal.raise !== null) {
      return { type: 'raise', to: randomTo(legal.raise, pot, rng) };
    }
    return { type: 'check' };
  }
  if (r < 15 && legal.raise !== null) return { type: 'raise', to: randomTo(legal.raise, pot, rng) };
  if (r < 40 && legal.canFold) return { type: 'fold' };
  return legal.canCall ? { type: 'call' } : { type: 'fold' };
}

/** The HUD's win chance, faster than the HUD (2,000 trials when the spot is not exact). */
function quickHud(obs: Observation): number {
  const nOpp = liveOpponents(obs).length;
  if (nOpp === 0) return 1;
  if (obs.board.length === 0) return preflopEquity(obs.hole, nOpp).equity;
  return equity({ hero: obs.hole, board: obs.board, nOpp }, { trials: 2000 }).equity;
}

/**
 * `count` hero decisions from random hands played with the real engine: each table is random
 * (2–9 seats, blinds, stacks from 3 to 300 big blinds, labels shown or hidden), every hero
 * decision is observed (the brain's whole input) and its features are computed.
 */
export function generateSituations(count: number, seed: Seed128 = DEFAULT_SEED): Situation[] {
  const rng = rngFromSeed(seed);
  const out: Situation[] = [];
  for (let hand = 0; out.length < count; hand++) {
    const table = randomTable(rng, deriveSeed(seed, 'table', hand));
    const n = table.slots.length;
    const labels = table.slots.map((slot, i) =>
      i > 0 && randInt(rng, 2) === 0 ? (slot.personality as PersonalityId) : null,
    );
    let h: HandState = startHand(table, deriveSeed(seed, 'hand', hand));
    let guard = 0;
    while (h.phase !== 'complete' && out.length < count && guard++ < 400) {
      if (h.phase !== 'betting') {
        h = step(h, { kind: 'advance' });
        continue;
      }
      const seat = h.toAct as number;
      const legal = legalActions(h) as LegalActions;
      if (seat === 0) {
        const obs = observe(h, 0, {
          seatStats: new Array(n).fill(null),
          visiblePersonality: labels,
          seatLevels: new Array<BotLevel>(n).fill(table.config.botLevel),
        });
        const f = features(obs, CHECK_PROFILE, coachSeed(obs), quickHud(obs));
        out.push({ obs, f });
      }
      const pot = h.seats.reduce((sum, s) => sum + s.totalBet, 0);
      h = step(h, { kind: 'act', seat, action: randomAction(legal, pot, rng) });
    }
  }
  return out;
}

// ── Decisions: every reason the spot allows, with the policies' data ───────────────────────────

/** A decision as `decide()` will hand it to `explain` (Appendix A.5 fields). */
export type CheckDecision = Pick<
  Decision,
  'action' | 'trace' | 'confidence' | 'alt' | 'eRandom' | 'eRange' | 'need'
>;

const r = (code: Reason['code'], data: Reason['data'] = {}): Reason => ({ code, data });
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const FOLD: PlayerAction = { type: 'fold' };
const CHECK: PlayerAction = { type: 'check' };
const CALL: PlayerAction = { type: 'call' };

/** A legal raise or bet near `to` (snapped to the small blind and the bounds). */
function aggressive(obs: Observation, to: number): PlayerAction | null {
  const type = obs.legal.raise !== null ? 'raise' : obs.legal.bet !== null ? 'bet' : null;
  if (type === null) return null;
  const bounds = obs.legal[type] as { min: number; max: number };
  const snapped = Math.round(to / obs.sb) * obs.sb;
  return { type, to: Math.min(bounds.max, Math.max(bounds.min, snapped)) };
}

function allInAction(obs: Observation): PlayerAction | null {
  if (obs.legal.raise !== null) return { type: 'raise', to: obs.legal.raise.max };
  if (obs.legal.bet !== null) return { type: 'bet', to: obs.legal.bet.max };
  return obs.legal.callIsAllIn ? CALL : null;
}

/**
 * Every reason the spot allows, each with an action it explains, the data the chunk 5.3–5.5
 * policies put in `Reason.data` (sizes as `to`/`bb` before the flop and `size`/`sizeBB` after it,
 * `E` = the policy's range equity, chances as fractions) and a few guardrail corrections.
 */
export function candidateDecisions(s: Situation, rng: Rng): CheckDecision[] {
  const { obs, f } = s;
  const legal = obs.legal;
  const out: CheckDecision[] = [];
  const confidences: Decision['confidence'][] = ['clear', 'normal', 'close'];
  const add = (action: PlayerAction | null, trace: Reason[], E = f.eRange): void => {
    if (action === null) return;
    const confidence = confidences[randInt(rng, 3)] as Decision['confidence'];
    const others = [FOLD, CHECK, CALL].filter(
      (x) =>
        x.type !== action.type &&
        (x.type === 'fold'
          ? legal.canFold && !legal.canCheck
          : x.type === 'check'
            ? legal.canCheck
            : legal.canCall),
    );
    const alt =
      confidence === 'close' && others.length > 0
        ? (others[randInt(rng, others.length)] as PlayerAction)
        : null;
    out.push({ action, trace, confidence, alt, eRandom: f.eRandom, eRange: E, need: f.need });
  };
  const hand = className(classOf(obs.hole[0], obs.hole[1]));
  const pair = rankOf(obs.hole[0]) === rankOf(obs.hole[1]);
  const bb = obs.bb;
  const heroBet = obs.streetBets[obs.seat] as number;
  const currentBet = heroBet + legal.toCall;
  const noisy = (): number => clamp01(f.eRange + (randInt(rng, 17) - 8) / 100);
  const fold = legal.canFold && !legal.canCheck ? FOLD : null;
  const call = legal.canCall ? CALL : null;
  const check = legal.canCheck ? CHECK : null;
  const sized = (a: PlayerAction | null): Reason['data'] =>
    a !== null && (a.type === 'bet' || a.type === 'raise') ? { to: a.to, bb } : {};
  const sizedPost = (a: PlayerAction | null): Reason['data'] =>
    a !== null && (a.type === 'bet' || a.type === 'raise') ? { size: a.to, sizeBB: a.to / bb } : {};

  if (f.street === 'preflop') {
    const headsUp = obs.dealtIn.filter(Boolean).length === 2;
    const open = openPct(f.k, headsUp);
    if (f.facing === 'none' || f.facing === 'limpers') {
      const raise = aggressive(obs, 2.5 * bb + bb * (f.facing === 'limpers' ? 1 : 0));
      const base = { hand, rankPct: f.rankPct, behind: f.k, openPct: open };
      add(raise, [r('OPEN_RANGE', { ...base, ...sized(raise) })]);
      add(fold, [r('FOLD_RANGE', base)]);
      add(check, [r('CHECK_FREE')]);
      if (f.facing === 'limpers') {
        add(raise, [r('ISOLATE', { hand, rankPct: f.rankPct, limpers: 1, ...sized(raise) })]);
      }
    } else if (f.facing === 'allin') {
      const E = noisy();
      add(call, [r('CALL_ALLIN', { hand, E, need: f.need, V: 12 })], f.eRange);
      add(fold, [r('FOLD_ALLIN', { hand, E, need: f.need, V: 12 })], f.eRange);
    } else {
      const E = noisy();
      const numbers = { hand, E, need: f.need, V: 15, R: 0.95, evCall: 1 };
      const reraise = aggressive(obs, 3 * currentBet);
      add(reraise, [
        r(f.facing === 'open' ? 'THREE_BET_VALUE' : 'FOUR_BET_VALUE', {
          ...numbers,
          ...sized(reraise),
        }),
      ]);
      add(call, [r('CALL_PREFLOP', { ...numbers, implied: pair ? 3 * bb : 0 })]);
      if (pair) add(call, [r('SET_MINING', { ...numbers, implied: 3 * bb })]);
      add(fold, [r('FOLD_VS_RAISE', numbers)]);
    }
    if (f.effBB <= 12) {
      const S = Math.min(15, Math.max(1, Math.round(f.effBB)));
      const shove = allInAction(obs);
      const data = { S, behind: Math.min(8, Math.max(1, f.k)), hand, rankPct: f.rankPct };
      add(shove, [r('PUSH_FOLD', { action: 'allin', ...data, Pfold: 0.55, E: noisy() })]);
      add(fold, [r('PUSH_FOLD', { action: 'fold', ...data, Pfold: 0.3, E: noisy() })]);
    }
    return out;
  }

  const E = f.eRange;
  const need = f.need;
  const handName = f.handInfo.name;
  const largest = f.draws.reduce<Features['draws'][number] | null>(
    (best, d) => (best === null || d.outs > best.outs ? d : best),
    null,
  );
  if (f.toCall > 0) {
    const raise = aggressive(obs, 3 * currentBet);
    const shove = allInAction(obs);
    add(raise, [r('VALUE_RAISE', sizedPost(raise))]);
    add(raise, [r('RAISE_PROTECT', sizedPost(raise))]);
    add(raise, [r('NUTS', sizedPost(raise))]);
    add(shove, [r('VALUE_RAISE', sizedPost(shove)), r('COMMITTED', { handName, E, need })]);
    add(call, [r('CALL_PROFITABLE', { E, need, toCall: f.toCall, pot: f.winPot })]);
    add(call, [r('COMMITTED', { handName, E, need })]);
    if (largest !== null) {
      const needImplied = f.toCall / (f.winPot + f.toCall + 0.5 * f.pot);
      add(call, [r('IMPLIED', { E, need, needImplied, draw: largest.kind })]);
    }
    if (f.facing === 'allin') {
      add(call, [r('CALL_ALLIN', { E, need })]);
      add(fold, [r('FOLD_ALLIN', { E, need })]);
      add(call, [
        r('FOLD_ALLIN', { E, need }),
        r('GUARDRAIL', { rule: 4, detail: 'allInPriceGood' }),
      ]);
      add(fold, [
        r('CALL_ALLIN', { E, need }),
        r('GUARDRAIL', { rule: 4, detail: 'allInPriceBad' }),
      ]);
    } else {
      add(fold, [r('FOLD_PRICE', { E, need })]);
    }
    add(fold, [r('BOARD_PLAYS')]);
    add(call, [
      r('FOLD_PRICE', { E, need }),
      r('GUARDRAIL', { rule: 2, detail: 'tooStrongToFold' }),
    ]);
    if (f.street === 'river') {
      add(fold, [
        r('CALL_PROFITABLE', { E, need, toCall: f.toCall, pot: f.winPot }),
        r('GUARDRAIL', { rule: 3, detail: 'riverNoChance' }),
      ]);
    }
  } else {
    const bet = aggressive(obs, f.pot / 2);
    const third = aggressive(obs, f.pot / 3);
    add(bet, [r('VALUE_BET', { handName, category: f.handInfo.category, E, ...sizedPost(bet) })]);
    add(bet, [r('NUTS', { handName, category: f.handInfo.category, E, ...sizedPost(bet) })]);
    add(third, [r('THIN_VALUE', { handName, E, ...sizedPost(third) })]);
    add(third, [r('CBET_DRY', sizedPost(third))]);
    if (f.street !== 'river' && f.outs > 0) {
      add(bet, [
        r('SEMI_BLUFF', {
          draw: largest?.kind ?? '',
          outs: f.outs,
          hitNext: 0.2,
          hitRiver: 0.35,
          ...sizedPost(bet),
        }),
      ]);
    }
    add(check, [r('POT_CONTROL', { handName })]);
    add(check, [r(f.street === 'river' ? 'CHECK_FREE' : 'CHECK_WEAK')]);
    add(check, [r('BOARD_PLAYS')]);
    add(check, [r('FOLD_PRICE', { E, need }), r('GUARDRAIL', { rule: 1, detail: 'checkFree' })]);
  }
  return out;
}

// ── The run ────────────────────────────────────────────────────────────────────────────────────

export interface CopyReport {
  problems: string[];
  situations: number;
  hints: number;
  /** Template keys that appeared in the generated hints. */
  covered: ReadonlySet<TemplateKey>;
  /** Rendered hints for a reader (`--print n`): every k-th hint. */
  samples: string[][];
}

function keysOf(line: Line, into: Set<TemplateKey>): void {
  into.add(line.key);
  for (const p of Object.values(line.params)) if (p.kind === 'line') keysOf(p.line, into);
}

/**
 * Parts 1–3 over `count` situations. Problems are deduplicated, each with the first spot that
 * shows it. `print` keeps that many rendered hints, spread over the run, for a reader.
 */
export function runCheckCopy(
  count: number = DEFAULT_SITUATIONS,
  seed: Seed128 = DEFAULT_SEED,
  print = 0,
): CopyReport {
  const problems = [...checkTemplates(), ...checkGlossary()];
  const situations = generateSituations(count, seed);
  const rng = rngFromSeed(deriveSeed(seed, 'decisions'));
  const covered = new Set<TemplateKey>();
  const seen = new Set<string>();
  const samples: string[][] = [];
  const every = Math.max(1, Math.floor((6 * count) / Math.max(1, print)));
  let hints = 0;
  for (const s of situations) {
    for (const d of candidateDecisions(s, rng)) {
      const input = explainInput(s.obs, s.f, d);
      let found: string[];
      try {
        const e = explain(input);
        for (const line of hintLines(e)) keysOf(line, covered);
        found = checkHint(e, input);
        if (samples.length < print && hints % every === 0) samples.push(hintText(e));
      } catch (error) {
        found = [`explain failed: ${(error as Error).message}`];
      }
      hints++;
      for (const p of found) {
        if (seen.has(p)) continue;
        seen.add(p);
        const spot = `${s.f.street}, ${d.trace.map((x) => x.code).join('+')} → ${JSON.stringify(d.action)}`;
        problems.push(`${p} [${spot}; hole ${className(classOf(s.obs.hole[0], s.obs.hole[1]))}]`);
      }
    }
  }
  return { problems, situations: situations.length, hints, covered, samples };
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.main) {
  const count = Number(argValue('--situations') ?? DEFAULT_SITUATIONS);
  const seed = argValue('--seed') ?? DEFAULT_SEED;
  const print = Number(argValue('--print') ?? 0);
  if (!Number.isInteger(count) || count < 1 || !isSeed128(seed) || !Number.isInteger(print)) {
    console.error(
      'check-copy: usage: node scripts/check-copy.ts [--situations N] [--seed 32hex] [--print N]',
    );
    process.exit(2);
  }
  const started = performance.now();
  const report = runCheckCopy(count, seed, print);
  for (const sample of report.samples) console.log(`\n${sample.join('\n')}`);
  if (report.samples.length > 0) console.log('');
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const reasonKeys = TEMPLATE_KEYS.filter((k) => !k.includes('.') || /^[A-Z]/.test(k));
  const unseen = reasonKeys.filter((k) => !report.covered.has(k) && !k.startsWith('feedback'));
  console.log(
    `check-copy: ${TEMPLATE_KEYS.length} templates, ${GLOSSARY_KEYS.length} glossary keys; ${report.situations} situations, ${report.hints} hints in ${seconds} s`,
  );
  console.log(
    `check-copy: hint templates seen ${reasonKeys.length - unseen.length}/${reasonKeys.length}${unseen.length > 0 ? ` (not seen: ${unseen.join(', ')})` : ''}`,
  );
  if (report.problems.length > 0) {
    console.error(`check-copy: ${report.problems.length} problems:`);
    for (const p of report.problems.slice(0, 50)) console.error(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log('check-copy: OK');
  }
}
