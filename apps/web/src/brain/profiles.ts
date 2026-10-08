/**
 * Brain profiles (PLAN §9.1, §9.2, Appendix A.5): what `decide()` plays like. A bot's profile is
 * its personality (§9.1: how loose, how aggressive, how sticky, how often it bluffs and slow-plays)
 * at its level (§9.2: how many trials, how much noise, which range model, which sizes, how random
 * its picks are). The coach is the fixed profile `COACH`: the TAG baseline, deterministic, with no
 * noise and the full range model (§8.1 C1).
 *
 * Every number comes from `tunables.ts` (`PERSONALITIES`, `LEVEL_PARAMS`): PLAN and code change
 * together there.
 */
import type { BotLevel, PersonalityId } from '../engine/types.ts';
import { COACH_ID } from './features.ts';
import {
  AGGRESSION_AF_BASE,
  AGGRESSION_SCALE,
  LEVEL_PARAMS,
  PERSONALITIES,
  RANGE_TRIALS,
} from './tunables.ts';
import type { BrainProfile } from './types.ts';

/** §9.1: `ln(AF / 2.5) × 0.1`, added to the scores of bets and raises (§9.4 step 3). */
export function aggressionBias(af: number): number {
  return Math.log(af / AGGRESSION_AF_BASE) * AGGRESSION_SCALE;
}

/** `BrainProfile.id` of a bot: "personality/level" (e.g. "tag/hard"). */
export function profileId(personality: PersonalityId, level: BotLevel): string {
  return `${personality}/${level}`;
}

/**
 * The profile of a bot with `personality` at `level` (§9.1 × §9.2). Easy bluffs a flat 5%
 * whatever its personality (§9.2 "Bluffs: random 5%"); bots may limp (`neverLimp: false`) and
 * mix their picks (`deterministic: false`).
 */
export function profileFor(personality: PersonalityId, level: BotLevel): BrainProfile {
  const p = PERSONALITIES[personality];
  const l = LEVEL_PARAMS[level];
  return {
    id: profileId(personality, level),
    looseness: p.looseness,
    pfrRatio: p.pfrRatio,
    aggressionBias: aggressionBias(p.af),
    bluffFreq: l.bluffFreq ?? p.bluffFreq,
    bluff3betFreq: p.bluff3betFreq,
    stickiness: p.stickiness,
    slowplayFreq: p.slowplayFreq,
    equityNoiseSD: l.equityNoiseSD,
    mcTrials: l.mcTrials,
    rangeModel: l.rangeModel,
    positionAwareness: l.positionAwareness,
    sizing: l.sizing,
    temperature: l.temperature,
    defenseFactor: l.defenseFactor,
    preflopJitter: l.preflopJitter,
    exploit: l.exploit,
    deterministic: false,
    neverLimp: false,
  };
}

/**
 * The coach (Appendix A.5): the 'tag' row of §9.1 with id 'coach', no noise, `eRange` from 4,000
 * trials, the full range model, full position awareness, the §8.7 texture sizes, argmax picks
 * (`temperature` 0, `deterministic`), full defence, no jitter, no bluffs, no slow-plays, no
 * exploits, and never a limp. It bets without value only by the §8.5 semi-bluff and c-bet rules.
 */
export const COACH: BrainProfile = Object.freeze({
  ...profileFor('tag', 'hard'),
  id: COACH_ID,
  equityNoiseSD: 0,
  mcTrials: RANGE_TRIALS,
  rangeModel: 'reweight+stats',
  positionAwareness: 1,
  sizing: 'texture',
  temperature: 0,
  defenseFactor: 1,
  preflopJitter: 0,
  bluffFreq: 0,
  bluff3betFreq: 0,
  slowplayFreq: 0,
  exploit: false,
  deterministic: true,
  neverLimp: true,
});
