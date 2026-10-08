/**
 * Coach explanations (PLAN §8.10, Appendix F.1, F.5; chunk 5.6): every reason code renders, the
 * numbers rules (the HUD's eRandom in every hint as a whole number; RANGE_ADJUST when the two
 * equities differ by 5 points or more; `{E}` per F.1), the consistency variants, the "Why not …?"
 * lines for every recommended action, the main-reason choice and the F.5 plumbing.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  explain,
  explainInput,
  feedbackLine,
  isAllIn,
  shownPct,
  TEMPLATE_KEYS,
  templateSpec,
  villainAction,
  type ExplainInput,
  type Explanation,
  type Line,
  type VillainAction,
} from '../../src/brain/explain.ts';
import { coachSeed, features, showsRangeAdjust } from '../../src/brain/features.ts';
import type { Reason, ReasonCode } from '../../src/brain/types.ts';
import type { LegalActions, Observation, PlayerAction } from '../../src/engine/types.ts';
import { hintText, lineText, pctText } from '../../src/i18n/coach.ts';
import { en } from '../../src/i18n/en.ts';
import { checkHint } from '../../scripts/copy-rules.ts';
import { bet, call, check, raise } from '../engine/play.ts';
import { FC_SEED } from '../engine/helpers.ts';
import { observeSpot, playSpot, testProfile } from './fixtures.ts';

const FACING: LegalActions = {
  seat: 0,
  toCall: 40,
  callAmount: 40,
  callIsAllIn: false,
  canFold: true,
  canCheck: false,
  canCall: true,
  bet: null,
  raise: { min: 80, max: 2000 },
};
const FREE: LegalActions = {
  seat: 0,
  toCall: 0,
  callAmount: 0,
  callIsAllIn: false,
  canFold: false,
  canCheck: true,
  canCall: false,
  bet: { min: 20, max: 2000 },
  raise: null,
};
/** The big blind's option before the flop: check, or raise (no "bet" before the flop). */
const OPTION: LegalActions = { ...FREE, bet: null, raise: { min: 40, max: 2000 } };

/** A heads-up flop spot facing a bet of 40 into 80 (need 25%), with everything overridable. */
function input(over: Partial<ExplainInput> = {}): ExplainInput {
  return {
    action: { type: 'call' },
    trace: [],
    confidence: 'normal',
    alt: null,
    eRandom: 0.4,
    eRange: 0.4,
    need: 0.25,
    pot: 120,
    winPot: 120,
    toCall: 40,
    bb: 20,
    legal: FACING,
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
    ...over,
  };
}

/** The same spot checked to the hero (nothing to call). */
const free = (over: Partial<ExplainInput> = {}): ExplainInput =>
  input({ legal: FREE, toCall: 0, need: 0, facing: 'none', ...over });

/** Before the flop, unopened (the button with 2 players behind, need 40% to call the blind). */
const preflop = (over: Partial<ExplainInput> = {}): ExplainInput =>
  input({
    street: 'preflop',
    facing: 'none',
    k: 2,
    pot: 30,
    winPot: 30,
    toCall: 20,
    need: 0.4,
    villain: null,
    handName: 'King-Queen suited',
    handCategory: 'highCard',
    ...over,
  });

const r = (code: ReasonCode, data: Reason['data'] = {}): Reason => ({ code, data });
const text = (e: Explanation): string => hintText(e).join('\n');
const keys = (lines: readonly Line[]): string[] => lines.map((l) => l.key);
const reasonText = (e: Explanation): string => e.reasons.map((l) => lineText(l)).join(' ');
const RAISE_TO = (to: number): PlayerAction => ({ type: 'raise', to });
const BET_TO = (to: number): PlayerAction => ({ type: 'bet', to });

