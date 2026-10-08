// The coach's view model (chunk 5.9): glossary links (F.9), the F.1 text of a decision with the
// {E} rules, and what the strip, sheet, ring and tray show per level (§10.2, §12.6, §12.7). The
// last block is pitfall 35: a range number never shows without its label.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Decision, ReasonCode } from '../../src/brain/types.ts';
import { coachText } from '../../src/i18n/coachUi.ts';
import { coachView, hintView, narrationText, slotOf } from '../../src/ui/coach.ts';
import {
  headlineOf,
  hintText,
  pctText,
  preflopName,
  sentences,
  type TextContext,
} from '../../src/ui/coachText.ts';
import { glossaryKeys, lookupTerm, parseTerms, plainText } from '../../src/ui/glossary.ts';
import {
  CHECKED,
  coachData,
  decision,
  FACING,
  input,
  NARRATION,
  r,
  rangeAdjusted,
} from './coachFixtures.ts';

const CTX: TextContext = { bb: 20, amounts: 'chips', legal: FACING };

const ALL_CODES = Object.keys(coachText.reason) as ReasonCode[];

describe('glossary (Appendix F.9)', () => {
  it('derives the keys: split at " / ", a parenthesised alias, lower case', () => {
    expect(glossaryKeys('big blind (BB)')).toEqual(['big blind', 'bb']);
    expect(glossaryKeys('call / check / fold / raise')).toEqual(['call', 'check', 'fold', 'raise']);
    expect(glossaryKeys('continuation bet (c-bet)')).toEqual(['continuation bet', 'c-bet']);
    expect(glossaryKeys('SPR')).toEqual(['spr']);
    expect(lookupTerm('BB')?.term).toBe('big blind (BB)');
    expect(lookupTerm('fold')?.text).toBe(lookupTerm('raise')?.text);
  });

  it('parses {g:term} links, the plural "s" staying plain', () => {
    expect(parseTerms('Only 8 {g:big blind}s left: go {g:all-in} or fold.')).toEqual([
      { kind: 'text', text: 'Only 8 ' },
      { kind: 'term', text: 'big blind', key: 'big blind' },
      { kind: 'text', text: 's left: go ' },
      { kind: 'term', text: 'all-in', key: 'all-in' },
      { kind: 'text', text: ' or fold.' },
    ]);
    expect(parseTerms('No terms here.')).toEqual([{ kind: 'text', text: 'No terms here.' }]);
    // An unknown key is plain text, joined to its neighbours.
    expect(parseTerms('a {g:nothing} b')).toEqual([{ kind: 'text', text: 'a nothing b' }]);
    expect(plainText('Small {g:pocket pair}. Try for a {g:set}.')).toBe(
      'Small pocket pair. Try for a set.',
    );
  });

  it('every term an F.1 template links is in the glossary', () => {
    for (const code of ALL_CODES) {
      const text = hintText(decision({ trace: [r(code)] }), CTX).reason;
      for (const m of text.matchAll(/\{g:([^}]+)\}/g)) {
        expect(lookupTerm(m[1] ?? ''), `${code}: ${m[1]}`).not.toBeNull();
      }
    }
  });
});

