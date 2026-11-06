/**
 * The Data commands through the controller (PLAN §14.8, §14.9, Stage 8 acceptance 4b; chunk
 * 8.3): Export to the share sheet (inside the tap), a download or the clipboard; Import's check,
 * preview and Replace, with a hand in progress or waiting for its grade; Reset; Export → Reset →
 * Import; crash injection at every write of Replace; `persist()`. The storage protocols are
 * `tests/persist/transfer.test.ts`. The Data section's buttons and dialogs are chunk 8.4's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageManagerLike } from '../../src/app/controller.ts';
import { DATA_SCREENS } from '../../src/app/controller.ts';
import { deliverExport, type ShareEnv } from '../../src/app/dataTools.ts';
import type { LegalActions, PlayerAction } from '../../src/engine/types.ts';
import type {
  ExportFile,
  HandRecord,
  HandRing,
  Profile,
  SessionState,
} from '../../src/persist/schema.ts';
import { createSafeStorage, STORAGE_KEYS } from '../../src/persist/storage.ts';
import { buildExport, exportFileName } from '../../src/persist/transfer.ts';
import { FakeStorage, quotaError } from '../persist/fakeStorage.ts';
import { stubGrader } from './graders.ts';
import { drive, flush, makeHarness, tick, type Harness, type HarnessOptions } from './harness.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const K = STORAGE_KEYS;

const passive = (legal: LegalActions): PlayerAction =>
  legal.canCheck ? { type: 'check' } : { type: 'call' };

const read = <T>(backend: FakeStorage, key: string): T =>
  JSON.parse(backend.data.get(key) as string) as T;
const profileOf = (backend: FakeStorage): Profile => read<Profile>(backend, K.profile);
const ringOf = (backend: FakeStorage): HandRecord[] =>
  backend.data.has(K.hands) ? read<HandRing>(backend, K.hands).hands : [];
const counted = (p: Profile): number =>
  p.stats.results.clean.hands + p.stats.results.practice.hands;
/**
 * The Data commands' toasts. The hands these tests play bring the collection moment's toasts too
 * (§12.9, chunk 9.1b: a category's first counted hand), which `controller.collection.test.ts`
 * covers; they are left out here.
 */
const toasts = (h: Harness): string[] =>
  h
    .state()
    .ui.toasts.map((t) => t.kind)
    .filter((kind) => kind !== 'collection');
/** The categories with a first date: the collection (§14.4, §12.9). */
const collected = (p: Profile): string[] =>
  Object.entries(p.stats.collection)
    .filter(([, c]) => c.first !== null)
    .map(([category]) => category);

/** Fake pages so far: each makes Blob URLs of its own, as browsers do. */
let pages = 0;

/** What a fake page received from Export. */
interface Sent {
  shared: File[];
  downloads: { name: string; blob: Blob }[];
  copied: string[];
}

/**
 * A page for Export: `share` resolves, is cancelled (AbortError), is refused (NotAllowedError) or
 * is missing; downloads and the clipboard work unless told otherwise.
 */
function page(
  share: 'ok' | 'cancel' | 'refuse' | 'none',
  options: { download?: boolean; clipboard?: boolean; standalone?: boolean } = {},
): { env: ShareEnv; sent: Sent } {
  const sent: Sent = { shared: [], downloads: [], copied: [] };
  const blobs = new Map<string, Blob>();
  const id = ++pages;
  const anchor = () => {
    const a = {
      href: '',
      download: '',
      hidden: false,
      click: () => sent.downloads.push({ name: a.download, blob: blobs.get(a.href) as Blob }),
      remove: () => {},
    };
    return a;
  };
  const env: ShareEnv = {
    navigator: {
      ...(share !== 'none' && {
        canShare: (data: { files: File[] }) => data.files.length === 1,
        share: (data: { files: File[] }) => {
          sent.shared.push(...data.files);
          if (share === 'ok') return Promise.resolve();
          const name = share === 'cancel' ? 'AbortError' : 'NotAllowedError';
          return Promise.reject(new DOMException('no', name));
        },
      }),
      clipboard: {
        writeText: (text: string) => {
          if (options.clipboard === false) return Promise.reject(new Error('denied'));
          sent.copied.push(text);
          return Promise.resolve();
        },
      },
      ...(options.standalone === true && { standalone: true }),
    },
    ...(options.download !== false && {
      document: {
        createElement: anchor,
        body: { append: () => {} },
      } as unknown as Pick<Document, 'createElement' | 'body'>,
      URL: {
        createObjectURL: (blob: Blob) => {
          const url = `blob:test/${id}/${blobs.size + 1}`;
          blobs.set(url, blob);
          return url;
        },
        revokeObjectURL: (url: string) => void blobs.delete(url),
      },
    }),
    File,
    Blob,
  };
  return { env, sent };
}