describe('every reason code renders (Appendix F.1)', () => {
  const cases: ReadonlyArray<[ReasonCode, ExplainInput, string]> = [
    [
      'OPEN_RANGE',
      preflop({ action: RAISE_TO(50), trace: [r('OPEN_RANGE', { openPct: 43 })] }),
      'King-Queen suited is in the top 20% of starting hands. 2 players act after you. Play about the top 43% here. Raise to 50 (2.5 BB).',
    ],
    [
      'FOLD_RANGE',
      preflop({ action: { type: 'fold' }, trace: [r('FOLD_RANGE', { openPct: 43 })] }),
      'King-Queen suited is not strong enough here. 2 players act after you. Folding saves chips.',
    ],
    [
      'ISOLATE',
      preflop({ facing: 'limpers', action: RAISE_TO(60), trace: [r('ISOLATE')] }),
      'Players only called. Raise to 60 (3 BB) to play against fewer players.',
    ],
    [
      'CHECK_FREE',
      preflop({
        legal: OPTION,
        toCall: 0,
        need: 0,
        action: { type: 'check' },
        trace: [r('CHECK_FREE')],
      }),
      'Checking costs nothing. Never fold when you can check.',
    ],
    [
      'THREE_BET_VALUE',
      preflop({
        facing: 'open',
        action: RAISE_TO(180),
        trace: [r('THREE_BET_VALUE', { E: 0.61 })],
      }),
      'Your King-Queen suited beats most hands that raise here (about 61%). Re-raise to 180 (9 BB).',
    ],
    [
      'FOUR_BET_VALUE',
      preflop({ facing: '3bet', action: RAISE_TO(500), trace: [r('FOUR_BET_VALUE', { E: 0.6 })] }),
      'Your King-Queen suited is ahead of most re-raising hands. Raise again to 500 (25 BB).',
    ],
    [
      'CALL_PREFLOP',
      preflop({
        facing: 'open',
        need: 0.3,
        action: { type: 'call' },
        trace: [r('CALL_PREFLOP', { E: 0.45 })],
      }),
      'You win about 45% against their likely hands. You need 30%. Calling is fine.',
    ],
    [
      'FOLD_VS_RAISE',
      preflop({
        facing: 'open',
        action: { type: 'fold' },
        trace: [r('FOLD_VS_RAISE', { E: 0.3 })],
      }),
      'They raised, so they likely have a good hand. King-Queen suited wins only about 30% against it.',
    ],
    [
      'SET_MINING',
      preflop({ facing: 'open', action: { type: 'call' }, trace: [r('SET_MINING')] }),
      'Small pocket pair. Call to try for a set. You hit about 1 time in 8. Then you can win a big pot.',
    ],
    [
      'CALL_PROFITABLE',
      input({ trace: [r('CALL_PROFITABLE')] }),
      'You win about 40%. You need 25% to call 40 into 120. 40% is more than 25%, so calling wins over time.',
    ],
    [
      'FOLD_PRICE',
      input({ eRandom: 0.2, eRange: 0.2, action: { type: 'fold' }, trace: [r('FOLD_PRICE')] }),
      'You need 25% to call. You win only about 20%. Folding saves chips.',
    ],
    [
      'IMPLIED',
      input({
        eRandom: 0.2,
        eRange: 0.2,
        trace: [r('IMPLIED', { needImplied: 0.16, draw: 'flush' })],
      }),
      'The price alone needs 25%. If you hit your flush draw, you can win more later. About 16% is enough.',
    ],
    [
      'VALUE_BET',
      free({ eRandom: 0.8, eRange: 0.8, action: BET_TO(80), trace: [r('VALUE_BET')] }),
      'Your Pair of Kings is probably best (about 80%). Bet 80 (4 BB). Worse hands like smaller pairs can pay you.',
    ],
    [
      'VALUE_RAISE',
      input({ eRandom: 0.8, eRange: 0.8, action: RAISE_TO(160), trace: [r('VALUE_RAISE')] }),
      'You likely have the best hand. Raise to 160 (8 BB) to win more.',
    ],
    [
      'RAISE_PROTECT',
      input({ eRandom: 0.7, eRange: 0.7, action: RAISE_TO(160), trace: [r('RAISE_PROTECT')] }),
      'Strong, but this board has many draws. Raise now so draws pay to continue.',
    ],
    [
      'THIN_VALUE',
      free({ eRandom: 0.6, eRange: 0.6, action: BET_TO(40), trace: [r('THIN_VALUE')] }),
      'Your Pair of Kings is a bit better than their calling hands. A small bet of 40 (2 BB) wins more.',
    ],
    [
      'POT_CONTROL',
      free({ action: { type: 'check' }, trace: [r('POT_CONTROL')] }),
      'Medium hand (Pair of Kings). Check. Better hands would call a bet. Worse hands would fold.',
    ],
    [
      'SEMI_BLUFF',
      free({
        eRandom: 0.36,
        eRange: 0.36,
        action: BET_TO(60),
        draws: [{ kind: 'flush', outs: 9 }],
        outs: 9,
        trace: [r('SEMI_BLUFF', { draw: 'flush' })],
      }),
      'Flush draw: 9 outs. You hit about 19% next card and 35% by the river. Betting can win now or later.',
    ],
    [
      'CBET_DRY',
      free({ eRandom: 0.3, eRange: 0.3, action: BET_TO(40), trace: [r('CBET_DRY')] }),
      'You raised before the flop. This board likely missed them. A small bet of 40 (2 BB) often wins.',
    ],
    [
      'CHECK_WEAK',
      free({ eRandom: 0.2, eRange: 0.2, action: { type: 'check' }, trace: [r('CHECK_WEAK')] }),
      'You have little now. Check and see the next card for free.',
    ],
    [
      'PUSH_FOLD',
      preflop({
        action: RAISE_TO(2000),
        trace: [r('PUSH_FOLD', { action: 'allin', S: 8, Pfold: 0.4, E: 0.45 })],
      }),
      'Only 8 big blinds left: go all-in or fold. They fold about 40%. If called, you still win about 45%.',
    ],
    [
      'CALL_ALLIN',
      input({ facing: 'allin', trace: [r('CALL_ALLIN', { E: 0.4 })] }),
      'You need 25% to call. You win about 40% against hands that go all-in here. Call.',
    ],
    [
      'FOLD_ALLIN',
      input({ facing: 'allin', action: { type: 'fold' }, trace: [r('FOLD_ALLIN', { E: 0.2 })] }),
      'You need 25% to call. Against hands that go all-in here, you win only about 20%. Fold.',
    ],
    [
      'COMMITTED',
      input({ trace: [r('COMMITTED')] }),
      'The pot is big compared to your chips. With Pair of Kings, folding gives up too much.',
    ],
    [
      'NUTS',
      free({ eRandom: 0.99, eRange: 0.99, action: BET_TO(90), trace: [r('NUTS')] }),
      'You have the best possible hand. Make the pot big.',
    ],
    [
      'BOARD_PLAYS',
      input({ action: { type: 'fold' }, eRandom: 0.1, eRange: 0.1, trace: [r('BOARD_PLAYS')] }),
      "Your cards don't help. The board is your hand, and everyone shares it.",
    ],
    [
      'GUARDRAIL',
      input({
        eRandom: 0.96,
        eRange: 0.96,
        trace: [r('GUARDRAIL', { rule: 2, detail: 'tooStrongToFold' })],
      }),
      'This decision is clear. Your hand is too strong to fold.',
    ],
  ];

  it.each(cases)('%s', (code, spot, sentence) => {
    const e = explain(spot);
    expect(e.trace.map((x) => x.code)).toContain(code);
    expect(reasonText(e)).toContain(sentence);
    expect(checkHint(e, spot)).toEqual([]);
  });

  it('covers every policy code of Appendix A.5 (the derived ones have their own tests)', () => {
    const derived: ReasonCode[] = [
      'RANGE_ADJUST',
      'WHY_NOT_FOLD',
      'WHY_NOT_CHECK',
      'WHY_NOT_CALL',
      'WHY_NOT_BET',
      'WHY_NOT_RAISE',
      'CLOSE_SPOT',
      'RULE_2_4',
      'RULE_2_4_BIG',
    ];
    const all = TEMPLATE_KEYS.filter((k) => /^[A-Z_0-9]+$/.test(k) && k !== 'FALLBACK');
    expect([...cases.map(([code]) => code), ...derived].sort()).toEqual([...all].sort());
  });

  it('the {detail} of every guardrail (F.1)', () => {
    const details: ReadonlyArray<[string, PlayerAction, string]> = [
      ['checkFree', { type: 'check' }, 'Checking is free.'],
      ['tooStrongToFold', { type: 'call' }, 'Your hand is too strong to fold.'],
      ['riverNoChance', { type: 'fold' }, 'You almost never win here.'],
      ['allInPriceGood', { type: 'call' }, 'The price is too good to fold.'],
      ['allInPriceBad', { type: 'fold' }, 'You win too rarely to call.'],
    ];
    for (const [detail, action, sentence] of details) {
      const legal = action.type === 'check' ? FREE : FACING;
      const e = explain(input({ action, legal, trace: [r('GUARDRAIL', { rule: 1, detail })] }));
      expect(reasonText(e)).toBe(`This decision is clear. ${sentence}`);
    }
  });

  it('RULE_2_4 and RULE_2_4_BIG for a big draw on the flop; only RULE_2_4 on the turn', () => {
    const draw = {
      draws: [
        { kind: 'oesd' as const, outs: 8 },
        { kind: 'flush' as const, outs: 9 },
      ],
      outs: 15,
    };
    const flop = explain(input({ ...draw, trace: [r('CALL_PROFITABLE')] }));
    expect(keys(flop.trick)).toEqual(['RULE_2_4', 'RULE_2_4_BIG']);
    expect(lineText(flop.trick[0] as Line)).toBe(
      'Quick trick: outs × 2 ≈ % for the next card. Outs × 4 ≈ % by the river. Exact: 54%.',
    );
    expect(lineText(flop.trick[1] as Line)).toBe('The trick guesses too high for big draws.');
    const turn = explain(input({ ...draw, street: 'turn', trace: [r('CALL_PROFITABLE')] }));
    expect(keys(turn.trick)).toEqual(['RULE_2_4']);
    expect(lineText(turn.trick[0] as Line)).toContain('Exact: 33%.');
    // No draw (only backdoor draws, or no outs): no trick; never on the river.
    const backdoor = { draws: [{ kind: 'backdoorFlush' as const, outs: 0 }], outs: 3 };
    expect(explain(input({ ...backdoor, trace: [r('CALL_PROFITABLE')] })).trick).toEqual([]);
    expect(
      explain(input({ ...draw, street: 'river', trace: [r('CALL_PROFITABLE')] })).trick,
    ).toEqual([]);
  });

  it('CLOSE_SPOT names the alternative headline in chips only (F.1 {alt})', () => {
    const alts: ReadonlyArray<[PlayerAction, LegalActions, string]> = [
      [{ type: 'fold' }, FACING, 'Close call: Fold is also fine.'],
      [{ type: 'call' }, FACING, 'Close call: Call 40 is also fine.'],
      [
        { type: 'call' },
        { ...FACING, callIsAllIn: true },
        'Close call: Call all-in 40 is also fine.',
      ],
      [RAISE_TO(120), FACING, 'Close call: Raise to 120 is also fine.'],
      [RAISE_TO(2000), FACING, 'Close call: All-in 2,000 is also fine.'],
      [BET_TO(1200), FREE, 'Close call: Bet 1,200 is also fine.'],
      [{ type: 'check' }, FREE, 'Close call: Check is also fine.'],
    ];
    for (const [alt, legal, sentence] of alts) {
      const action: PlayerAction =
        alt.type === 'check'
          ? BET_TO(40)
          : alt.type === 'fold'
            ? { type: 'call' }
            : { type: 'fold' };
      const e = explain(input({ legal, action, alt, confidence: 'close', trace: [] }));
      expect(e.close === null ? null : lineText(e.close)).toBe(sentence);
    }
    // Not close, or the alternative is the recommendation itself: no line.
    expect(explain(input({ alt: { type: 'fold' }, confidence: 'normal' })).close).toBeNull();
    expect(explain(input({ alt: { type: 'call' }, confidence: 'close' })).close).toBeNull();
  });
});