describe('coach text (Appendix F.1)', () => {
  it('formats whole percentages, never 0 or 100 unless exact', () => {
    expect(pctText(0.454)).toBe('45');
    expect(pctText(0.002)).toBe('<1');
    expect(pctText(0)).toBe('0');
    expect(pctText(0.996)).toBe('>99');
    expect(pctText(1)).toBe('100');
  });

  it('names preflop hands as F.2 does', () => {
    expect(preflopName('AKs')).toBe('Ace-King suited');
    expect(preflopName('T9o')).toBe('Ten-Nine offsuit');
    expect(preflopName('66')).toBe('Pocket Sixes');
  });

  it('writes the headline in the action bar’s words, with big blinds for bets and raises', () => {
    expect(headlineOf({ type: 'call' }, CTX)).toBe('Call 40');
    expect(headlineOf({ type: 'fold' }, CTX)).toBe('Fold');
    expect(headlineOf({ type: 'check' }, CTX)).toBe('Check');
    expect(headlineOf({ type: 'raise', to: 60 }, CTX)).toBe('Raise to 60 (3 BB)');
    expect(headlineOf({ type: 'bet', to: 50 }, CTX)).toBe('Bet 50 (2.5 BB)');
    expect(headlineOf({ type: 'bet', to: 2_000 }, CTX, true)).toBe('All-in 2,000');
    const bb: TextContext = { ...CTX, amounts: 'bb' };
    expect(headlineOf({ type: 'raise', to: 60 }, bb)).toBe('Raise to 3 BB');
    const allInCall: TextContext = { ...CTX, legal: { ...FACING, callIsAllIn: true } };
    expect(headlineOf({ type: 'call' }, allInCall)).toBe('Call all-in 40');
  });

  it('renders the hint structure: reason, why-not lines, close call', () => {
    const t = hintText(
      decision({
        confidence: 'close',
        alt: { type: 'fold' },
        trace: [
          r('CALL_PROFITABLE', { E: 0.45, need: 0.25, toCall: 40, pot: 120 }),
          r('WHY_NOT_FOLD'),
          r('CLOSE_SPOT'),
        ],
      }),
      CTX,
    );
    expect(t.headline).toBe('Call 40');
    expect(t.rangeAdjust).toBeNull();
    expect(t.reason).toBe(
      'You win about 45%. You need 25% to call 40 into 120. 45% is more than 25%, so calling wins over time.',
    );
    expect(t.reasonFirst).toBe('You win about 45%.');
    expect(t.whyNot).toEqual(['Why not fold? You win more often than you need to.']);
    expect(t.close).toBe('Close call: Fold is also fine.');
    expect(t.extra).toEqual([]);
  });

  it('uses eRange in the codes that name the range, eRandom elsewhere', () => {
    const d = decision({ eRandom: 0.5, eRange: 0.3, trace: [r('CALL_ALLIN', { need: 0.25 })] });
    expect(hintText(d, CTX).reason).toContain('You win about 30% against hands that go all-in');
    const plain = decision({ eRandom: 0.5, eRange: 0.47, trace: [r('CALL_PROFITABLE')] });
    expect(hintText(plain, CTX).reasonFirst).toBe('You win about 50%.');
  });

  it('RANGE_ADJUST comes first, labelled, and makes {E} the range number after it', () => {
    const t = hintText(rangeAdjusted(), CTX);
    expect(t.rangeAdjust).toBe(
      'Against any cards you win 62%. This player bets big only with good hands. Against those, you win about 20%.',
    );
    expect(t.reason).toBe('You need 25% to call. You win only about 20%. Folding saves chips.');
    expect(t.whyNot).toEqual(['Why not call? You need 25%, and you win about 20%.']);
  });

  it('every reason code renders with every placeholder filled', () => {
    const data = {
      E: 0.4,
      need: 0.25,
      toCall: 40,
      pot: 120,
      size: 60,
      hand: 'AKs',
      handName: 'Pair of Kings',
      category: 'pair',
      draw: 'flush',
      outs: 9,
      hitNext: 0.19,
      hitRiver: 0.35,
      exact: 0.35,
      Pfold: 0.6,
      needImplied: 0.15,
      rankPct: 5,
      openPct: 20,
      behind: 3,
      S: 8,
      actionDescription: 'raise',
      rule: '2',
    };
    for (const code of ALL_CODES) {
      const d = decision({ alt: { type: 'fold' }, trace: [r(code, data)] });
      const t = hintText(d, CTX);
      const text = [t.reason, t.rangeAdjust, ...t.whyNot, t.close, ...t.trick]
        .filter((x): x is string => x !== null)
        .join(' ');
      expect(text, code).not.toBe('');
      expect(plainText(text), code).not.toMatch(/[{}]|undefined|NaN|null/);
    }
  });

  it('splits sentences at their end marks, not inside numbers', () => {
    expect(sentences('Raise to 50 (2.5 BB). Then wait.')).toEqual([
      'Raise to 50 (2.5 BB).',
      'Then wait.',
    ]);
  });
});