function launch(backend: FakeStorage, options: Partial<HarnessOptions> = {}): Harness {
  return makeHarness({ storage: createSafeStorage(() => backend), ...options });
}

/**
 * Instant speed, 3 players, the next hand by itself (off by default since 1.3.94; these tests
 * play on past a hand end without tapping), Play.
 */
function start(backend: FakeStorage, options: Partial<HarnessOptions> = {}): Harness {
  const h = launch(backend, options);
  h.dispatch({ type: 'settings', patch: { players: 3, speed: 'instant', autoNext: true } });
  h.dispatch({ type: 'play' });
  return h;
}

/** Lets the Data chunk load (a real dynamic import) and its promises settle. */
async function settled(): Promise<void> {
  await vi.dynamicImportSettled();
  await flush();
}

/**
 * An export file of another device's profile: `last` hands counted (its stats are this one's), and
 * this device's last records (up to 3) renumbered as its last hands, up to `last`.
 */
function otherDevice(backend: FakeStorage, last: number): string {
  const mine = profileOf(backend);
  const records = ringOf(backend).slice(-3);
  const theirs: Profile = {
    ...mine,
    lastCommittedHandSeq: last,
    settings: { ...mine.settings, botLevel: 'medium' },
  };
  const hands = records.map((r, i) => ({ ...r, handSeq: last - records.length + 1 + i }));
  return JSON.stringify(buildExport(theirs, hands, new Date('2026-09-12T10:00:00.000Z')));
}

/** The hand numbers in an export file. */
const fileSeqs = (text: string): number[] =>
  (JSON.parse(text) as ExportFile).hands.map((r) => r.handSeq);

/** Picks a file with this text; its check is in once the Data chunk has loaded and read it. */
async function importText(h: Harness, text: string): Promise<void> {
  h.dispatch({ type: 'importFile', file: new Blob([text], { type: 'application/json' }) });
  await settled();
}

