/**
 * The action bar view model (PLAN §12.7) and its amount maths, driven by real engine states: the
 * UI never computes a bound itself, and every amount it can send must be one `step` accepts
 * (PLAN §0.3, Known pitfalls 1, 18, 19).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { randInt, rngFromSeed } from '../../src/core/rng.ts';
import { legalActions } from '../../src/engine/legal.ts';
import { step } from '../../src/engine/step.ts';
import type { HandState, LegalActions, PlayerAction } from '../../src/engine/types.ts';
import { en } from '../../src/i18n/en.ts';
import {
  actionBarView,
  amountAt,
  amountFieldText,
  formatAmount,
  formatBigBlinds,
  formatChips,
  indexOfAmount,
  parseAmount,
  priceOf,
  sliderValueText,
  snapAmount,
  snapToPreset,
  stepAmount,
  stepCount,
  trayAction,
  trayActionLabel,
  winPot,
  type ActionBarInput,
  type ActionBarView,
  type AmountUnit,
  type SeatChips,
  type TrayView,
} from '../../src/ui/actionBar.ts';
import { ACTION_SPOTS } from '../../src/ui/dev/actionFixtures.ts';
import { deal, FC_SEED, tableWith } from '../engine/helpers.ts';
import {
  ADVANCE,
  bet,
  call,
  check,
  fold,
  handArb,
  play,
  raise,
  randomInput,
} from '../engine/play.ts';

/** The bar's input for the seat to act in `h`, as the Table screen will build it. */
function inputOf(h: HandState, amounts: AmountUnit = 'chips'): ActionBarInput {
  return {
    legal: legalActions(h),
    street: h.street,
    currentBet: h.currentBet,
    sb: h.sb,
    bb: h.bb,
    seats: h.seats,
    amounts,
  };
}

const viewOf = (h: HandState, amounts: AmountUnit = 'chips'): ActionBarView =>
  actionBarView(inputOf(h, amounts));

const trayOf = (v: ActionBarView): TrayView => {
  if (v.tray === null) throw new Error('no tray');
  return v.tray;
};

const presetsOf = (v: ActionBarView) =>
  trayOf(v).presets.map((p) => ({ id: p.id, amount: p.amount, enabled: p.enabled }));

interface Blinds {
  readonly sb: number;
  readonly bb: number;
  readonly startingStack: number;
}
const BLINDS: Blinds = { sb: 10, bb: 20, startingStack: 2000 };

/** Three players, the hero on the button: the hero acts first preflop, last after the flop. */
const threeHanded = (stacks: [number, number, number] = [2000, 2000, 2000]): HandState =>
  deal(tableWith(stacks, { ...BLINDS, button: 0 }));

/** Heads-up, the hero on the button (the small blind): first preflop, second after the flop. */
const headsUp = (hero: number, villain = 2000, blinds = BLINDS): HandState =>
  deal(tableWith([hero, villain], { ...blinds, button: 0 }));

/** 3-handed, everyone limps preflop (pot 60); on the flop the small blind (seat 1) acts first. */
const flop3 = (heroStack = 2000): HandState =>
  play(threeHanded([heroStack, 2000, 2000]), call(0), call(1), check(2), ADVANCE);

/** The flop above, both blinds check to the hero. */
const checkedToHeroOnFlop = (heroStack = 2000): HandState =>
  play(flop3(heroStack), check(1), check(2));

/** The flop above: the small blind bets 40, the big blind folds; the hero faces 40 (pot 100). */
const facingFlopBet = (): HandState => play(flop3(), bet(1, 40), fold(2));

