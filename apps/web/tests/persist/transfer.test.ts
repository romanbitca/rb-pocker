/**
 * Export, import and reset (PLAN §14.8, §14.9, H.2 rule 5; chunk 8.3): the export file, the import
 * checks (JSON, version, migrations, guards), the Import and Reset protocols with their `rev`
 * check and `pc.v1.preimport` copy, crash injection at every write of both, and Export → Reset →
 * Import giving back the same profile and hands. The controller's side (the commands, a hand in
 * progress, the toasts) is `tests/app/controller.data.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { HANDS_KEEP, loadHands } from '../../src/persist/hands.ts';
import { PROFILE_VERSION } from '../../src/persist/migrations.ts';
import { loadProfile } from '../../src/persist/profile.ts';
import {
  defaultProfile,
  emptySeatStats,
  emptyStats,
  type ExportFile,
  type HandRecord,
  type HandRing,
  type Profile,
} from '../../src/persist/schema.ts';
import { PERSIST_KIT as kit } from '../../src/persist/kit.ts';
import { applyHand } from '../../src/persist/stats.ts';
import { createSafeStorage, STORAGE_KEYS, type SafeStorage } from '../../src/persist/storage.ts';
import {
  buildExport,
  countedHands,
  debugData,
  EXPORT_APP,
  exportData,
  exportFileName,
  IMPORT_MAX_CHARS,
  importProfile,
  readImport,
  resetProfile,
  type ImportFile,
  type TransferResult,
} from '../../src/persist/transfer.ts';
import { FakeStorage, quotaError } from './fakeStorage.ts';
import { handRecord, NOW, profileV0ToV1, v0Profile } from './fixtures.ts';

const K = STORAGE_KEYS;
const LATER = new Date('2026-09-28T11:00:00.000Z');
const EVEN_LATER = new Date('2026-09-28T12:00:00.000Z');

const storeOver = (fake: FakeStorage): SafeStorage => createSafeStorage(() => fake);
const stored = <T>(fake: FakeStorage, key: string): T =>
  JSON.parse(fake.data.get(key) as string) as T;
const seqs = (records: readonly HandRecord[]): number[] => records.map((r) => r.handSeq);

/** A clean hand with this `handSeq`. */
const record = (handSeq: number, overrides: Partial<HandRecord> = {}): HandRecord => ({
  ...handRecord(),
  handSeq,
  assisted: false,
  ...overrides,
});

/** A profile that counted hands `from`..`to`, as stored after `rev` writes. */
function counted(from: number, to: number, rev: number, settings = {}): Profile {
  let profile = defaultProfile(NOW);
  for (let seq = from; seq <= to; seq++) {
    profile = { ...profile, stats: applyHand(profile.stats, record(seq)) };
  }
  return {
    ...profile,
    rev,
    lastCommittedHandSeq: to,
    settings: { ...profile.settings, ...settings },
    heroModel: { ...emptySeatStats(), hands: to - from + 1 },
  };
}

const ringOf = (records: HandRecord[]): string => JSON.stringify({ schema: 1, hands: records });
const range = (from: number, to: number): HandRecord[] =>
  Array.from({ length: to - from + 1 }, (_, i) => record(from + i));

/** This device: 3 hands counted (rev 5), their records, settings with 4 players. */
const mine = () => counted(1, 3, 5, { players: 4, seatLevels: [null, null, null, null] });
const myHands = () => range(1, 3);
/** The file's profile (another device): hands 5–9 counted, Medium bots, a tip seen. */
const theirs = (): Profile => {
  const p = counted(5, 9, 40, { botLevel: 'medium' });
  return {
    ...p,
    persistGranted: true,
    flags: { ...p.flags, tips: { heroStrip: true }, offlineReady: true, iosInstall: true },
  };
};
const theirHands = () => range(5, 9);

function fileText(overrides: Partial<Record<keyof ExportFile, unknown>> = {}): string {
  return JSON.stringify({ ...buildExport(theirs(), theirHands(), NOW), ...overrides });
}

const fileOf = (text: string): ImportFile => {
  const read = readImport(kit, text);
  if (!read.ok) throw new Error(read.problem);
  return read.file;
};

/** The storage of this device: its profile and its ring. */
const device = (): FakeStorage =>
  new FakeStorage({ [K.profile]: JSON.stringify(mine()), [K.hands]: ringOf(myHands()) });

