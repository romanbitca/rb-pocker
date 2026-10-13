/**
 * The hands kept for Review (PLAN §12.10, chunk 6.3): the slice's rules (newest first, 100 at
 * most, no duplicates), the `review` command and the selectors, and the controller keeping every
 * hand it plays out, with a record that replays to that hand (§4.7).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HERO } from '../../src/app/controller.ts';
import {
  REVIEW_KEEP,
  addHand,
  initialReview,
  selectHandSeq,
  type ReviewHand,
} from '../../src/app/review.ts';
import {
  createAppStore,
  selectReviewCount,
  selectReviewHand,
  selectReviewList,
} from '../../src/app/store.ts';
import { handEndViewOf } from '../../src/app/tableViews.ts';
import { replay } from '../../src/engine/replay.ts';
import { drive, heroPolicy, makeHarness, tick, type Harness } from './harness.ts';
import { collectHands } from './reviewFixtures.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const [base] = collectHands(1, 'fold');
if (base === undefined) throw new Error('no hand');
/** `base` as hand number `n`. */
const handNo = (n: number): ReviewHand => ({ ...base, handSeq: n });

describe('the slice', () => {
  it('keeps the newest hand first', () => {
    let slice = initialReview();
    for (const n of [1, 2, 3]) slice = addHand(slice, handNo(n));
    expect(slice.hands.map((h) => h.handSeq)).toEqual([3, 2, 1]);
  });

  it('keeps one hand per handSeq: a hand added again replaces the old one', () => {
    let slice = addHand(addHand(initialReview(), handNo(1)), handNo(2));
    const again = { ...handNo(1), at: '2026-10-09T01:00:00.000Z' };
    slice = addHand(slice, again);
    expect(slice.hands.map((h) => h.handSeq)).toEqual([1, 2]);
    expect(slice.hands[0]).toBe(again);
  });

  it(`keeps the last ${REVIEW_KEEP} hands`, () => {
    let slice = initialReview();
    for (let n = 1; n <= REVIEW_KEEP + 5; n++) slice = addHand(slice, handNo(n));
    expect(slice.hands).toHaveLength(REVIEW_KEEP);
    expect(slice.hands[0]?.handSeq).toBe(REVIEW_KEEP + 5);
    expect(slice.hands[REVIEW_KEEP - 1]?.handSeq).toBe(6);
  });

  it('shows a hand that is kept, and the list for one that is not', () => {
    const slice = addHand(addHand(initialReview(), handNo(1)), handNo(2));
    expect(selectHandSeq(slice, 2).selected).toBe(2);
    expect(selectHandSeq(slice, 99).selected).toBeNull();
    expect(selectHandSeq(slice, null)).toBe(slice);
    const shown = selectHandSeq(slice, 1);
    expect(selectHandSeq(shown, 1)).toBe(shown);
  });
});

