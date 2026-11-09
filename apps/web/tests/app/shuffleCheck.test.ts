/**
 * "Check the shuffle" (PLAN §16.3, chunk 9.4, `app/shuffleCheck.ts`). Stage 9 acceptance 4: the
 * shuffle check verifies 1,000 recorded hands. The hands are played by the engine (2 to 9 players,
 * random legal play, about a third with Undo reshuffles taken as §11.3 allows them) and recorded by
 * the app's own `handRecordOf`, with the shuffle code of `commitText` hashed by `node:crypto`; the
 * check hashes with `crypto.subtle` (the app's path) and deals every hand again from its seed.
 * Then the records are changed one field at a time: a changed seed, code, table, hand number or
 * card fails with ✗.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { handRecordOf } from '../../src/app/handRecord.ts';
import { reviewHandOf } from '../../src/app/history.ts';
import type { ReviewHand } from '../../src/app/review.ts';
import { checkShuffle, shuffleInputOf, type ShuffleCheck } from '../../src/app/shuffleCheck.ts';
import { commitText, pageSha256, type Sha256 } from '../../src/app/shuffleCode.ts';
import { heroDecisionsTaken } from '../../src/app/undo.ts';
import { handEndViewOf } from '../../src/app/tableViews.ts';
import { parseCard, type Card } from '../../src/core/cards.ts';
import { deriveSeed, randInt, rngFromSeed, type Seed128 } from '../../src/core/rng.ts';
import { replay } from '../../src/engine/replay.ts';
import { deckFromSeed, startHand } from '../../src/engine/start.ts';
import { step } from '../../src/engine/step.ts';
import type { EngineInput, HandState } from '../../src/engine/types.ts';
import { emptyHandMeta, isHandRecord, type HandRecord } from '../../src/persist/schema.ts';
import { tableWith } from '../engine/helpers.ts';
import { randomInput } from '../engine/play.ts';
import { sha256Hex } from '../helpers/sha256.ts';

const BASE: Seed128 = '5a0ff1e0000000000000000000009400';
const HANDS = 1000;

interface Recorded {
  record: HandRecord;
  /** How many Undo reshuffles the hand had. */
  undos: number;
}

/**
 * One hand played to its end. A third of the hands take Undo now and then (§11.3 r2: after the
 * hero's act at the latest decision point, before any reveal and the hand end, once per decision
 * point): the snapshot back, the stub reshuffled, the inputs cut back to it plus `reshuffle`.
 */
function playHand(i: number): {
  table: ReturnType<typeof tableWith>;
  seed: Seed128;
  final: HandState;
  inputs: EngineInput[];
  undos: number;
} {
  const rng = rngFromSeed(deriveSeed(BASE, 'play', i));
  const players = 2 + randInt(rng, 8);
  const stacks = Array.from({ length: players }, (_, seat) =>
    seat === 0 ? 2000 : 200 + 20 * randInt(rng, 190),
  );
  const table = tableWith(stacks, {
    sb: 10,
    bb: 20,
    startingStack: 2000,
    tableSeed: deriveSeed(BASE, 'table', i),
    nextHandSeq: 1 + 3 * i,
  });
  const seed = deriveSeed(BASE, 'hand', i);
  const undoes = randInt(rng, 3) === 0;
  let h = startHand(table, seed);
  let inputs: EngineInput[] = [];
  let snapshot: { state: HandState; count: number; decisionId: number } | null = null;
  let undos = 0;
  for (let n = 0; h.phase !== 'complete'; n++) {
    if (n > 600) throw new Error(`hand ${i} does not end`);
    if (h.phase === 'betting' && h.toAct === 0) {
      snapshot = { state: h, count: inputs.length, decisionId: heroDecisionsTaken(h) };
    }
    const input = randomInput(h, rng, 25);
    inputs.push(input);
    h = step(h, input);
    if (
      undoes &&
      snapshot !== null &&
      inputs.length > snapshot.count &&
      h.phase !== 'complete' &&
      h.revealed.length === 0 &&
      !snapshot.state.undoneDecisions.includes(snapshot.decisionId) &&
      randInt(rng, 3) === 0
    ) {
      const reshuffle = {
        kind: 'reshuffle',
        decisionId: snapshot.decisionId,
        undoIndex: 0,
      } as const;
      h = step(snapshot.state, reshuffle);
      inputs = [...inputs.slice(0, snapshot.count), reshuffle];
      snapshot = null;
      undos++;
    }
  }
  return { table, seed, final: h, inputs, undos };
}