describe('export (§14.8)', () => {
  it('names the file after the local date', () => {
    expect(exportFileName(new Date(2026, 8, 12, 23, 59))).toBe(
      'rb-poker-coach-stats-2026-09-12.json',
    );
    expect(exportFileName(new Date(2027, 0, 3, 0, 1))).toBe('rb-poker-coach-stats-2027-01-03.json');
    expect(exportFileName(new Date(2027, 0, 3), 'debug')).toBe(
      'rb-poker-coach-debug-2027-01-03.json',
    );
  });

  it('the debug report (§4.5, chunk 8.4): the stored voided hands as they are, and the report', () => {
    const ring = { schema: 1, records: [{ engineVersion: '1.0.0' }] };
    const fake = new FakeStorage({ [K.diag]: JSON.stringify(ring) });
    const { name, text } = debugData(kit, storeOver(fake), { counters: { voidedHands: 1 } }, NOW);
    expect(name).toBe(exportFileName(NOW, 'debug'));
    expect(JSON.parse(text)).toEqual({
      app: 'poker-coach',
      kind: 'debug',
      exportedAt: NOW.toISOString(),
      counters: { voidedHands: 1 },
      diag: ring,
    });
    // Unreadable text is sent as it is; nothing stored: null.
    fake.data.set(K.diag, '{broken');
    expect(JSON.parse(debugData(kit, storeOver(fake), {}, NOW).text).diag).toBe('{broken');
    fake.data.delete(K.diag);
    expect(JSON.parse(debugData(kit, storeOver(fake), {}, NOW).text).diag).toBeNull();
  });

  it('writes the profile as stored and its counted hand records', () => {
    const fake = device();
    // A record above lastCommittedHandSeq was never counted (§14.3): it is not exported.
    fake.data.set(K.hands, ringOf([...myHands(), record(4)]));
    const { name, text } = exportData(kit, storeOver(fake), mine(), NOW);
    expect(name).toBe(exportFileName(NOW));
    const file = JSON.parse(text) as ExportFile;
    expect(file).toEqual({
      app: 'poker-coach',
      schemaVersion: PROFILE_VERSION,
      exportedAt: NOW.toISOString(),
      profile: mine(),
      hands: myHands(),
    });
    expect(fake.writeLog).toEqual([]);
  });

  it('a storage that cannot be read, or a damaged ring: the profile with no hands', () => {
    const { text } = exportData(
      kit,
      createSafeStorage(() => null),
      mine(),
      NOW,
    );
    expect((JSON.parse(text) as ExportFile).hands).toEqual([]);
    for (const ring of ['{"schema":1,"hands":', '[1]', '{"schema":2,"hands":[]}', '{"schema":1}']) {
      const fake = device();
      fake.data.set(K.hands, ring);
      const out = JSON.parse(exportData(kit, storeOver(fake), mine(), NOW).text) as ExportFile;
      expect(out.hands, ring).toEqual([]);
      expect(out.profile).toEqual(mine());
    }
    // Damaged and repeated records are left out, as `loadHands` would.
    const fake = device();
    fake.data.set(K.hands, ringOf([record(1), { ...record(2), board: 'x' } as never, record(3)]));
    const out = JSON.parse(exportData(kit, storeOver(fake), mine(), NOW).text) as ExportFile;
    expect(seqs(out.hands)).toEqual([1, 3]);
  });
});

