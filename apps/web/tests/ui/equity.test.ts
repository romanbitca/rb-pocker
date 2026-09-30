/**
 * The HUD's display rules (ui/equity.ts; PLAN §7.6, §0.3, §6.4, §6.6, §10.2, §13.2, Appendix
 * F.3, F.10): whole-number percentages that never overstate, the badge's skeleton, "~",
 * hysteresis and popover, the price chip with the capped `winPot`, the draw chip text, the "By
 * river" cells and the big-move lines. Every string also appears verbatim in docs/PLAN.md.
 */
import { describe, expect, it } from 'vitest';
import type { EquityResult } from '../../src/analysis/types.ts';
import type {
  ActionBarInputData,
  DrawChipData,
  DrawChipsData,
  WinBadgeData,
} from '../../src/app/store.ts';
import type { LegalActions, SeatState } from '../../src/engine/types.ts';
import { en } from '../../src/i18n/en.ts';
import {
  badgeView,
  bigMoveView,
  byRiverCell,
  byRiverText,
  drawChipText,
  drawChipViews,
  hysteresis,
  nextBadgeMemory,
  percentText,
  priceChipView,
  type BadgeMemory,
} from '../../src/ui/equity.ts';
import { card, cards } from '../helpers/cards.ts';

const PLAN = Object.values(
  import.meta.glob<string>('../../../../docs/PLAN.md', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
)[0] as string;

const result = (equity: number, final: boolean, extra: Partial<EquityResult> = {}) => ({
  n: 40_000,
  win: equity,
  split: 0,
  equity,
  exact: false,
  final,
  truncated: false,
  ...extra,
});

const badge = (patch: Partial<WinBadgeData> = {}): WinBadgeData => ({
  status: 'computing',
  key: 'k1',
  result: null,
  nOpp: 3,
  known: false,
  ...patch,
});

/** Feeds `results` through the hysteresis memory like the badge does; returns the texts shown. */
function shownTexts(steps: WinBadgeData[]): string[] {
  let memory: BadgeMemory | null = null;
  return steps.map((data) => {
    memory = nextBadgeMemory(memory, data);
    return badgeView(data, memory)?.text ?? '(none)';
  });
}

describe('percentages (Appendix F: whole numbers)', () => {
  it('never read 0% for a chance above 0, nor 100% for one below 100', () => {
    expect(percentText(0)).toBe('0%');
    expect(percentText(0.03)).toBe('<1%');
    expect(percentText(0.5)).toBe('1%');
    expect(percentText(61.5)).toBe('62%');
    expect(percentText(99.4)).toBe('99%');
    expect(percentText(99.7)).toBe('>99%');
    expect(percentText(100)).toBe('100%');
  });
});

describe('the win badge (§7.6)', () => {
  it('shows the "--%" skeleton before the first estimate, never "0%"', () => {
    const view = badgeView(badge(), null);
    expect(view).toMatchObject({ state: 'skeleton', text: '--%', popover: null });
    expect(view?.label).toBe(en.badge.labelComputing);
  });

  it('shows "~62%" while provisional and "62%" when final', () => {
    expect(shownTexts([badge({ result: result(0.6212, false) })])).toEqual(['~62%']);
    expect(shownTexts([badge({ status: 'done', result: result(0.6212, true) })])).toEqual(['62%']);
  });

  it('a truncated final (the 3 s cap) and a timed-out estimate keep the "~"', () => {
    const truncated = badge({ status: 'done', result: result(0.6, true, { truncated: true }) });
    expect(shownTexts([truncated])).toEqual(['~60%']);
    const late = badge({ status: 'timedOut', result: result(0.6, false) });
    expect(shownTexts([late])).toEqual(['~60%']);
  });

  it('hysteresis: while provisional the number moves only 1.0 point or more from the one shown', () => {
    const steps = [0.617, 0.624, 0.612, 0.6095, 0.6149, 0.6361].map((e) =>
      badge({ result: result(e, false) }),
    );
    // 61.7 shows 62; 62.4 and 61.2 are within 1.0 of 62; 60.95 moves to 61; 61.49 stays; 63.61 moves.
    expect(shownTexts(steps)).toEqual(['~62%', '~62%', '~62%', '~61%', '~61%', '~64%']);
    expect(hysteresis(61.7, 61.2, false)).toBe(61.7);
    expect(hysteresis(61.7, 60.95, false)).toBe(60.95);
  });

  it('always shows the final value, even within 1.0 point', () => {
    const steps = [
      badge({ result: result(0.617, false) }),
      badge({ status: 'done', result: result(0.6149, true) }),
    ];
    expect(shownTexts(steps)).toEqual(['~62%', '61%']);
  });

  it('a new situation (street or fold) starts over: skeleton, then its own first estimate', () => {
    const steps = [
      badge({ status: 'done', result: result(0.62, true) }),
      badge({ key: 'k2', result: null }),
      badge({ key: 'k2', result: result(0.7, false) }),
    ];
    expect(shownTexts(steps)).toEqual(['62%', '--%', '~70%']);
  });

  it('Folded: the word, no number, no popover', () => {
    expect(badgeView(badge({ status: 'folded' }), null)).toMatchObject({
      state: 'folded',
      text: 'Folded',
      popover: null,
    });
  });

  it('"—" with "Win chance is not available right now" when the worker failed or timed out empty', () => {
    for (const status of ['unavailable', 'timedOut'] as const) {
      const view = badgeView(badge({ status }), null);
      expect(view).toMatchObject({ state: 'none', text: '—' });
      expect(view?.popover?.unavailable).toBe('Win chance is not available right now');
    }
  });

  it('is gone when off', () => {
    expect(badgeView(badge({ status: 'off' }), null)).toBeNull();
  });

  it('the popover: wins, splits, players and deals; the explanation with the number shown', () => {
    const data = badge({
      status: 'done',
      result: result(0.62, true, { win: 0.6, split: 0.02 }),
    });
    const view = badgeView(data, nextBadgeMemory(null, data));
    expect(view?.popover?.stats).toBe(
      'Wins 60% · splits 2% · vs 3 players (any cards) · 40,000 deals',
    );
    expect(view?.popover?.how).toBe(
      "We play out the rest of the hand thousands of times, dealing the other players random cards. You won in 62% of them. We never look at the bots' real cards.",
    );
    const one = badge({ ...data, nOpp: 1 });
    expect(badgeView(one, nextBadgeMemory(null, one))?.popover?.stats).toContain('vs 1 player (');
  });

  it('known hands: the number, no random-deal popover', () => {
    const data = badge({ status: 'done', known: true, result: result(0.7, true) });
    const view = badgeView(data, nextBadgeMemory(null, data));
    expect(view?.text).toBe('70%');
    expect(view?.popover?.stats).toBeNull();
    expect(view?.popover?.how).toBeNull();
  });
});

describe('the price chip (§7.6, §0.3)', () => {
  const seat = (totalBet: number, stack: number): SeatState => ({
    dealtIn: true,
    stack,
    hole: null,
    folded: false,
    allIn: stack === 0,
    streetBet: totalBet,
    totalBet,
    lastActedAtBet: null,
  });
  const legal = (callAmount: number, toCall = callAmount): LegalActions => ({
    seat: 0,
    toCall,
    callAmount,
    callIsAllIn: callAmount < toCall,
    canFold: true,
    canCheck: false,
    canCall: true,
    bet: null,
    raise: null,
  });
  const input = (seats: SeatState[], l: LegalActions | null): ActionBarInputData => ({
    legal: l,
    street: 'flop',
    currentBet: Math.max(...seats.map((s) => s.streetBet)),
    sb: 10,
    bb: 20,
    seats,
    amounts: 'chips',
  });

  it('"Call 40 · need 20%" on two lines when facing a bet', () => {
    // Hero 60 in, villain 100 in (a bet of 40 more): pot 160, need = 40 / (160 + 40) = 20%.
    const view = priceChipView(input([seat(60, 500), seat(100, 500)], legal(40)), 'beginner');
    expect(view).toEqual({
      text: 'Call 40 · need 20%',
      call: 'Call 40',
      need: 'need 20%',
      potYouCanWin: null,
    });
  });

  it('§0.3 short all-in call: need 25% from the pot you can win (150), not 8%', () => {
    // Hero and villain have 50 each in; villain bets 500 more; hero has 50 left.
    const view = priceChipView(input([seat(50, 50), seat(550, 1000)], legal(50, 500)), 'beginner');
    expect(view?.text).toBe('Call 50 · need 25%');
    expect(view?.potYouCanWin).toBe('Pot you can win 150');
  });

  it("only at Beginner and Intermediate, on the hero's turn, facing a bet (§10.2)", () => {
    const facing = input([seat(20, 500), seat(60, 500)], legal(40));
    expect(priceChipView(facing, 'intermediate')).not.toBeNull();
    expect(priceChipView(facing, 'advanced')).toBeNull();
    expect(priceChipView(facing, 'exam')).toBeNull();
    expect(priceChipView(input([seat(20, 500), seat(60, 500)], null), 'beginner')).toBeNull();
    const check = { ...legal(0), canCall: false, canCheck: true };
    expect(priceChipView(input([seat(20, 500), seat(20, 500)], check), 'beginner')).toBeNull();
    expect(priceChipView(null, 'beginner')).toBeNull();
  });

  it('in big blinds when amounts are shown that way', () => {
    const inBb = { ...input([seat(20, 500), seat(60, 500)], legal(40)), amounts: 'bb' as const };
    expect(priceChipView(inBb, 'beginner')?.call).toBe(`Call ${en.amounts.bb('2')}`);
  });
});

describe('the draw chips (Appendix F.3, §6.4, §10.2)', () => {
  const draw = (patch: Partial<DrawChipData> = {}): DrawChipData => ({
    kind: 'flush',
    outs: 9,
    cards: cards('2♥ 3♥ 4♥ 5♥ 6♥ 8♥ 9♥ 10♥ J♥').map((c) => ({ card: c, risky: false })),
    pct: 34.97,
    when: 'byRiver',
    ...patch,
  });

  it('"{name} · {outs} outs · {pct}% {by river|next card}"', () => {
    expect(drawChipText(draw())).toBe('Flush draw · 9 outs · 35% by river');
    expect(drawChipText(draw({ kind: 'nutFlush', pct: 19.57, when: 'nextCard' }))).toBe(
      'Nut flush draw · 9 outs · 20% next card',
    );
    expect(drawChipText(draw({ kind: 'gutshot', outs: 1, cards: [], pct: 4.26 }))).toBe(
      'Gutshot straight draw · 1 out · 4% by river',
    );
  });

  it('risky outs add "(n risky)"', () => {
    const risky = draw({
      cards: [
        { card: card('2♥'), risky: true },
        ...cards('3♥ 4♥').map((c) => ({ card: c, risky: false })),
      ],
    });
    expect(drawChipText(risky)).toBe('Flush draw · 9 outs · 35% by river (1 risky)');
  });

  it('shows the exact number, not the rule of 4: 15 outs on the flop read 54%', () => {
    expect(drawChipText(draw({ kind: 'oesd', outs: 15, cards: [], pct: 54.12 }))).toBe(
      'Open-ended straight draw · 15 outs · 54% by river',
    );
  });

  it('Exam: the names only, with no out cards (§10.2)', () => {
    const data: DrawChipsData = { handSeq: 1, draws: [draw()], namesOnly: true };
    expect(drawChipViews(data)).toEqual([
      { key: 'flush', name: 'Flush draw', text: 'Flush draw', risky: 0, cards: [] },
    ]);
    expect(drawChipViews(null)).toEqual([]);
  });
});

describe('"By river" cells (§13.2)', () => {
  it('"12%", "—" for 0, "<1%" for a tiny chance, "100%" for the made hand on the river', () => {
    expect(byRiverText(12.4)).toBe('12%');
    expect(byRiverText(0)).toBe('—');
    expect(byRiverText(0.03)).toBe('<1%');
    expect(byRiverText(100)).toBe('100%');
    expect(byRiverCell(null, 'flush')).toBe('');
  });
});

describe('big-move lines (§7.6)', () => {
  it('EQ_FOLD, EQ_IMPROVED, EQ_DANGER and EQ_BLANK_DROP, with the card drawn in place', () => {
    expect(bigMoveView({ key: 'a', kind: 'fold', name: 'Ben' })).toEqual({
      key: 'a',
      before: 'Ben folded. One fewer player to beat.',
      card: null,
      after: '',
    });
    expect(
      bigMoveView({ key: 'b', kind: 'improved', card: card('9♥'), handName: 'Two Pair' }),
    ).toEqual({ key: 'b', before: 'The ', card: card('9♥'), after: ' helped you: now Two Pair.' });
    expect(
      bigMoveView({ key: 'c', kind: 'danger', card: card('8♣'), threat: 'fullHouse' }),
    ).toMatchObject({ before: 'The ', after: ' is dangerous: a full house is now possible.' });
    expect(bigMoveView({ key: 'd', kind: 'blank', card: card('3♣') })).toMatchObject({
      before: 'The ',
      after: ' did not help you.',
    });
    expect(bigMoveView(null)).toBeNull();
  });
});

describe('the HUD words come from docs/PLAN.md (Appendix F.3, F.10, §6.1, §12.14, §13.2)', () => {
  const B = en.badge;
  const D = en.draws;
  const words: Record<string, string> = {
    caption: `"${B.caption}"`,
    folded: `"${B.folded}"`,
    stats: B.stats('{win}%', '{tie}%', 2, '{deals}').replace('2', '{n}'),
    howLink: B.howLink,
    how: B.how('{E}%'),
    unavailable: B.unavailable,
    price: `price chip "${B.price('{toCall}', '{need}%')}"`,
    fold: B.move.fold('{name}'),
    improved: B.move.improved('{card}', '{handName}'),
    danger: B.move.danger('{card}', '{threat}'),
    blank: B.move.blank('{card}'),
    threats: `"${B.move.threat.flush}"`,
    threats2: `"${B.move.threat.straight}"`,
    threats3: `"${B.move.threat.fullHouse}"`,
    chip: `"${D.chip('{name}', 2, '{pct}%', `{${D.byRiver}|${D.nextCard}}`).replace('2', '{outs}')}"`,
    risky: `"(${D.risky(1).trim().slice(1, -1).replace('1', '{n}')})"`,
    riskyCaption: `"${D.riskyCaption}"`,
    nuts: `suffix "${en.table.nuts}"`,
    byRiverInfo: en.rankings.byRiverInfo,
    ...Object.fromEntries(Object.entries(D.name).map(([k, name]) => [`draw ${k}`, `"${name}"`])),
  };
  for (const [name, text] of Object.entries(words)) {
    it(name, () => expect(PLAN).toContain(text));
  }
});
