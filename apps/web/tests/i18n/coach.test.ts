/**
 * The coach-text renderer (PLAN §8.10, Appendix F.1, F.9): templates, number formats (the HUD's
 * rounding), sentence capitals, plural forms, nested templates, glossary keys.
 */
import { describe, expect, it } from 'vitest';
import type { Explanation, Line, Param } from '../../src/brain/explain.ts';
import {
  bbText,
  chipsText,
  EN_COACH,
  glossaryEntry,
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
  topText,
  type CoachStrings,
} from '../../src/i18n/coach.ts';
import { en } from '../../src/i18n/en.ts';
import { percentText } from '../../src/ui/equity.ts';

const l = (
  key: Line['key'],
  params: Record<string, Param> = {},
  glossary: Line['glossary'] = [],
): Line => ({
  key,
  params,
  glossary,
});

describe('templates', () => {
  it('parses text, placeholders and glossary links, with a plural "s" outside the link', () => {
    expect(parseTemplate('Only {S} {g:big blind}s left: go {g:all-in} or fold.')).toEqual([
      { kind: 'text', text: 'Only ' },
      { kind: 'param', name: 'S' },
      { kind: 'text', text: ' ' },
      { kind: 'glossary', key: 'big blind' },
      { kind: 'text', text: 's left: go ' },
      { kind: 'glossary', key: 'all-in' },
      { kind: 'text', text: ' or fold.' },
    ]);
    expect(parseTemplate('{E}')).toEqual([{ kind: 'param', name: 'E' }]);
    expect(parseTemplate('No values.')).toEqual([{ kind: 'text', text: 'No values.' }]);
  });

  it('lists the forms, placeholders and glossary keys of a template', () => {
    const plural = en.coach.templates.PUSH_FOLD;
    expect(templateForms(plural)).toHaveLength(2);
    expect(templateParams(plural)).toEqual(['E', 'Pfold', 'S']);
    expect(templateGlossary(plural)).toEqual(['all-in', 'big blind']);
    expect(templateForms('One form')).toEqual(['One form']);
    expect(templateParams(en.coach.templates.CHECK_FREE)).toEqual([]);
  });
});

describe('numbers', () => {
  it('pctText is the HUD badge rounding (ui/equity.ts percentText) without the "%"', () => {
    for (let tenths = -10; tenths <= 1010; tenths++) {
      const points = tenths / 10;
      expect(`${pctText(points)}%`).toBe(percentText(points));
    }
    expect([pctText(0.4), pctText(0.5), pctText(62.49), pctText(99.6)]).toEqual([
      '<1',
      '1',
      '62',
      '>99',
    ]);
  });

  it('a starting-hand percentile rounds up and is at least 1 ("top 1%" for AA)', () => {
    expect([
      topText(0),
      topText(0.45),
      topText(4.2),
      topText(15),
      topText(98.19),
      topText(100),
    ]).toEqual(['1', '1', '5', '15', '99', '100']);
  });

  it('chips with thousands separators; big blinds with one decimal only when needed', () => {
    expect([
      chipsText(0),
      chipsText(950),
      chipsText(2340),
      chipsText(1_000_000),
      chipsText(-1250),
    ]).toEqual(['0', '950', '2,340', '1,000,000', '-1,250']);
    expect([bbText(2.5), bbText(3), bbText(2.47), bbText(1250), bbText(0.25)]).toEqual([
      '2.5',
      '3',
      '2.5',
      '1,250',
      '0.3',
    ]);
  });
});