describe('actionBarView: the §12.7 table', () => {
  it('no bet to face: Fold disabled with its reason, Check, Bet ▲ opens the tray', () => {
    const v = viewOf(checkedToHeroOnFlop());
    expect(v.waiting).toBe(false);
    expect(v.fold).toEqual({
      label: 'Fold',
      enabled: false,
      action: null,
      note: en.actions.foldNotNeeded,
    });
    expect(v.fold.note).toBe('Checking is free. No need to fold.');
    expect(v.middle).toMatchObject({
      label: 'Check',
      enabled: true,
      action: { type: 'check' },
      sub: null,
    });
    expect(v.right).toMatchObject({ label: 'Bet', enabled: true, action: null, opensTray: true });
    expect(trayOf(v)).toMatchObject({ kind: 'bet', min: 20, max: 1980 });
    expect(v.price).toBeNull();
  });

  it('facing a bet: Fold, Call 40, Raise ▲', () => {
    const v = viewOf(facingFlopBet());
    expect(v.fold).toEqual({ label: 'Fold', enabled: true, action: { type: 'fold' }, note: null });
    expect(v.middle).toMatchObject({ label: 'Call 40', action: { type: 'call' }, sub: null });
    expect(v.right).toMatchObject({ label: 'Raise', enabled: true, opensTray: true });
    expect(trayOf(v)).toMatchObject({ kind: 'raise', min: 80, max: 1980 });
  });

  it('a call that puts the hero all-in: "Call all-in 50", no right button', () => {
    // §0.3: 50 each in, the villain bets 500 more, the hero has 50 left.
    const blinds = { sb: 25, bb: 50, startingStack: 2000 };
    let h = play(headsUp(100, 2000, blinds), call(0), check(1), ADVANCE);
    h = play(h, bet(1, 500));
    const v = viewOf(h);
    expect(v.middle.label).toBe('Call all-in 50');
    expect(v.middle.action).toEqual({ type: 'call' });
    expect(v.right).toBeNull();
    expect(v.tray).toBeNull();
    expect(v.fold.enabled).toBe(true);
  });

  it('raise not reopened by a short all-in: Raise disabled, and it says why', () => {
    // Hero raises to 60 (a raise of 40); the big blind's all-in to 90 adds only 30.
    let h = threeHanded([2000, 2000, 90]);
    h = play(h, raise(0, 60), call(1), raise(2, 90));
    const legal = legalActions(h) as LegalActions;
    expect(legal.seat).toBe(0);
    expect(legal.raise).toBeNull();
    const v = viewOf(h);
    expect(v.middle.label).toBe('Call 30');
    expect(v.right).toEqual({
      label: 'Raise',
      enabled: false,
      action: null,
      note: en.actions.cannotRaise,
      opensTray: false,
    });
    expect(v.right?.note).toBe(
      "You can't raise here: the all-in was too small to reopen the betting.",
    );
    expect(v.tray).toBeNull();
  });

  it('nobody left to raise against (the only opponent is all-in): no right button', () => {
    const h = play(headsUp(2000, 300), raise(0, 60), raise(1, 300));
    const v = viewOf(h);
    expect(v.middle.label).toBe('Call 240');
    expect(v.right).toBeNull();
  });

  it('only one legal raise (all-in): "All-in 130" acts on one tap, no tray', () => {
    let h = play(headsUp(150), call(0), check(1), ADVANCE);
    h = play(h, bet(1, 100));
    const v = viewOf(h);
    expect(legalActions(h)?.raise).toEqual({ min: 130, max: 130 });
    expect(v.right).toEqual({
      label: 'All-in 130',
      enabled: true,
      action: { type: 'raise', to: 130 },
      note: null,
      opensTray: false,
    });
    expect(v.tray).toBeNull();
  });

  it('only one legal bet (a stack below the big blind): "All-in 15" bets it', () => {
    let h = play(headsUp(35), call(0), check(1), ADVANCE);
    h = play(h, check(1));
    const v = viewOf(h);
    expect(v.right).toMatchObject({ label: 'All-in 15', action: { type: 'bet', to: 15 } });
    expect(v.tray).toBeNull();
  });

  it("not the hero's turn: everything disabled, the middle says Waiting…", () => {
    const v = actionBarView({ ...inputOf(checkedToHeroOnFlop()), legal: null });
    expect(v.waiting).toBe(true);
    expect(v.fold).toMatchObject({ enabled: false, action: null, note: null });
    expect(v.middle).toMatchObject({ label: 'Waiting…', enabled: false, action: null });
    expect(v.right).toMatchObject({ label: 'Bet', enabled: false, opensTray: true });
    expect(v.tray).toBeNull();
    const preflop = actionBarView({ ...inputOf(threeHanded()), legal: null });
    expect(preflop.right?.label).toBe('Raise');
  });

  it("the big blind's option: Fold disabled, Check, Raise ▲ with the open sizes", () => {
    // 3-handed, button seat 1: the hero is the big blind; both others limp.
    const h = play(deal(tableWith([2000, 2000, 2000], { ...BLINDS, button: 1 })), call(1), call(2));
    const v = viewOf(h);
    expect(v.fold.enabled).toBe(false);
    expect(v.middle.label).toBe('Check');
    expect(v.right).toMatchObject({ label: 'Raise', opensTray: true });
    expect(presetsOf(v).map((p) => p.id)).toEqual(['bb25', 'bb3', 'bb4', 'allIn']);
  });

  it('amounts in big blinds (Settings "show amounts as BB")', () => {
    const v = viewOf(facingFlopBet(), 'bb');
    expect(v.middle.label).toBe('Call 2\u00A0BB');
    const t = trayOf(v);
    // Min 80 · 2.5× 100 · 3× 120 · Pot 40 + 100 + 40 = 180 · All-in 1,980.
    expect(t.presets.map((p) => p.amountText)).toEqual([
      '4\u00A0BB',
      '5\u00A0BB',
      '6\u00A0BB',
      '9\u00A0BB',
      '99\u00A0BB',
    ]);
    expect(trayActionLabel(t, 130)).toBe('Raise to 6.5\u00A0BB');
  });
});