describe("the HUD's eRandom in every hint, as a whole number (C9, §8.10, Stage 5 acceptance 7)", () => {
  const VILLAINS: (VillainAction | null)[] = [
    null,
    'betsBig',
    'bets',
    'raises',
    'reRaises',
    'allIn',
    'calls',
  ];
  type Pick = [ReasonCode, PlayerAction, Partial<ExplainInput>];
  const FREE_CODES: readonly Pick[] = [
    ['VALUE_BET', BET_TO(60), {}],
    ['THIN_VALUE', BET_TO(40), {}],
    ['POT_CONTROL', { type: 'check' }, {}],
    ['CHECK_WEAK', { type: 'check' }, {}],
    ['SEMI_BLUFF', BET_TO(60), {}],
  ];
  const chance = fc.double({ min: 0, max: 1, noNaN: true });
  /**
   * A decision as the policies make it (§8.5): a call on price only when `eRange·R` beats the
   * price, else a fold or an implied-odds call; facing an all-in, call when `eRange ≥ need`
   * (R = 1, §8.4); the codes that do not compare the price, at any numbers.
   */
  const spotArb = fc
    .record({
      eRandom: chance,
      eRange: chance,
      need: fc.double({ min: 0.01, max: 0.9, noNaN: true }),
      facing: fc.boolean(),
      codeIndex: fc.nat(),
      villain: fc.constantFrom(...VILLAINS),
      street: fc.constantFrom('flop' as const, 'turn' as const, 'river' as const),
      position: fc.constantFrom('IP' as const, 'OOP' as const),
      nOpp: fc.integer({ min: 1, max: 4 }),
      category: fc.constantFrom('highCard' as const, 'pair' as const, 'flush' as const),
      close: fc.boolean(),
    })
    .map((x): ExplainInput => {
      const R =
        x.street === 'river' || x.position === 'IP'
          ? 1
          : (x.street === 'flop' ? 0.85 : 0.92) - (x.nOpp > 1 ? 0.05 : 0);
      const allin: Partial<ExplainInput> = { facing: 'allin' };
      const facing: Pick[] = [
        ['COMMITTED', { type: 'call' }, {}],
        ['VALUE_RAISE', RAISE_TO(160), {}],
        ['BOARD_PLAYS', { type: 'fold' }, {}],
        x.eRange >= x.need
          ? ['CALL_ALLIN', { type: 'call' }, allin]
          : ['FOLD_ALLIN', { type: 'fold' }, allin],
        ...(x.eRange * R > x.need
          ? ([['CALL_PROFITABLE', { type: 'call' }, {}]] as Pick[])
          : ([
              ['FOLD_PRICE', { type: 'fold' }, {}],
              ['IMPLIED', { type: 'call' }, {}],
            ] as Pick[])),
      ];
      const codes = x.facing ? facing : FREE_CODES;
      const [code, action, extra] = codes[x.codeIndex % codes.length] as Pick;
      const data: Reason['data'] = { E: x.eRange, needImplied: (x.eRange * R) / 2, draw: 'flush' };
      const draws = x.street === 'river' ? [] : [{ kind: 'flush' as const, outs: 9 }];
      return input({
        ...(x.facing ? { need: x.need } : { legal: FREE, toCall: 0, need: 0, facing: 'none' }),
        eRandom: x.eRandom,
        eRange: x.eRange,
        villain: x.villain,
        street: x.street,
        position: x.position,
        nOpp: x.nOpp,
        handCategory: x.category,
        draws,
        outs: draws.length > 0 ? 9 : 0,
        action,
        trace: [r(code, data)],
        confidence: x.close ? 'close' : 'normal',
        alt: x.close ? { type: action.type === 'check' ? 'check' : 'fold' } : null,
        ...extra,
      });
    });

  it('every hint passes check-copy: numbers line, RANGE_ADJUST, no contradiction (2,000 runs)', () => {
    fc.assert(
      fc.property(spotArb, (spot) => {
        const e = explain(spot);
        expect(checkHint(e, spot)).toEqual([]);
        const hud = `${pctText(100 * spot.eRandom)}%`;
        expect(hud).toMatch(/^(\d{1,3}|<1|>99)%$/);
        expect(lineText(e.numbers)).toContain(`Win ${hud}`);
        expect(text(e)).toContain(hud);
      }),
      { numRuns: 2000, seed: FC_SEED },
    );
  });

  it('the numbers line: free, facing a bet, and short of the bet ("Pot you can win")', () => {
    expect(lineText(explain(free({ action: { type: 'check' } })).numbers)).toBe(
      'Win 40% · Pot 120',
    );
    expect(lineText(explain(input()).numbers)).toBe('Win 40% · Need 25% · Pot 120 · To call 40');
    // The §0.3 example: 50 each in, the villain bets 500 more, the hero has 50 left.
    const short = input({
      pot: 600,
      winPot: 150,
      toCall: 50,
      need: 0.25,
      eRandom: 0.3,
      eRange: 0.3,
    });
    expect(lineText(explain(short).numbers)).toBe(
      'Win 30% · Need 25% · Pot you can win 150 · To call 50',
    );
  });

  it('chances at the ends read as the HUD shows them ("<1%", ">99%", exact 0% and 100%)', () => {
    const at = (eRandom: number): string =>
      lineText(explain(free({ eRandom, eRange: eRandom, action: { type: 'check' } })).numbers);
    expect(at(0)).toBe('Win 0% · Pot 120');
    expect(at(0.004)).toBe('Win <1% · Pot 120');
    expect(at(0.996)).toBe('Win >99% · Pot 120');
    expect(at(1)).toBe('Win 100% · Pot 120');
  });
});

