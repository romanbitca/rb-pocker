/**
 * The stand-in `decide` of chunk 5.8 (`src/brain/standIn.ts`): what `brain.worker` runs until
 * chunk 5.7 adds the real `decide()`. It plays SimpleBot's rules and returns a full `Decision`
 * (Appendix A.5). SimpleBot itself is the self-play baseline in `scripts/bots/simple.ts`; the
 * stand-in is a copy (the §2.1 boundary keeps `src/` from importing `scripts/`), so this test
 * checks that both decide alike at every decision of 2,000 seeded hands. Chunk 5.7 deletes the
 * stand-in and this file.
 */
import { describe, expect, it } from 'vitest';
import { simpleBotAction } from '../../scripts/bots/simple.ts';
import { decide, standInAction } from '../../src/brain/standIn.ts';
import { deriveSeed, randInt, rngFromSeed, type Rng } from '../../src/core/rng.ts';
import { observe } from '../../src/engine/observe.ts';
import { startHand } from '../../src/engine/start.ts';
import { step } from '../../src/engine/step.ts';
import type {
  HandState,
  Observation,
  ObserveExtras,
  PlayerAction,
} from '../../src/engine/types.ts';
import { deal, rigDeck, tableWith } from '../engine/helpers.ts';
import { testSeed } from '../helpers/seed.ts';

const extras = (n: number): ObserveExtras => ({
  seatStats: new Array(n).fill(null),
  visiblePersonality: new Array(n).fill(null),
  seatLevels: new Array(n).fill('easy'),
});

const obsOf = (h: HandState, seat: number): Observation => observe(h, seat, extras(h.seats.length));

/** A random legal action: sometimes a fold, mostly a call or check, else a bet or raise of any size. */
function randomLegal(obs: Observation, rng: Rng): PlayerAction {
  const { legal } = obs;
  const r = randInt(rng, 100);
  if (r < 20 && legal.canFold) return { type: 'fold' };
  if (r < 60) return legal.canCheck ? { type: 'check' } : { type: 'call' };
  const bounds = legal.bet ?? legal.raise;
  if (bounds === null) return legal.canCheck ? { type: 'check' } : { type: 'call' };
  const to = bounds.min + randInt(rng, bounds.max - bounds.min + 1);
  return legal.bet !== null ? { type: 'bet', to } : { type: 'raise', to };
}

describe('the stand-in decide', () => {
  it('decides exactly like SimpleBot (scripts/bots/simple.ts) at every decision of 2,000 hands', () => {
    const root = testSeed('51b0000000000000000000000000d3c1');
    const rng = rngFromSeed(root);
    let decisions = 0;
    const actions = new Set<string>();
    for (let game = 0; game < 2000; game++) {
      const seats = 2 + randInt(rng, 8);
      const stacks = Array.from({ length: seats }, () => 200 + randInt(rng, 20000));
      let h = startHand(tableWith(stacks), deriveSeed(root, 'hand', game));
      for (let n = 0; h.phase !== 'complete'; n++) {
        expect(n).toBeLessThan(400);
        if (h.phase === 'betting') {
          const seat = h.toAct as number;
          const obs = obsOf(h, seat);
          const action = simpleBotAction(obs);
          expect(standInAction(obs)).toEqual(action);
          expect(decide(obs).action).toEqual(action);
          decisions++;
          actions.add(action.type);
          // Every other decision is a random legal action, so the bot meets big bets and raises
          // that all-SimpleBot play never makes (it would never fold).
          h = step(h, { kind: 'act', seat, action: n % 2 === 0 ? action : randomLegal(obs, rng) });
        } else {
          h = step(h, { kind: 'advance' });
        }
      }
    }
    expect(decisions).toBeGreaterThan(8000);
    expect([...actions].sort()).toEqual(['bet', 'call', 'check', 'fold', 'raise']);
  }, 60_000);

  it('returns a full Decision: the action, its kind, and neutral values for the rest', () => {
    const table = tableWith([10000, 10000, 10000, 10000, 10000, 10000], { button: 0 });
    const h = rigDeck(deal(table), { holes: { 3: '7c 7d' } });
    const decision = decide(obsOf(h, 3));
    expect(decision).toEqual({
      action: { type: 'raise', to: 300 },
      kind: 'raise',
      ev: {},
      eRandom: 0,
      eRange: 0,
      need: 0,
      bucket: null,
      strength: 'marginal',
      confidence: 'clear',
      alt: null,
      trace: [],
    });
    // JSON all through, so it crosses `postMessage` as it is.
    expect(JSON.parse(JSON.stringify(decision))).toEqual(decision);
  });

  it('names a decision that puts every chip in "allin"', () => {
    const table = tableWith([10000, 10000, 10000, 250, 10000, 10000], { button: 0 });
    const h = rigDeck(deal(table), { holes: { 3: 'Ac Ad' } });
    expect(decide(obsOf(h, 3))).toMatchObject({
      action: { type: 'raise', to: 250 },
      kind: 'allin',
    });
  });

  it('is a pure function of the observation, which it leaves as it was', () => {
    const table = tableWith([10000, 10000, 10000, 10000, 10000, 10000], { button: 0 });
    const obs = obsOf(rigDeck(deal(table), { holes: { 3: 'Ah Td' } }), 3);
    const before = structuredClone(obs);
    expect(decide(obs)).toEqual(decide(structuredClone(obs)));
    expect(obs).toEqual(before);
  });
});
