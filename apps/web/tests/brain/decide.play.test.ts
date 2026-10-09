/**
 * Whole hands played by the brain alone (PLAN §9.4, §9.7; Stage 5 acceptance 5, the part this
 * chunk can check: the full 100,000-hand self-play is chunk 5.11): random tables of 2–9 seats
 * (empty seats, tiny and short stacks, big blinds from 2 to 1,000), every seat an Easy or Medium
 * bot with its own profile and table-only seed (§2.4), and in one hand of four the coach in a seat
 * (`hint`). Every action must be accepted by the engine, every invariant must hold after every
 * step (the log replay included), and every hand must finish.
 */
import { describe, expect, it } from 'vitest';
import { decide, hint } from '../../src/brain/decide.ts';
import { profileFor } from '../../src/brain/profiles.ts';
import type { BrainProfile } from '../../src/brain/types.ts';
import { deriveSeed, randInt, rngFromSeed, seedFromWords } from '../../src/core/rng.ts';
import { checkInvariants } from '../../src/engine/invariants.ts';
import { observe } from '../../src/engine/observe.ts';
import { startHand } from '../../src/engine/start.ts';
import { step } from '../../src/engine/step.ts';
import {
  BOT_LEVELS,
  PERSONALITY_IDS,
  type EngineInput,
  type HandState,
  type ObserveExtras,
  type PlayerAction,
} from '../../src/engine/types.ts';
import { MAX_INPUTS, randomTable } from '../engine/random-play.ts';
import { testSeed } from '../helpers/seed.ts';

const HANDS = 400;

describe('hands played by the brain alone (2–9 seats)', () => {
  it(
    'never an illegal action, every invariant holds, every hand finishes',
    { timeout: 300_000 },
    () => {
      const root = testSeed('5f7a000000000000000000000000d3c1');
      const rng = rngFromSeed(root);
      const seatCounts = new Set<number>();
      const kinds = new Map<string, number>();
      let decisions = 0;
      let coachDecisions = 0;
      for (let hand = 0; hand < HANDS; hand++) {
        const table = randomTable(rng);
        const n = table.slots.length;
        seatCounts.add(n);
        const levels = Array.from({ length: n }, () => (randInt(rng, 2) === 0 ? 'easy' : 'medium'));
        const profiles: BrainProfile[] = Array.from({ length: n }, (_, i) =>
          profileFor(
            PERSONALITY_IDS[
              randInt(rng, PERSONALITY_IDS.length)
            ] as (typeof PERSONALITY_IDS)[number],
            levels[i] as 'easy' | 'medium',
          ),
        );
        const coachSeat = randInt(rng, 4) === 0 ? randInt(rng, n) : -1;
        const extras: ObserveExtras = {
          seatStats: new Array(n).fill(null),
          visiblePersonality: profiles.map(
            (p) => p.id.split('/')[0] as (typeof PERSONALITY_IDS)[number],
          ),
          seatLevels: levels.map((l) => (BOT_LEVELS.includes(l) ? l : 'easy')),
        };
        const handSeed = seedFromWords(rng.next(), rng.next(), rng.next(), rng.next());
        let h: HandState = startHand(table, handSeed);
        checkInvariants(h, { replayLog: true });
        let inputs = 0;
        while (h.phase !== 'complete') {
          expect(inputs).toBeLessThan(MAX_INPUTS);
          let input: EngineInput;
          if (h.phase === 'betting') {
            const seat = h.toAct as number;
            const obs = observe(h, seat, extras);
            let action: PlayerAction;
            if (seat === coachSeat) {
              action = hint(obs, null).action;
              coachDecisions++;
            } else {
              const seed = deriveSeed(
                deriveSeed(table.tableSeed, 'bots'),
                'bot',
                hand,
                seat,
                h.log.length,
              );
              const d = decide(obs, profiles[seat] as BrainProfile, seed);
              action = d.action;
              kinds.set(d.kind, (kinds.get(d.kind) ?? 0) + 1);
            }
            decisions++;
            input = { kind: 'act', seat, action };
          } else {
            input = { kind: 'advance' };
          }
          // The engine refuses an illegal action by throwing: none may be thrown.
          h = step(h, input);
          checkInvariants(h, { replayLog: true });
          inputs++;
        }
        expect(h.result).not.toBeNull();
      }
      expect([...seatCounts].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
      expect(decisions).toBeGreaterThan(2000);
      expect(coachDecisions).toBeGreaterThan(100);
      for (const kind of ['fold', 'check', 'call', 'bet', 'raise', 'allin']) {
        expect(kinds.get(kind) ?? 0).toBeGreaterThan(0);
      }
    },
  );
});