/** The hand as the app records it (§14.3 step 1), its shuffle code hashed by node:crypto. */
function recordHand(i: number): Recorded {
  const { table, seed, final, inputs, undos } = playHand(i);
  const record = handRecordOf({
    hand: final,
    table,
    inputs,
    meta: { ...emptyHandMeta(), undoCount: undos },
    coachLevel: 'beginner',
    allIn: null,
    at: '2026-11-06T00:00:00.000Z',
    commit: sha256Hex(commitText(seed, table.tableId, table.nextHandSeq)),
    commitBeforeDeal: true,
  });
  if (record === null) throw new Error(`hand ${i} has no record`);
  // As stored: JSON, and it passes the A.7 guard.
  const stored = JSON.parse(JSON.stringify(record)) as HandRecord;
  expect(isHandRecord(stored)).toBe(true);
  return { record: stored, undos };
}

const sha256 = pageSha256() as Sha256; // the app's own path: crypto.subtle (Node has it)
let recorded: Recorded[] = [];
let results: ShuffleCheck[] = [];

beforeAll(async () => {
  recorded = Array.from({ length: HANDS }, (_, i) => recordHand(i));
  results = await Promise.all(recorded.map(({ record }) => checkShuffle(record, sha256)));
}, 60_000);

/** A different valid hex digit at `at`. */
function flipHex(text: string, at: number): string {
  const c = text[at] as string;
  return text.slice(0, at) + (c === '0' ? '1' : '0') + text.slice(at + 1);
}

/** A card dealt nowhere in the record's hero hand or board. */
function otherCard(record: HandRecord, from: Card): Card {
  const used = new Set<Card>([...record.heroHole, ...record.board]);
  for (let k = 1; k < 52; k++) {
    const card = ((from + k) % 52) as Card;
    if (!used.has(card)) return card;
  }
  throw new Error('no free card');
}