describe('the sizing tray presets (§12.7, §8.7)', () => {
  it('postflop bet: ⅓ · ½ · ⅔ · Pot · All-in, from the pot, starting at ½ pot', () => {
    const v = viewOf(checkedToHeroOnFlop()); // pot 60
    expect(presetsOf(v)).toEqual([
      { id: 'third', amount: 20, enabled: true },
      { id: 'half', amount: 30, enabled: true },
      { id: 'twoThirds', amount: 40, enabled: true },
      { id: 'pot', amount: 60, enabled: true },
      { id: 'allIn', amount: 1980, enabled: true },
    ]);
    expect(trayOf(v).start).toBe(30);
    expect(trayOf(v).presets.map((p) => p.label)).toEqual([
      '⅓ pot',
      '½ pot',
      '⅔ pot',
      'Pot',
      'All-in',
    ]);
  });

  it('preflop open: 2.5 BB · 3 BB · 4 BB · All-in, starting at 2.5 BB', () => {
    const v = viewOf(threeHanded());
    expect(presetsOf(v)).toEqual([
      { id: 'bb25', amount: 50, enabled: true },
      { id: 'bb3', amount: 60, enabled: true },
      { id: 'bb4', amount: 80, enabled: true },
      { id: 'allIn', amount: 2000, enabled: true },
    ]);
    expect(trayOf(v).start).toBe(50);
  });

  it('raise: Min is the legal minimum; 2.5× and 3× the bet; Pot = currentBet + pot + toCall', () => {
    // Hero opens to 60, the small blind folds, the big blind 3-bets to 180.
    const h = play(threeHanded(), raise(0, 60), fold(1), raise(2, 180));
    const legal = legalActions(h) as LegalActions;
    expect(legal.raise).toEqual({ min: 300, max: 2000 });
    const v = viewOf(h);
    // pot = 60 + 10 + 180 = 250; Pot raise = 180 + 250 + 120 = 550.
    expect(presetsOf(v)).toEqual([
      { id: 'min', amount: 300, enabled: true },
      { id: 'x25', amount: 450, enabled: true },
      { id: 'x3', amount: 540, enabled: true },
      { id: 'pot', amount: 550, enabled: true },
      { id: 'allIn', amount: 2000, enabled: true },
    ]);
    expect(trayOf(v).start).toBe(450);
    expect(v.middle.label).toBe('Call 120');
  });

  it('the minimum raise comes from legalActions, also after a short all-in (never currentBet + x)', () => {
    // 5-handed, hero on the button. UTG (seat 3) raises to 60, a raise of 40; seat 4 goes all-in
    // for 90, only 30 more (not a full raise). The hero has not acted: the next legal raise is to
    // 90 + 40 = 130, not 90 + 30 = 120 or 2 × 90 (§3.6).
    const stacks = [2000, 2000, 2000, 2000, 90];
    const h = play(deal(tableWith(stacks, { ...BLINDS, button: 0 })), raise(3, 60), raise(4, 90));
    const legal = legalActions(h) as LegalActions;
    expect(legal.seat).toBe(0);
    expect(legal.raise).toEqual({ min: 130, max: 2000 });
    const t = trayOf(viewOf(h));
    expect(t.min).toBe(130);
    expect(t.presets[0]).toMatchObject({ id: 'min', amount: 130, enabled: true });
  });

  it('a short stack: presets above the stack are disabled; equal amounts merge (All-in keeps its name)', () => {
    // 45 behind on the flop, pot 60: ⅓ 20 · ½ 30 · ⅔ 40 · Pot 60 (too much) · All-in 45.
    expect(presetsOf(viewOf(checkedToHeroOnFlop(65)))).toEqual([
      { id: 'third', amount: 20, enabled: true },
      { id: 'half', amount: 30, enabled: true },
      { id: 'twoThirds', amount: 40, enabled: true },
      { id: 'pot', amount: 60, enabled: false },
      { id: 'allIn', amount: 45, enabled: true },
    ]);
    // 60 behind: Pot (60) and All-in (60) are one chip, named All-in, where Pot was.
    const merged = viewOf(checkedToHeroOnFlop(80));
    expect(presetsOf(merged)).toEqual([
      { id: 'third', amount: 20, enabled: true },
      { id: 'half', amount: 30, enabled: true },
      { id: 'twoThirds', amount: 40, enabled: true },
      { id: 'allIn', amount: 60, enabled: true },
    ]);
  });

  it('a preset below the minimum bet is disabled, and the start is clamped', () => {
    // Heads-up limp (pot 40): ⅓ pot rounds to 10, below the 20 minimum bet.
    let h = play(headsUp(2000), call(0), check(1), ADVANCE);
    h = play(h, check(1));
    const v = viewOf(h);
    expect(presetsOf(v)[0]).toEqual({ id: 'third', amount: 10, enabled: false });
    expect(trayOf(v).start).toBe(20);
    // A 2.5× target (400) above a short stack (300 in all): the start is clamped to all-in.
    const short = play(headsUp(300, 2000), raise(0, 60), raise(1, 160));
    const t = trayOf(viewOf(short));
    expect([t.min, t.max]).toEqual([260, 300]);
    expect(t.start).toBe(300);
    // 3× (480) and Pot (160 + 220 + 100 = 480) are equal, both out of range: one disabled chip.
    expect(t.presets.map((p) => [p.id, p.amount, p.enabled])).toEqual([
      ['min', 260, true],
      ['x25', 400, false],
      ['x3', 480, false],
      ['allIn', 300, true],
    ]);
  });

  it('every preset amount is a multiple of the small blind, or a bound (pitfall 19)', () => {
    const t = trayOf(viewOf(checkedToHeroOnFlop()));
    for (const p of t.presets) {
      expect(p.amount % t.sb === 0 || p.amount === t.min || p.amount === t.max).toBe(true);
    }
  });
});

