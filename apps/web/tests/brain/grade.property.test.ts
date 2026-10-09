/**
 * C8 and the coach's consistency at random decision points (PLAN §8.1 C8, §8.9, §8.11, Known
 * pitfall 34; Stage 6 acceptance 1; fast-check, 2,000 runs). Each run takes one decision point
 * of a hand played by the real engine (any street, 2–9 seats, stacks from one chip to 500 bb,
 * random labels and levels) and goes through `brain.worker`'s job runner with the real coach, as
 * the game does: a `hint` job (the HUD number given, or one run in five left to the worker), then
 * `grade` jobs with the HUD number the grade brings (another one, or none).
 *
 * - C8: following the hint is Best: the recommendation, whatever HUD number either job brought;
 *   in a Close spot the alternative too. One run in four grades the recommendation again from
 *   scratch (`grade()`, no cache): the same result.
 * - No contradiction: a move the coach did not recommend is Best only within 1% of the pot (or as
 *   the close alternative); a move the model rates above the recommendation is exactly Good; a
 *   Mistake or a Blunder always loses EV against the recommendation.
 * - The numbers: loss = max(0, EV(rec) − EV(taken)) from the hint's own EVs, `lossPot` its share
 *   of the pot, `lossMilliBB` an integer; no leak and no feedback for Best and Good; a price row
 *   never contradicts its whole numbers; the trace never shows the HUD number.
 * - Every grade, every leak tag and every F.5 reason shows up in real play.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decide } from '../../src/brain/decide.ts';
import { candidateActions, candidateKey } from '../../src/brain/ev.ts';
import { TEMPLATE_KEYS } from '../../src/brain/explain.ts';
import { coachAnswer, grade, recommendationTrace, sameMove } from '../../src/brain/grade.ts';
import type { Decision, GradeResult, LeakId } from '../../src/brain/types.ts';
import { rngFromSeed } from '../../src/core/rng.ts';
import { observe } from '../../src/engine/observe.ts';
import type { HandState, Observation, PlayerAction } from '../../src/engine/types.ts';
import { createBrainService } from '../../src/workers/brainService.ts';
import type { BrainReply } from '../../src/workers/protocol.ts';
import { FC_SEED } from '../engine/helpers.ts';
import { handArb, randomAction, seedArb } from '../engine/play.ts';
import { decisionPointAt, extrasArb } from './points.ts';

const RUNS = 2000;
const LEAKS: readonly LeakId[] = [
  'open-loose',
  'open-tight',
  'limp',
  'call-pre-wide',
  'fold-pre-much',
  'pushfold',
  'missed-value',
  'bluff-much',
  'overfold',
  'chase',
  'river-call',
  'call-light',
  'sizing',
];

/** The whole number a chance shows as (a Line's `pct` value is in points). */
const shown = (points: number): number => Math.round(points);