describe('RANGE_ADJUST (§8.10): both equities, labelled, when they differ by 5 points or more', () => {
  it('the F.1 wording, with what the villain did (every {actionDescription})', () => {
    const words: Record<VillainAction, string> = {
      betsBig: 'bets big',
      bets: 'bets',
      raises: 'raises',
      reRaises: 're-raises',
      allIn: 'goes all-in',
      calls: 'calls',
    };
    for (const [villain, said] of Object.entries(words) as [VillainAction, string][]) {
      const e = explain(
        input({ eRandom: 0.62, eRange: 0.35, villain, trace: [r('CALL_PROFITABLE')] }),
      );
      expect(e.reasons[0]?.key).toBe('RANGE_ADJUST');
      expect(lineText(e.reasons[0] as Line)).toBe(
        `Against any cards you win 62%. This player ${said} only with good hands. Against those, you win about 35%.`,
      );
    }
  });

  it('after RANGE_ADJUST, {E} is the range number; the numbers line keeps eRandom', () => {
    const e = explain(input({ eRandom: 0.62, eRange: 0.35, trace: [r('CALL_PROFITABLE')] }));
    expect(lineText(e.reasons[1] as Line)).toContain('You win about 35%.');
    expect(lineText(e.numbers)).toContain('Win 62%');
    expect(e.shown).toEqual({ eRandom: 0.62, eRange: 0.35, win: 0.35, need: 0.25 });
  });

  it('a higher range number says the hands are likely weaker; unknown villain: both, plainly', () => {
    const weaker = explain(input({ eRandom: 0.4, eRange: 0.52, trace: [r('CALL_PROFITABLE')] }));
    expect(lineText(weaker.reasons[0] as Line)).toBe(
      'Against any cards you win 40%. How they played makes strong hands less likely. Against their likely hands, you win about 52%.',
    );
    const plain = explain(
      input({ eRandom: 0.62, eRange: 0.35, villain: null, trace: [r('CALL_PROFITABLE')] }),
    );
    expect(lineText(plain.reasons[0] as Line)).toBe(
      'Against any cards you win 62%. Against their likely hands, you win about 35%.',
    );
  });

  it('not shown when the gap is under 5 points and the price is not between the two', () => {
    const e = explain(input({ eRandom: 0.42, eRange: 0.39, trace: [r('CALL_PROFITABLE')] }));
    expect(keys(e.reasons)).toEqual(['CALL_PROFITABLE']);
    expect(e.shown.eRange).toBeNull();
    expect(lineText(e.reasons[0] as Line)).toContain('You win about 42%.');
  });

  it('shown when the price lies strictly between the two rounded numbers, even 2 points apart', () => {
    const spot = input({
      eRandom: 0.27,
      eRange: 0.25,
      need: 0.26,
      trace: [r('FOLD_PRICE')],
      action: { type: 'fold' },
    });
    expect(showsRangeAdjust(0.27, 0.25, 0.26)).toBe(true);
    const e = explain(spot);
    expect(e.reasons[0]?.key).toBe('RANGE_ADJUST');
    expect(lineText(e.reasons[1] as Line)).toBe(
      'You need 26% to call. You win only about 25%. Folding saves chips.',
    );
  });

  it('shown when eRandom would contradict a price sentence that the range number supports', () => {
    // §8.10's rule misses this one: need 25.01 is above both rounded numbers (21, 25), and the
    // call was made on 25.49%. With 21% the text would say "You win 21%, you need 25%: call".
    const spot = input({
      eRandom: 0.21,
      eRange: 0.2549,
      need: 0.2501,
      trace: [r('CALL_PROFITABLE')],
    });
    expect(showsRangeAdjust(0.21, 0.2549, 0.2501)).toBe(false);
    const e = explain(spot);
    expect(e.reasons[0]?.key).toBe('RANGE_ADJUST.weaker');
    // 25% against 25%: "more than" would be false, so it is the close variant.
    expect(lineText(e.reasons[1] as Line)).toBe(
      'You win about 25%. You need 25% to call 40 into 120. It is close, but calling is a little better.',
    );
    expect(checkHint(e, spot)).toEqual([]);
    // A tie with eRandom is no contradiction: no RANGE_ADJUST, the close variant with the HUD's 25%.
    const tie = explain(
      input({ eRandom: 0.251, eRange: 0.2549, need: 0.2501, trace: [r('CALL_PROFITABLE')] }),
    );
    expect(keys(tie.reasons)).toEqual(['CALL_PROFITABLE.close']);
  });

  it("a range code's own number is the hint's range number; the decision's eRange still triggers it", () => {
    // FOLD_VS_RAISE compared 30% against the raiser; the decision's eRange (all opponents) is 20%.
    const e = explain(
      preflop({
        facing: 'open',
        eRandom: 0.33,
        eRange: 0.2,
        action: { type: 'fold' },
        trace: [r('FOLD_VS_RAISE', { E: 0.3 })],
      }),
    );
    expect(keys(e.reasons)).toEqual(['RANGE_ADJUST.plain', 'FOLD_VS_RAISE']);
    expect(lineText(e.reasons[0] as Line)).toBe(
      'Against any cards you win 33%. Against their likely hands, you win about 30%.',
    );
    expect(lineText(e.reasons[1] as Line)).toContain('wins only about 30% against it');
  });

  it('PUSH_FOLD keeps its own "if called" number and does not label the range', () => {
    const e = explain(
      preflop({
        eRandom: 0.5,
        eRange: 0.5,
        action: RAISE_TO(2000),
        trace: [r('PUSH_FOLD', { action: 'allin', S: 6, Pfold: 0.5, E: 0.38 })],
      }),
    );
    expect(keys(e.reasons)).toEqual(['PUSH_FOLD']);
    expect(lineText(e.reasons[0] as Line)).toContain('If called, you still win about 38%.');
  });

  it('property: equities 5+ points apart always put RANGE_ADJUST first, with both numbers', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0.01, max: 0.9, noNaN: true }),
        (eRandom, eRange, need) => {
          fc.pre(Math.abs(eRandom - eRange) >= 0.05);
          const e = explain(input({ eRandom, eRange, need, trace: [r('COMMITTED')] }));
          expect(e.reasons[0]?.key.startsWith('RANGE_ADJUST')).toBe(true);
          const said = lineText(e.reasons[0] as Line);
          expect(said).toContain(`Against any cards you win ${pctText(100 * eRandom)}%.`);
          expect(said).toContain(`${pctText(100 * eRange)}%.`);
        },
      ),
      { numRuns: 2000, seed: FC_SEED },
    );
  });
});