describe('amounts: snapping, clamping and the slider steps (§12.7)', () => {
  // An odd minimum raise (after an odd all-in) and an odd all-in.
  const odd = { min: 57, max: 1003, sb: 10 };

  it('snapAmount: the nearest multiple of the small blind inside the bounds, or a bound', () => {
    const cases: [number, number][] = [
      [Number.NaN, 57],
      [-5, 57],
      [0, 57],
      [57, 57],
      [58, 57],
      [59, 60],
      [62, 60],
      [65, 70],
      [120, 120],
      [124.9, 120],
      [999, 1000],
      [1001, 1000],
      [1002, 1003],
      [1003, 1003],
      [5000, 1003],
    ];
    for (const [amount, snapped] of cases) expect(snapAmount(amount, odd)).toBe(snapped);
  });

  it('the slider has one step per small blind, plus the two bounds', () => {
    expect(stepCount(odd)).toBe(97); // 57, 60, 70, …, 1000, 1003
    expect(amountAt(odd, 0)).toBe(57);
    expect(amountAt(odd, 1)).toBe(60);
    expect(amountAt(odd, 95)).toBe(1000);
    expect(amountAt(odd, 96)).toBe(1003);
    expect(amountAt(odd, 500)).toBe(1003);
    expect(amountAt(odd, -3)).toBe(57);
    for (let i = 0; i < stepCount(odd); i++) {
      expect(indexOfAmount(odd, amountAt(odd, i))).toBe(i);
    }
    const even = { min: 40, max: 2000, sb: 10 };
    expect(stepCount(even)).toBe(197);
    expect(amountAt(even, 1)).toBe(50);
    const tiny = { min: 150, max: 155, sb: 10 };
    expect(stepCount(tiny)).toBe(2);
    expect([amountAt(tiny, 0), amountAt(tiny, 1)]).toEqual([150, 155]);
    // A million-chip stack is arithmetic, not a list.
    expect(stepCount({ min: 2, max: 1_000_000, sb: 1 })).toBe(999_999);
  });

  it('[−] / [+] move one step and stop at the bounds', () => {
    expect(stepAmount(odd, 57, 1)).toBe(60);
    expect(stepAmount(odd, 60, -1)).toBe(57);
    expect(stepAmount(odd, 57, -1)).toBe(57);
    expect(stepAmount(odd, 1000, 1)).toBe(1003);
    expect(stepAmount(odd, 1003, 1)).toBe(1003);
    expect(stepAmount(odd, 300, 1)).toBe(310);
  });

  it('a dragged slider snaps to an enabled preset within ±2%', () => {
    const t = trayOf(viewOf(threeHanded())); // 50 · 60 · 80 · All-in 2,000
    expect(snapToPreset(t, 81)).toBe(80); // 1.25% away
    expect(snapToPreset(t, 90)).toBe(90); // 12.5% away: no snap
    expect(snapToPreset(t, 1970)).toBe(2000); // 1.5% away
    expect(snapToPreset(t, 1950)).toBe(1950); // 2.5% away
  });

  it('a typed amount is parsed, snapped and clamped', () => {
    const t = trayOf(viewOf(threeHanded()));
    expect(parseAmount('1,234', t)).toBe(1230);
    expect(parseAmount(' 75 ', t)).toBe(80);
    expect(parseAmount('5', t)).toBe(40);
    expect(parseAmount('99999999999', t)).toBe(2000);
    expect(parseAmount('', t)).toBeNull();
    expect(parseAmount('abc', t)).toBeNull();
    const inBB = { ...t, amounts: 'bb' as const };
    expect(parseAmount('6.5', inBB)).toBe(130);
    expect(parseAmount('6,5', inBB)).toBe(130);
    expect(parseAmount('x', inBB)).toBeNull();
    expect(amountFieldText(t, 2000)).toBe('2,000');
    expect(amountFieldText(inBB, 130)).toBe('6.5');
  });

  it('the confirm label and the slider text are "to" amounts', () => {
    const t = trayOf(viewOf(threeHanded()));
    expect(trayActionLabel(t, 120)).toBe('Raise to 120');
    expect(trayActionLabel(t, 2000)).toBe('All-in 2,000');
    expect(trayAction(t, 123)).toEqual({ type: 'raise', to: 120 });
    expect(sliderValueText(t, 120)).toBe('Raise to 120, 6 big blinds');
    expect(sliderValueText(t, 50)).toBe('Raise to 50, 2.5 big blinds');
    expect(sliderValueText({ ...t, amounts: 'bb' }, 120)).toBe('Raise to 6\u00A0BB, 120 chips');
    const b = trayOf(viewOf(checkedToHeroOnFlop()));
    expect(trayActionLabel(b, 20)).toBe('Bet 20');
    expect(sliderValueText(b, 20)).toBe('Bet 20, 1 big blind');
  });

  it('formats chips with commas and big blinds with one decimal only when needed', () => {
    expect(formatChips(0)).toBe('0');
    expect(formatChips(2340)).toBe('2,340');
    expect(formatChips(1_000_000)).toBe('1,000,000');
    expect(formatBigBlinds(130, 20)).toBe('6.5');
    expect(formatBigBlinds(120, 20)).toBe('6');
    expect(formatBigBlinds(25, 20)).toBe('1.3');
    expect(formatBigBlinds(400_000, 20)).toBe('20,000');
    expect(formatAmount(50, 20, 'bb')).toBe('2.5\u00A0BB');
    expect(formatAmount(2340, 20, 'chips')).toBe('2,340');
  });
});