describe('the review command and the selectors', () => {
  function storeWith(...seqs: number[]) {
    const store = createAppStore();
    store.setState({
      review: seqs.reduce((slice, n) => addHand(slice, handNo(n)), initialReview()),
    });
    return store;
  }

  it('opens the Review screen on that hand, over the Table, and closes the overlays', () => {
    const store = storeWith(1, 2);
    store.getState().dispatch({ type: 'go', screen: 'table' });
    store.getState().dispatch({ type: 'open', overlay: 'menu' });
    store.getState().dispatch({ type: 'review', handSeq: 2 });
    const s = store.getState();
    expect(s.ui.nav).toEqual({ screens: ['home', 'table', 'review'], overlays: [] });
    expect(s.ui.screen).toBe('review');
    expect(s.review.selected).toBe(2);
    expect(selectReviewHand(s)?.handSeq).toBe(2);
    // Off the Table the game waits (Appendix A.8).
    expect(s.ui.gates).toContain('offTable');
  });

  it('with no hand it shows the list; Back returns to the Table', () => {
    const store = storeWith(1);
    store.getState().dispatch({ type: 'go', screen: 'table' });
    store.getState().dispatch({ type: 'review', handSeq: 1 });
    store.getState().dispatch({ type: 'review', handSeq: null });
    expect(store.getState().review.selected).toBeNull();
    expect(selectReviewHand(store.getState())).toBeNull();
    expect(store.getState().ui.nav.screens).toEqual(['home', 'table', 'review']);
    store.getState().dispatch({ type: 'back' });
    expect(store.getState().ui.screen).toBe('table');
    expect(store.getState().ui.gates).not.toContain('offTable');
  });

  it('an unknown hand shows the list', () => {
    const store = storeWith(1);
    store.getState().dispatch({ type: 'review', handSeq: 42 });
    expect(store.getState().review.selected).toBeNull();
    expect(store.getState().ui.screen).toBe('review');
  });

  it('the list has no record, no seed and no table: a row is its number, cards and result', () => {
    const store = storeWith(1, 2, 3);
    const items = selectReviewList(store.getState());
    expect(items.map((i) => i.handSeq)).toEqual([3, 2, 1]);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(['end', 'handNumber', 'handSeq', 'heroHole']);
      expect(JSON.stringify(item)).not.toContain(base.record.seed);
    }
    expect(items[0]?.handNumber).toBe(base.record.table.handsDealt + 1);
    expect(selectReviewCount(store.getState())).toBe(3);
  });

  it('the list is the same array until a hand is added', () => {
    const store = storeWith(1);
    const first = selectReviewList(store.getState());
    store.getState().dispatch({ type: 'go', screen: 'table' });
    expect(selectReviewList(store.getState())).toBe(first);
    store.setState((s) => ({ review: addHand(s.review, handNo(2)) }));
    const second = selectReviewList(store.getState());
    expect(second).not.toBe(first);
    expect(second).toHaveLength(2);
  });
});

describe('the controller keeps the hands it plays out', () => {
  async function playHands(h: Harness, hands: number) {
    h.dispatch({ type: 'play' });
    return drive(h, { hands, hero: heroPolicy('b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0') });
  }

  it('every finished hand, newest first, each with a record that replays to it', async () => {
    const h = makeHarness({ settings: { players: 4, seatLevels: [null, null, null, null] } });
    const played = await playHands(h, 8);
    const kept = h.state().review.hands;
    expect(kept.map((x) => x.handSeq)).toEqual(played.map((p) => p.handSeq).reverse());
    for (const hand of played) {
      const k = kept.find((x) => x.handSeq === hand.handSeq) as ReviewHand;
      expect(replay(k.record)).toEqual(hand);
      expect(k.record.seed).toBe(hand.seed);
      expect(k.record.engineVersion).toBe(hand.engineVersion);
      expect(k.heroHole).toEqual(hand.seats[HERO]?.hole);
      expect(k.end).toEqual(handEndViewOf(hand, k.record.table));
      expect(new Date(k.at).toISOString()).toBe(k.at);
    }
  }, 60_000);

  it('the record holds the table as at hand start, not the next hand’s', async () => {
    const h = makeHarness();
    const [first] = await playHands(h, 1);
    const kept = h.state().review.hands[0] as ReviewHand;
    expect(kept.record.table.nextHandSeq).toBe(first?.handSeq);
    expect(kept.record.table.handsDealt).toBe(0);
  }, 60_000);

  it('a hand left unfinished by a new table is not kept', async () => {
    const h = makeHarness();
    h.dispatch({ type: 'play' });
    for (let i = 0; i < 30 && h.state().game.mode !== 'botTurn'; i++) await tick();
    const old = h.state().game.table;
    const unfinished = h.state().game.hand?.handSeq;
    expect(unfinished).toBeDefined();
    h.dispatch({ type: 'newTable', confirmed: true });
    for (let i = 0; i < 400 && h.state().game.table === old; i++) await tick();
    expect(h.state().game.table).not.toBe(old);
    expect(h.state().review.hands.some((x) => x.handSeq === unfinished)).toBe(false);
  }, 60_000);
});