describe('Export (§14.8)', () => {
  it('a Data screen loads the chunk first, so the share sheet opens inside the tap', async () => {
    const backend = new FakeStorage();
    const { env, sent } = page('ok');
    const h = start(backend, { shareEnv: env });
    await drive(h, { hands: 2, hero: passive });
    expect(DATA_SCREENS).toContain('settings');
    h.dispatch({ type: 'go', screen: 'settings' });
    await settled();
    h.dispatch({ type: 'exportStats' });
    // No await: the share call happened inside the dispatch, as a tap's handler would make it.
    expect(sent.shared).toHaveLength(1);
    const file = sent.shared[0] as File;
    expect(file.name).toBe(exportFileName(new Date()));
    expect(file.type).toBe('application/json');
    const content = JSON.parse(await file.text()) as ExportFile;
    expect(content).toMatchObject({ app: 'poker-coach', schemaVersion: 1 });
    expect(content.profile).toEqual(profileOf(backend));
    expect(content.hands).toEqual(ringOf(backend));
    await flush();
    expect(toasts(h)).toEqual([]); // the sheet was the feedback
    h.controller.dispose();
  }, 30_000);

  it('closing the share sheet is the player`s choice: nothing else happens', async () => {
    const { env, sent } = page('cancel');
    expect(await deliverExport(env, 'x.json', '{}')).toBe('cancelled');
    expect(sent).toEqual({ shared: [expect.any(File)], downloads: [], copied: [] });
  });

  it('a refused share (no user activation): a download instead', async () => {
    const { env, sent } = page('refuse');
    expect(await deliverExport(env, 'x.json', '{"a":1}')).toBe('downloaded');
    expect(sent.downloads.map((d) => d.name)).toEqual(['x.json']);
    expect(await sent.downloads[0]?.blob.text()).toBe('{"a":1}');
  });

  it('no file sharing (desktop browsers): a download', async () => {
    const backend = new FakeStorage();
    const { env, sent } = page('none');
    const h = start(backend, { shareEnv: env });
    await drive(h, { hands: 1, hero: passive });
    h.dispatch({ type: 'exportStats' }); // the chunk not loaded yet: it loads, then exports
    await settled();
    expect(sent.downloads).toHaveLength(1);
    const content = JSON.parse(await (sent.downloads[0]?.blob as Blob).text()) as ExportFile;
    expect(content.hands.map((r) => r.handSeq)).toEqual([1]);
    expect(toasts(h)).toEqual([]);
    h.controller.dispose();
  }, 30_000);

  it('an iOS home-screen app without file sharing, or no download: the clipboard, then a toast', async () => {
    for (const options of [{ standalone: true }, { download: false }]) {
      const backend = new FakeStorage();
      const { env, sent } = page('none', options);
      const h = start(backend, { shareEnv: env });
      h.dispatch({ type: 'exportStats' });
      await settled();
      expect(sent.downloads).toEqual([]);
      expect(sent.copied).toHaveLength(1);
      expect(JSON.parse(sent.copied[0] as string)).toMatchObject({ app: 'poker-coach' });
      expect(toasts(h)).toEqual(['exportCopied']);
      h.controller.dispose();
    }
  });

  it('nothing works: the failure toast', async () => {
    const backend = new FakeStorage();
    const { env } = page('none', { download: false, clipboard: false });
    const h = start(backend, { shareEnv: env });
    h.dispatch({ type: 'exportStats' });
    await settled();
    expect(toasts(h)).toEqual(['exportFailed']);
    const bare = await deliverExport({}, 'x.json', '{}');
    expect(bare).toBe('failed');
    h.controller.dispose();
  });
});