describe('import: reading the file (§14.8: parse, type-guard, migrate)', () => {
  it('a good file: its profile, its counted hands and the preview', () => {
    const read = readImport(kit, fileText());
    expect(read).toEqual({
      ok: true,
      file: {
        profile: theirs(),
        hands: theirHands(),
        preview: { hands: 5, exportedAt: NOW.toISOString() },
        dropped: 0,
      },
    });
    expect(countedHands(theirs())).toBe(5);
  });

  it.each([
    ['not JSON', '{"app":"poker-coach",'],
    ['JSON, but not an object', '[1,2,3]'],
    ['another app', fileText({ app: 'chess-coach' })],
    ['no app field', JSON.stringify({ profile: theirs(), hands: [] })],
  ])('%s: not a stats file', (_, text) => {
    expect(readImport(kit, text)).toMatchObject({ ok: false, why: 'notStats' });
  });

  it('a file far bigger than the browser storage: not read', () => {
    const big = `${fileText().slice(0, -1)},"pad":"${'x'.repeat(IMPORT_MAX_CHARS)}"}`;
    expect(readImport(kit, big)).toMatchObject({ ok: false, why: 'notStats' });
  });

  it('a file from a newer app is refused, never guessed at', () => {
    expect(readImport(kit, fileText({ schemaVersion: PROFILE_VERSION + 1 }))).toMatchObject({
      ok: false,
      why: 'newer',
    });
    expect(
      readImport(kit, fileText({ profile: { ...theirs(), schema: PROFILE_VERSION + 1 } })),
    ).toMatchObject({ ok: false, why: 'newer' });
  });

  it.each([
    ['a schemaVersion that is no number', { schemaVersion: '1' }],
    ['no export time', { exportedAt: 'yesterday' }],
    ['a profile of the wrong type', { profile: { ...theirs(), lastCommittedHandSeq: '9' } }],
    ['a truncated profile', { profile: { schema: 1, rev: 3 } }],
    ['a profile with no schema', { profile: { ...theirs(), schema: undefined } }],
    ['hands that are no list', { hands: { 5: record(5) } }],
  ])('%s: damaged', (_, overrides) => {
    expect(readImport(kit, fileText(overrides))).toMatchObject({ ok: false, why: 'damaged' });
  });

  it('an older profile is migrated on the way (H.2 rule 5: the same migrations as boot)', () => {
    const text = fileText({ schemaVersion: 0, profile: v0Profile(), hands: [] });
    expect(readImport(kit, text)).toMatchObject({ ok: false, why: 'damaged' }); // no 0 → 1 step today
    const read = readImport(kit, text, { 0: profileV0ToV1 });
    if (!read.ok) throw new Error(read.problem);
    expect(read.file.profile.settings).toMatchObject({ players: 4, bb: 50, botLevel: 'medium' });
    expect(read.file.preview.hands).toBe(0);
  });

  it('keeps only good, counted records, one per hand, oldest first, the newest 100', () => {
    const broken = { ...record(6), heroHole: [3, 3] };
    const notCounted = record(10);
    const again = record(7, { undoCount: 2, assisted: true });
    const text = fileText({
      hands: [record(9), broken, record(5), record(7), notCounted, again, 'junk', record(8)],
    });
    const read = readImport(kit, text);
    if (!read.ok) throw new Error(read.problem);
    expect(seqs(read.file.hands)).toEqual([5, 7, 8, 9]);
    expect(read.file.hands[1]).toEqual(again); // the last copy of a hand wins, as in the ring
    expect(read.file.dropped).toBe(4);

    const many = counted(1, HANDS_KEEP + 20, 200);
    const all = readImport(kit, JSON.stringify(buildExport(many, range(1, HANDS_KEEP + 20), NOW)));
    if (!all.ok) throw new Error(all.problem);
    expect(seqs(all.file.hands)).toEqual(seqs(range(21, HANDS_KEEP + 20)));
    expect(all.file.dropped).toBe(20);
  });
});