describe('"Why not …?" for every recommended action (§8.10 hint structure 4)', () => {
  const cases: ReadonlyArray<[string, ExplainInput, string[]]> = [
    [
      'fold facing a bet: call (the price) and raise',
      input({ eRandom: 0.2, eRange: 0.2, action: { type: 'fold' }, trace: [r('FOLD_PRICE')] }),
      ['WHY_NOT_CALL', 'WHY_NOT_RAISE'],
    ],
    [
      'fold before the flop, unopened: raise only (a limp is never advice)',
      preflop({ eRandom: 0.2, eRange: 0.2, action: { type: 'fold' }, trace: [r('FOLD_RANGE')] }),
      ['WHY_NOT_RAISE'],
    ],
    [
      'check after the flop: bet',
      free({ action: { type: 'check' }, trace: [r('POT_CONTROL')] }),
      ['WHY_NOT_BET'],
    ],
    [
      "check in the big blind's option: raise",
      preflop({
        legal: OPTION,
        toCall: 0,
        need: 0,
        action: { type: 'check' },
        trace: [r('CHECK_FREE')],
      }),
      ['WHY_NOT_RAISE'],
    ],
    [
      'call: fold (the price is good) and raise',
      input({ trace: [r('CALL_PROFITABLE')] }),
      ['WHY_NOT_FOLD', 'WHY_NOT_RAISE'],
    ],
    [
      'bet for value: check',
      free({ eRandom: 0.8, eRange: 0.8, action: BET_TO(60), trace: [r('VALUE_BET')] }),
      ['WHY_NOT_CHECK'],
    ],
    [
      'semi-bluff: no "free card" line (it is not a value bet)',
      free({
        eRandom: 0.35,
        eRange: 0.35,
        action: BET_TO(60),
        trace: [r('SEMI_BLUFF')],
        outs: 9,
        draws: [{ kind: 'flush', outs: 9 }],
      }),
      [],
    ],
    [
      'raise for value: fold (call is not worse on price)',
      input({ eRandom: 0.8, eRange: 0.8, action: RAISE_TO(160), trace: [r('VALUE_RAISE')] }),
      ['WHY_NOT_FOLD'],
    ],
    [
      'all-in raise, short stack: fold (never "Why not call?" in push/fold)',
      input({
        street: 'preflop',
        facing: 'open',
        eRandom: 0.45,
        eRange: 0.45,
        need: 0.3,
        action: RAISE_TO(2000),
        trace: [r('PUSH_FOLD', { action: 'allin', S: 9, Pfold: 0.3, E: 0.42 })],
      }),
      ['WHY_NOT_FOLD'],
    ],
    [
      'all-in bet: check',
      free({ eRandom: 0.9, eRange: 0.9, action: BET_TO(2000), trace: [r('VALUE_BET')] }),
      ['WHY_NOT_CHECK'],
    ],
    [
      'call all-in: fold',
      input({
        legal: { ...FACING, callIsAllIn: true, raise: null },
        facing: 'allin',
        trace: [r('CALL_ALLIN', { E: 0.4 })],
      }),
      ['WHY_NOT_FOLD'],
    ],
  ];

  it.each(cases)('%s', (_name, spot, expected) => {
    const e = explain(spot);
    expect(keys(e.whyNot)).toEqual(expected);
    expect(checkHint(e, spot)).toEqual([]);
  });

  it('every WHY_NOT code appears, with its F.1 sentence', () => {
    const seen = new Map<string, string>();
    for (const [, spot] of cases) {
      for (const l of explain(spot).whyNot) seen.set(l.key, lineText(l));
    }
    expect(Object.fromEntries(seen)).toEqual({
      WHY_NOT_FOLD: 'Why not fold? You win more often than you need to.',
      WHY_NOT_CHECK: 'Why not check? Worse hands would get a free card.',
      WHY_NOT_CALL: 'Why not call? You need 25%, and you win about 20%.',
      WHY_NOT_BET: 'Why not bet? Better hands call, and worse hands fold.',
      WHY_NOT_RAISE: 'Why not raise? Worse hands fold, and better hands call.',
    });
  });

  it('only when true: no "Why not fold?" unless the win chance beats the price', () => {
    const e = explain(input({ eRandom: 0.2, eRange: 0.2, trace: [r('COMMITTED')] }));
    expect(keys(e.whyNot)).toEqual(['WHY_NOT_RAISE']);
    const call = explain(
      input({
        eRandom: 0.3,
        eRange: 0.3,
        action: { type: 'fold' },
        trace: [r('FOLD_VS_RAISE', { E: 0.3 })],
      }),
    );
    expect(keys(call.whyNot)).toEqual(['WHY_NOT_RAISE']);
  });

  it('the close alternative gets the "Close call" line instead of its "Why not"', () => {
    const e = explain(
      input({ trace: [r('CALL_PROFITABLE')], confidence: 'close', alt: { type: 'fold' } }),
    );
    expect(keys(e.whyNot)).toEqual(['WHY_NOT_RAISE']);
    expect(e.close === null ? '' : lineText(e.close)).toBe('Close call: Fold is also fine.');
    expect(e.trace.map((x) => x.code)).toEqual(['CALL_PROFITABLE', 'WHY_NOT_RAISE', 'CLOSE_SPOT']);
  });
});

