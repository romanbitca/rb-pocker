/**
 * Every HEURISTIC constant of the brain lives here and nowhere else (PLAN §8.11): a change to one
 * of them must keep every Appendix E golden spot green. Each block names the PLAN section it
 * comes from; the numbers are copied from there, so PLAN and code change together.
 *
 * Types only from engine/types (PLAN §2.1): the brain never runs engine code.
 */
import type { BotLevel, PersonalityId } from '../engine/types.ts';

// ── §8.2 features ──────────────────────────────────────────────────────────────────────────────

/** Weighted Monte Carlo trials behind the coach's `eRange` (§8.2; `COACH.mcTrials`). */
export const RANGE_TRIALS = 4_000;
/** §8.11 fallback when `#bench` misses the hint budget. */
export const RANGE_TRIALS_FALLBACK = 2_500;
/** Trials of `E_called` against the continuing part of each range (§8.9). */
export const E_CALLED_TRIALS = 800;
/** §8.11 fallback of `E_CALLED_TRIALS`. */
export const E_CALLED_TRIALS_FALLBACK = 500;

/** Bucket lower bounds on the per-opponent strength `p` (§8.2, Loki thresholds). */
export const BUCKET_MONSTER = 0.85;
export const BUCKET_STRONG = 0.65;
export const BUCKET_MEDIUM = 0.45;
/** A hand below Medium is a Draw with at least this many outs before the river (§8.2). */
export const DRAW_MIN_OUTS = 8;

/** Texture score `W` (§8.2): Dry `W ≤ 1`, Wet `W == 2`, Very wet `W ≥ 3`. */
export const TEXTURE_WET = 2;
export const TEXTURE_VERY_WET = 3;
/** Adjacent sorted board ranks this close (or closer) count toward `W`, at most this many. */
export const TEXTURE_MAX_GAP = 2;
export const TEXTURE_MAX_CONNECTED = 2;

/** RANGE_ADJUST shows both equities when they differ by at least this much (§8.10). */
export const RANGE_ADJUST_GAP = 0.05;

// ── §8.3 preflop: opening ranges ───────────────────────────────────────────────────────────────

/** `openPct(k)` in percent for k = 1..8 players behind (index k − 1); k = 1 is the SB 3+ handed. */
export const OPEN_PCT: readonly number[] = [40, 43, 27, 21, 17, 15, 13, 11];
/** Heads-up the button (the small blind) opens this share (§8.3). */
export const OPEN_PCT_HEADS_UP = 80;

/**
 * §8.3 `openPct(k)`: percent of all combos opened with `k` players still to act behind; `k` is
 * clamped to 1..8. Heads-up (two players dealt in) it is `OPEN_PCT_HEADS_UP` whatever `k`.
 */
export function openPct(k: number, headsUp: boolean): number {
  if (headsUp) return OPEN_PCT_HEADS_UP;
  const i = Math.min(OPEN_PCT.length, Math.max(1, Math.round(k))) - 1;
  return OPEN_PCT[i] as number;
}

// ── §8.6 opponent ranges ───────────────────────────────────────────────────────────────────────

/** Preflop priors, "top X%" by first voluntary action (§8.6 table; before looseness). */
export const PRIOR_LIMP_PCT = 50;
export const PRIOR_CALL_PCT = 25;
export const PRIOR_THREE_BET_PCT = 6;
export const PRIOR_FOUR_BET_PCT = 2.5;
/** An all-in raise of at most this many big blinds reads as a push (`pushPct(k, S)`). */
export const PRIOR_PUSH_MAX_BB = 15;
/** Callers of a raise would have 3-bet their best hands: the top 4% get weight 0.3. */
export const PRIOR_CALL_TRAP_PCT = 4;
/** A big blind that only checks its option would have raised its best hands: top 15% get 0.3. */
export const PRIOR_BB_CHECK_TRAP_PCT = 15;
/** The weight of those "would have raised" hands. */
export const PRIOR_TRAP_WEIGHT = 0.3;
/** Soft edge: weight 1 up to X, then linearly down to `MIN_WEIGHT` at `SOFT_EDGE × X`. */
export const SOFT_EDGE = 1.25;
/** The floor of every prior weight and every re-weighting factor: no hand becomes impossible. */
export const MIN_WEIGHT = 0.01;
/**
 * Numerical guard, not a poker rule: after each re-weighting a range is scaled so its largest
 * weight is 1, and no unblocked weight goes below this (hundreds of 0.01 factors would otherwise
 * underflow to 0 and make a hand impossible).
 */
export const WEIGHT_UNDERFLOW_FLOOR = 1e-12;