describe('import → Replace (§14.8)', () => {
  it('the file replaces profile and hands; the old profile goes to pc.v1.preimport first', () => {
    const fake = device();
    const before = fake.data.get(K.profile);
    const result = importProfile(kit, storeOver(fake), mine(), fileOf(fileText()), LATER);
    expect(fake.writeLog).toEqual([K.preimport, K.hands, K.profileBackup, K.profile, K.hands]);
    expect(fake.data.get(K.preimport)).toBe(before);
    expect(fake.data.get(K.profileBackup)).toBe(before);
    const expected: Profile = {
      ...theirs(),
      // This tab's write counter goes on, so its next write passes the rev check (§14.3 step 2).
      rev: mine().rev + 1,
      updatedAt: LATER.toISOString(),
      // What belongs to this browser, not to the player, stays.
      persistGranted: mine().persistGranted,
      flags: {
        ...theirs().flags,
        iosInstall: false,
        safariImport: false,
        offlineReady: false,
      },
    };
    expect(result).toEqual({ status: 'done', profile: expected, result: { ok: true } });
    expect(stored<Profile>(fake, K.profile)).toEqual(expected);
    expect(stored<HandRing>(fake, K.hands).hands).toEqual(theirHands());
    // The next launch reads it as any profile.
    const load = loadProfile(storeOver(fake), { now: EVEN_LATER, readOnly: true });
    expect(load).toEqual({ status: 'ok', profile: expected, migratedFrom: null });
    expect(loadHands(storeOver(fake), expected.lastCommittedHandSeq).hands).toEqual(theirHands());
  });

  it('a file with no hands leaves an empty ring', () => {
    const fake = device();
    importProfile(kit, storeOver(fake), mine(), fileOf(fileText({ hands: [] })), LATER);
    expect(fake.writeLog).toEqual([K.preimport, K.hands, K.profileBackup, K.profile]);
    expect(stored<HandRing>(fake, K.hands)).toEqual({ schema: 1, hands: [] });
  });

  it('the first launch (nothing stored): nothing to keep, nothing to back up', () => {
    const fake = new FakeStorage();
    const result = importProfile(
      kit,
      storeOver(fake),
      defaultProfile(NOW),
      fileOf(fileText()),
      LATER,
    );
    expect(result.status).toBe('done');
    expect(fake.writeLog).toEqual([K.hands, K.profile, K.hands]);
    expect(stored<Profile>(fake, K.profile).rev).toBe(1);
  });

  it('another tab wrote since we read (§14.7): nothing is written', () => {
    const fake = device();
    fake.data.set(K.profile, JSON.stringify({ ...mine(), rev: 6 }));
    const result = importProfile(kit, storeOver(fake), mine(), fileOf(fileText()), LATER);
    expect(result).toEqual({ status: 'conflict', storedRev: 6 });
    expect(fake.writeLog).toEqual([]);
  });

  it('a safety copy or an emptied ring that cannot be written: nothing is replaced', () => {
    for (const attempt of [1, 2]) {
      const fake = device();
      fake.failAttempt = attempt;
      const result = importProfile(kit, storeOver(fake), mine(), fileOf(fileText()), LATER);
      expect(result, `attempt ${attempt}`).toMatchObject({ status: 'failed', reason: 'quota' });
      expect(stored<Profile>(fake, K.profile)).toEqual(mine());
      expect(fake.writeLog).toHaveLength(attempt);
    }
    // Private mode: every write fails, so nothing is ever replaced (and the tab says so).
    const full = device();
    full.failWrites = quotaError();
    expect(importProfile(kit, storeOver(full), mine(), fileOf(fileText()), LATER)).toMatchObject({
      status: 'failed',
    });
    expect(stored<Profile>(full, K.profile)).toEqual(mine());
  });

  it('a commit point that fails: the new profile in memory, the old one and no hands on disk', () => {
    const fake = device();
    fake.failAttempt = 4; // preimport, hands, bak, profile
    const store = storeOver(fake);
    const result = importProfile(kit, store, mine(), fileOf(fileText()), LATER);
    expect(result).toMatchObject({ status: 'done', result: { ok: false, reason: 'quota' } });
    expect(stored<Profile>(fake, K.profile)).toEqual(mine());
    expect(stored<HandRing>(fake, K.hands).hands).toEqual([]);
    // This launch reads the new profile back from memory (§14.6 rule 3).
    const read = store.get(K.profile);
    expect(JSON.parse(read.ok ? (read.value ?? '') : '')).toMatchObject({ rev: mine().rev + 1 });
  });

  it('a profile that would not load again is never written', () => {
    const fake = device();
    const file = fileOf(fileText());
    const bad: ImportFile = { ...file, profile: { ...file.profile, createdAt: 'never' } };
    expect(importProfile(kit, storeOver(fake), mine(), bad, LATER)).toMatchObject({
      status: 'failed',
      reason: 'invalid',
    });
    expect(fake.writeLog).toEqual([]);
  });
});

describe('reset stats (§14.8)', () => {
  it('empties stats, hands and the hero model; keeps settings, flags and lastCommittedHandSeq', () => {
    const fake = device();
    const before = fake.data.get(K.profile);
    const result = resetProfile(kit, storeOver(fake), mine(), LATER);
    expect(fake.writeLog).toEqual([K.preimport, K.hands, K.profileBackup, K.profile]);
    expect(fake.data.get(K.preimport)).toBe(before);
    const expected: Profile = {
      ...mine(),
      stats: emptyStats(),
      heroModel: emptySeatStats(),
      rev: mine().rev + 1,
      updatedAt: LATER.toISOString(),
    };
    expect(result).toEqual({ status: 'done', profile: expected, result: { ok: true } });
    expect(stored<Profile>(fake, K.profile)).toEqual(expected);
    // §14.3: Reset never lowers lastCommittedHandSeq, so the next hand is numbered above it.
    expect(expected.lastCommittedHandSeq).toBe(3);
    expect(loadHands(storeOver(fake), 3).hands).toEqual([]);
  });

  it('another writer: nothing is written', () => {
    const fake = device();
    fake.data.set(K.profile, JSON.stringify({ ...mine(), rev: 9 }));
    expect(resetProfile(kit, storeOver(fake), mine(), LATER)).toEqual({
      status: 'conflict',
      storedRev: 9,
    });
    expect(fake.writeLog).toEqual([]);
  });
});