describe('the main reason fits the final action', () => {
  it('a guardrail that changed the action replaces the policy reason it overruled', () => {
    const e = explain(
      input({
        eRandom: 0.97,
        eRange: 0.97,
        trace: [
          r('FOLD_PRICE', { E: 0.2 }),
          r('GUARDRAIL', { rule: 2, detail: 'tooStrongToFold' }),
        ],
      }),
    );
    expect(keys(e.reasons)).toEqual(['GUARDRAIL']);
    expect(text(e)).not.toContain('Folding saves chips');
  });

  it('two reasons that both fit are shown, main first (a committed all-in raise)', () => {
    const e = explain(
      input({
        eRandom: 0.8,
        eRange: 0.8,
        action: RAISE_TO(2000),
        trace: [r('VALUE_RAISE'), r('COMMITTED')],
      }),
    );
    expect(keys(e.reasons)).toEqual(['VALUE_RAISE', 'COMMITTED']);
    expect(lineText(e.headline)).toBe('All-in 2,000 (100 BB)');
  });

  it('reasons for other actions, unusable data and derived codes are dropped; none left: FALLBACK', () => {
    const e = explain(
      input({
        trace: [
          r('FOLD_PRICE'),
          r('OPEN_RANGE'),
          r('GUARDRAIL', { rule: 9, detail: 'nonsense' }),
          r('RANGE_ADJUST'),
          r('WHY_NOT_FOLD'),
          r('PUSH_FOLD', { action: 'allin', S: 8 }),
          r('IMPLIED', {}),
        ],
      }),
    );
    expect(keys(e.reasons)).toEqual(['FALLBACK']);
    expect(lineText(e.reasons[0] as Line)).toBe('This move wins the most chips over time.');
    expect(e.trace.filter((x) => !x.code.startsWith('WHY_NOT'))).toEqual([]);
  });

  it('PUSH_FOLD "allin" fits an all-in call; "fold" fits a fold', () => {
    const data = { S: 5, Pfold: 0.2, E: 0.4 };
    const callAllIn = explain(
      input({
        legal: { ...FACING, callIsAllIn: true, raise: null },
        trace: [r('PUSH_FOLD', { action: 'allin', ...data })],
      }),
    );
    expect(keys(callAllIn.reasons)).toEqual(['PUSH_FOLD']);
    expect(lineText(callAllIn.headline)).toBe('Call all-in 40');
    const fold = explain(
      input({ action: { type: 'fold' }, trace: [r('PUSH_FOLD', { action: 'fold', ...data })] }),
    );
    expect(keys(fold.reasons)).toEqual(['PUSH_FOLD.fold']);
    expect(lineText(fold.reasons[0] as Line)).toBe(
      'Only 5 big blinds left: go all-in or fold. They fold only about 20%. If called, you win only about 40%.',
    );
  });
});

describe('consistency: a sentence never contradicts the numbers it shows', () => {
  it('CALL_PROFITABLE: "more than" only when the whole numbers say so', () => {
    const e = explain(
      input({ eRandom: 0.252, eRange: 0.252, need: 0.249, trace: [r('CALL_PROFITABLE')] }),
    );
    expect(keys(e.reasons)).toEqual(['CALL_PROFITABLE.close']);
    expect(lineText(e.reasons[0] as Line)).toBe(
      'You win about 25%. You need 25% to call 40 into 120. It is close, but calling is a little better.',
    );
  });

  it('FOLD_PRICE out of position: you win more than you need, but later bets cost you', () => {
    const e = explain(
      input({
        eRandom: 0.3,
        eRange: 0.3,
        position: 'OOP',
        action: { type: 'fold' },
        trace: [r('FOLD_PRICE')],
      }),
    );
    expect(keys(e.reasons)).toEqual(['FOLD_PRICE.realise']);
    expect(lineText(e.reasons[0] as Line)).toBe(
      'You need 25% to call. You win about 30% if you see every card. Later bets can make you fold before that. Folding saves chips.',
    );
    expect(keys(e.whyNot)).toEqual(['WHY_NOT_RAISE']);
  });

  it('FOLD_PRICE on the river with equal numbers: close', () => {
    const e = explain(
      input({
        eRandom: 0.249,
        eRange: 0.249,
        need: 0.251,
        street: 'river',
        action: { type: 'fold' },
        trace: [r('FOLD_PRICE')],
      }),
    );
    expect(keys(e.reasons)).toEqual(['FOLD_PRICE.close']);
  });

  it('CALL_ALLIN and FOLD_ALLIN against their own numbers', () => {
    const calls = explain(
      input({ need: 0.3, facing: 'allin', trace: [r('CALL_ALLIN', { E: 0.28 })] }),
    );
    expect(calls.reasons.map((l) => l.key)).toContain('CALL_ALLIN.close');
    const folds = explain(
      input({ facing: 'allin', action: { type: 'fold' }, trace: [r('FOLD_ALLIN', { E: 0.27 })] }),
    );
    expect(folds.reasons.map((l) => l.key)).toContain('FOLD_ALLIN.close');
  });

  it('CALL_PREFLOP below the price: implied odds for a pocket pair, else close', () => {
    const pair = explain(
      preflop({
        facing: 'open',
        need: 0.38,
        trace: [r('CALL_PREFLOP', { E: 0.33, implied: 40 })],
        action: { type: 'call' },
      }),
    );
    expect(lineText(pair.reasons.at(-1) as Line)).toBe(
      'You win about 33% against their likely hands. You need 38%. If you make a set, you can win a big pot.',
    );
    expect(pair.reasons.at(-1)?.glossary).toEqual(['set']);
    const other = explain(
      preflop({
        facing: 'open',
        need: 0.38,
        trace: [r('CALL_PREFLOP', { E: 0.33 })],
        action: { type: 'call' },
      }),
    );
    expect(other.reasons.at(-1)?.key).toBe('CALL_PREFLOP.close');
  });

  it('VALUE_BET: an example by category; "strong against n players" when under 50%', () => {
    const bet = (over: Partial<ExplainInput>): string =>
      reasonText(
        explain(
          free({ eRandom: 0.8, eRange: 0.8, action: BET_TO(60), trace: [r('VALUE_BET')], ...over }),
        ),
      );
    expect(bet({ handCategory: 'twoPair' })).toContain('Worse hands like one pair can pay you.');
    expect(bet({ handCategory: 'trips' })).toContain('like one pair and two pair');
    expect(bet({ handCategory: 'straight' })).toContain('like two pair and sets');
    expect(bet({ handCategory: 'flush' })).toContain('like straights and sets');
    expect(bet({ handCategory: 'quads' })).toContain('like flushes and straights');
    expect(bet({ handCategory: 'highCard', handName: 'Ace-high' })).toBe(
      'Your Ace-high is probably best (about 80%). Bet 60 (3 BB).',
    );
    expect(bet({ nOpp: 2, eRandom: 0.45, eRange: 0.45 })).toBe(
      'Your Pair of Kings is strong against 2 players (about 45%). Bet 60 (3 BB). Worse hands like smaller pairs can pay you.',
    );
    expect(
      bet({ nOpp: 3, eRandom: 0.4, eRange: 0.4, handCategory: 'highCard', handName: 'Ace-high' }),
    ).toBe('Your Ace-high is strong against 3 players (about 40%). Bet 60 (3 BB).');
  });

  it('SEMI_BLUFF on the turn has one chance; a missing draw name says "draw"', () => {
    const turn = explain(
      free({
        street: 'turn',
        eRandom: 0.3,
        eRange: 0.3,
        action: BET_TO(60),
        draws: [{ kind: 'oesd', outs: 8 }],
        outs: 8,
        trace: [r('SEMI_BLUFF', { draw: '' })],
      }),
    );
    expect(lineText(turn.reasons[0] as Line)).toBe(
      'Open-ended straight draw: 8 outs. You hit about 17% on the river. Betting can win now or later.',
    );
    const noName = explain(
      free({ eRandom: 0.3, eRange: 0.3, action: BET_TO(60), outs: 9, trace: [r('SEMI_BLUFF')] }),
    );
    expect(lineText(noName.reasons[0] as Line)).toMatch(/^Draw: 9 outs\. /);
  });

  it('singular forms: 1 player behind, 1 big blind left', () => {
    const one = explain(preflop({ k: 1, action: { type: 'fold' }, trace: [r('FOLD_RANGE')] }));
    expect(lineText(one.reasons[0] as Line)).toContain('1 player acts after you.');
    const open = explain(
      preflop({ k: 1, action: RAISE_TO(50), trace: [r('OPEN_RANGE', { openPct: 40 })] }),
    );
    expect(lineText(open.reasons[0] as Line)).toContain('1 player acts after you.');
    const push = explain(
      preflop({
        action: RAISE_TO(2000),
        trace: [r('PUSH_FOLD', { action: 'allin', S: 1, Pfold: 0.1, E: 0.4 })],
      }),
    );
    expect(lineText(push.reasons[0] as Line)).toContain(
      'Only 1 big blind left: go all-in or fold.',
    );
  });

  it('the starting-hand percentile rounds up (AA is "top 1%"), and the headline sizes', () => {
    const aces = explain(
      preflop({
        rankPct: 0.45,
        preflopName: 'Pocket Aces',
        action: RAISE_TO(50),
        trace: [r('OPEN_RANGE', { openPct: 17 })],
      }),
    );
    expect(lineText(aces.reasons[0] as Line)).toContain(
      'Pocket Aces is in the top 1% of starting hands.',
    );
    expect(lineText(aces.headline)).toBe('Raise to 50 (2.5 BB)');
    expect(lineText(explain(input()).headline)).toBe('Call 40');
    expect(lineText(explain(input({ action: { type: 'fold' } })).headline)).toBe('Fold');
    expect(lineText(explain(free({ action: { type: 'check' } })).headline)).toBe('Check');
    expect(lineText(explain(free({ action: BET_TO(1250) })).headline)).toBe('Bet 1,250 (62.5 BB)');
  });
});