describe('renderLine', () => {
  it('values and glossary links as segments; "{size}" with a no-break space before "BB"', () => {
    const segments = renderLine(
      l(
        'PUSH_FOLD',
        {
          S: { kind: 'count', value: 8 },
          Pfold: { kind: 'pct', value: 40.4 },
          E: { kind: 'pct', value: 45.5 },
        },
        ['big blind', 'all-in'],
      ),
    );
    expect(segments).toEqual([
      { text: 'Only ' },
      { text: '8', value: true },
      { text: ' ' },
      { text: 'big blind', glossary: 'big blind' },
      { text: 's left: go ' },
      { text: 'all-in', glossary: 'all-in' },
      { text: ' or fold. They fold about ' },
      { text: '40', value: true },
      { text: '%. If called, you still win about ' },
      { text: '46', value: true },
      { text: '%.' },
    ]);
    expect(lineText(l('headline.raise', { size: { kind: 'size', to: 1250, bb: 12.5 } }))).toBe(
      'Raise to 1,250 (12.5 BB)',
    );
  });

  it('upper-cases the first letter of each sentence, and only there', () => {
    const draw = (kind: 'flush' | 'oesd' | null): Line =>
      l(
        'SEMI_BLUFF.turn',
        {
          draw: { kind: 'draw', draw: kind },
          outs: { kind: 'count', value: 9 },
          hitNext: { kind: 'pct', value: 19.6 },
        },
        ['outs'],
      );
    expect(lineText(draw('flush'))).toBe(
      'Flush draw: 9 outs. You hit about 20% on the river. Betting can win now or later.',
    );
    expect(lineText(draw(null))).toMatch(/^Draw: 9 outs\./);
    // Mid-sentence, a draw name stays lower case.
    const implied = l('IMPLIED', {
      need: { kind: 'pct', value: 25 },
      draw: { kind: 'draw', draw: 'oesd' },
      needImplied: { kind: 'pct', value: 16 },
    });
    expect(lineText(implied)).toContain('If you hit your open-ended straight draw, you can');
  });

  it('a nested template renders as written: "bets big", not "Bets big"', () => {
    const range = l('RANGE_ADJUST', {
      eRandom: { kind: 'pct', value: 62 },
      actionDescription: { kind: 'line', line: l('villain.betsBig') },
      eRange: { kind: 'pct', value: 35 },
    });
    expect(lineText(range)).toBe(
      'Against any cards you win 62%. This player bets big only with good hands. Against those, you win about 35%.',
    );
    const guard = l('GUARDRAIL', { detail: { kind: 'line', line: l('detail.checkFree') } });
    expect(lineText(guard)).toBe('This decision is clear. Checking is free.');
  });

  it('picks the singular form for a count of 1', () => {
    const fold = (behind: number): string =>
      lineText(
        l('FOLD_RANGE', {
          hand: { kind: 'name', text: 'Seven-Two offsuit' },
          behind: { kind: 'count', value: behind },
        }),
      );
    expect(fold(1)).toBe(
      'Seven-Two offsuit is not strong enough here. 1 player acts after you. Folding saves chips.',
    );
    expect(fold(2)).toContain('2 players act after you.');
    expect(fold(0)).toContain('0 players act after you.');
  });

  it('throws on a missing template or value (check-copy keeps both from happening)', () => {
    expect(() => lineText(l('CLOSE_SPOT'))).toThrow(/no value for \{alt\}/);
    const broken: CoachStrings = {
      ...EN_COACH,
      templates: { ...EN_COACH.templates, NUTS: undefined as unknown as string },
    };
    expect(() => lineText(l('NUTS'), broken)).toThrow(/no template for NUTS/);
  });
});

describe('hint lines in reading order', () => {
  it('headline, reasons, numbers, why-not lines, close call, rule of 2 and 4', () => {
    const e: Explanation = {
      headline: l('headline.fold'),
      reasons: [l('CHECK_WEAK')],
      numbers: l('numbers.free', {
        eRandom: { kind: 'pct', value: 12 },
        pot: { kind: 'chips', value: 300 },
      }),
      whyNot: [l('WHY_NOT_BET')],
      close: l('CLOSE_SPOT', { alt: { kind: 'line', line: l('alt.check') } }),
      trick: [l('RULE_2_4_BIG')],
      trace: [],
      shown: { eRandom: 0.12, eRange: null, win: 0.12, need: 0 },
    };
    expect(hintLines(e).map((x) => x.key)).toEqual([
      'headline.fold',
      'CHECK_WEAK',
      'numbers.free',
      'WHY_NOT_BET',
      'CLOSE_SPOT',
      'RULE_2_4_BIG',
    ]);
    expect(hintText(e)).toEqual([
      'Fold',
      'You have little now. Check and see the next card for free.',
      'Win 12% · Pot 300',
      'Why not bet? Better hands call, and worse hands fold.',
      'Close call: Check is also fine.',
      'The trick guesses too high for big draws.',
    ]);
    expect(hintLines({ ...e, close: null }).map((x) => x.key)).not.toContain('CLOSE_SPOT');
  });
});

describe('glossary (Appendix F.9)', () => {
  it('keys: each name split at " / ", a parenthesised alias as one more key, lower case', () => {
    expect(glossaryKeys('big blind (BB)')).toEqual(['big blind', 'bb']);
    expect(glossaryKeys('call / check / fold / raise')).toEqual(['call', 'check', 'fold', 'raise']);
    expect(glossaryKeys('need % / pot odds')).toEqual(['need %', 'pot odds']);
    expect(glossaryKeys('continuation bet (c-bet)')).toEqual(['continuation bet', 'c-bet']);
    expect(glossaryKeys('SPR')).toEqual(['spr']);
  });

  it('finds the entry of a key, or null', () => {
    expect(glossaryEntry('bb')?.term).toBe('big blind (BB)');
    expect(glossaryEntry('fold')?.definition).toContain('give up the hand');
    expect(glossaryEntry('outs')?.definition).toBe(
      'Cards still in the deck that improve your hand.',
    );
    expect(glossaryEntry('flopzilla')).toBeNull();
  });
});
