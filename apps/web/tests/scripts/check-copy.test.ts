/**
 * `scripts/check-copy.ts` and its rules (`scripts/copy-rules.ts`): the real copy passes, and each
 * failing fixture breaks one rule (PLAN §8.10 language rules, Appendix F; Stage 5 acceptance 7).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  explain,
  type ExplainInput,
  type Explanation,
  type Line,
} from '../../src/brain/explain.ts';
import { EN_COACH, type CoachStrings, type GlossaryEntry } from '../../src/i18n/coach.ts';
import { en } from '../../src/i18n/en.ts';
import {
  candidateDecisions,
  DEFAULT_SEED,
  generateSituations,
  runCheckCopy,
} from '../../scripts/check-copy.ts';
import {
  checkGlossary,
  checkHint,
  checkLine,
  checkTemplates,
  sampleLine,
  sentenceWords,
} from '../../scripts/copy-rules.ts';
import { rngFromSeed } from '../../src/core/rng.ts';

const SCRIPT = fileURLToPath(new URL('../../scripts/check-copy.ts', import.meta.url));

/** The real strings with some templates replaced. */
function withTemplates(changes: Record<string, unknown>): CoachStrings {
  return {
    ...EN_COACH,
    templates: { ...EN_COACH.templates, ...changes } as CoachStrings['templates'],
  };
}

describe('sentenceWords', () => {
  it('a value is one word, a symbol none; sentences end at ". ", "? " and "! "', () => {
    expect(
      sentenceWords([
        { text: 'Raise to ' },
        { text: '1,250 (12.5 BB)', value: true },
        { text: '. Why not fold? Win ' },
        { text: '62', value: true },
        { text: '% · Need ' },
        { text: '25', value: true },
        { text: '%' },
      ]),
    ).toEqual([
      ['Raise', 'to', '§.'],
      ['Why', 'not', 'fold?'],
      ['Win', '§%', 'Need', '§%'],
    ]);
  });
});

describe('passing fixtures: the real copy', () => {
  it('every template and the glossary pass', () => {
    expect(checkTemplates()).toEqual([]);
    expect(checkGlossary()).toEqual([]);
  });

  it('every template renders with sample values in each form', () => {
    for (const key of Object.keys(en.coach.templates) as Line['key'][]) {
      expect(checkLine(sampleLine(key, 1))).toEqual([]);
      expect(checkLine(sampleLine(key, 2))).toEqual([]);
    }
  });

  it('the hints of 60 generated situations pass (the CI run has 1,000)', () => {
    const report = runCheckCopy(60, DEFAULT_SEED);
    expect(report.problems).toEqual([]);
    expect(report.situations).toBe(60);
    expect(report.hints).toBeGreaterThan(60);
    expect(report.covered.has('numbers') || report.covered.has('numbers.free')).toBe(true);
  }, 30_000);

  it('situations come from the real engine: hero decisions on every street', () => {
    const situations = generateSituations(80, DEFAULT_SEED);
    const streets = new Set(situations.map((s) => s.obs.street));
    expect([...streets].sort()).toEqual(['flop', 'preflop', 'river', 'turn']);
    for (const s of situations) {
      expect(s.obs.seat).toBe(0);
      expect(s.obs.legal.seat).toBe(0);
      expect(s.f.eRandom).toBeGreaterThanOrEqual(0);
      expect(s.f.eRandom).toBeLessThanOrEqual(1);
    }
    // Every decision has an action that its reasons explain and that is legal.
    const rng = rngFromSeed(DEFAULT_SEED);
    for (const s of situations.slice(0, 20)) {
      for (const d of candidateDecisions(s, rng)) {
        const a = d.action;
        const legal = s.obs.legal;
        const ok =
          a.type === 'fold'
            ? legal.canFold
            : a.type === 'check'
              ? legal.canCheck
              : a.type === 'call'
                ? legal.canCall
                : (legal[a.type]?.min ?? Infinity) <= a.to && a.to <= (legal[a.type]?.max ?? -1);
        expect(ok).toBe(true);
      }
    }
  }, 30_000);
});

