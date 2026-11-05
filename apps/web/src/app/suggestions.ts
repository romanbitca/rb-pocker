/**
 * Level suggestions (PLAN §10.4, chunk 8.4): never automatic. A card on the hand summary or on
 * Stats → Progress offers one level change, and the player says yes or "Not now".
 *
 * - **Bots up:** the last 300 clean hands (no Undo) at the table's bot level net ≥ +10 bb/100 and
 *   their decision score is ≥ 80 → one bot level up. Not at Expert.
 * - **Bots down:** the last 200 hands at that level (clean or practice) ≤ −30 bb/100 and a decision
 *   score < 60 → one bot level down. Not at Easy.
 * - **Coach down:** the last 100 graded decisions taken without the hint (`hintSeen` false; the
 *   Beginner level's decisions never count, its hint is on show): Best + Good ≥ 75% and Mistake +
 *   Blunder ≤ 5% → one coach level less help. Not at Exam.
 *
 * A rule is silent until it has its full sample. "Decision score" = Σ `scorePoints` ÷ Σ `graded`
 * over the same hands (§14.4); hands without a graded decision leave it undefined, and an undefined
 * score meets neither threshold. Sums stay integers: bb/100 ≥ 10 is Σ netMilliBB ≥ 100 · hands. The
 * bot rules read `stats.recentHands` (oldest first: the hands whose bots all played at the table's
 * level, §14.4), the coach rule the `DecisionRecord`s of the `pc.v1.hands` ring, newest first. The
 * bot rules come first, then the coach rule; one card at a time.
 *
 * A "Not now" hides that rule's card for 7 days (`flags.suggestionSnoozedUntil`); a yes hides it
 * too, and a yes to the bots hides both bot rules (after easier bots, the old hands at the easier
 * level would at once say "Try Medium" again).
 *
 * The rules live in a lazy chunk (§15.3): the controller loads this module when the Table or Stats
 * opens, where the card can show, and hands it a `SuggestionHost`. Like `app/dataTools.ts` it
 * imports nothing at run time (pitfall 47); the ring's records come through the host.
 */
import type { Grade } from '../brain/types.ts';
import type { BotLevel, CoachLevel } from '../engine/types.ts';
import type { HandRecord, Profile, ProfileFlags, RecentHand, Settings } from '../persist/schema.ts';

export type SuggestionRule = keyof ProfileFlags['suggestionSnoozedUntil'];

/** The card's offer: from the level in force to the next one (the card names `to`). */
export type Suggestion =
  | { rule: 'botsUp' | 'botsDown'; from: BotLevel; to: BotLevel }
  | { rule: 'coachDown'; from: CoachLevel; to: CoachLevel };

/** §10.4 numbers. */
export const SUGGESTION = {
  up: { hands: 300, bbPer100: 10, score: 80 },
  down: { hands: 200, bbPer100: -30, score: 60 },
  coach: { decisions: 100, goodPct: 75, badPct: 5 },
  /** "at most once per 7 days after 'Not now'". */
  snoozeDays: 7,
} as const;

/** Easiest first (as `BOT_LEVELS`, kept here so this chunk imports nothing). */
const BOT_ORDER: readonly BotLevel[] = ['easy', 'medium', 'hard', 'expert'];
/** Most help first (as `COACH_LEVELS`). */
const COACH_ORDER: readonly CoachLevel[] = ['beginner', 'intermediate', 'advanced', 'exam'];

/**
 * The last `rule.hands` of `hands` meet a bot rule: up, bb/100 ≥ its number and a score ≥ its
 * score; down, bb/100 ≤ its number and a score < its score. Fewer hands, or no graded decision
 * among them, meet neither.
 */
