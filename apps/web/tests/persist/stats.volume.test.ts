/**
 * PLAN §14.9: 10,000 simulated hands keep the storage bounded (chunk 8.2). The storage is the one
 * `tests/helpers/statsVolume.ts` builds: 10,000 hands at a full 9-seat table, a session every 40
 * hands, the last 100 through the commit protocol, a hand in play in the session.
 *
 * ⚠️ The PLAN's first budget was 300 KB, from estimates (a record ~1.2 KB, `recentHands` ~25 KB).
 * Measured here: about 553 KB — the hand ring 396 KB (a 9-seat record is ~4 KB: its table and
 * replay inputs), the profile and its backup 75 KB each (`recentHands` 55 KB of it), the session
 * 7 KB. So the budget is now 600 KB, still about a tenth of the 5 MiB localStorage gives (§14.1,
 * risk R21: a compact record format would halve the ring).
 */
import { describe, expect, it } from 'vitest';
import { loadHands } from '../../src/persist/hands.ts';
import { loadProfile } from '../../src/persist/profile.ts';
import { RECENT_HANDS_KEEP, SESSIONS_KEEP } from '../../src/persist/stats.ts';
import { createSafeStorage, STORAGE_KEYS } from '../../src/persist/storage.ts';
import { statsView } from '../../src/ui/stats.ts';
import { VOLUME_HANDS, volumeStorage } from '../helpers/statsVolume.ts';

/** §14.2, §14.9 (chunk 8.2, see the note above): every key together, in characters. */
export const STORAGE_BUDGET = 600_000;

describe('10,000 hands (§14.9)', () => {
  it('keep the storage bounded: full rings, 100 records, a profile under 100 KB', () => {
    const { storage, profile } = volumeStorage();
    const sizes = Object.fromEntries([...storage.data].map(([k, v]) => [k, k.length + v.length]));
    console.info('storage after 10,000 hands (characters):', sizes, 'total', storage.used());

    expect(storage.used()).toBeLessThan(STORAGE_BUDGET);
    // Nothing grows with the number of hands: the rings are full, the profile stays small.
    expect(profile.stats.recentHands).toHaveLength(RECENT_HANDS_KEEP);
    expect(profile.stats.recentSessions).toHaveLength(SESSIONS_KEEP);
    expect(profile.stats.sessions).toBe(VOLUME_HANDS / 40);
    expect(sizes[STORAGE_KEYS.profile]).toBeLessThan(100_000);
    expect(sizes[STORAGE_KEYS.profileBackup]).toBeLessThan(100_000);

    // It all loads back: the profile, and the last 100 hands for History.
    const store = createSafeStorage(() => storage);
    const loaded = loadProfile(store);
    expect(loaded.status).toBe('ok');
    expect(loaded.profile).toEqual(profile);
    const hands = loadHands(store, profile.lastCommittedHandSeq);
    expect(hands.problem).toBeNull();
    // R21: what a record weighs, field by field (characters of JSON, the mean over the ring).
    const fields: Record<string, number> = {};
    for (const record of hands.hands) {
      for (const [field, value] of Object.entries(record)) {
        fields[field] = (fields[field] ?? 0) + JSON.stringify(value).length / hands.hands.length;
      }
    }
    const mean = JSON.stringify(hands.hands).length / hands.hands.length;
    console.info(
      `a 9-seat hand record: ${Math.round(mean)} characters on average;`,
      Object.entries(fields)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([field, n]) => `${field} ${Math.round(n)}`)
        .join(', '),
    );
    expect(hands.hands.map((h) => h.handSeq)).toEqual(
      Array.from({ length: 100 }, (_, i) => VOLUME_HANDS - 99 + i),
    );
    const view = statsView(profile.stats, 20, new Date());
    expect(view.hands).toBe(VOLUME_HANDS);
    expect(view.progress.score.series).toHaveLength(20);
  }, 30_000);
});