describe('grades at random decision points (C8, §8.9, pitfall 34)', () => {
  it(
    'following the hint is Best; the grade never contradicts the coach; every row is reachable',
    { timeout: 900_000 },
    () => {
      let reply: BrainReply | null = null;
      const service = createBrainService({
        decide,
        coach: coachAnswer,
        post: (r) => {
          reply = r;
        },
      });
      const ask = (obs: Observation, taken: PlayerAction, eRandom: number | null, id: number) => {
        reply = null;
        service.handle({ kind: 'grade', jobId: id, epoch: 1, obs, taken, eRandom, decisionId: id });
        const r = reply as BrainReply | null;
        if (r?.kind !== 'grade') throw new Error(`no grade: ${JSON.stringify(r)}`);
        expect(r.jobId).toBe(id);
        return r.result;
      };

      const seen = { runs: 0, close: 0, fresh: 0, graded: 0, nullHint: 0 };
      const grades = new Set<string>();
      const leaks = new Set<string>();
      const rows = new Set<string>();

      /** The invariants of one graded move against the hint `d` of `obs`. */
      const check = (obs: Observation, d: Decision, g: GradeResult, taken: PlayerAction): void => {
        seen.graded++;
        grades.add(g.grade);
        if (g.leak !== null) leaks.add(g.leak);
        expect(g.rec).toEqual(d.action);
        expect(g.taken).toEqual(taken);
        expect(g.lossChips).toBeGreaterThanOrEqual(0);
        expect(g.lossPot).toBeCloseTo(g.lossChips / obs.pot, 12);
        expect(Number.isInteger(g.lossMilliBB)).toBe(true);
        expect(g.lossMilliBB).toBe(Math.round((1000 * g.lossChips) / obs.bb));
        expect(g.trace).toEqual(recommendationTrace(d.trace));
        const close = d.confidence === 'close' && d.alt !== null && sameMove(taken, d.alt);
        if (sameMove(taken, d.action) || close) expect(g.grade).toBe('best');
        const recEV = d.ev[candidateKey(obs.legal, d.action)] as number;
        const takenEV = d.ev[candidateKey(obs.legal, taken)];
        if (takenEV !== undefined) {
          expect(g.lossChips).toBeCloseTo(Math.max(0, recEV - takenEV), 9);
          if (takenEV > recEV + 1e-9 && !sameMove(taken, d.action) && !close) {
            expect(g.grade).toBe('good');
          }
        }
        if (g.grade === 'best' && !sameMove(taken, d.action) && !close) {
          expect(g.lossPot).toBeLessThanOrEqual(0.01 + 1e-9);
        }
        if (g.grade === 'mistake' || g.grade === 'blunder') expect(g.lossChips).toBeGreaterThan(0);
        if (g.grade === 'best' || g.grade === 'good') {
          expect(g.leak).toBeNull();
          expect(g.feedback).toBeNull();
          return;
        }
        rows.add(g.feedback?.key ?? 'feedback.fallback');
        const f = g.feedback;
        if (
          f !== null &&
          (f.key.startsWith('feedback.foldedPrice') || f.key.startsWith('feedback.calledPrice'))
        ) {
          const E = f.params.E;
          const need = f.params.need;
          if (E?.kind !== 'pct' || need?.kind !== 'pct')
            throw new Error('price row without numbers');
          if (f.key.startsWith('feedback.foldedPrice'))
            expect(shown(E.value)).toBeGreaterThan(shown(need.value));
          else expect(shown(E.value)).toBeLessThan(shown(need.value));
        }
      };

      fc.assert(
        fc.property(
          handArb,
          extrasArb,
          fc.nat(),
          seedArb,
          fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { freq: 5 }),
          fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { freq: 3 }),
          ({ h, policySeed }, extrasFor, pick, moveSeed, eHint, eGrade) => {
            const point = decisionPointAt(h, policySeed, pick);
            fc.pre(point !== null);
            const s = point as HandState;
            const obs = observe(s, s.toAct as number, extrasFor(s.seats.length));
            const run = seen.runs++;
            if (eHint === null) seen.nullHint++;

            // The hint job, as the game sends it at the hero's turn.
            reply = null;
            service.handle({ kind: 'hint', jobId: 0, epoch: 1, obs, eRandom: eHint });
            const hintReply = reply as BrainReply | null;
            if (hintReply?.kind !== 'hint') throw new Error('no hint');
            const d = hintReply.decision;

            // C8: the recommendation is Best, with another HUD number or none.
            const followed = ask(obs, d.action, eGrade, run);
            check(obs, d, followed, d.action);
            expect(followed).toMatchObject({ grade: 'best', lossChips: 0, leak: null });
            expect(ask(obs, d.action, null, run).grade).toBe('best');
            if (run % 4 === 0) {
              seen.fresh++;
              expect(grade(obs, d.action, eGrade, run)).toEqual(followed);
            }
            // The close alternative is Best too.
            if (d.confidence === 'close' && d.alt !== null) {
              seen.close++;
              check(obs, d, ask(obs, d.alt, eGrade, run), d.alt);
            }
            // Every §8.9 candidate (the hint's own EVs) and a random legal move (any size).
            for (const c of candidateActions(obs))
              check(obs, d, ask(obs, c.action, eGrade, run), c.action);
            const move = randomAction(obs.legal, rngFromSeed(moveSeed), 60);
            check(obs, d, ask(obs, move, eGrade, run), move);
          },
        ),
        { seed: FC_SEED, numRuns: RUNS },
      );

      expect(seen.runs).toBe(RUNS);
      expect(seen.nullHint).toBeGreaterThan(RUNS / 10);
      expect(seen.close).toBeGreaterThan(RUNS / 20);
      expect(seen.fresh).toBe(RUNS / 4);
      expect([...grades].sort()).toEqual(['best', 'blunder', 'good', 'inaccuracy', 'mistake']);
      expect([...leaks].sort()).toEqual([...LEAKS].sort());
      const f5 = TEMPLATE_KEYS.filter((k) => k.startsWith('feedback.'));
      expect([...rows].sort()).toEqual([...f5].sort());
    },
  );
});
