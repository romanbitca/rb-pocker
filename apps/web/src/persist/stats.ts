/**
 * The stats reducer `applyHand(stats, record)` (PLAN §14.3 step 4, §14.4): pure, run once per hand
 * inside the commit, so a hand is counted exactly once whatever crashes happen.
 *
 * Chunk 8.1 counts the hand in its results bucket (§11.4: `practice` when it had an Undo, else
 * `clean`): hands, net chips and net milli-big-blinds, and the play dates. Chunk 8.2 adds the rest
 * of §14.4 from the same `HandRecord` (decisions, by level and street, leaks, collection, streak,
 * VPIP/PFR, the session, recent hands).
 */
import type { HandRecord, Stats } from './schema.ts';

export function applyHand(stats: Stats, record: HandRecord): Stats {
  const key = record.assisted ? 'practice' : 'clean';
  const bucket = stats.results[key];
  return {
    ...stats,
    firstPlayedAt: stats.firstPlayedAt ?? record.at,
    lastPlayedAt: record.at,
    results: {
      ...stats.results,
      [key]: {
        ...bucket,
        hands: bucket.hands + 1,
        netChips: bucket.netChips + (record.net[0] ?? 0),
        netMilliBB: bucket.netMilliBB + record.heroNetMilliBB,
      },
    },
  };
}