describe('the price and the pot you can win (§0.3, pitfall 18)', () => {
  const s = (totalBet: number, extra: Partial<SeatChips> = {}): SeatChips => ({
    dealtIn: true,
    folded: false,
    allIn: false,
    totalBet,
    ...extra,
  });

  it('§0.3 example: 50 each in, a bet of 500 more, 50 left → winPot 150, need 25% (not 8%)', () => {
    const seats = [s(50), s(550)];
    expect(winPot(seats, 0, 50)).toBe(150);
    expect(priceOf(seats, 0, 50)).toEqual({
      toCall: 50,
      pot: 600,
      winPot: 150,
      need: 0.25,
      needPercent: 25,
    });
  });

  it('the same numbers from a real hand, and the bar says "Pot you can win 150"', () => {
    const blinds = { sb: 25, bb: 50, startingStack: 2000 };
    let h = play(headsUp(100, 2000, blinds), call(0), check(1), ADVANCE);
    h = play(h, bet(1, 500));
    const v = viewOf(h);
    expect(v.price).toEqual({ toCall: 50, pot: 600, winPot: 150, need: 0.25, needPercent: 25 });
    expect(v.middle.sub).toBe('Pot you can win 150');
    expect(viewOf(h, 'bb').middle.sub).toBe('Pot you can win 3\u00A0BB');
    // The preview's fixture is the same spot.
    const fixture = actionBarView({ ...ACTION_SPOTS.shortCall, amounts: 'chips' });
    expect(fixture.price).toEqual(v.price);
    expect(fixture.middle).toEqual(v.middle);
  });

  it('when the hero covers the bet, winPot is the pot and no second line shows', () => {
    const v = viewOf(facingFlopBet());
    // pot 100 (60 + 40), call 40: need = 40 / 140.
    expect(v.price).toEqual({ toCall: 40, pot: 100, winPot: 100, need: 40 / 140, needPercent: 29 });
    expect(v.middle.sub).toBeNull();
  });

  it('folded chips can be won; a seat not dealt in adds nothing; need is 0 with nothing to call', () => {
    const seats = [s(50), s(550), s(30, { folded: true }), { ...s(0), dealtIn: false }];
    expect(winPot(seats, 0, 50)).toBe(50 + 100 + 30);
    expect(priceOf(seats, 0, 0).need).toBe(0);
  });
});

