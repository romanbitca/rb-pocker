/**
 * Stage 6 acceptance 6 in Node: grading adds at most 50 ms after the action when the EVs are
 * cached, at most 150 ms when an exact-size EV is needed (PLAN §18, §8.11). Timed as `brain.worker`
 * runs it: the `hint` job comes first (at the hero's turn, the HUD number not known yet), then the
 * `grade` job after the action (with the HUD's final number), through the job runner, so the time
 * includes the observation key, the cache lookup, the grade and its F.5 reason. Three cases per
 * decision point: the recommendation and another candidate (cached EVs), and a bet or raise of a
 * size that is not a candidate (one exact-size EV, 800 `E_called` trials). A grade with no hint
 * before it (a full deliberation) is reported too. The corpus is every decision point of 6-max
 * hands at 100 bb played by the random legal policy, every street. A p95 above the budget fails (a
 * CI runner is slower than a laptop, but the cached grade is a fraction of a millisecond); the
 * rest is printed. The coverage run leaves this file out (instrumented code is slower).
 */
import { describe, expect, it } from 'vitest';
import { decide } from '../../src/brain/decide.ts';
import { candidateKey } from '../../src/brain/ev.ts';
import { coachAnswer } from '../../src/brain/grade.ts';
import type { Decision } from '../../src/brain/types.ts';
import { deriveSeed, rngFromSeed } from '../../src/core/rng.ts';
import { observe } from '../../src/engine/observe.ts';
import { startHand } from '../../src/engine/start.ts';
import { step } from '../../src/engine/step.ts';
import type { HandState, Observation, PlayerAction } from '../../src/engine/types.ts';
import { createBrainService } from '../../src/workers/brainService.ts';
import type { BrainReply } from '../../src/workers/protocol.ts';
import { tableWith } from '../engine/helpers.ts';
import { randomInput } from '../engine/play.ts';
import { env } from '../helpers/seed.ts';
import { extrasFor } from './fixtures.ts';

const SEED = '20261009000000000000000000006100';
const HANDS = 40;
const CACHED_P95_BUDGET_MS = 50;
const EXACT_P95_BUDGET_MS = 150;
/** Grades with nothing cached are timed on every fourth point (each is a full deliberation). */
const MISS_EVERY = 4;
/** Decision points of the untimed warm-up pass (JIT). */
const WARM_UP = 120;

/** Every decision point of `HANDS` 6-max hands at 100 bb. */
function corpus(): Observation[] {
  const out: Observation[] = [];
  for (let i = 0; i < HANDS; i++) {
    const rng = rngFromSeed(deriveSeed(SEED, 'policy', i));
    let h: HandState = startHand(
      tableWith(new Array<number>(6).fill(10000)),
      deriveSeed(SEED, 'hand', i),
    );
    for (let n = 0; n < 400 && h.phase !== 'complete'; n++) {
      if (h.phase === 'betting') out.push(observe(h, h.toAct as number, extrasFor(6)));
      h = step(h, randomInput(h, rng, 20));
    }
  }
  return out;
}

/** A bet or raise of a legal size that is not one of the hint's candidates, if there is one. */
function offCandidateSize(obs: Observation, d: Decision): PlayerAction | null {
  const type = obs.legal.bet !== null ? 'bet' : obs.legal.raise !== null ? 'raise' : null;
  if (type === null) return null;
  const { min, max } = obs.legal[type] as { min: number; max: number };
  for (let k = 1; k <= 40; k++) {
    const to = Math.min(max - 1, min + Math.round((k * (max - min)) / 41));
    if (to < min) break;
    const action: PlayerAction = { type, to };
    if (d.ev[candidateKey(obs.legal, action)] === undefined) return action;
  }
  return null;
}

function quantiles(times: number[]): { p50: number; p95: number; max: number } {
  const sorted = [...times].sort((a, b) => a - b);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number;
  return { p50: at(0.5), p95: at(0.95), max: sorted.at(-1) as number };
}

const ms = (x: number): string => `${x.toFixed(2)} ms`;

describe('grading time (Stage 6 acceptance 6, §8.11)', () => {
  it(
    'a grade after the hint takes ≤ 50 ms (cached EVs), ≤ 150 ms with an exact-size EV (p95, Node)',
    { timeout: 300_000 },
    () => {
      const points = corpus();
      expect(points.length).toBeGreaterThan(400);
      let reply: BrainReply | null = null;
      const fresh = () =>
        createBrainService({
          decide,
          coach: coachAnswer,
          post: (r) => {
            reply = r;
          },
        });
      let service = fresh();
      const timed = (obs: Observation, taken: PlayerAction, eRandom: number): number => {
        reply = null;
        const t = performance.now();
        service.handle({ kind: 'grade', jobId: 1, epoch: 1, obs, taken, eRandom, decisionId: 0 });
        const elapsed = performance.now() - t;
        if ((reply as BrainReply | null)?.kind !== 'grade') throw new Error('no grade');
        return elapsed;
      };

      const pass = (record: boolean) => {
        const cached: number[] = [];
        const exact: number[] = [];
        const miss: number[] = [];
        (record ? points : points.slice(0, WARM_UP)).forEach((obs, i) => {
          service.handle({ kind: 'hint', jobId: 0, epoch: 1, obs, eRandom: null });
          const hintReply = reply as BrainReply | null;
          if (hintReply?.kind !== 'hint') throw new Error('no hint');
          const d = hintReply.decision;
          const hud = d.eRandom; // the HUD's final number, known by the time the hero acts
          cached.push(timed(obs, d.action, hud));
          const other = obs.legal.canCheck ? { type: 'check' as const } : { type: 'fold' as const };
          if (other.type !== d.action.type) cached.push(timed(obs, other, hud));
          const off = offCandidateSize(obs, d);
          if (off !== null) exact.push(timed(obs, off, hud));
          if (record && i % MISS_EVERY === 0) {
            service = fresh(); // nothing cached: the grade deliberates
            miss.push(timed(obs, d.action, hud));
          }
        });
        return { cached, exact, miss };
      };

      pass(false); // warm-up (JIT)
      service = fresh();
      const run = pass(true);
      const cached = quantiles(run.cached);
      const exact = quantiles(run.exact);
      const miss = quantiles(run.miss);
      const line =
        `grading times over ${points.length} decision points (through the worker's job runner): ` +
        `cached EVs (${run.cached.length}) p50 ${ms(cached.p50)}, p95 ${ms(cached.p95)}, max ${ms(cached.max)} (budget ${CACHED_P95_BUDGET_MS} ms); ` +
        `exact-size EV (${run.exact.length}) p50 ${ms(exact.p50)}, p95 ${ms(exact.p95)}, max ${ms(exact.max)} (budget ${EXACT_P95_BUDGET_MS} ms); ` +
        `no hint cached (${run.miss.length}) p50 ${ms(miss.p50)}, p95 ${ms(miss.p95)}, max ${ms(miss.max)}`;
      console.info(line);
      if (env('GITHUB_ACTIONS') === 'true') console.info(`::notice title=Grading speed::${line}`);
      expect(run.exact.length).toBeGreaterThan(points.length / 4);
      expect(cached.p95).toBeLessThanOrEqual(CACHED_P95_BUDGET_MS);
      expect(exact.p95).toBeLessThanOrEqual(EXACT_P95_BUDGET_MS);
    },
  );
});
