/**
 * PLAN §11.3 and §11.5: the engine-level half of undo (the controller's snapshot/restore, grading
 * gate and timers are Stage 6 and need `TableController`, which does not exist yet — this file
 * covers only what `step`'s `reshuffle` input must already guarantee on its own).
 *
 * The Appendix B vectors B33 ("any undo snapshot, restore, deep-equal to the snapshot before the
 * reshuffle input") and B40 (basic reshuffle mechanics: only the stub changes, once per decision,
 * refused after a reveal or in the showdown, bad counters) are in `appendix-b.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { chiSquarePValue, chiSquareStat, P_MIN } from '../helpers/stats.ts';
import { replay } from '../../src/engine/replay.ts';
import { step } from '../../src/engine/step.ts';
import type { EngineInput, HandState, ReplayRecord } from '../../src/engine/types.ts';
import { deal, tableWith } from './helpers.ts';
import { ADVANCE, call, check, legalOf, play } from './play.ts';

describe('undo at engine level (§11.3)', () => {
  it(
    '10,000 seeded undos: the next card dealt from the stub is uniform (chi-square, p > 0.001)',
    { timeout: 30_000 },
    () => {
      // 3 players checked down to the end of the flop round, one card away from the turn.
      const checkOrCallRound = (start: HandState): HandState => {
        let s = start;
        while (s.phase === 'betting') {
          const legal = legalOf(s);
          s = play(s, legal.canCheck ? check(legal.seat) : call(legal.seat));
        }
        return s;
      };
      let h = deal(tableWith([10000, 10000, 10000], { button: 0 }));
      h = checkOrCallRound(h); // preflop
      h = play(h, ADVANCE); // deal the flop
      h = checkOrCallRound(h); // flop
      expect(h).toMatchObject({ phase: 'roundComplete', street: 'flop' });

      const stub = h.deck.slice(h.deckPos);
      const indexOfCard = new Map(stub.map((c, i) => [c, i]));
      const counts = new Array<number>(stub.length).fill(0);
      const N = 10_000;
      for (let undoIndex = 0; undoIndex < N; undoIndex++) {
        const reshuffled = step(h, { kind: 'reshuffle', decisionId: 0, undoIndex });
        const dealt = step(reshuffled, ADVANCE); // deals the burn card, then the turn
        const turnCard = dealt.board[3] as number;
        const idx = indexOfCard.get(turnCard);
        if (idx === undefined) throw new Error('the turn card was not one of the stub cards');
        counts[idx] = (counts[idx] as number) + 1;
      }
      const stat = chiSquareStat(counts, N / stub.length);
      const p = chiSquarePValue(stat, stub.length - 1);
      expect(p).toBeGreaterThan(P_MIN);
    },
  );
});

describe('replay of a hand with an undo (§4.7, §11.5)', () => {
  it('a mid-hand reshuffle input is part of the record and replays to exactly the same final state', () => {
    const table = tableWith([10000, 10000, 10000], { button: 0 });
    let s: HandState = deal(table);
    const inputs: EngineInput[] = [];
    const apply = (input: EngineInput): void => {
      inputs.push(input);
      s = step(s, input);
    };
    apply({ kind: 'reshuffle', decisionId: 0, undoIndex: 0 }); // "undo" before the first decision
    while (s.phase !== 'complete') {
      if (s.phase !== 'betting') {
        apply(ADVANCE);
        continue;
      }
      const legal = legalOf(s);
      apply(legal.canCheck ? check(legal.seat) : call(legal.seat));
    }
    const record: ReplayRecord = {
      engineVersion: s.engineVersion,
      seed: s.seed,
      commit: null,
      table,
      inputs,
    };
    expect(replay(record)).toStrictEqual(s);
    expect(inputs.some((i) => i.kind === 'reshuffle')).toBe(true);
  });
});