describe('the bar only ever sends what the engine accepts (property, pitfalls 1 and 19)', () => {
  /** Every action a tap on the bar or the tray can produce for this view. */
  function offered(v: ActionBarView, rng: ReturnType<typeof rngFromSeed>): PlayerAction[] {
    const out: PlayerAction[] = [];
    for (const b of [v.fold, v.middle, v.right]) {
      if (b !== null && b.enabled && b.action !== null) out.push(b.action);
    }
    const t = v.tray;
    if (t !== null) {
      const n = stepCount(t);
      const indexes = [0, 1, n - 2, n - 1, randInt(rng, n), randInt(rng, n)];
      const amounts = [
        t.start,
        ...t.presets.filter((p) => p.enabled).map((p) => p.amount),
        ...indexes.map((i) => amountAt(t, i)),
        snapAmount(randInt(rng, t.max * 2 + 1), t),
        stepAmount(t, t.start, 1),
        stepAmount(t, t.start, -1),
        parseAmount(String(randInt(rng, t.max + 50)), t) ?? t.min,
      ];
      for (const a of amounts) out.push(trayAction(t, a));
    }
    return out;
  }

  it('random legal play: every offered action and amount is legal, and the bar matches legalActions', () => {
    const seen = { decisions: 0, trays: 0, amounts: 0, shortCalls: 0 };
    fc.assert(
      fc.property(handArb, fc.boolean(), ({ h, policySeed }, inBB) => {
        const rng = rngFromSeed(policySeed);
        let s = h;
        for (let i = 0; i < 400 && s.phase !== 'complete'; i++) {
          if (s.phase === 'betting') {
            const legal = legalActions(s) as LegalActions;
            const v = viewOf(s, inBB ? 'bb' : 'chips');
            // The disabled Fold appears exactly when checking is free.
            expect(v.fold.enabled).toBe(legal.canFold);
            expect(v.fold.note !== null).toBe(legal.canCheck);
            // The tray exists exactly when a bet or raise has more than one legal amount.
            const bounds = legal.bet ?? legal.raise;
            expect(v.tray !== null).toBe(bounds !== null && bounds.min < bounds.max);
            if (v.tray !== null && bounds !== null) {
              expect([v.tray.min, v.tray.max]).toEqual([bounds.min, bounds.max]);
            }
            if (v.price !== null) {
              expect(v.price.winPot).toBeLessThanOrEqual(v.price.pot);
              expect(v.price.need).toBeGreaterThan(0);
              expect(v.price.need).toBeLessThan(1);
              if (!legal.callIsAllIn) expect(v.price.winPot).toBe(v.price.pot);
            }
            seen.decisions += 1;
            if (v.tray !== null) seen.trays += 1;
            if (v.middle.sub !== null) seen.shortCalls += 1;
            for (const action of offered(v, rng)) {
              if ((action.type === 'bet' || action.type === 'raise') && v.tray !== null) {
                const t = v.tray;
                expect(action.to % t.sb === 0 || action.to === t.min || action.to === t.max).toBe(
                  true,
                );
                seen.amounts += 1;
              }
              expect(() => step(s, { kind: 'act', seat: legal.seat, action })).not.toThrow();
            }
          }
          s = step(s, randomInput(s, rng));
        }
      }),
      { seed: FC_SEED, numRuns: 150 },
    );
    // Not vacuous (about 1,400 decisions, 1,100 trays and 17,000 amounts with the fixed seed).
    // The not-reopened row is rare here (2–8 per run), so its own test above covers it.
    expect(seen.decisions).toBeGreaterThan(1000);
    expect(seen.trays).toBeGreaterThan(300);
    expect(seen.amounts).toBeGreaterThan(5000);
    expect(seen.shortCalls).toBeGreaterThan(0);
  }, 20_000); // about 1.5 s on a CI runner; room for a slow one
});