describe('Import (§14.8): check, preview, Replace', () => {
  it('with the chunk loaded (a Data screen opened it) the check starts at once', async () => {
    const backend = new FakeStorage();
    const h = start(backend);
    await drive(h, { hands: 1, hero: passive });
    h.dispatch({ type: 'go', screen: 'settings' });
    await settled();
    h.dispatch({ type: 'importFile', file: new Blob([otherDevice(backend, 9)]) });
    expect(h.state().data.importCheck).toEqual({ status: 'reading' });
    await settled();
    expect(h.state().data.importCheck).toMatchObject({ status: 'ready', hands: 1 });
    h.controller.dispose();
  }, 30_000);

  it('a good file: the preview, then Replace: the file`s stats, settings and hands, a toast', async () => {
    const backend = new FakeStorage();
    const h = start(backend);
    await drive(h, { hands: 3, hero: passive });
    const before = backend.data.get(K.profile);
    const text = otherDevice(backend, 40);
    await importText(h, text);
    expect(h.state().data.importCheck).toEqual({
      status: 'ready',
      hands: 3,
      exportedAt: '2026-09-12T10:00:00.000Z',
    });
    expect(backend.data.get(K.profile)).toBe(before); // nothing yet
    h.dispatch({ type: 'importConfirm' });
    expect(h.state().data.importCheck).toBeNull();
    expect(toasts(h)).toEqual(['imported']);
    const profile = profileOf(backend);
    expect(profile.lastCommittedHandSeq).toBe(40);
    expect(profile.settings.botLevel).toBe('medium');
    expect(h.state().settings.botLevel).toBe('medium');
    expect(ringOf(backend).map((r) => r.handSeq)).toEqual([38, 39, 40]);
    expect(backend.data.get(K.preimport)).toBe(before);
    expect(h.state().review.hands).toEqual([]); // Review's hands were the old stats'
    h.controller.dispose();
  }, 30_000);

  it('Stage 8 acceptance 4b: a profile that counted more hands than this table dealt; 1 hand → counted', async () => {
    const backend = new FakeStorage();
    const h = start(backend);
    await drive(h, { hands: 2, hero: passive });
    expect(h.state().game.next?.nextHandSeq).toBe(3);
    await importText(h, otherDevice(backend, 50));
    h.dispatch({ type: 'importConfirm' });
    const imported = profileOf(backend);
    const [hand] = await drive(h, { hands: 1, hero: passive });
    expect(hand?.handSeq).toBe(51);
    const after = profileOf(backend);
    expect(after.lastCommittedHandSeq).toBe(51);
    expect(counted(after)).toBe(counted(imported) + 1);
    expect(ringOf(backend).map((r) => r.handSeq)).toEqual([49, 50, 51]);
    h.controller.dispose();
  }, 30_000);

  it('during a hand: the hand is cancelled, its chips back, and the next one is numbered above the file`s', async () => {
    const backend = new FakeStorage();
    const h = start(backend);
    await drive(h, { hands: 1, hero: passive });
    for (let i = 0; i < 800 && h.state().game.mode !== 'heroTurn'; i++) await tick();
    const unfinished = h.state().game.hand;
    const startStacks = h.state().game.table?.slots.map((s) => s.stack);
    expect(unfinished?.phase).toBe('betting');
    await importText(h, otherDevice(backend, 50));
    h.dispatch({ type: 'importConfirm' });
    const hand = h.state().game.hand;
    expect(hand?.handSeq).toBe(51);
    expect(h.state().game.table?.slots.map((s) => s.stack)).toEqual(startStacks);
    expect(read<SessionState>(backend, K.session).hand?.handSeq).toBe(51);
    await drive(h, { hands: 1, hero: passive });
    expect(profileOf(backend).lastCommittedHandSeq).toBe(51);
    h.controller.dispose();
  }, 30_000);

  it('a finished hand still waiting for its grade is counted first, in the stats preimport keeps', async () => {
    const backend = new FakeStorage();
    const grader = stubGrader({ delayMs: 60_000 });
    const h = start(backend, { grader });
    h.dispatch({ type: 'settings', patch: { autoNext: false } });
    for (let i = 0; i < 2000 && h.state().game.mode !== 'handEnd'; i++) {
      const s = h.state();
      if (s.game.mode === 'heroTurn' && s.game.legal !== null) {
        h.dispatch({ type: 'act', action: passive(s.game.legal) });
      } else await tick();
    }
    expect(profileOf(backend).lastCommittedHandSeq).toBe(0); // the commit waits for the grade
    await importText(h, otherDevice(backend, 30));
    h.dispatch({ type: 'importConfirm' });
    expect(read<Profile>(backend, K.preimport).lastCommittedHandSeq).toBe(1);
    expect(profileOf(backend).lastCommittedHandSeq).toBe(30);
    h.controller.dispose();
  }, 30_000);

  it.each([
    ['not JSON', 'hello', 'notStats'],
    ['another app', JSON.stringify({ app: 'chess', profile: {} }), 'notStats'],
    ['a newer app', JSON.stringify({ app: 'poker-coach', schemaVersion: 9 }), 'newer'],
    [
      'a broken profile',
      JSON.stringify({
        app: 'poker-coach',
        schemaVersion: 1,
        exportedAt: '2026-09-12T10:00:00.000Z',
        profile: { schema: 1 },
        hands: [],
      }),
      'damaged',
    ],
  ])('%s: the check says why, Replace changes nothing', async (_, text, why) => {
    const backend = new FakeStorage();
    const h = start(backend);
    await importText(h, text);
    expect(h.state().data.importCheck).toEqual({ status: 'failed', why });
    const before = new Map(backend.data);
    h.dispatch({ type: 'importConfirm' });
    expect(toasts(h)).toEqual(['dataNotChanged']);
    expect(backend.data).toEqual(before);
    h.controller.dispose();
  });

  it('a file that cannot be read; Cancel; a second file replaces the first', async () => {
    const backend = new FakeStorage();
    const h = start(backend);
    await drive(h, { hands: 1, hero: passive });
    const broken = { size: 10, text: () => Promise.reject(new Error('gone')) } as unknown as Blob;
    h.dispatch({ type: 'importFile', file: broken });
    await settled();
    expect(h.state().data.importCheck).toEqual({ status: 'failed', why: 'unreadable' });
    const huge = { size: 6 * 1024 * 1024, text: () => Promise.resolve('') } as unknown as Blob;
    h.dispatch({ type: 'importFile', file: huge });
    await settled();
    expect(h.state().data.importCheck).toEqual({ status: 'failed', why: 'notStats' });
    await importText(h, otherDevice(backend, 20));
    h.dispatch({ type: 'importCancel' });
    expect(h.state().data.importCheck).toBeNull();
    h.dispatch({ type: 'importConfirm' });
    expect(toasts(h)).toEqual(['dataNotChanged']);
    expect(profileOf(backend).lastCommittedHandSeq).toBe(1);
    // Two files picked quickly: the second one counts.
    h.dispatch({ type: 'importFile', file: new Blob([otherDevice(backend, 20)]) });
    h.dispatch({ type: 'importFile', file: new Blob([otherDevice(backend, 30)]) });
    await settled();
    h.dispatch({ type: 'importConfirm' });
    expect(profileOf(backend).lastCommittedHandSeq).toBe(30);
    h.controller.dispose();
  }, 30_000);

  it('a Replace that cannot be written leaves an unfinished hand as it was', async () => {
    const backend = new FakeStorage();
    const h = start(backend);
    await drive(h, { hands: 1, hero: passive });
    for (let i = 0; i < 800 && h.state().game.mode !== 'heroTurn'; i++) await tick();
    const unfinished = h.state().game.hand;
    expect(unfinished?.phase).toBe('betting');
    await importText(h, otherDevice(backend, 50));
    backend.failWrites = quotaError();
    h.dispatch({ type: 'importConfirm' });
    expect(toasts(h)).toContain('dataNotChanged');
    expect(h.state().game.hand).toEqual(unfinished);
    expect(h.state().game.mode).toBe('heroTurn');
    h.controller.dispose();
  }, 30_000);

  it('a browser that keeps nothing (private mode): Replace changes nothing, and says so', async () => {
    const backend = new FakeStorage();
    const h = start(backend);
    await drive(h, { hands: 1, hero: passive });
    const text = otherDevice(backend, 20);
    await importText(h, text);
    backend.failWrites = quotaError();
    h.dispatch({ type: 'importConfirm' });
    expect(toasts(h)).toContain('dataNotChanged');
    expect(profileOf(backend).lastCommittedHandSeq).toBe(1);
    h.controller.dispose();
  }, 30_000);

  it('crash injection at every write of Replace: the next launch has one whole profile and its own hands', async () => {
    /**
     * 2 hands played, then a file of another device (hands 19–20) replaces them; then the tab
     * dies. Returns the file and the writes Replace made.
     */
    async function run(backend: FakeStorage, dieAfter: number | null) {
      const h = start(backend);
      await drive(h, { hands: 2, hero: passive });
      const text = otherDevice(backend, 20);
      await importText(h, text);
      const before = backend.writeLog.length;
      if (dieAfter !== null) backend.dieAfterWrites = backend.writes + dieAfter;
      h.dispatch({ type: 'importConfirm' });
      h.controller.dispose();
      return { text, writes: backend.writeLog.length - before };
    }
    const reference = new FakeStorage();
    const { text, writes } = await run(reference, null);
    const theirs = fileSeqs(text);
    expect(theirs).toEqual([19, 20]);
    expect(writes).toBeGreaterThanOrEqual(5); // preimport, hands, bak, profile, hands
    for (let k = 0; k <= writes; k++) {
      const dying = new FakeStorage();
      await run(dying, k);
      const backend = new FakeStorage(Object.fromEntries(dying.data));
      const next = launch(backend);
      expect(toasts(next), `k = ${k}`).not.toContain('dataRecovered');
      const profile = profileOf(backend);
      const seqs = ringOf(backend)
        .map((r) => r.handSeq)
        .filter((seq) => seq <= profile.lastCommittedHandSeq);
      if (profile.lastCommittedHandSeq === 20) {
        expect([[], theirs], `k = ${k}`).toContainEqual(seqs);
      } else {
        expect(profile.lastCommittedHandSeq, `k = ${k}`).toBe(2);
        expect([[], [1, 2]], `k = ${k}`).toContainEqual(seqs);
      }
      // The next hand is counted, numbered above whichever profile won.
      next.dispatch({ type: 'settings', patch: { speed: 'instant' } });
      next.dispatch({ type: 'play' });
      const [hand] = await drive(next, { hands: 1, hero: passive });
      expect(hand?.handSeq, `k = ${k}`).toBeGreaterThan(profile.lastCommittedHandSeq);
      expect(profileOf(backend).lastCommittedHandSeq, `k = ${k}`).toBe(hand?.handSeq);
      next.controller.dispose();
    }
  }, 120_000);

  it('crash injection when Replace cancels an unfinished hand: no hand is ever counted twice', async () => {
    /** As above, but Replace comes at the hero's turn of the third hand. */
    async function run(backend: FakeStorage, dieAfter: number | null): Promise<number> {
      const h = start(backend);
      await drive(h, { hands: 2, hero: passive });
      for (let i = 0; i < 800 && h.state().game.mode !== 'heroTurn'; i++) await tick();
      expect(h.state().game.hand?.handSeq).toBe(3);
      await importText(h, otherDevice(backend, 20));
      const before = backend.writeLog.length;
      if (dieAfter !== null) backend.dieAfterWrites = backend.writes + dieAfter;
      h.dispatch({ type: 'importConfirm' });
      h.controller.dispose();
      return backend.writeLog.length - before;
    }
    const writes = await run(new FakeStorage(), null);
    expect(writes).toBeGreaterThanOrEqual(7); // the protocol, the cancelled hand, the next hand
    for (let k = 0; k <= writes; k++) {
      const dying = new FakeStorage();
      await run(dying, k);
      const backend = new FakeStorage(Object.fromEntries(dying.data));
      const next = launch(backend);
      const start0 = profileOf(backend);
      expect([2, 20], `k = ${k}`).toContain(start0.lastCommittedHandSeq);
      next.dispatch({ type: 'settings', patch: { speed: 'instant' } });
      next.dispatch({ type: 'play' });
      const done = await drive(next, { hands: 2, hero: passive });
      // A hand counts once, when its number is above what the profile had counted.
      const fresh = done.filter((h) => h.handSeq > start0.lastCommittedHandSeq);
      const after = profileOf(backend);
      expect(counted(after) - counted(start0), `k = ${k}`).toBe(fresh.length);
      const seqs = ringOf(backend).map((r) => r.handSeq);
      expect(new Set(seqs).size, `k = ${k}`).toBe(seqs.length);
      expect(after.lastCommittedHandSeq, `k = ${k}`).toBe(
        Math.max(start0.lastCommittedHandSeq, ...fresh.map((h) => h.handSeq)),
      );
      next.controller.dispose();
    }
  }, 180_000);
});