describe('Export → Reset → Import (§14.9)', () => {
  it('gives back a deep-equal profile and hands (only the write counter and time move on)', () => {
    const fake = device();
    const store = storeOver(fake);
    const original = mine();
    const { text } = exportData(kit, store, original, NOW);
    const reset = resetProfile(kit, store, original, LATER);
    if (reset.status !== 'done') throw new Error(reset.status);
    expect(countedHands(reset.profile)).toBe(0);
    const imported = importProfile(kit, store, reset.profile, fileOf(text), EVEN_LATER);
    if (imported.status !== 'done') throw new Error(imported.status);
    const back = loadProfile(store, { now: EVEN_LATER, readOnly: true }).profile;
    expect(back).toEqual(imported.profile);
    expect({ ...back, rev: original.rev, updatedAt: original.updatedAt }).toEqual(original);
    expect(back.rev).toBe(original.rev + 2);
    expect(loadHands(store, back.lastCommittedHandSeq).hands).toEqual(myHands());
  });
});

describe('crash injection at every write of Import and Reset (§14.9)', () => {
  type Op = (store: SafeStorage) => TransferResult;
  const ops: [string, Op, Profile, HandRecord[]][] = [
    [
      'import',
      (s) => importProfile(kit, s, mine(), fileOf(fileText()), LATER),
      theirs(),
      theirHands(),
    ],
    ['reset', (s) => resetProfile(kit, s, mine(), LATER), { ...mine(), stats: emptyStats() }, []],
  ];

  it.each(ops)(
    '%s: after any crash the profile is whole, old or new, with only its own hands',
    (_, op, newer, newerHands) => {
      const reference = device();
      op(storeOver(reference));
      const writes = reference.writeLog.length;
      expect(writes).toBeGreaterThanOrEqual(4);
      for (let k = 0; k <= writes; k++) {
        const dying = device();
        dying.dieAfterWrites = k;
        op(storeOver(dying));
        // The next launch over what reached the storage.
        const after = new FakeStorage(Object.fromEntries(dying.data));
        const store = storeOver(after);
        const load = loadProfile(store, { now: EVEN_LATER, readOnly: true });
        expect(load.status, `k = ${k}`).toBe('ok');
        const profile = load.profile;
        const hands = loadHands(store, profile.lastCommittedHandSeq).hands;
        const isNew = profile.rev === mine().rev + 1;
        if (isNew) {
          expect(profile.stats, `k = ${k}`).toEqual(newer.stats);
          expect(after.data.get(K.preimport), `k = ${k}`).toBe(JSON.stringify(mine()));
          expect([[], seqs(newerHands)], `k = ${k}`).toContainEqual(seqs(hands));
        } else {
          expect(profile, `k = ${k}`).toEqual(mine());
          expect([[], seqs(myHands())], `k = ${k}`).toContainEqual(seqs(hands));
        }
        expect([...after.data.keys()].some((key) => key.startsWith('pc.corrupt.'))).toBe(false);
      }
    },
  );

  it.each(ops)('%s: one failed write at each attempt never mixes two profiles', (_, op) => {
    const reference = device();
    op(storeOver(reference));
    for (let attempt = 1; attempt <= reference.writeLog.length; attempt++) {
      const fake = device();
      fake.failAttempt = attempt;
      op(storeOver(fake));
      const store = storeOver(new FakeStorage(Object.fromEntries(fake.data)));
      const profile = loadProfile(store, { now: EVEN_LATER, readOnly: true }).profile;
      const hands = seqs(loadHands(store, profile.lastCommittedHandSeq).hands);
      const old = profile.rev === mine().rev;
      expect(old || profile.rev === mine().rev + 1, `attempt ${attempt}`).toBe(true);
      if (old) expect([[], [1, 2, 3]], `attempt ${attempt}`).toContainEqual(hands);
      else
        expect(
          hands.every((seq) => seq >= 5),
          `attempt ${attempt}`,
        ).toBe(true);
    }
  });
});

describe('the app field and the file name keep the internal short form (§0.3)', () => {
  it('poker-coach', () => {
    expect(EXPORT_APP).toBe('poker-coach');
  });
});
