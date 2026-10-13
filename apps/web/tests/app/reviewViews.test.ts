/**
 * Review's view model (PLAN §4.7, §12.10): `buildReview` turns a finished hand into the frames the
 * Review screen steps through. Checked against the engine's own states (`replayStates`):
 * - one frame per input and the deal, in order, each one the table at that step;
 * - what each step did, as events (blinds, actions, streets, reveals, refunds, undo);
 * - ⚠️ hidden cards never enter a frame: a bot's hole cards show from the step where the engine
 *   turned them face up and not before, a folded hand never (§3.9, §4.8);
 * - a record from another major engine version, or one that does not replay, gives the summary.
 */
import { describe, expect, it } from 'vitest';
import { buildReview, type ReviewFrame, type ReviewReplay } from '../../src/app/reviewViews.ts';
import { deriveSeed, rngFromSeed } from '../../src/core/rng.ts';
import type { Card } from '../../src/core/cards.ts';
import { deepFreeze } from '../../src/engine/clone.ts';
import { replay, replayStates } from '../../src/engine/replay.ts';
import type { EngineInput, HandState, ReplayRecord } from '../../src/engine/types.ts';
import { handEndViewOf } from '../../src/app/tableViews.ts';
import { randomAction } from '../engine/play.ts';
import { SEED, tableWith } from '../engine/helpers.ts';
import {
  callStation,
  collectHands,
  keep,
  passiveFolder,
  playToEnd,
  REVIEW_SEED,
  reviewTable,
  type Policy,
} from './reviewFixtures.ts';

const replayOf = (hand: ReturnType<typeof keep>): ReviewReplay => {
  const view = buildReview(hand);
  if (!view.replayable) throw new Error(`not replayable: ${view.reason}`);
  return view;
};

/** Every card a frame shows face up: the board, the hero's hand, revealed bot hands, dealt cards. */
function visibleCards(frame: ReviewFrame): Set<Card> {
  const cards = new Set<Card>();
  for (const c of frame.board) if (c.card !== null) cards.add(c.card);
  for (const c of frame.hero?.hole ?? []) if (c.card !== null) cards.add(c.card);
  for (const seat of frame.seats) {
    if (seat.cards.kind === 'revealed') {
      for (const c of seat.cards.cards) if (c.card !== null) cards.add(c.card);
    }
  }
  for (const e of frame.events) if (e.kind === 'street') e.cards.forEach((c) => cards.add(c));
  return cards;
}

/** The hole cards of the bots that are still in the hand and not face up at `h`. */
function hiddenHoles(h: HandState): Card[] {
  const out: Card[] = [];
  h.seats.forEach((s, seat) => {
    if (seat === 0 || !s.dealtIn || s.folded || s.hole === null) return;
    if (!h.revealed.includes(seat)) out.push(...s.hole);
  });
  return out;
}