describe('Reset stats (§14.8)', () => {
  it('stats, hands and hero model emptied; settings kept; the next hand counts in the new stats', async () => {
    const backend = new FakeStorage();
    const h = start(backend);
    await drive(h, { hands: 3, hero: passive });
    const before = profileOf(backend);
    backend.data.set(K.drill, '{"schema":1}'); // the hand drill's stats (§13.5)
    h.dispatch({ type: 'resetStats' });
    await settled();
    expect(toasts(h)).toEqual(['statsReset']);
    expect(backend.data.has(K.drill)).toBe(false); // Reset clears the drill too
    const reset = profileOf(backend);
    expect(counted(reset)).toBe(0);
    expect(reset.heroModel.hands).toBe(0);
    expect(reset.settings).toEqual(before.settings);
    expect(reset.lastCommittedHandSeq).toBe(3); // §14.3: never lowered
    expect(collected(before).length).toBeGreaterThan(0);
    expect(collected(reset)).toEqual([]); // the collection starts again (§12.9)
    expect(ringOf(backend)).toEqual([]);
    expect(read<Profile>(backend, K.preimport)).toEqual(before);
    expect(h.state().game.seatStats.hero).toBeUndefined();
    const [hand] = await drive(h, { hands: 1, hero: passive });
    expect(hand?.handSeq).toBe(4);
    expect(counted(profileOf(backend))).toBe(1);
    expect(profileOf(backend).heroModel.hands).toBe(1);
    h.controller.dispose();
  }, 30_000);
});