describe('Stage 9 acceptance 4: the shuffle check verifies 1,000 recorded hands', () => {
  it('every one is ✓, with its deck', () => {
    expect(recorded).toHaveLength(HANDS);
    const failed = results.flatMap((r, i) => (r.status === 'ok' ? [] : [`${i}: ${r.status}`]));
    expect(failed).toEqual([]);
    results.forEach((r, i) => {
      if (r.status !== 'ok') return;
      const { record } = recorded[i] as Recorded;
      // The deck is a whole deck, top card first; without Undo it is the seed's own shuffle.
      expect([...r.deck].sort((a, b) => a - b)).toEqual(Array.from({ length: 52 }, (_, c) => c));
      expect(r.reshuffled).toBe(record.undoCount > 0);
      if (record.undoCount === 0) expect(r.deck).toEqual(deckFromSeed(record.seed));
      else expect(r.deck).not.toEqual(deckFromSeed(record.seed));
    });
  });

  it('is not vacuous: every table size, Undo reshuffles that changed the board, showdowns', () => {
    const sizes = new Set(recorded.map(({ record }) => record.table.config.seatCount));
    expect([...sizes].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    const undone = recorded.filter(({ undos }) => undos > 0);
    expect(undone.length).toBeGreaterThan(100);
    // Hands whose board would be other cards without the reshuffle: the check really deals the
    // logged Undo reshuffles from the same seed.
    const changed = undone.filter(({ record }) => {
      const without = record.inputs.filter((input) => input.kind !== 'reshuffle');
      try {
        return replay({ ...record, inputs: without }).board.join() !== record.board.join();
      } catch {
        return true;
      }
    });
    expect(changed.length).toBeGreaterThan(20);
    expect(recorded.filter(({ record }) => record.board.length === 5).length).toBeGreaterThan(200);
  });
});

describe('a changed record fails with ✗', () => {
  /** Every 5th record (200), changed by `change`, checked again. */
  async function changedResults(change: (r: HandRecord) => HandRecord | null) {
    const out: { i: number; status: ShuffleCheck['status'] }[] = [];
    for (let i = 0; i < HANDS; i += 5) {
      const changed = change(structuredClone((recorded[i] as Recorded).record));
      if (changed !== null) out.push({ i, status: (await checkShuffle(changed, sha256)).status });
    }
    return out;
  }

  it('a changed seed: the shuffle code does not match', async () => {
    const out = await changedResults((r) => ({ ...r, seed: flipHex(r.seed, r.handSeq % 32) }));
    expect(out).toHaveLength(200);
    expect(out.filter((x) => x.status !== 'code')).toEqual([]);
  }, 30_000);

  it('a changed shuffle code, table id or hand number: the code does not match', async () => {
    const commit = await changedResults((r) => ({
      ...r,
      commit: flipHex(r.commit as string, r.handSeq % 64),
    }));
    const tableId = await changedResults((r) => ({
      ...r,
      table: { ...r.table, tableId: flipHex(r.table.tableId, 0) },
    }));
    const handSeq = await changedResults((r) => ({ ...r, handSeq: r.handSeq + 1 }));
    for (const out of [commit, tableId, handSeq]) {
      expect(out).toHaveLength(200);
      expect(out.filter((x) => x.status !== 'code')).toEqual([]);
    }
  }, 30_000);

  it('one of your cards changed: the cards do not match this shuffle', async () => {
    const out = await changedResults((r) => ({
      ...r,
      heroHole: [otherCard(r, r.heroHole[0]), r.heroHole[1]],
    }));
    expect(out).toHaveLength(200);
    expect(out.filter((x) => x.status !== 'cards')).toEqual([]);
  }, 30_000);

  it('a board card changed: the cards do not match this shuffle', async () => {
    const out = await changedResults((r) => {
      if (r.board.length === 0) return null;
      const board = [...r.board];
      const at = r.handSeq % board.length;
      board[at] = otherCard(r, board[at] as Card);
      return { ...r, board };
    });
    expect(out.length).toBeGreaterThan(80);
    expect(out.filter((x) => x.status !== 'cards')).toEqual([]);
  }, 30_000);

  it('an Undo reshuffle taken out of the log: the cards it dealt no longer match', async () => {
    let tried = 0;
    for (const { record } of recorded) {
      const without = record.inputs.filter((input) => input.kind !== 'reshuffle');
      if (without.length === record.inputs.length) continue;
      let board: Card[] | null;
      try {
        board = replay({ ...record, inputs: without }).board;
      } catch {
        board = null;
      }
      if (board !== null && board.join() === record.board.join()) continue;
      tried++;
      const result = await checkShuffle({ ...record, inputs: without }, sha256);
      expect(['cards', 'broken']).toContain(result.status);
    }
    expect(tried).toBeGreaterThan(20);
  }, 30_000);

  it('an Undo count the logged reshuffles do not show: the Undo count does not match', async () => {
    // One Undo more or fewer than the log has (every 5th record; fewer only where there was one).
    const more = await changedResults((r) => ({ ...r, undoCount: r.undoCount + 1 }));
    const fewer = await changedResults((r) =>
      r.undoCount > 0 ? { ...r, undoCount: r.undoCount - 1 } : null,
    );
    expect(more).toHaveLength(200);
    expect(fewer.length).toBeGreaterThan(30);
    for (const out of [more, fewer]) expect(out.filter((x) => x.status !== 'undo')).toEqual([]);
    // A reshuffle taken out of the log after which no card came: the cards still match, the
    // count does not.
    let tried = 0;
    for (const { record } of recorded) {
      const without = record.inputs.filter((input) => input.kind !== 'reshuffle');
      if (without.length === record.inputs.length) continue;
      let same: boolean;
      try {
        const h = replay({ ...record, inputs: without });
        same =
          h.phase === 'complete' &&
          h.board.join() === record.board.join() &&
          h.seats[0]?.hole?.join() === record.heroHole.join();
      } catch {
        same = false;
      }
      if (!same) continue;
      tried++;
      expect((await checkShuffle({ ...record, inputs: without }, sha256)).status).toBe('undo');
    }
    expect(tried).toBeGreaterThan(10); // 14 of the 1,000 hands: an Undo on the last street
  }, 30_000);
});

describe('what the check says when it cannot say ✓ or ✗', () => {
  const first = (): HandRecord => structuredClone((recorded[0] as Recorded).record);

  it('a hand without a shuffle code; a page without crypto.subtle (§12.14)', async () => {
    expect(await checkShuffle({ ...first(), commit: null }, sha256)).toEqual({ status: 'none' });
    expect(await checkShuffle(first(), null)).toEqual({ status: 'insecure' });
    expect(await checkShuffle({ ...first(), commit: null }, null)).toEqual({ status: 'insecure' });
  });

  it('a record that cannot be dealt again: another engine major, an unfinished hand, a refused input', async () => {
    const r = first();
    expect((await checkShuffle({ ...r, engineVersion: '9.0.0' }, sha256)).status).toBe('broken');
    expect((await checkShuffle({ ...r, inputs: r.inputs.slice(0, 1) }, sha256)).status).toBe(
      'broken',
    );
    const refused: EngineInput = { kind: 'act', seat: 0, action: { type: 'raise', to: 1 } };
    expect((await checkShuffle({ ...r, inputs: [refused, ...r.inputs] }, sha256)).status).toBe(
      'broken',
    );
  });

  it('a hash function that fails says the hand cannot be checked', async () => {
    const failing: Sha256 = () => Promise.reject(new Error('no digest'));
    expect(await checkShuffle(first(), failing)).toEqual({ status: 'broken' });
  });
});

describe('Review’s hands (app/review.ts) read as the record does', () => {
  it('shuffleInputOf: the replay record, your cards and the board', async () => {
    const { record } = recorded[3] as Recorded;
    const final = replay(record);
    const end = handEndViewOf(final, record.table);
    if (end === null) throw new Error('not complete');
    const hand: ReviewHand = {
      handSeq: record.handSeq,
      at: record.at,
      record: {
        engineVersion: record.engineVersion,
        seed: record.seed,
        commit: record.commit,
        table: record.table,
        inputs: record.inputs,
      },
      heroHole: record.heroHole,
      board: record.board,
      undoCount: record.undoCount,
      decisions: [],
      commitBeforeDeal: true,
      end,
    };
    const input = shuffleInputOf(hand);
    expect(input).toMatchObject({
      handSeq: record.handSeq,
      seed: record.seed,
      commit: record.commit,
      heroHole: record.heroHole,
      board: record.board,
      undoCount: record.undoCount,
    });
    expect((await checkShuffle(input, sha256)).status).toBe('ok');
    const changed = { ...hand, heroHole: [parseCard('As'), parseCard('Ks')] as [Card, Card] };
    const same = record.heroHole.join() === changed.heroHole.join();
    expect((await checkShuffle(shuffleInputOf(changed), sha256)).status).toBe(
      same ? 'ok' : 'cards',
    );
  });

  it('a stored hand opened from Stats → History (`reviewHandOf`, chunk 8.2) is ✓ too', async () => {
    for (const i of [0, 3, 7, 11]) {
      const { record } = recorded[i] as Recorded;
      const hand = reviewHandOf(record);
      expect(hand.board).toEqual(record.board);
      expect((await checkShuffle(shuffleInputOf(hand), sha256)).status).toBe('ok');
    }
  });
});