/** Loki re-weighting (§8.6): a bet or raise of size B has μ = base + slope × min(B / pot, 1). */
export const LOKI_BET_MU_BASE = 0.5;
export const LOKI_BET_MU_SLOPE = 0.3;
/** μ of a call. */
export const LOKI_CALL_MU = 0.4;
/** σ of bets, raises and calls. */
export const LOKI_SIGMA = 0.2;
/** A check keeps every combo except those with EHS above this, which get `CHECK_STRONG_WEIGHT`. */
export const CHECK_STRONG_EHS = 0.8;
export const CHECK_STRONG_WEIGHT = 0.6;
/** Observed aggression moves the bet/raise μ: AF above `AF_HIGH` → −shift, below `AF_LOW` → +shift. */
export const AF_HIGH = 3;
export const AF_LOW = 1;
export const AF_MU_SHIFT = 0.08;
/** EHS draw bonus on the flop (§8.6); halved on the turn, none on the river. */
export const DRAW_BONUS_FLUSH = 0.15;
export const DRAW_BONUS_OPEN_ENDED = 0.12;
export const DRAW_BONUS_GUTSHOT = 0.06;
export const DRAW_BONUS_TURN_FACTOR = 0.5;
/** Sampling: redraws after a card collision before a uniform draw among the free cards. */
export const SAMPLE_MAX_COLLISIONS = 20;

// ── §9.1 personalities, §9.3 level lists, §9.5 seat statistics ─────────────────────────────────

export interface Personality {
  /** Targets as fractions: VPIP and PFR of all hands, AF = postflop (bets + raises) / calls. */
  vpip: number;
  pfr: number;
  af: number;
  looseness: number;
  pfrRatio: number;
  stickiness: number;
  bluffFreq: number;
  bluff3betFreq: number;
  slowplayFreq: number;
}

/** The §9.1 table (VPIP/PFR as fractions). */
export const PERSONALITIES: Readonly<Record<PersonalityId, Personality>> = {
  rock: {
    vpip: 0.12,
    pfr: 0.09,
    af: 1.5,
    looseness: 0.55,
    pfrRatio: 0.75,
    stickiness: 0.8,
    bluffFreq: 0.03,
    bluff3betFreq: 0,
    slowplayFreq: 0.1,
  },
  tag: {
    vpip: 0.22,
    pfr: 0.18,
    af: 2.5,
    looseness: 1,
    pfrRatio: 0.82,
    stickiness: 1,
    bluffFreq: 0.1,
    bluff3betFreq: 0.03,
    slowplayFreq: 0.1,
  },
  lag: {
    vpip: 0.32,
    pfr: 0.26,
    af: 3.5,
    looseness: 1.45,
    pfrRatio: 0.8,
    stickiness: 1.1,
    bluffFreq: 0.18,
    bluff3betFreq: 0.08,
    slowplayFreq: 0.05,
  },
  station: {
    vpip: 0.45,
    pfr: 0.07,
    af: 0.7,
    looseness: 2,
    pfrRatio: 0.15,
    stickiness: 1.4,
    bluffFreq: 0.02,
    bluff3betFreq: 0,
    slowplayFreq: 0.3,
  },
  maniac: {
    vpip: 0.6,
    pfr: 0.45,
    af: 5,
    looseness: 2.7,
    pfrRatio: 0.75,
    stickiness: 1.2,
    bluffFreq: 0.35,
    bluff3betFreq: 0.15,
    slowplayFreq: 0,
  },
};

/**
 * §9.3 personality list per level. The engine deals personalities from its own copy
 * (`engine/table.ts` `PERSONALITY_LISTS`, which the brain may not import); a test keeps the two
 * equal. The population prior of a seat without a visible label averages its level's list (§9.5).
 */
export const LEVEL_PERSONALITIES: Readonly<Record<BotLevel, readonly PersonalityId[]>> = {
  easy: ['station', 'station', 'maniac', 'station', 'rock', 'station', 'lag', 'station'],
  medium: ['tag', 'station', 'lag', 'rock', 'station', 'maniac', 'tag', 'station'],
  hard: ['tag', 'lag', 'rock', 'tag', 'lag', 'station', 'tag', 'rock'],
  expert: ['tag', 'lag', 'tag', 'lag', 'tag', 'rock', 'lag', 'tag'],
};

/** Shrinkage toward the prior: `est = (x + k·prior) / (n + k)` with k = 20 opportunities (§9.5). */
export const STATS_PRIOR_WEIGHT = 20;
/** `loosenessEstimate = clamp(estVPIP / 0.22, 0.5, 3.0)` (§9.5). */
export const LOOSENESS_BASE_VPIP = 0.22;
export const LOOSENESS_MIN = 0.5;
export const LOOSENESS_MAX = 3;