describe('Export → Reset → Import (§14.9) through the commands', () => {
  it('gives back a deep-equal profile and hands', async () => {
    const backend = new FakeStorage();
    const { env, sent } = page('ok');
    const h = start(backend, { shareEnv: env });
    await drive(h, { hands: 3, hero: passive });
    const original = profileOf(backend);
    const hands = ringOf(backend);
    const drill = '{"schema":1,"best":7}';
    backend.data.set(K.drill, drill); // the hand drill's stats (§13.5): not in the file
    h.dispatch({ type: 'go', screen: 'settings' });
    await settled();
    h.dispatch({ type: 'exportStats' });
    const text = await (sent.shared[0] as File).text();
    expect(text).not.toContain(drill);
    h.dispatch({ type: 'resetStats' });
    await settled();
    expect(counted(profileOf(backend))).toBe(0);
    await importText(h, text);
    h.dispatch({ type: 'importConfirm' });
    const back = profileOf(backend);
    expect({ ...back, rev: original.rev, updatedAt: original.updatedAt }).toEqual(original);
    expect(ringOf(backend)).toEqual(hands);
    expect(backend.data.has(K.drill)).toBe(false); // Reset removed it; Import leaves it out
    expect(toasts(h)).toEqual(['statsReset', 'imported']);
    h.controller.dispose();
  }, 30_000);
});