describe('isAllIn', () => {
  it('a bet or raise to the maximum, or an all-in call', () => {
    expect(isAllIn(RAISE_TO(2000), FACING)).toBe(true);
    expect(isAllIn(RAISE_TO(1999), FACING)).toBe(false);
    expect(isAllIn(BET_TO(2000), FREE)).toBe(true);
    expect(isAllIn({ type: 'call' }, { ...FACING, callIsAllIn: true })).toBe(true);
    expect(isAllIn({ type: 'call' }, FACING)).toBe(false);
    expect(isAllIn({ type: 'fold' }, FACING)).toBe(false);
  });
});

describe('villainAction (F.1 {actionDescription}) from real observations', () => {
  // Heads-up, button 1: seat 1 is the small blind and acts first before the flop; the hero (seat
  // 0) is the big blind and acts first after it. Blinds 50/100.
  const spot = (
    inputs: Parameters<typeof playSpot>[0]['inputs'],
    stacks = [20000, 20000],
  ): Observation => observeSpot(playSpot({ stacks, button: 1, inputs }), 0);

  it('nothing voluntary yet: null; a limp: calls; an open: raises; a 4-bet: re-raises', () => {
    expect(
      villainAction(observeSpot(playSpot({ stacks: [20000, 20000], button: 0, inputs: [] }), 0)),
    ).toBeNull();
    expect(villainAction(spot([call(1)]))).toBe('calls');
    expect(villainAction(spot([raise(1, 300)]))).toBe('raises');
    expect(villainAction(spot([raise(1, 300), raise(0, 900), raise(1, 2700)]))).toBe('reRaises');
  });

  it('after the flop: bets, bets big (⅔ pot or more), raises, re-raises, goes all-in', () => {
    const flop = [raise(1, 300), call(0)]; // pot 600, the hero acts first on the flop
    expect(villainAction(spot([...flop, check(0), bet(1, 300)]))).toBe('bets');
    expect(villainAction(spot([...flop, check(0), bet(1, 400)]))).toBe('betsBig');
    expect(villainAction(spot([...flop, bet(0, 100), raise(1, 200)]))).toBe('raises');
    expect(
      villainAction(spot([...flop, bet(0, 100), raise(1, 200), raise(0, 300), raise(1, 400)])),
    ).toBe('reRaises');
    expect(villainAction(spot([...flop, check(0), bet(1, 19700)]))).toBe('allIn');
  });

  it("a folded opponent's actions are skipped", () => {
    const obs = spot([raise(1, 300)]);
    expect(villainAction({ ...obs, folded: obs.folded.map((_, s) => s === 1) })).toBeNull();
  });
});

describe('explainInput from a real observation and its features', () => {
  it('the E13 shape: a turn shove into the hero, who has top pair top kicker', () => {
    const h = playSpot({
      stacks: [5500, 5500],
      button: 0,
      holes: { 0: 'As Kd', 1: '9c 9d' },
      board: 'Kh 8c 4d 2s 7h',
      inputs: [raise(0, 300), call(1), check(1), bet(0, 1200), call(1), bet(1, 4000)],
    });
    const obs = observeSpot(h, 0);
    const f = features(obs, testProfile('reweight+stats', 400, 'coach'), coachSeed(obs), 0.86);
    const d = {
      action: { type: 'call' } as PlayerAction,
      trace: [r('COMMITTED', { handName: f.handInfo.name, E: f.eRange, need: f.need })],
      confidence: 'clear' as const,
      alt: null,
      eRandom: f.eRandom,
      eRange: f.eRange,
      need: f.need,
    };
    const spotInput = explainInput(obs, f, d);
    expect(spotInput).toMatchObject({
      pot: 7000,
      winPot: 7000,
      toCall: 4000,
      bb: 100,
      street: 'turn',
      facing: 'allin',
      villain: 'allIn',
      preflopName: 'Ace-King offsuit',
      handName: f.handInfo.name,
      handCategory: 'pair',
    });
    const e = explain(spotInput);
    expect(lineText(e.headline)).toBe('Call all-in 4,000');
    expect(lineText(e.numbers)).toContain(`Win ${pctText(86)}%`);
    expect(keys(e.reasons).at(-1)).toBe('COMMITTED');
    expect(checkHint(e, spotInput)).toEqual([]);
  });
});