describe('failing fixtures: templates', () => {
  const cases: ReadonlyArray<[string, Record<string, unknown>, RegExp]> = [
    [
      'a sentence of 16 words',
      { NUTS: 'You have the best possible hand right now, so you should make the pot very big.' },
      /NUTS: a sentence of 16 words/,
    ],
    [
      'a missing placeholder',
      { VALUE_RAISE: 'You likely have the best hand. Raise to win more.' },
      /VALUE_RAISE: missing \{size\}/,
    ],
    [
      'an unused placeholder',
      { NUTS: 'You have the best possible hand: {E}%.' },
      /NUTS: unused \{E\}/,
    ],
    [
      'a glossary link the code does not declare and the glossary does not know',
      { NUTS: 'You have the {g:mortal nuts}.' },
      /links \{g:mortal nuts\}, not declared[\s\S]*\{g:mortal nuts\} is not in the glossary/,
    ],
    [
      'a declared glossary key that is not linked',
      { SET_MINING: 'Small {g:pocket pair}. Call to try for a set. You hit about 1 time in 8.' },
      /SET_MINING: declares \{g:set\}, not linked/,
    ],
    ['a decimal number', { NUTS: 'You have the best hand 99.5 times in 100.' }, /a decimal number/],
    ['a stray brace', { NUTS: 'You have the best hand }.' }, /a stray brace/],
    [
      'a plural count that is not a value',
      { FOLD_RANGE: { count: 'players', one: '{hand} {behind}.', other: '{hand} {behind}.' } },
      /plural count \{players\}/,
    ],
    ['a template no code uses', { HELLO: 'Hello.' }, /HELLO: a template that no code uses/],
    ['a missing template', { NUTS: undefined }, /NUTS: no template/],
  ];

  it.each(cases)('%s', (_name, changes, problem) => {
    const problems = checkTemplates(withTemplates(changes));
    expect(problems.join('\n')).toMatch(problem);
  });
});

describe('failing fixtures: glossary', () => {
  const real: readonly GlossaryEntry[] = en.glossary;
  it('a missing key, a key defined twice, an unknown key, a long definition', () => {
    const without = real.filter((g) => g.term !== 'set');
    expect(checkGlossary(without)).toContain('glossary: no entry for "set"');
    const twice = [...real, { term: 'set', definition: 'Again.' }];
    expect(checkGlossary(twice)).toContain('glossary: "set" is defined twice');
    const extra = [...real, { term: 'donk bet', definition: 'A bet into the raiser.' }];
    expect(checkGlossary(extra).join()).toMatch(/"donk bet" is not in GLOSSARY_KEYS/);
    const long = real.map((g) =>
      g.term === 'pot'
        ? {
            ...g,
            definition:
              'All of the chips that every player has bet into the middle so far during this one hand.',
          }
        : g,
    );
    expect(checkGlossary(long).join()).toMatch(/glossary "pot": a sentence of 18 words/);
  });
});

/** A heads-up flop spot facing 40 into 80 (need 25%). */
const SPOT: ExplainInput = {
  action: { type: 'call' },
  trace: [{ code: 'CALL_PROFITABLE', data: {} }],
  confidence: 'normal',
  alt: null,
  eRandom: 0.4,
  eRange: 0.4,
  need: 0.25,
  pot: 120,
  winPot: 120,
  toCall: 40,
  bb: 20,
  legal: {
    seat: 0,
    toCall: 40,
    callAmount: 40,
    callIsAllIn: false,
    canFold: true,
    canCheck: false,
    canCall: true,
    bet: null,
    raise: { min: 80, max: 2000 },
  },
  street: 'flop',
  facing: 'bet',
  position: 'IP',
  nOpp: 1,
  k: 0,
  rankPct: 20,
  handName: 'Pair of Kings',
  handCategory: 'pair',
  preflopName: 'King-Queen suited',
  draws: [],
  outs: 0,
  villain: 'bets',
};