describe('who may change the data (§14.7)', () => {
  it('Import and Reset need the writer tab; Export works in a read-only tab too', async () => {
    const backend = new FakeStorage();
    const h = start(backend);
    await drive(h, { hands: 1, hero: passive });
    const stored = profileOf(backend);
    backend.data.set(K.profile, JSON.stringify({ ...stored, rev: stored.rev + 5 }));
    h.dispatch({ type: 'settings', patch: { sound: false } });
    h.dispatch({ type: 'pagehide' }); // the settings' write finds the other rev
    await flush();
    expect(h.state().data.tab).toBe('readOnly');
    h.dispatch({ type: 'resetStats' });
    h.dispatch({ type: 'importFile', file: new Blob(['{}']) });
    await settled();
    expect(toasts(h)).toEqual(['dataNotChanged', 'dataNotChanged']);
    expect(h.state().data.importCheck).toBeNull();
    const { env, sent } = page('ok');
    const ro = launch(backend, { shareEnv: env, tabLock: deniedLock() });
    await flush();
    expect(ro.state().data.tab).toBe('readOnly');
    ro.dispatch({ type: 'exportStats' });
    await settled();
    const content = JSON.parse(await (sent.shared[0] as File).text()) as ExportFile;
    expect(content.profile.rev).toBe(stored.rev + 5); // what the writer stored
    h.controller.dispose();
    ro.controller.dispose();
  }, 30_000);
});

