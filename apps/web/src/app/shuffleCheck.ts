/**
 * "Check the shuffle" (PLAN §16.3, §12.10, chunk 9.4): Review's proof that a finished hand's cards
 * came from the shuffle the game committed to before the deal.
 *
 * The check trusts no stored deck: it recomputes `SHA-256(seed:tableId:handSeq)` and compares it
 * with the stored shuffle code, then deals the hand again from the revealed seed with the engine's
 * own code (`replay`: `deckFromSeed`, then every logged Undo reshuffle, whose streams come from the
 * same seed, §2.4) and compares the cards it deals with the cards the record says were dealt: your
 * hole cards and the board; and the logged reshuffles with the record's Undo count (one each,
 * §11.3). ✓ only when all of these match.
 *
 * It proves the record is consistent, not when the code was shown: the code appears only in
 * Review, after the hand, so a record made up whole (seed, code and cards together) passes too.
 * Showing the code at the Table before the deal would let the player check that (§16.3 notes).
 *
 * ⚠️ The deck it returns names every card, folded and unseen ones too: it is shown only after the
 * hand, when the player asks for the check (§16.3: the seed is revealed then anyway).
 */
import type { Card } from '../core/cards.ts';
import { replay } from '../engine/replay.ts';
import { ENGINE_VERSION, type HandState } from '../engine/types.ts';
import type { HandRecord } from '../persist/schema.ts';
import type { ReviewHand } from './review.ts';
import { commitText, pageSha256, type Sha256 } from './shuffleCode.ts';

/** What the check reads. A stored hand record (A.7 `HandRecord`) has all of it. */
export type ShuffleInput = Pick<
  HandRecord,
  'handSeq' | 'seed' | 'commit' | 'engineVersion' | 'table' | 'inputs' | 'undoCount'
> & {
  readonly heroHole: readonly Card[] | null;
  readonly board: readonly Card[];
};

/** A hand kept for Review, as the check reads it. */
export function shuffleInputOf(hand: ReviewHand): ShuffleInput {
  return {
    ...hand.record,
    handSeq: hand.handSeq,
    heroHole: hand.heroHole,
    board: hand.board,
    undoCount: hand.undoCount,
  };
}

/** The check's answer. */
export type ShuffleCheck =
  /** ✓ The deck the hand was dealt from, top card first (after any Undo reshuffle). */
  | { readonly status: 'ok'; readonly deck: readonly Card[]; readonly reshuffled: boolean }
  /**
   * ✗ `code`: the seed (or the hand's table or number) does not give the stored shuffle code;
   * ✗ `cards`: the seed deals other cards than the record shows; ✗ `undo`: the log has more or
   * fewer Undo reshuffles than the record's Undo count. `broken`: the record cannot be dealt again
   * (another engine version, or inputs the engine refuses); `none` and `insecure` as in
   * `ShuffleRow` (`app/shuffleCode.ts`).
   */
  | { readonly status: 'code' | 'cards' | 'undo' | 'broken' | 'none' | 'insecure' };

const majorOf = (version: string): string => version.split('.')[0] ?? '';

const sameCards = (a: readonly Card[] | null, b: readonly Card[] | null): boolean =>
  a === null || b === null ? a === b : a.length === b.length && a.every((card, i) => card === b[i]);

/** Checks one finished hand (§16.3). Never throws. */
export async function checkShuffle(
  input: ShuffleInput,
  sha256: Sha256 | null = pageSha256(),
): Promise<ShuffleCheck> {
  if (sha256 === null) return { status: 'insecure' };
  if (input.commit === null) return { status: 'none' };
  if (majorOf(input.engineVersion) !== majorOf(ENGINE_VERSION)) return { status: 'broken' };
  let hash: string;
  let hand: HandState;
  try {
    hash = await sha256(commitText(input.seed, input.table.tableId, input.handSeq));
    hand = replay(input);
  } catch {
    return { status: 'broken' };
  }
  if (hand.phase !== 'complete') return { status: 'broken' };
  if (hash !== input.commit || hand.handSeq !== input.handSeq) return { status: 'code' };
  if (
    !sameCards(hand.seats[0]?.hole ?? null, input.heroHole) ||
    !sameCards(hand.board, input.board)
  ) {
    return { status: 'cards' };
  }
  // Each Undo reshuffles once (§11.3): a reshuffle taken out of the log (or put in) after which
  // no card came deals the same cards, but the count gives it away.
  const reshuffles = input.inputs.filter((i) => i.kind === 'reshuffle').length;
  if (reshuffles !== input.undoCount) return { status: 'undo' };
  return { status: 'ok', deck: [...hand.deck], reshuffled: reshuffles > 0 };
}
