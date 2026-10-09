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

/**
 * The §9.1 table (VPIP/PFR as fractions). The targets are fixed; `looseness`, `pfrRatio` and the
 * §9.4 biases are calibrated by self-play against them (§9.7, chunk 5.11: Rock's, Station's and
 * Maniac's looseness, LAG's pfrRatio). TAG's row is also the coach's (`COACH`), so it stays.
 */
export const PERSONALITIES: Readonly<Record<PersonalityId, Personality>> = {
  rock: {
    vpip: 0.12,
    pfr: 0.09,
    af: 1.5,
    looseness: 0.35,
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
    pfrRatio: 1,
    stickiness: 1.1,
    bluffFreq: 0.18,
    bluff3betFreq: 0.08,
    slowplayFreq: 0.05,
  },
  station: {
    vpip: 0.45,
    pfr: 0.07,
    af: 0.7,
    looseness: 3.4,
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
    looseness: 3.5,
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

// --- 5.5 guardrails / EV ---

/** §8.8 rule 2: never fold with a per-opponent strength `p` at or above this. */
export const GUARD_NEVER_FOLD_P = 0.95;
/** §8.8 rule 3: never call a river bet with `eRange` below this. */
export const GUARD_RIVER_MIN_EQUITY = 0.03;
/** §8.8 rule 4: facing an all-in, always call when `eRange ≥ need + GUARD_ALLIN_CALL_MARGIN`. */
export const GUARD_ALLIN_CALL_MARGIN = 0.15;
/** §8.8 rule 4: facing an all-in, never call when `eRange < need − GUARD_ALLIN_FOLD_MARGIN`. */
export const GUARD_ALLIN_FOLD_MARGIN = 0.25;

/** §8.9: each opponent continues with `c = clamp(MDF × stickiness, CONTINUE_MIN, CONTINUE_MAX)`. */
export const CONTINUE_MIN = 0.15;
export const CONTINUE_MAX = 0.95;
/** §8.9 candidates: postflop bets as fractions of the pot (all-in is added separately). */
export const EV_BET_FRACTIONS: readonly number[] = [1 / 3, 1 / 2, 2 / 3, 3 / 4, 1];
/** §8.9 candidates: raises to these multiples of the bet (plus the minimum and all-in). */
export const EV_RAISE_MULTIPLES: readonly number[] = [2.5, 3, 4];
/** §8.9 candidates: preflop opens to these many big blinds, plus one per limper (and all-in). */
export const EV_OPEN_BB: readonly number[] = [2.5, 3, 4];
export const EV_OPEN_PER_LIMPER_BB = 1;
/** §8.9: a spot is Close when the top two candidate EVs are within this share of the pot… */
export const CLOSE_SPOT_POT = 0.03;
/** …and Clear when they are more than this share apart. */
export const CLEAR_SPOT_POT = 0.1;

// --- 5.3 preflop / push-fold ---

/** Open size in big blinds; the small blind (3+ handed) opens bigger; +1 bb per limper (§8.3). */
export const OPEN_SIZE_BB = 2.5;
export const OPEN_SIZE_SB_BB = 3;
export const OPEN_SIZE_PER_LIMPER_BB = 1;
/** 3-bet to 3 × the open in position, 4 × out of position, + 1 × the open per caller (§8.3). */
export const THREE_BET_SIZE_IP = 3;
export const THREE_BET_SIZE_OOP = 4;
export const THREE_BET_SIZE_PER_CALLER = 1;
/** 4-bet to 2.3 × the 3-bet (§8.3). */
export const FOUR_BET_SIZE = 2.3;
/** Shove instead when the raise-to would be at least this share of the hero's chips (§8.3). */
export const SHOVE_INSTEAD_SHARE = 0.35;

/** Isolate limpers with the top 0.7 × openPct(k); the big blind only below 15% (heads-up 30%). */
export const ISOLATE_FACTOR = 0.7;
export const BB_ISOLATE_PCT = 15;
export const BB_ISOLATE_PCT_HEADS_UP = 30;

/** A raiser's range is clamped to 3..100% (§8.3 step 1). */
export const VILLAIN_RANGE_MIN_PCT = 3;
/** Facing a 3-bet the 3-bettor holds max(3, 0.25 × the opener's range); facing a 4-bet+ 2.5%. */
export const THREE_BET_RANGE_SHARE = 0.25;
export const FOUR_BET_RANGE_PCT = 2.5;
/** Weighted Monte Carlo trials of E when callers are already in (§8.3 step 2). */
export const PREFLOP_MULTIWAY_TRIALS = 1500;

/** Realisation R (§8.3 step 3, HEURISTIC): in position, out of position, gapped offsuit factor. */
export const PREFLOP_R_IP = 0.95;
export const PREFLOP_R_OOP = 0.8;
export const PREFLOP_R_GAPPED_OFFSUIT = 0.9;
/** "Offsuit unpaired hands with a rank gap ≥ 3" (K9o, KTo, A5o; not KJo). */
export const PREFLOP_GAP_MIN = 3;
/** Set-mining implied odds of a pocket pair: 0.118 × 0.4 × effStackAfterCall (§8.3 step 4). */
export const SET_HIT_CHANCE = 0.118;
export const SET_PAYOFF_SHARE = 0.4;
/** The SET_MINING reason names a call with a pocket pair up to 99 (rank index 7; twos = 0). */
export const SET_MINING_MAX_PAIR_RANK = 7;

/** Re-raise for value: 3-bet or 4-bet with E ≥ 0.58; all-in against a 4-bet+ with E ≥ 0.50. */
export const RERAISE_VALUE_EQUITY = 0.58;
export const ALLIN_VS_FOUR_BET_EQUITY = 0.5;
/** Calling a raise needs rankPct ≤ min(50, 1.5 × V) (or the big blind); a 3-bet 1.5 × V. */
export const CALL_RANGE_FACTOR = 1.5;
export const CALL_RANGE_CAP_PCT = 50;

/** §8.4: push or fold when effBB ≤ 12; with limpers shove only the top 0.8 × pushPct. */
export const PUSH_FOLD_MAX_BB = 12;
export const PUSH_LIMPERS_FACTOR = 0.8;

// --- 5.4 postflop / sizing ---
// §8.5 postflop policy

/** Realisation `R` (§8.5 step 2): river and in position 1; out of position flop 0.85, turn 0.92. */
export const REALISATION_FULL = 1;
export const REALISATION_OOP_FLOP = 0.85;
export const REALISATION_OOP_TURN = 0.92;
/** Subtracted from `R` in a multiway pot (every street, the river included). */
export const REALISATION_MULTIWAY = 0.05;
/** Implied odds: `P_hit × IMPLIED_SHARE × min(stackBehind, winPot + toCall)`. */
export const IMPLIED_SHARE = 0.5;
/** SPR bands of the commitment rule (§8.5 step 6): ≤ 3, (3, 6], above 6. */
export const SPR_COMMIT_ALL_IN = 3;
export const SPR_COMMIT = 6;
/** Heads-up, SPR ≤ 3: "top pair or better" is read as `p ≥` this. */
export const COMMIT_P_HEADS_UP = 0.6;
/** SPR > 6: a one-pair hand bets for value on at most this many streets. */
export const ONE_PAIR_VALUE_STREETS = 2;
/** River thin value in position (Medium): `p ≥` this. */
export const RIVER_THIN_VALUE_P = 0.6;

// §8.7 bet sizing (fractions of the pot; raises as multiples of the bet faced)

export const SIZE_DRY = 1 / 3;
/** Turn value bet on a Dry board (also the river value bet of a Strong hand on a Dry board). */
export const SIZE_DRY_LATE_VALUE = 1 / 2;
export const SIZE_WET = 2 / 3;
export const SIZE_VERY_WET = 3 / 4;
export const SIZE_RIVER_MONSTER = 3 / 4;
/** River Monster with `spr ≤ RIVER_POT_SPR`: a full pot. */
export const SIZE_RIVER_MONSTER_LOW_SPR = 1;
export const RIVER_POT_SPR = 1.5;
export const SIZE_THIN_VALUE = 1 / 3;
export const SIZE_RIVER_BLUFF = 2 / 3;
/** §8.5 step 5 semi-bluff: 1/2 pot on a Dry board, 2/3 on Wet or Very wet. */
export const SIZE_SEMI_BLUFF_DRY = 1 / 2;
export const SIZE_SEMI_BLUFF_WET = 2 / 3;
export const SIZE_CBET = 1 / 3;
/** Raise vs a bet: to = this × the bet faced (in position / out of position). */
export const RAISE_MULT_IP = 3;
export const RAISE_MULT_OOP = 3.5;
/** All-in when a bet would leave less than this share of the pot (after a call) behind. */
export const ALL_IN_BEHIND_SHARE = 0.25;
/** All-in for any bet or raise when `spr ≤` this. */
export const ALL_IN_SPR = 1;

// §9.2 bot size sets: Easy 'half' (1/2 pot), Medium 'two' (1/2 and pot)

export const SIZE_HALF = 1 / 2;
export const SIZE_POT = 1;
/** 'two': a §8.7 bet fraction at least this big becomes a pot-size bet, a smaller one 1/2 pot. */
export const TWO_SIZES_POT_FROM = 3 / 4;

// --- 5.7 profiles / decide ---

/**
 * §9.1 `aggressionBias = 2.1 × ln(AF / 2.5)`, like every §9.4 step 3 bias in units of the level's
 * temperature `T`: the TAG's AF scores no bias. Calibrated by self-play (§9.7, chunk 5.11).
 */
export const AGGRESSION_AF_BASE = 2.5;
export const AGGRESSION_SCALE = 2.1;

/** The §9.2 parameters of one bot level (`profileFor` adds the §9.1 personality). */
export interface LevelParams {
  /** Monte Carlo trials of `eRange` (and of `E_called`, at most `E_CALLED_TRIALS`). */
  mcTrials: number;
  /** σ of the Gaussian noise on the perceived equity (§9.4 step 1). */
  equityNoiseSD: number;
  rangeModel: 'random' | 'static' | 'reweight' | 'reweight+stats';
  /** 0: `openPct(4)` everywhere; 0.5: the mean of `openPct(k)` and `openPct(4)`; 1: `openPct(k)`. */
  positionAwareness: 0 | 0.5 | 1;
  sizing: 'half' | 'two' | 'texture' | 'texture+exploit';
  /** Softmax temperature `T` (§9.4 step 5). */
  temperature: number;
  /** Share of MDF defended against bets (§9.4 step 4). */
  defenseFactor: number;
  /** Preflop threshold jitter `U(−j, j)` (§9.4 step 2). */
  preflopJitter: number;
  /** §9.2 "Bluffs": Easy bluffs a flat 5% whatever its personality; null = the personality's. */
  bluffFreq: number | null;
  exploit: boolean;
}

/**
 * §9.2 difficulty → engine parameters. Hard and Expert come from the same table so that
 * `profileFor` is total; Stage 7 adds their balanced bluffs and the Expert exploits.
 */
export const LEVEL_PARAMS: Readonly<Record<BotLevel, LevelParams>> = {
  easy: {
    mcTrials: 200,
    equityNoiseSD: 0.12,
    rangeModel: 'random',
    positionAwareness: 0,
    sizing: 'half',
    temperature: 0.25,
    defenseFactor: 0.55,
    preflopJitter: 0.4,
    bluffFreq: 0.05,
    exploit: false,
  },
  medium: {
    mcTrials: 500,
    equityNoiseSD: 0.07,
    rangeModel: 'static',
    positionAwareness: 0.5,
    sizing: 'two',
    temperature: 0.12,
    defenseFactor: 0.7,
    preflopJitter: 0.2,
    bluffFreq: null,
    exploit: false,
  },
  hard: {
    mcTrials: 1500,
    equityNoiseSD: 0.03,
    rangeModel: 'reweight',
    positionAwareness: 1,
    sizing: 'texture',
    temperature: 0.06,
    defenseFactor: 0.85,
    preflopJitter: 0.1,
    bluffFreq: null,
    exploit: false,
  },
  expert: {
    mcTrials: 3000,
    equityNoiseSD: 0.01,
    rangeModel: 'reweight+stats',
    positionAwareness: 1,
    sizing: 'texture+exploit',
    temperature: 0.04,
    defenseFactor: 0.95,
    preflopJitter: 0.05,
    bluffFreq: null,
    exploit: true,
  },
};

/**
 * §8.10 strength meter: Weak below 0.35, Marginal from 0.35; Decent, Strong and Monster from the
 * §8.2 bucket bounds (`BUCKET_MEDIUM`, `BUCKET_STRONG`, `BUCKET_MONSTER`).
 */
export const STRENGTH_MARGINAL = 0.35;

/**
 * §9.4 step 3 score biases, in units of the level's temperature `T` (a candidate scores
 * `EV/pot + T × bias`): a bias weighs the same at every level, and only the EVs count for more at
 * a lower `T`. Calibrated by self-play (§9.7, chunk 5.11). The rule action `A*` after the flop and
 * before it (where `A*` carries the personality's ranges and the EVs' fold equity rates a raise
 * with any two cards near break-even); a call, per unit of stickiness above 1.
 */
export const MIX_RULE_BONUS = 1;
export const MIX_RULE_BONUS_PREFLOP = 3.5;
export const MIX_CALL_STICKINESS = 3;
/** §9.4 step 3: a bet or raise with Air (a bluff), a Monster's check on a Dry board (a slow-play). */
export const MIX_BLUFF_BONUS = 2.5;
export const MIX_SLOWPLAY_BONUS = 2.5;

// --- 6.1 grading (§8.9 "Grade") ---

/**
 * The §8.9 grade table, by `lossPot` (the EV lost against the recommendation over the pot before
 * the action): Best ≤ 1%, Good ≤ 5%, Inaccuracy ≤ 15%, Mistake ≤ 40%, above that a Blunder.
 */
export const GRADE_BEST_POT = 0.01;
export const GRADE_GOOD_POT = 0.05;
export const GRADE_INACCURACY_POT = 0.15;
export const GRADE_MISTAKE_POT = 0.4;
/**
 * The bb floors: a loss below 0.25 bb is at most Good, below 1 bb at most an Inaccuracy; a
 * Blunder, from any path (the price signal included), needs a loss of at least 5 bb, else Mistake.
 */
export const GRADE_GOOD_MAX_BB = 0.25;
export const GRADE_INACCURACY_MAX_BB = 1;
export const GRADE_BLUNDER_MIN_BB = 5;
/**
 * The price signal: a call with `E·R < need − 0.15` is at least a Mistake and below `need − 0.30`
 * a Blunder; a fold with `E·R > need + 0.15` at least a Mistake and above `need + 0.30` a Blunder.
 */
export const PRICE_SIGNAL_MISTAKE = 0.15;
export const PRICE_SIGNAL_BLUNDER = 0.3;
/** A bet or raise whose "to" amount is within ±15% of the recommended one is the recommendation. */
export const SAME_SIZE_SHARE = 0.15;
/**
 * Appendix F.5 "Folded a strong preflop hand": a hand in the top half of starting hands (the cap
 * of the coach's calls of a raise, §8.3), so "It is strong enough to play" is plainly true.
 */
export const FEEDBACK_STRONG_PCT = 50;
