// @vitest-environment jsdom
/**
 * Review's "Check the shuffle" row (PLAN §16.3, §12.10, §12.14; chunk 9.4): the shuffle code and
 * the seed of a finished hand, the check (a lazy chunk) with its ✓ and the deck the hand was dealt
 * from, ✗ with a plain reason for a changed record, and one line instead on a page without
 * `crypto.subtle` or for a hand without a code. Before the check no hidden card is on the page.
 */
import '../../../src/ui/styles/tokens.css';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addHand, initialReview, type ReviewHand } from '../../../src/app/review.ts';
import { commitText } from '../../../src/app/shuffleCode.ts';
import { appStore, defaultGameSettings, initialGame, initialUi } from '../../../src/app/store.ts';
import { heroDecisionsTaken } from '../../../src/app/undo.ts';
import { cardAriaLabel, type Card } from '../../../src/core/cards.ts';
import { deriveSeed } from '../../../src/core/rng.ts';
import { legalActions } from '../../../src/engine/legal.ts';
import { replay } from '../../../src/engine/replay.ts';
import { startHand } from '../../../src/engine/start.ts';
import { step } from '../../../src/engine/step.ts';
import type { EngineInput, HandState, LegalActions } from '../../../src/engine/types.ts';
import { enReview } from '../../../src/i18n/review.ts';
import { ReviewRoute } from '../../../src/ui/screens/Review.tsx';
import {
  callStation,
  collectHands,
  keep,
  REVIEW_SEED,
  reviewTable,
} from '../../app/reviewFixtures.ts';
import { sha256Hex } from '../../helpers/sha256.ts';
import { SUIT_CODE_POINTS } from '../dom.ts';
import { smallTargets } from './targets.ts';

const T = enReview.shuffle;