/**
 * Stage 5 acceptance 7 on the Appendix E spots that exercise RANGE_ADJUST, with the coach's range
 * settings (4,000 trials) and the HUD's own number: the hint shows `eRandom` as a whole number,
 * and RANGE_ADJUST whenever the two equities differ by 5 points or more. The main reason is the
 * one Appendix E expects (chunk 5.7 runs the same checks on `hint()` for all 18 spots).
 */
describe('Appendix E spots E9, E13, E16 (Stage 5 acceptance 7)', () => {
  const COACH = testProfile('reweight+stats', 4000, 'coach');
  const spots: ReadonlyArray<[string, () => Observation, PlayerAction, ReasonCode]> = [
    [
      'E9: A♥K♥ on Q♥7♥2♣ facing 2 bb into 6 bb: call',
      () =>
        observeSpot(
          playSpot({
            stacks: [10000, 10000],
            button: 0,
            holes: { 0: 'Ah Kh' },
            board: 'Qh 7h 2c',
            inputs: [raise(0, 300), call(1), bet(1, 200)],
          }),
          0,
        ),
      { type: 'call' },
      'CALL_PROFITABLE',
    ],
    [
      'E13: A♠K♦ on K♥8♣4♦2♠, villain all-in 40 bb: call (COMMITTED)',
      () =>
        observeSpot(
          playSpot({
            stacks: [5500, 5500],
            button: 0,
            holes: { 0: 'As Kd' },
            board: 'Kh 8c 4d 2s',
            inputs: [raise(0, 300), call(1), check(1), bet(0, 1200), call(1), bet(1, 4000)],
          }),
          0,
        ),
      { type: 'call' },
      'COMMITTED',
    ],
    [
      'E16: 5♥4♥ on A♠K♦9♣2♠J♦, a visible Rock bets pot: fold (FOLD_PRICE)',
      () =>
        observeSpot(
          playSpot({
            stacks: [10000, 10000],
            button: 0,
            holes: { 1: '5h 4h' },
            board: 'As Kd 9c 2s Jd',
            inputs: [
              raise(0, 300),
              call(1),
              check(1),
              bet(0, 200),
              call(1),
              check(1),
              bet(0, 500),
              call(1),
              check(1),
              bet(0, 2000),
            ],
          }),
          1,
          { labels: ['rock', null], levels: ['medium', 'medium'] },
        ),
      { type: 'fold' },
      'FOLD_PRICE',
    ],
  ];

  it.each(spots)(
    '%s',
    (_name, spot, action, code) => {
      const obs = spot();
      const f = features(obs, COACH, coachSeed(obs));
      const trace = [r(code, { handName: f.handInfo.name, E: f.eRange, need: f.need })];
      const d = { action, trace, confidence: 'normal' as const, alt: null };
      const input = explainInput(obs, f, {
        ...d,
        eRandom: f.eRandom,
        eRange: f.eRange,
        need: f.need,
      });
      const e = explain(input);
      const said = text(e);
      expect(said).toContain(`${pctText(100 * f.eRandom)}%`);
      expect(pctText(100 * f.eRandom)).toMatch(/^\d{1,3}$/);
      const differ = Math.abs(f.eRange - f.eRandom) >= 0.05;
      expect(e.reasons[0]?.key.startsWith('RANGE_ADJUST')).toBe(differ || f.rangeAdjust);
      if (differ) expect(said).toContain(`Against any cards you win ${pctText(100 * f.eRandom)}%.`);
      expect(e.trace.map((x) => x.code)).toContain(code);
      expect(checkHint(e, input)).toEqual([]);
    },
    20_000,
  );
});

describe('feedback rows (Appendix F.5): the template plumbing', () => {
  const cases: ReadonlyArray<[Parameters<typeof feedbackLine>[0], string]> = [
    [
      { row: 'foldedPrice', E: 0.4, need: 0.25, rangeAdjust: false },
      'You folded with a 40% win chance. You needed only 25% to call.',
    ],
    [
      { row: 'foldedPrice', E: 0.4, need: 0.25, rangeAdjust: true },
      'You folded with a 40% win chance against their likely hands. You needed only 25% to call.',
    ],
    [
      { row: 'calledPrice', E: 0.2, need: 0.25, rangeAdjust: true },
      'You called with a 20% win chance against their likely hands. You needed 25%. Calling loses chips over time.',
    ],
    [
      { row: 'calledPrice', E: 0.2, need: 0.25, rangeAdjust: false },
      'You called with a 20% win chance. You needed 25%. Calling loses chips over time.',
    ],
    [
      { row: 'checkedStrong' },
      'You checked a very strong hand. Betting wins more from worse hands.',
    ],
    [
      { row: 'airMultiway', players: 3 },
      'You bet with almost nothing into 3 players. Someone usually calls.',
    ],
    [{ row: 'airHeadsUp' }, 'This bet rarely makes better hands fold. Checking was cheaper.'],
    [
      { row: 'size', tooBig: true, to: 120, bb: 20 },
      'Good idea, but the size was too big. Coach: 120 (6 BB).',
    ],
    [
      { row: 'size', tooBig: false, to: 50, bb: 20 },
      'Good idea, but the size was too small. Coach: 50 (2.5 BB).',
    ],
    [
      { row: 'openLoose', hand: 'Seven-Two offsuit' },
      'Seven-Two offsuit is too weak to play from here. Most players fold it.',
    ],
    [
      { row: 'foldedStrong', hand: 'Ace-King suited', rankPct: 3.2 },
      'Ace-King suited is in the top 4% of hands. It is strong enough to play.',
    ],
    [
      { row: 'pushFold', S: 8, hand: 'Ace-Five offsuit', move: 'allin' },
      'With 8 big blinds, Ace-Five offsuit should go all-in.',
    ],
    [
      { row: 'pushFold', S: 1, hand: 'Nine-Four offsuit', move: 'fold' },
      'With 1 big blind, Nine-Four offsuit should fold.',
    ],
    [
      { row: 'fallback', alt: { type: 'call' }, legal: FACING, toCall: 40, bb: 20 },
      "The coach's move wins more chips here: Call 40.",
    ],
  ];
  it.each(cases)('%o', (row, sentence) => {
    expect(lineText(feedbackLine(row))).toBe(sentence);
  });
});

describe('TEMPLATES and en.coach.templates', () => {
  it('every key has a template and every template a key', () => {
    expect(Object.keys(en.coach.templates).sort()).toEqual([...TEMPLATE_KEYS].sort());
  });

  it('the shown whole number of a chance', () => {
    expect([shownPct(0.004), shownPct(0.005), shownPct(0.62), shownPct(0.995)]).toEqual([
      0, 1, 62, 100,
    ]);
    expect(templateSpec('CLOSE_SPOT').params).toEqual(['alt']);
  });
});