function meets(
  hands: readonly RecentHand[],
  rule: { readonly hands: number; readonly bbPer100: number; readonly score: number },
  up: boolean,
): boolean {
  const last = hands.slice(-rule.hands);
  if (last.length < rule.hands) return false;
  let net = 0;
  let points = 0;
  let graded = 0;
  for (const h of last) {
    net += h.netMilliBB;
    points += h.scorePoints;
    graded += h.graded;
  }
  if (graded === 0) return false;
  // bb/100 = Σ netMilliBB / 1000 / hands × 100, and score = Σ points / Σ graded, without division.
  const bb = net * 100 - rule.bbPer100 * 1000 * rule.hands;
  const score = points - rule.score * graded;
  return up ? bb >= 0 && score >= 0 : bb <= 0 && score < 0;
}

/** The bot rules for the table's level `level` (`recent`: `stats.recentHands`, oldest first). */
export function botSuggestion(recent: readonly RecentHand[], level: BotLevel): Suggestion | null {
  const at = recent.filter((h) => h.botLevel === level);
  const i = BOT_ORDER.indexOf(level);
  const up = BOT_ORDER[i + 1];
  if (
    up !== undefined &&
    meets(
      at.filter((h) => !h.assisted),
      SUGGESTION.up,
      true,
    )
  ) {
    return { rule: 'botsUp', from: level, to: up };
  }
  const down = BOT_ORDER[i - 1];
  if (down !== undefined && meets(at, SUGGESTION.down, false)) {
    return { rule: 'botsDown', from: level, to: down };
  }
  return null;
}

/** A hand's graded decisions without the hint, outside Beginner, newest first (§10.4). */
function ownGrades(record: HandRecord): Grade[] {
  if (record.coachLevel === 'beginner') return [];
  const grades: Grade[] = [];
  for (let d = record.decisions.length - 1; d >= 0; d--) {
    const decision = record.decisions[d] as HandRecord['decisions'][number];
    if (decision.grade !== null && !decision.hintSeen) grades.push(decision.grade);
  }
  return grades;
}

/**
 * The coach rule's sample: the grades of `hands` (ring records, oldest first) that count, newest
 * first, at most 100. Undone decisions count, as in the decision score (§11.4).
 */
export function coachSample(hands: readonly HandRecord[]): Grade[] {
  const grades: Grade[] = [];
  for (let h = hands.length - 1; h >= 0 && grades.length < SUGGESTION.coach.decisions; h--) {
    grades.push(...ownGrades(hands[h] as HandRecord));
  }
  return grades.slice(0, SUGGESTION.coach.decisions);
}

/** The coach rule at the coach level `level` (`sample`: newest first). */
export function coachSuggestion(sample: readonly Grade[], level: CoachLevel): Suggestion | null {
  const to = COACH_ORDER[COACH_ORDER.indexOf(level) + 1];
  const { decisions, goodPct, badPct } = SUGGESTION.coach;
  if (to === undefined || sample.length < decisions) return null;
  let good = 0;
  let bad = 0;
  for (const g of sample.slice(0, decisions)) {
    if (g === 'best' || g === 'good') good++;
    else if (g === 'mistake' || g === 'blunder') bad++;
  }
  return good * 100 >= goodPct * decisions && bad * 100 <= badPct * decisions
    ? { rule: 'coachDown', from: level, to }
    : null;
}

/** The rule's card is hidden now ("Not now" or a yes less than 7 days ago). */
export function snoozed(flags: ProfileFlags, rule: SuggestionRule, now: Date): boolean {
  const until = flags.suggestionSnoozedUntil[rule];
  return until !== null && now.getTime() < Date.parse(until);
}

/**
 * The flags after the card's answer: "Not now" hides its rule for 7 days; a yes hides it too, and
 * a yes to the bots both bot rules (module note).
 */
export function answered(
  flags: ProfileFlags,
  suggestion: Suggestion,
  accept: boolean,
  now: Date,
): ProfileFlags {
  const until = new Date(now.getTime() + SUGGESTION.snoozeDays * 86_400_000).toISOString();
  const rules: SuggestionRule[] =
    accept && suggestion.rule !== 'coachDown' ? ['botsUp', 'botsDown'] : [suggestion.rule];
  const next = { ...flags.suggestionSnoozedUntil };
  for (const rule of rules) next[rule] = until;
  return { ...flags, suggestionSnoozedUntil: next };
}