beforeEach(() => {
  appStore.setState({
    game: initialGame(),
    ui: initialUi(false),
    review: initialReview(),
    settings: defaultGameSettings(),
  });
  appStore.getState().dispatch({ type: 'go', screen: 'table' });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The hand with the shuffle code the controller would have made before its deal. */
function withCode(hand: ReviewHand): ReviewHand {
  const { seed, table } = hand.record;
  return {
    ...hand,
    record: { ...hand.record, commit: sha256Hex(commitText(seed, table.tableId, hand.handSeq)) },
  };
}

/**
 * A heads-up hand with an Undo (§11.3): the hero calls or checks, the next street comes, then the
 * move is taken back: the stub is reshuffled from the same seed and the hand is played out.
 */
function handWithUndo(): ReviewHand {
  for (let i = 0; i < 50; i++) {
    const table = reviewTable(2, deriveSeed(REVIEW_SEED, 'undo-table', i), 1, 0);
    const seed = deriveSeed(REVIEW_SEED, 'undo-hand', i);
    let h: HandState = startHand(table, seed);
    let inputs: EngineInput[] = [];
    /** The next input of a check-or-call hand, applied. */
    const next = (state: HandState): HandState => {
      const input: EngineInput =
        state.phase === 'betting'
          ? {
              kind: 'act',
              seat: state.toAct as number,
              action: callStation(state, legalActions(state) as LegalActions),
            }
          : { kind: 'advance' };
      inputs.push(input);
      return step(state, input);
    };
    while (h.phase !== 'complete' && !(h.phase === 'betting' && h.toAct === 0)) h = next(h);
    if (h.phase === 'complete') continue;
    const snapshot = { state: h, count: inputs.length, decisionId: heroDecisionsTaken(h) };
    const board = h.board.length;
    while (h.phase !== 'complete' && h.board.length === board) h = next(h);
    if (h.phase === 'complete' || h.revealed.length > 0) continue;
    const reshuffle = { kind: 'reshuffle', decisionId: snapshot.decisionId, undoIndex: 0 } as const;
    h = step(snapshot.state, reshuffle);
    inputs = [...inputs.slice(0, snapshot.count), reshuffle];
    while (h.phase !== 'complete') h = next(h);
    const final = h;
    return withCode(
      keep(final, { engineVersion: final.engineVersion, seed, commit: null, table, inputs }),
    );
  }
  throw new Error('no hand with an Undo');
}

const [fold] = collectHands(1, 'fold').map(withCode) as [ReviewHand];

function open(hand: ReviewHand) {
  appStore.setState({ review: addHand(initialReview(), hand) });
  act(() => appStore.getState().dispatch({ type: 'review', handSeq: hand.handSeq }));
  return render(<ReviewRoute />);
}

const row = () => screen.getByRole('region', { name: T.title });
const checkButton = () => within(row()).getByRole('button', { name: T.check });

/** Taps "Check the shuffle" and waits for the answer (the check is a lazy chunk). */
async function check(): Promise<HTMLElement> {
  act(() => void fireEvent.click(checkButton()));
  return await within(row()).findByText(/Nobody changed them|does not match|do not match|cannot/);
}

describe('before the check', () => {
  it('shows the shuffle code and the seed, says when the code was made, and offers the check', () => {
    open(fold);
    const r = within(row());
    expect(r.getByText(T.code)).toBeTruthy();
    expect(r.getByText(fold.record.commit as string)).toBeTruthy();
    expect(r.getByText(T.seed)).toBeTruthy();
    expect(r.getByText(fold.record.seed)).toBeTruthy();
    expect(r.getByText(T.saved)).toBeTruthy();
    expect(checkButton()).toBeTruthy();
    expect(r.queryByRole('list')).toBeNull();
  });

  it('no hidden card is on the page yet: the deck comes only with the check', () => {
    open(fold);
    const final = replay(fold.record);
    const shown = new Set<Card>([...(fold.heroHole ?? []), ...final.board]);
    const html = document.body.innerHTML;
    for (let card = 0; card < 52; card++) {
      if (!shown.has(card))
        expect(html.includes(cardAriaLabel(card)), cardAriaLabel(card)).toBe(false);
    }
  });

  it('the button is big enough to touch; no suit symbol is drawn as text', () => {
    const { container } = open(fold);
    expect(smallTargets(row(), () => false)).toEqual([]);
    expect(smallTargets(container, () => false)).toEqual([]);
    expect(SUIT_CODE_POINTS.test(document.body.textContent ?? '')).toBe(false);
  });
});

describe('the check (§16.3)', () => {
  it('✓: the cards came from this shuffle, and the deck the hand was dealt from, top card first', async () => {
    open(fold);
    const verdict = await check();
    expect(verdict.textContent).toBe(T.ok);
    expect(verdict.getAttribute('data-good')).toBe('true');
    expect(verdict.getAttribute('aria-live')).toBe('polite');
    const deck = within(row()).getByRole('list', { name: T.deck });
    const names = within(deck)
      .getAllByRole('img')
      .map((el) => el.getAttribute('aria-label'));
    expect(names).toEqual(replay(fold.record).deck.map(cardAriaLabel));
    expect(names).toHaveLength(52);
    expect(within(row()).queryByText(T.reshuffled)).toBeNull();
    expect(SUIT_CODE_POINTS.test(document.body.textContent ?? '')).toBe(false);
  });

  it('a hand with an Undo: ✓ too, the reshuffle came from the same seed, and the row says so', async () => {
    const hand = handWithUndo();
    expect(hand.record.inputs.some((input) => input.kind === 'reshuffle')).toBe(true);
    open(hand);
    expect((await check()).textContent).toBe(T.ok);
    expect(within(row()).getByText(T.reshuffled)).toBeTruthy();
    const deck = within(row()).getByRole('list', { name: T.deck });
    expect(
      within(deck)
        .getAllByRole('img')
        .map((el) => el.getAttribute('aria-label')),
    ).toEqual(replay(hand.record).deck.map(cardAriaLabel));
  });

  it('✗ a changed seed: the shuffle code does not match this hand; no deck', async () => {
    const seed = deriveSeed(fold.record.seed, 'changed');
    open({ ...fold, record: { ...fold.record, seed } });
    const verdict = await check();
    expect(verdict.textContent).toBe(T.badCode);
    expect(verdict.getAttribute('data-good')).toBe('false');
    expect(within(row()).queryByRole('list')).toBeNull();
  });

  it('✗ a changed card: the cards do not match this shuffle', async () => {
    const [a, b] = fold.heroHole as [Card, Card];
    const used = new Set<Card>([a, b, ...fold.board]);
    const other = Array.from({ length: 52 }, (_, c) => c).find((c) => !used.has(c)) as Card;
    open({ ...fold, heroHole: [other, b] });
    const verdict = await check();
    expect(verdict.textContent).toBe(T.badCards);
    expect(verdict.getAttribute('data-good')).toBe('false');
  });

  it('a check that cannot load or run says the hand cannot be checked', async () => {
    vi.stubGlobal('crypto', {
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
      subtle: {
        digest: () => Promise.reject(new Error('no digest')),
      },
    });
    open(fold);
    expect((await check()).textContent).toBe(T.broken);
  });
});

describe('when there is nothing to check', () => {
  it('a hand without a shuffle code says so, with no button', () => {
    const [plain] = collectHands(1, 'fold') as [ReviewHand];
    expect(plain.record.commit).toBeNull();
    open(plain);
    expect(within(row()).getByText(T.none)).toBeTruthy();
    expect(within(row()).queryByRole('button')).toBeNull();
  });

  it('a page without crypto.subtle (plain http, §12.14): "Needs a secure connection (https)"', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
    });
    open(fold);
    expect(within(row()).getByText(T.insecure)).toBeTruthy();
    expect(within(row()).queryByRole('button')).toBeNull();
    expect(within(row()).queryByText(fold.record.commit as string)).toBeNull();
  });

  it('a hand that cannot be replayed has no shuffle row (its summary only)', () => {
    open({ ...fold, record: { ...fold.record, engineVersion: '9.0.0' } });
    expect(screen.queryByRole('region', { name: T.title })).toBeNull();
  });
});