describe('buildReview: the frames', () => {
  const table = tableWith([2000, 2000, 2000], { sb: 10, bb: 20, button: 0, nextHandSeq: 12 });
  const withHandsDealt = { ...table, handsDealt: 11 };

  it('a hand won by folds: the deal, each fold, the result; nobody ever shows a card', () => {
    const { final, record } = playToEnd(withHandsDealt, SEED, passiveFolder);
    const view = replayOf(keep(final, record));
    expect(view.handSeq).toBe(12);
    expect(view.handNumber).toBe(12);
    expect(view.opponents).toBe(2);
    expect(view.frames.map((f) => f.index)).toEqual([0, 1, 2, 3]);

    const kinds = view.frames.map((f) => f.events.map((e) => e.kind));
    expect(kinds).toEqual([['blind', 'blind'], ['act'], ['act', 'refund'], []]);
    expect(view.frames[1]?.events).toMatchObject([
      { kind: 'act', action: 'fold', who: { name: 'You', hero: true } },
    ]);
    expect(view.frames[2]?.events[0]).toMatchObject({
      kind: 'act',
      action: 'fold',
      who: { name: 'P1', hero: false },
    });
    expect(view.frames[0]?.events).toMatchObject([
      { kind: 'blind', blind: 'sb', amount: 10, who: { name: 'P1' } },
      { kind: 'blind', blind: 'bb', amount: 20, who: { name: 'P2' } },
    ]);

    for (const frame of view.frames) {
      for (const seat of frame.seats) expect(seat.cards.kind).not.toBe('revealed');
    }
    expect(view.frames[3]?.board).toEqual([]);
    expect(view.end.endedBy).toBe('fold');
    expect(view.end).toEqual(handEndViewOf(final, record.table));
  });

  it('a showdown: hole cards turn face up at the reveal step, not before', () => {
    const { final, record } = playToEnd(withHandsDealt, SEED, callStation);
    const view = replayOf(keep(final, record));
    const streets = view.frames.flatMap((f) => f.events.filter((e) => e.kind === 'street'));
    expect(streets.map((e) => (e.kind === 'street' ? e.street : ''))).toEqual([
      'flop',
      'turn',
      'river',
    ]);
    const reveal = view.frames.findIndex((f) => f.events.some((e) => e.kind === 'reveal'));
    expect(reveal).toBeGreaterThan(0);
    const revealEvent = view.frames[reveal]?.events.find((e) => e.kind === 'reveal');
    expect(revealEvent).toMatchObject({ kind: 'reveal', reason: 'showdown' });
    view.frames.forEach((frame, i) => {
      for (const seat of frame.seats) {
        expect(seat.cards.kind, `frame ${i}, seat ${seat.seat}`).toBe(
          i < reveal ? 'hidden' : 'revealed',
        );
      }
    });
    expect(view.frames.at(-1)?.board).toHaveLength(5);
  });

  it('an all-in run-out: the reveal says so, and the board is dealt a street at a time', () => {
    const table2 = tableWith([2000, 2000], { sb: 10, bb: 20, button: 0, nextHandSeq: 1 });
    const allIn: Policy = (_h, legal) =>
      legal.raise !== null
        ? { type: 'raise', to: legal.raise.max }
        : legal.canCall
          ? { type: 'call' }
          : { type: 'check' };
    const { final, record } = playToEnd(table2, SEED, allIn);
    const view = replayOf(keep(final, record));
    const events = view.frames.flatMap((f) => f.events);
    expect(events.find((e) => e.kind === 'reveal')).toMatchObject({ reason: 'runout' });
    const dealt = view.frames.map((f) => f.board.length);
    expect(dealt).toEqual([...dealt].sort((a, b) => a - b));
    expect(new Set(dealt)).toEqual(new Set([0, 3, 4, 5]));
    const reveal = view.frames.findIndex((f) => f.events.some((e) => e.kind === 'reveal'));
    expect(view.frames[reveal - 1]?.seats[0]?.cards.kind).toBe('hidden');
    expect(view.frames[reveal]?.seats[0]?.cards.kind).toBe('revealed');
    expect(events.some((e) => e.kind === 'act' && e.allIn)).toBe(true);
  });

  it('an undo shows as a reshuffle step', () => {
    const t = withHandsDealt;
    const inputs: EngineInput[] = [
      { kind: 'reshuffle', decisionId: 0, undoIndex: 0 },
      { kind: 'act', seat: 0, action: { type: 'fold' } },
      { kind: 'act', seat: 1, action: { type: 'fold' } },
      { kind: 'advance' },
    ];
    const record: ReplayRecord = {
      engineVersion: '0.1.0',
      seed: SEED,
      commit: null,
      table: t,
      inputs,
    };
    const final = replay(record);
    const view = replayOf(keep(final, record));
    expect(view.frames[1]?.events).toEqual([{ kind: 'reshuffle' }]);
    expect(view.frames).toHaveLength(5);
  });

  it('nobody is "thinking" in a replay, and the hero is shown on every frame', () => {
    const { final, record } = playToEnd(withHandsDealt, SEED, callStation);
    const view = replayOf(keep(final, record));
    for (const frame of view.frames) {
      expect(frame.seats.every((s) => !s.toAct)).toBe(true);
      expect(frame.hero?.toAct).toBe(false);
      expect(frame.hero?.hole.every((c) => c.card !== null)).toBe(true);
    }
  });

  it('is pure: the same hand builds the same view, and a frozen record is not touched', () => {
    const { final, record } = playToEnd(withHandsDealt, SEED, callStation);
    const hand = deepFreeze(keep(final, record));
    expect(buildReview(hand)).toEqual(buildReview(hand));
  });
});