describe('failing fixtures: lines and hints', () => {
  const good = explain(SPOT);
  const pct = (value: number) => ({ kind: 'pct' as const, value });

  it('the passing hint', () => {
    expect(checkHint(good, SPOT)).toEqual([]);
  });

  it('a line with a missing value, an unused value, wrong or unknown glossary keys', () => {
    const line = good.reasons[0] as Line;
    const rest = Object.fromEntries(Object.entries(line.params).filter(([k]) => k !== 'toCall'));
    expect(checkLine({ ...line, params: rest }).join()).toMatch(
      /no value for \{toCall\}[\s\S]*does not render/,
    );
    expect(checkLine({ ...line, params: { ...line.params, extra: pct(1) } }).join()).toMatch(
      /unused value \{extra\}/,
    );
    expect(checkLine({ ...line, glossary: ['outs'] }).join()).toMatch(
      /glossary keys \[outs\], template \[\]/,
    );
    const set = sampleLine('SET_MINING');
    expect(checkLine({ ...set, glossary: ['pocket pair', 'flopzilla' as 'set'] }).join()).toMatch(
      /unknown glossary key "flopzilla"/,
    );
  });

  it('a line whose rendering leaves a brace or has a sentence over 15 words', () => {
    const strings = withTemplates({ NUTS: 'You have the best hand }.' });
    expect(checkLine({ key: 'NUTS', params: {}, glossary: [] }, strings).join()).toMatch(
      /unresolved placeholder in "You have the best hand }\."/,
    );
    const long = withTemplates({
      NUTS: 'You have one two three four five six seven eight nine ten eleven twelve thirteen fourteen.',
    });
    expect(checkLine({ key: 'NUTS', params: {}, glossary: [] }, long).join()).toMatch(
      /a sentence of 16 words/,
    );
  });

  const tamper = (change: (e: Explanation) => Explanation): string[] =>
    checkHint(change(structuredClone(good)), SPOT);

  it('a numbers line without the HUD win chance', () => {
    expect(
      tamper((e) => ({
        ...e,
        numbers: { ...e.numbers, params: { ...e.numbers.params, eRandom: pct(41) } },
      })).join(),
    ).toMatch(/lacks the HUD's 40%/);
  });

  it('equities 5+ points apart without RANGE_ADJUST first, or RANGE_ADJUST later', () => {
    const apart = { ...SPOT, eRandom: 0.62, eRange: 0.35 };
    const e = explain(apart);
    expect(checkHint(e, apart)).toEqual([]);
    const dropped = { ...e, reasons: e.reasons.slice(1) };
    expect(checkHint(dropped, apart).join()).toMatch(
      /differ by 5\+ points, but RANGE_ADJUST does not come first/,
    );
    const moved = { ...e, reasons: [...e.reasons].reverse() };
    expect(checkHint(moved, apart).join()).toMatch(/RANGE_ADJUST is not the first reason/);
    const wrong = {
      ...e,
      reasons: [
        {
          ...(e.reasons[0] as Line),
          params: { ...(e.reasons[0] as Line).params, eRange: pct(30) },
        },
        ...e.reasons.slice(1),
      ],
    };
    expect(checkHint(wrong, apart).join()).toMatch(/does not show both 62% and 35%/);
  });

  it('a price sentence that contradicts its numbers, a false "close", a bare range number', () => {
    const swap = (params: Record<string, ReturnType<typeof pct>>, key?: Line['key']) =>
      tamper((e) => ({
        ...e,
        reasons: [
          {
            ...(e.reasons[0] as Line),
            ...(key ? { key } : {}),
            params: { ...(e.reasons[0] as Line).params, ...params },
          },
        ],
      })).join();
    expect(swap({ E: pct(20) })).toMatch(/CALL_PROFITABLE: .* contradicts its numbers/);
    expect(swap({ E: pct(40) }, 'CALL_PROFITABLE.close')).toMatch(
      /says "close", but 40% and 25% are not/,
    );
    expect(swap({ E: pct(43) })).toMatch(/shows 43% with no label, not the HUD's 40%/);
    const realise = tamper((e) => ({
      ...e,
      reasons: [{ key: 'FOLD_PRICE.realise', params: { E: pct(20), need: pct(25) }, glossary: [] }],
    }));
    expect(realise.join()).toMatch(/20% is below 25%/);
  });

  it('a headline that is not the action, and a false "Why not fold?"', () => {
    expect(
      tamper((e) => ({
        ...e,
        headline: { key: 'headline.fold', params: {}, glossary: [] },
      })).join(),
    ).toMatch(/headline headline.fold does not match the action/);
    const low = {
      ...SPOT,
      eRandom: 0.2,
      eRange: 0.2,
      trace: [{ code: 'COMMITTED' as const, data: {} }],
    };
    const e = explain(low);
    const forced = { ...e, whyNot: [{ key: 'WHY_NOT_FOLD' as const, params: {}, glossary: [] }] };
    expect(checkHint(forced, low).join()).toMatch(
      /WHY_NOT_FOLD is shown but the win chance does not beat the price/,
    );
  });
});

describe('the command line', () => {
  it('passes on the real copy and prints a sample when asked', () => {
    const run = spawnSync(process.execPath, [SCRIPT, '--situations', '30', '--print', '2'], {
      encoding: 'utf8',
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/check-copy: .* 30 situations, \d+ hints/);
    expect(run.stdout).toMatch(/Win (\d+|<1|>99)%/);
    expect(run.stdout).toMatch(/check-copy: OK/);
  }, 60_000);

  it('rejects bad arguments with exit code 2', () => {
    const run = spawnSync(process.execPath, [SCRIPT, '--situations', 'many'], { encoding: 'utf8' });
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/usage/);
  }, 30_000);
});