/**
 * The card to show, or null: the bot rules first, then the coach rule (`sample` null: the ring is
 * not read, so the coach rule is silent). A rule hidden by its snooze is skipped.
 */
export function suggestionFor(input: {
  recent: readonly RecentHand[];
  botLevel: BotLevel;
  coachLevel: CoachLevel;
  sample: readonly Grade[] | null;
  flags: ProfileFlags;
  now: Date;
}): Suggestion | null {
  const bots = botSuggestion(input.recent, input.botLevel);
  if (bots !== null && !snoozed(input.flags, bots.rule, input.now)) return bots;
  if (input.sample === null || snoozed(input.flags, 'coachDown', input.now)) return null;
  return coachSuggestion(input.sample, input.coachLevel);
}

/** What the rules need from the controller. */
export interface SuggestionHost {
  /** The profile when this tab writes and has storage (a card's answer is saved), else null. */
  profile(): Profile | null;
  /** The settings in force (their levels: the table's bot level, the coach level). */
  settings(): Settings;
  /** The counted records of `pc.v1.hands`, oldest first (`loadHands`). */
  hands(): HandRecord[];
  now(): Date;
}

/** The suggestion side of one controller. */
export interface SuggestionTools {
  /** The card now, or null. Worked out again only when the profile, a level or the sample changed. */
  current(): Suggestion | null;
  /**
   * A hand was counted (`record`), or Stats opened (null): the coach sample takes the hand, or is
   * read from the ring once it can matter (100 decisions without the hint counted in the stats,
   * `decisions.all.own`, a coach level below Exam, the rule not hidden): at most once per profile.
   */
  counted(record: HandRecord | null): void;
  /** Another profile (boot, Import, Reset): the sample is read again when it matters. */
  forget(): void;
  /** The answer to `offer`: the settings patch of a yes (else null) and the flags to save. */
  answer(
    offer: Suggestion,
    accept: boolean,
  ): { patch: Partial<Settings> | null; flags: ProfileFlags };
}

export function suggestionTools(host: SuggestionHost): SuggestionTools {
  let sample: Grade[] | null = null;
  let memo: {
    profile: Profile;
    bot: BotLevel;
    coach: CoachLevel;
    sample: Grade[] | null;
    value: Suggestion | null;
  } | null = null;

  return {
    current() {
      const profile = host.profile();
      if (profile === null) return null;
      const { botLevel, coachLevel } = host.settings();
      if (
        memo?.profile === profile &&
        memo.bot === botLevel &&
        memo.coach === coachLevel &&
        memo.sample === sample
      ) {
        return memo.value;
      }
      const value = suggestionFor({
        recent: profile.stats.recentHands,
        botLevel,
        coachLevel,
        sample,
        flags: profile.flags,
        now: host.now(),
      });
      memo = { profile, bot: botLevel, coach: coachLevel, sample, value };
      return value;
    },
    counted(record) {
      if (sample !== null) {
        if (record !== null) {
          sample = [...ownGrades(record), ...sample].slice(0, SUGGESTION.coach.decisions);
        }
        return;
      }
      const profile = host.profile();
      if (
        profile === null ||
        profile.stats.decisions.all.own < SUGGESTION.coach.decisions ||
        host.settings().coachLevel === 'exam' ||
        snoozed(profile.flags, 'coachDown', host.now())
      ) {
        return;
      }
      sample = coachSample(host.hands());
    },
    forget() {
      sample = null;
    },
    answer(offer, accept) {
      const profile = host.profile() as Profile;
      const patch: Partial<Settings> | null = !accept
        ? null
        : offer.rule === 'coachDown'
          ? { coachLevel: offer.to }
          : { botLevel: offer.to };
      return { patch, flags: answered(profile.flags, offer, accept, host.now()) };
    },
  };
}