describe('buildReview: the frames follow the engine, step by step', () => {
  const hands = [...collectHands(40, 'fold'), ...collectHands(40, 'showdown')];

  it('frame i is the table after i inputs; hidden hole cards are in no frame', () => {
    const seen = { hidden: 0, revealed: 0, laterFolds: 0 };
    for (const hand of hands) {
      if (hand.end.endedBy === 'fold' && hand.record.inputs.length > 10) seen.laterFolds++;
      const view = replayOf(hand);
      const states = replayStates(hand.record);
      expect(view.frames).toHaveLength(states.length);
      view.frames.forEach((frame, i) => {
        const h = states[i] as HandState;
        expect(frame.index).toBe(i);
        expect(frame.street).toBe(h.street);
        expect(frame.board.map((c) => c.card)).toEqual(h.board);
        expect(frame.pot.total).toBe(h.seats.reduce((a, s) => a + s.totalBet, 0));
        // A bot's cards are face up exactly when the engine turned them over, and it is still live.
        frame.seats.forEach((pod, k) => {
          const seat = k + 1;
          const s = h.seats[seat];
          const up = s !== undefined && s.dealtIn && !s.folded && h.revealed.includes(seat);
          expect(
            pod.cards.kind === 'revealed',
            `hand ${hand.handSeq} frame ${i} seat ${seat}`,
          ).toBe(up);
          seen[up ? 'revealed' : 'hidden']++;
        });
        // No unrevealed live bot card is face up anywhere in the frame.
        const shown = visibleCards(frame);
        for (const card of hiddenHoles(h)) {
          expect(shown.has(card), `hand ${hand.handSeq} frame ${i}: card ${card} leaked`).toBe(
            false,
          );
        }
      });
      const last = states[states.length - 1] as HandState;
      expect(view.end).toEqual(handEndViewOf(last, hand.record.table));
    }
    // Not vacuous: plenty of hidden hands, some face-up ones, and folds that came late in the hand.
    expect(seen.hidden).toBeGreaterThan(1000);
    expect(seen.revealed).toBeGreaterThan(100);
    expect(seen.laterFolds).toBeGreaterThan(3);
  }, 60_000);

  it('a folded hand is never shown, not even at the end of a hand that went to a showdown', () => {
    for (const hand of hands) {
      const view = replayOf(hand);
      const last = replay(hand.record);
      const lastFrame = view.frames[view.frames.length - 1] as ReviewFrame;
      lastFrame.seats.forEach((seat, k) => {
        const s = last.seats[k + 1];
        if (s?.folded === true) expect(seat.cards.kind).not.toBe('revealed');
      });
    }
  }, 60_000);

  it('random play, not just the policies above: the same checks over 60 random hands', () => {
    for (let i = 0; i < 60; i++) {
      const rng = rngFromSeed(deriveSeed(REVIEW_SEED, 'view-random', i));
      const t = reviewTable(2 + (i % 8), deriveSeed(REVIEW_SEED, 'table-random', i), i + 1, i);
      const { final, record } = playToEnd(
        t,
        deriveSeed(REVIEW_SEED, 'hand-random', i),
        (_h, legal) => randomAction(legal, rng),
      );
      const view = replayOf(keep(final, record));
      const states = replayStates(record);
      view.frames.forEach((frame, k) => {
        const shown = visibleCards(frame);
        for (const card of hiddenHoles(states[k] as HandState)) expect(shown.has(card)).toBe(false);
      });
    }
  }, 60_000);
});

describe('buildReview: a hand that cannot be replayed gives its summary (§4.7)', () => {
  const [hand] = collectHands(1, 'fold');
  if (hand === undefined) throw new Error('no hand');

  it('another major engine version: the summary only', () => {
    const old = { ...hand, record: { ...hand.record, engineVersion: '1.0.0' } };
    const view = buildReview(old);
    expect(view).toMatchObject({ replayable: false, reason: 'version', handSeq: hand.handSeq });
    expect(view.end).toBe(hand.end);
  });

  it('the same major version with another minor still replays', () => {
    const minor = { ...hand, record: { ...hand.record, engineVersion: '0.9.3' } };
    expect(buildReview(minor).replayable).toBe(true);
  });

  it('an input the engine refuses: the summary only, no throw', () => {
    const bad = {
      ...hand,
      record: { ...hand.record, inputs: [{ kind: 'advance' } as EngineInput] },
    };
    expect(buildReview(bad)).toMatchObject({ replayable: false, reason: 'broken' });
  });

  it('inputs that stop before the end of the hand: the summary only', () => {
    const cut = { ...hand, record: { ...hand.record, inputs: hand.record.inputs.slice(0, 1) } };
    expect(buildReview(cut)).toMatchObject({ replayable: false, reason: 'broken' });
  });
});