/** A tab lock that another tab holds (Web Locks' `denied`). */
function deniedLock() {
  return {
    mode: 'locks' as const,
    start: (listener: (event: 'denied') => void) => queueMicrotask(() => listener('denied')),
    takeOver: () => {},
    standAside: () => {},
    release: () => {},
  };
}

describe('persist() (§14.8)', () => {
  function manager(answer: { persisted?: boolean; persist?: boolean; fails?: boolean } = {}) {
    const calls: string[] = [];
    const m: StorageManagerLike = {
      persisted: () => {
        calls.push('persisted');
        return answer.fails === true
          ? Promise.reject(new Error('no'))
          : Promise.resolve(answer.persisted ?? false);
      },
      persist: () => {
        calls.push('persist');
        return Promise.resolve(answer.persist ?? true);
      },
    };
    return { m, calls };
  }

  it('a launch from the Home Screen asks at once; the answer is kept and shown', async () => {
    const backend = new FakeStorage();
    const { m, calls } = manager({ persist: true });
    const h = launch(backend, { storageManager: m, standalone: true });
    await flush();
    expect(calls).toEqual(['persisted', 'persist']);
    expect(h.state().data.persisted).toBe(true);
    expect(profileOf(backend).persistGranted).toBe(true);
    h.controller.dispose();
    // Granted: never asked again.
    const { m: again, calls: none } = manager();
    launch(backend, { storageManager: again, standalone: true }).controller.dispose();
    await flush();
    expect(none).toEqual([]);
  });

  it('already persisted: only checked; refused: kept as No, asked again on the next launch', async () => {
    const backend = new FakeStorage();
    const { m, calls } = manager({ persisted: true });
    const first = launch(backend, { storageManager: m, standalone: true });
    await flush();
    first.controller.dispose();
    expect(calls).toEqual(['persisted']);
    expect(profileOf(backend).persistGranted).toBe(true);
    const fresh = new FakeStorage();
    const { m: no } = manager({ persist: false });
    const h = launch(fresh, { storageManager: no, standalone: true });
    await flush();
    expect(h.state().data.persisted).toBe(false);
    h.controller.dispose();
  });

  it('a browser tab: once, after the third finished session; never in a read-only tab; errors ignored', async () => {
    const early = new FakeStorage();
    const { m, calls } = manager();
    const h = start(early, { storageManager: m });
    await drive(h, { hands: 1, hero: passive });
    expect(calls).toEqual([]); // sessions < 3 (chunk 8.2 counts them)
    h.controller.dispose();

    const later = new FakeStorage();
    const profile = profileWithSessions(3);
    later.data.set(K.profile, JSON.stringify(profile));
    const { m: m2, calls: calls2 } = manager();
    const t = launch(later, { storageManager: m2 });
    expect(calls2).toEqual(['persisted']); // asked at boot, before the first await
    await flush();
    expect(calls2).toEqual(['persisted', 'persist']);
    expect(profileOf(later).persistGranted).toBe(true);
    t.controller.dispose();

    const ro = new FakeStorage({ [K.profile]: JSON.stringify(profile) });
    const { m: m3, calls: calls3 } = manager();
    launch(ro, { storageManager: m3, tabLock: deniedLock() }).controller.dispose();
    await flush();
    expect(calls3).toEqual([]);

    const broken = new FakeStorage({ [K.profile]: JSON.stringify(profile) });
    const { m: m4 } = manager({ fails: true });
    const b = launch(broken, { storageManager: m4 });
    await flush();
    expect(profileOf(broken).persistGranted).toBeNull();
    expect(b.controller.logs().errors.map((e) => e.what)).toContain('persist() failed');
    b.controller.dispose();
  }, 30_000);
});

/** A stored profile whose stats have `sessions` finished sessions. */
function profileWithSessions(sessions: number): Profile {
  const backend = new FakeStorage();
  const h = launch(backend);
  h.dispatch({ type: 'settings', patch: { players: 3 } });
  h.dispatch({ type: 'pagehide' });
  h.controller.dispose();
  const p = profileOf(backend);
  return { ...p, stats: { ...p.stats, sessions } };
}