describe('coachView (§10.2, §12.6)', () => {
  it('Beginner: the advice is on show, facing a bet with the two numbers', () => {
    const v = coachView(coachData(), null, input(FACING));
    expect(v.level).toBe('beginner');
    expect(v.shown).toBe(true);
    expect(v.strip).toEqual({
      kind: 'advice',
      headline: 'Call 40',
      line: 'You win about 45%. You need 25%.',
      why: false,
    });
    expect(v.ring).toBe('middle');
    expect(v.size).toBeNull();
    expect(v.hint?.strength).toEqual({ level: 3, label: 'Decent', name: 'Hand strength: Decent' });
  });

  it('Beginner: with nothing to call, the reason’s first sentence', () => {
    const bet = decision({
      action: { type: 'bet', to: 60 },
      kind: 'bet',
      need: 0,
      trace: [r('VALUE_BET', { handName: 'Pair of Kings', category: 'pair', size: 60 })],
    });
    const v = coachView(coachData({ decision: bet }), null, input(CHECKED));
    expect(v.strip).toMatchObject({
      kind: 'advice',
      headline: 'Bet 60 (3 BB)',
      line: 'Your Pair of Kings is probably best (about 45%).',
    });
    expect(v.ring).toBe('right');
    expect(v.size).toBe(60);
    expect(v.hint?.numbers.need).toBeNull();
    expect(v.hint?.numbers.bar).toBeNull();
  });

  it('Beginner: "Coach is thinking…" while pending; the failure line', () => {
    expect(
      coachView(coachData({ state: 'pending', decision: null }), null, input(FACING)).strip,
    ).toEqual({ kind: 'thinking' });
    const failed = coachView(coachData({ state: 'failed', decision: null }), null, input(FACING));
    expect(failed.strip).toEqual({ kind: 'failed' });
    expect(failed.ring).toBeNull();
  });

  it('Intermediate: "Hint" disabled until ready, then on tap the action and one sentence', () => {
    const pending = coachView(
      coachData({ level: 'intermediate', state: 'pending', decision: null }),
      null,
      input(FACING),
    );
    expect(pending.strip).toEqual({ kind: 'hint', ready: false });
    const ready = coachView(coachData({ level: 'intermediate' }), null, input(FACING));
    expect(ready.strip).toEqual({ kind: 'hint', ready: true });
    expect(ready.shown).toBe(false);
    expect(ready.ring).toBeNull();
    expect(ready.hint).not.toBeNull(); // built, for the sheet after the tap
    expect(ready.hint?.strength).toBeNull(); // the meter is Beginner's
    const opened = coachView(
      coachData({ level: 'intermediate', opened: true }),
      null,
      input(FACING),
    );
    expect(opened.strip).toEqual({
      kind: 'advice',
      headline: 'Call 40',
      line: 'You win about 45%.',
      why: true,
    });
    expect(opened.ring).toBe('middle');
  });

  it('Advanced and Exam act as Intermediate until Stage 6', () => {
    for (const level of ['advanced', 'exam'] as const) {
      expect(coachView(coachData({ level }), null, input(FACING)).strip).toEqual({
        kind: 'hint',
        ready: true,
      });
    }
  });

  it('narrates others’ actions, and is empty with no hand', () => {
    const v = coachView(coachData({ state: 'waiting', decision: null }), NARRATION, input(null));
    expect(v.strip).toEqual({ kind: 'narration', text: 'Ben raises to 60.' });
    expect(coachView(coachData({ state: 'off', decision: null }), null, null).strip).toEqual({
      kind: 'empty',
    });
    expect(narrationText({ ...NARRATION, hero: true, type: 'call', amount: 40 }, 20, 'chips')).toBe(
      'You call 40.',
    );
    expect(narrationText({ ...NARRATION, type: 'bet', allIn: true, amount: 2_000 }, 20, 'bb')).toBe(
      'Ben bets 100 BB. All-in.',
    );
    expect(narrationText({ ...NARRATION, type: 'fold' }, 20, 'chips')).toBe('Ben folds.');
  });

  it('rings the button of the action (§12.7)', () => {
    expect(slotOf(decision({ action: { type: 'fold' } }))).toBe('fold');
    expect(slotOf(decision({ action: { type: 'check' } }))).toBe('middle');
    expect(slotOf(decision({ action: { type: 'call' } }))).toBe('middle');
    expect(slotOf(decision({ action: { type: 'raise', to: 80 } }))).toBe('right');
  });

  it('the numbers: the HUD number, the price, a labelled price bar', () => {
    const h = hintView(decision(), 'beginner', input(FACING));
    expect(h.numbers).toMatchObject({
      win: 'Win chance 45% (any cards)',
      likely: null,
      need: 'Need 25%',
      pot: 'Pot 120',
      toCall: 'To call 40',
    });
    expect(h.numbers.bar).toMatchObject({
      win: 0.45,
      need: 0.25,
      good: true,
      label: 'Win chance 45% (any cards). Need 25%.',
      verdict: 'You win more often than you need.',
    });
  });

  it('RANGE_ADJUST: the strip shows the labelled pair; the numbers both, labelled', () => {
    const v = coachView(coachData({ decision: rangeAdjusted() }), null, input(FACING));
    expect(v.strip).toMatchObject({
      kind: 'advice',
      headline: 'Fold',
      line: 'Any cards: 62%. Their likely hands: about 20%.',
    });
    expect(v.hint?.numbers.win).toBe('Win chance 62% (any cards)');
    expect(v.hint?.numbers.likely).toBe('Against their likely hands: about 20%');
    expect(v.hint?.numbers.bar).toMatchObject({
      win: 0.2,
      good: false,
      label: 'Against their likely hands: about 20%. Need 25%.',
      verdict: 'You win less often than you need.',
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Pitfall 35: never a bare range number

/** Phrases that name what a number is against (F.1, §12.6). */
const LABELS = [
  'any cards',
  'Any cards',
  'likely hands',
  'Against those',
  'hands that raise here',
  'hands that go all-in here',
  'against it',
  'If called',
];

const reasonCodes: ReasonCode[] = ALL_CODES.filter(
  (c) => c !== 'RANGE_ADJUST' && !c.startsWith('WHY_NOT') && c !== 'CLOSE_SPOT',
);

const arbDecision: fc.Arbitrary<Decision> = fc
  .record({
    eRandom: fc.integer({ min: 1, max: 99 }),
    gap: fc.integer({ min: 5, max: 40 }),
    down: fc.boolean(),
    need: fc.integer({ min: 0, max: 60 }),
    main: fc.constantFrom(...reasonCodes),
    whyNot: fc.subarray(['WHY_NOT_FOLD', 'WHY_NOT_CALL', 'WHY_NOT_CHECK'] as const),
    action: fc.constantFrom('fold', 'call', 'check', 'bet', 'raise'),
  })
  .map(({ eRandom, gap, down, need, main, whyNot, action }) => {
    const eRange = Math.min(99, Math.max(1, down ? eRandom - gap : eRandom + gap));
    const a =
      action === 'bet' || action === 'raise'
        ? { type: action, to: 80 }
        : ({ type: action } as Decision['action']);
    return decision({
      action: a,
      kind: a.type,
      eRandom: eRandom / 100,
      eRange: eRange / 100,
      need: need / 100,
      trace: [
        r('RANGE_ADJUST', { actionDescription: 'bet' }),
        r(main, { size: 80, hand: 'AKs', handName: 'Pair of Kings', draw: 'flush', outs: 9 }),
        ...whyNot.map((c) => r(c)),
      ],
    });
  });

/**
 * A range number in `text` (sentences) without a label. The price ("Need 25%", "You need 25%")
 * is another number that may be equal: it is taken out first.
 */
function bareRange(text: string, d: Decision): boolean {
  const range = `${pctText(d.eRange)}%`;
  if (pctText(d.eRange) === pctText(d.eRandom)) return false;
  return sentences(text).some((s) => {
    const rest = s.replace(/\b[Nn]eed (about )?[<>]?\d+%/g, '');
    return rest.includes(range) && !LABELS.some((l) => rest.includes(l));
  });
}

it('the pitfall-35 check finds a bare range number', () => {
  const d = rangeAdjusted();
  expect(bareRange('You win only about 20%.', d)).toBe(true);
  expect(bareRange('Against their likely hands: about 20%. Need 25%.', d)).toBe(false);
  expect(bareRange('You need 20% to call.', { ...d, need: 0.2 })).toBe(false);
});

describe('pitfall 35: a range number always has its label', () => {
  it('the strip line never holds a bare range number (any level, any code)', () => {
    fc.assert(
      fc.property(arbDecision, fc.constantFrom('beginner', 'intermediate'), (d, level) => {
        const v = coachView(coachData({ level, decision: d, opened: true }), null, input(FACING));
        if (v.strip.kind !== 'advice') return false;
        return !bareRange(`${v.strip.headline}. ${v.strip.line}`, d);
      }),
      { numRuns: 2_000 },
    );
  });

  it('in the sheet, a range number is labelled in its sentence or follows RANGE_ADJUST', () => {
    fc.assert(
      fc.property(arbDecision, (d) => {
        const h = hintView(d, 'beginner', input(FACING));
        // The labelled places on their own:
        const own = [h.numbers.win, h.numbers.likely ?? '', h.numbers.bar?.label ?? ''];
        if (own.some((t) => bareRange(t, d))) return false;
        // The reason and the why-not lines come right after RANGE_ADJUST, which labels them.
        return h.rangeAdjust !== null && !bareRange(h.rangeAdjust, d);
      }),
      { numRuns: 2_000 },
    );
  });
});
