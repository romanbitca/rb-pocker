/**
 * Chunk 8.4 through the controller (PLAN §12.11, §12.13, §10.4, §14.8, §4.5): the one-time install
 * cards (`data.nudge`) and their flags, the browser's install offer (`data.install`, `install`),
 * the level suggestion card (`data.suggestion`, the lazy `app/suggestions.ts`) and its answer,
 * Import's dialog following the check (the `dataImport` overlay; Back cancels), and "Export debug
 * report". The pure rules are tests/app/suggestions.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShareEnv } from '../../src/app/dataTools.ts';
import type { InstallEnv } from '../../src/app/lifecycle.ts';
import { createTabLock } from '../../src/app/tabLock.ts';
import type { Grade } from '../../src/brain/types.ts';
import type { LegalActions, PlayerAction, ReplayRecord } from '../../src/engine/types.ts';
import {
  defaultProfile,
  type DiagRing,
  type HandRing,
  type Profile,
  type RecentHand,
} from '../../src/persist/schema.ts';
import { createSafeStorage, STORAGE_KEYS } from '../../src/persist/storage.ts';
import { exportFileName } from '../../src/persist/transfer.ts';
import { FakeStorage } from '../persist/fakeStorage.ts';
import { decision, handRecord, NOW } from '../persist/fixtures.ts';
import { FakeOrigin, settle } from './fakeLocks.ts';
import { drive, flush, makeHarness, type Harness, type HarnessOptions } from './harness.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const K = STORAGE_KEYS;

const passive = (legal: LegalActions): PlayerAction =>
  legal.canCheck ? { type: 'check' } : { type: 'call' };

const profileOf = (backend: FakeStorage): Profile =>
  JSON.parse(backend.data.get(K.profile) as string) as Profile;

/** A stored profile (one launch's worth of writes later) with `patch` on top. */
function stored(patch: (p: Profile) => Profile): FakeStorage {
  return new FakeStorage({ [K.profile]: JSON.stringify(patch(defaultProfile(NOW))) });
}

const withSessions =
  (sessions: number) =>
  (p: Profile): Profile => ({
    ...p,
    stats: { ...p.stats, sessions },
  });

/** A browser's install side: iOS or not, https or not, and Chrome's offer when `offer()` runs. */
function fakeInstall(options: { ios?: boolean; secure?: boolean } = {}) {
  let ready = false;
  let changed = (): void => {};
  const prompts: string[] = [];
  const env: InstallEnv = {
    ios: options.ios === true,
    secure: options.secure !== false,
    ready: () => ready,
    listen: (onChange) => {
      changed = onChange;
    },
    prompt: () => {
      if (!ready) return null;
      prompts.push('prompt');
      ready = false;
      changed();
      return Promise.resolve(true);
    },
  };
  return {
    env,
    prompts,
    offer: () => {
      ready = true;
      changed();
    },
  };
}

function launch(backend: FakeStorage, options: Partial<HarnessOptions> = {}): Harness {
  return makeHarness({ storage: createSafeStorage(() => backend), ...options });
}

describe('the one-time install cards (§12.11, §12.13)', () => {
  it('iOS over https: the Share tip after the first finished session, until [Got it]', () => {
    const { env } = fakeInstall({ ios: true });
    expect(launch(stored(withSessions(0)), { install: env }).state().data.nudge).toBeNull();
    const backend = stored(withSessions(1));
    const h = launch(backend, { install: env });
    expect(h.state().data.nudge).toBe('iosTip');
    h.dispatch({ type: 'dismissNudge' });
    expect(h.state().data.nudge).toBeNull();
    expect(profileOf(backend).flags.iosInstall).toBe(true);
    // It does not come back at the next launch.
    expect(launch(backend, { install: env }).state().data.nudge).toBeNull();
  });

  it('end to end: the tip appears on Home once Leave table ends the first session (§14.4)', async () => {
    const { env } = fakeInstall({ ios: true });
    const backend = new FakeStorage();
    const h = launch(backend, { install: env });
    h.dispatch({ type: 'settings', patch: { players: 3, speed: 'instant' } });
    h.dispatch({ type: 'play' });
    await drive(h, { hands: 1, hero: passive });
    expect(h.state().data.nudge).toBeNull(); // the session is still running
    h.dispatch({ type: 'leaveTable' });
    expect(h.state().ui.screen).toBe('home');
    expect(profileOf(backend).stats.sessions).toBe(1);
    expect(h.state().data.nudge).toBe('iosTip');
    h.controller.dispose();
  }, 30_000);

  it('no tip on a plain-http address, in a home-screen app, or without the install side', () => {
    const insecure = fakeInstall({ ios: true, secure: false }).env;
    expect(launch(stored(withSessions(3)), { install: insecure }).state().data.nudge).toBeNull();
    const ios = fakeInstall({ ios: true }).env;
    const home = launch(stored(withSessions(3)), { install: ios, standalone: true });
    expect(home.state().data.nudge).not.toBe('iosTip');
    expect(launch(stored(withSessions(3))).state().data.nudge).toBeNull();
  });

  it('where the browser offers installing: the card after the second finished session; [Install] opens its dialog', () => {
    const install = fakeInstall();
    const backend = stored(withSessions(2));
    const h = launch(backend, { install: install.env });
    expect(h.state().data).toMatchObject({ install: false, nudge: null });
    install.offer(); // Chrome fired beforeinstallprompt
    expect(h.state().data).toMatchObject({ install: true, nudge: 'installCard' });
    h.dispatch({ type: 'install' });
    // Inside the dispatch, as inside the tap: the browser asks for a user activation.
    expect(install.prompts).toEqual(['prompt']);
    expect(h.state().data.install).toBe(false); // an offer is used once
    // [Install] answers the card: it does not come back with the next offer.
    expect(profileOf(backend).flags.iosInstall).toBe(true);
    install.offer();
    expect(h.state().data).toMatchObject({ install: true, nudge: null });
  });

  it('[Not now] answers the install card too', () => {
    const install = fakeInstall();
    const backend = stored(withSessions(5));
    const h = launch(backend, { install: install.env });
    install.offer();
    expect(h.state().data.nudge).toBe('installCard');
    h.dispatch({ type: 'dismissNudge' });
    expect(h.state().data).toMatchObject({ install: true, nudge: null });
    expect(profileOf(backend).flags.iosInstall).toBe(true);
    expect(install.prompts).toEqual([]);
  });

  it('the Install tile follows the offer from the first session on; no card before the second', () => {
    const install = fakeInstall();
    const h = launch(stored(withSessions(1)), { install: install.env });
    install.offer();
    expect(h.state().data).toMatchObject({ install: true, nudge: null });
    h.dispatch({ type: 'install' });
    h.dispatch({ type: 'install' }); // used up: nothing more
    expect(install.prompts).toEqual(['prompt']);
  });

  it('a home-screen app on iOS with no hands: "Played in Safari before?" until [Skip] or a hand', async () => {
    const { env } = fakeInstall({ ios: true });
    const backend = new FakeStorage();
    const h = launch(backend, { install: env, standalone: true });
    expect(h.state().ui.screen).toBe('welcome');
    expect(h.state().data.nudge).toBe('safariImport');
    h.dispatch({ type: 'settings', patch: { players: 3, speed: 'instant' } });
    h.dispatch({ type: 'play' });
    await drive(h, { hands: 1, hero: passive });
    expect(h.state().data.nudge).toBeNull(); // a hand is counted: nothing to bring over
    h.controller.dispose();

    const skipped = launch(new FakeStorage(), { install: env, standalone: true });
    skipped.dispatch({ type: 'dismissNudge' });
    expect(skipped.state().data.nudge).toBeNull();
    // Android keeps one storage for the browser and the installed app: no card there.
    const android = launch(new FakeStorage(), { install: fakeInstall().env, standalone: true });
    expect(android.state().data.nudge).toBeNull();
  }, 30_000);

  it('a tab waiting for the lock shows the card at once; a read-only tab shows none, and no suggestion', async () => {
    const origin = new FakeOrigin(stored(withSessions(1)) as FakeStorage);
    const { env } = fakeInstall({ ios: true });
    const open = () => {
      const page = origin.page();
      return makeHarness({
        storage: createSafeStorage(() => origin.storageFor(page)),
        tabLock: createTabLock(page),
        install: env,
      });
    };
    const first = open();
    // Waiting for the lock's answer at boot: the card is there already (the first paint).
    expect(first.state().data).toMatchObject({ tab: 'pending', nudge: 'iosTip' });
    await settle();
    const second = open();
    await settle();
    expect(first.state().data).toMatchObject({ tab: 'writer', nudge: 'iosTip' });
    expect(second.state().data).toMatchObject({ tab: 'readOnly', nudge: null, suggestion: null });
    second.dispatch({ type: 'dismissNudge' });
    expect(
      (JSON.parse(origin.backend.data.get(K.profile) as string) as Profile).flags.iosInstall,
    ).toBe(false);
  });
});

/** `n` clean Easy hands at +10 bb/100 with a decision score of 80: "Try Medium?". */
const winning = (n: number): RecentHand[] =>
  Array.from({ length: n }, () => ({
    botLevel: 'easy',
    coachLevel: 'beginner',
    assisted: false,
    netMilliBB: 100,
    scorePoints: 80,
    graded: 1,
  }));

/** Lets the suggestions' chunk load (a real dynamic import) and its promise settle. */
async function loaded(): Promise<void> {
  await vi.dynamicImportSettled();
  await flush();
}

describe('the level suggestion card (§10.4)', () => {
  const easyWinner = (p: Profile): Profile => ({
    ...p,
    settings: { ...p.settings, players: 3, seatLevels: [null, null, null], speed: 'instant' },
    stats: { ...p.stats, recentHands: winning(300) },
  });

  it('shows once the Table opens (the chunk loads then), and only in the writer tab', async () => {
    const h = launch(stored(easyWinner));
    expect(h.state().data.suggestion).toBeNull(); // nothing at boot: the chunk is not loaded
    h.dispatch({ type: 'play' });
    await loaded();
    expect(h.state().data.suggestion).toEqual({ rule: 'botsUp', from: 'easy', to: 'medium' });
    h.controller.dispose();
  }, 30_000);

  it('[Try Medium] changes the bot level as Settings does and hides the card for 7 days', async () => {
    const backend = stored(easyWinner);
    const h = launch(backend);
    h.dispatch({ type: 'play' });
    await loaded();
    h.dispatch({ type: 'suggestion', accept: true });
    expect(h.state().settings.botLevel).toBe('medium');
    expect(h.state().data.suggestion).toBeNull();
    const saved = profileOf(backend);
    expect(saved.settings.botLevel).toBe('medium'); // saved at once, with the snooze
    expect(saved.flags.suggestionSnoozedUntil.botsUp).not.toBeNull();
    expect(saved.flags.suggestionSnoozedUntil.botsDown).not.toBeNull();
    // The hand in play keeps its table; the next one is dealt at Medium (§10).
    expect(h.state().game.table?.config.botLevel).toBe('easy');
    h.controller.dispose();
  }, 30_000);

  it('[Not now] keeps the level and hides only this card', async () => {
    const backend = stored(easyWinner);
    const h = launch(backend);
    h.dispatch({ type: 'play' });
    await loaded();
    h.dispatch({ type: 'suggestion', accept: false });
    expect(h.state().settings.botLevel).toBe('easy');
    expect(h.state().data.suggestion).toBeNull();
    const until = profileOf(backend).flags.suggestionSnoozedUntil;
    expect(until.botsUp).not.toBeNull();
    expect(until.botsDown).toBeNull();
    // A later launch within 7 days: still hidden.
    const again = launch(backend);
    again.dispatch({ type: 'play' });
    await loaded();
    expect(again.state().data.suggestion).toBeNull();
    h.controller.dispose();
    again.controller.dispose();
  }, 30_000);

  /** 100 Best decisions without the hint at Intermediate in the ring, and the stats that counted them. */
  function goodCoachRing(): FakeStorage {
    const record = {
      ...handRecord(),
      handSeq: 1,
      coachLevel: 'intermediate' as const,
      decisions: Array.from({ length: 100 }, (_, i) =>
        decision({ decisionId: i + 1, grade: 'best' as Grade, hintSeen: false }),
      ),
    };
    return new FakeStorage({
      [K.profile]: JSON.stringify(
        ((p: Profile): Profile => ({
          ...p,
          lastCommittedHandSeq: 1,
          settings: {
            ...p.settings,
            coachLevel: 'intermediate',
            players: 3,
            seatLevels: [null, null, null],
            speed: 'instant',
          },
          stats: {
            ...p.stats,
            decisions: { ...p.stats.decisions, all: { ...p.stats.decisions.all, own: 100 } },
          },
        }))(defaultProfile(NOW)),
      ),
      [K.hands]: JSON.stringify({ schema: 1, hands: [record] } satisfies HandRing),
    });
  }

  it('Stats opening reads the coach rule`s sample (Stats → Progress shows the card)', async () => {
    const h = launch(goodCoachRing());
    h.dispatch({ type: 'go', screen: 'stats' });
    await loaded();
    expect(h.state().data.suggestion).toEqual({
      rule: 'coachDown',
      from: 'intermediate',
      to: 'advanced',
    });
    h.controller.dispose();
  }, 30_000);

  it('the coach rule reads the stored hands at a commit, once the stats count 100 such decisions', async () => {
    const backend = goodCoachRing();
    const h = launch(backend);
    h.dispatch({ type: 'play' });
    await loaded();
    expect(h.state().data.suggestion).toBeNull(); // the ring is not read before a commit
    await drive(h, { hands: 1, hero: passive });
    expect(h.state().data.suggestion).toEqual({
      rule: 'coachDown',
      from: 'intermediate',
      to: 'advanced',
    });
    h.dispatch({ type: 'suggestion', accept: true });
    expect(h.state().settings.coachLevel).toBe('advanced');
    expect(profileOf(backend).flags.suggestionSnoozedUntil.coachDown).not.toBeNull();
    h.controller.dispose();
  }, 30_000);
});

describe("Import's dialog follows the check (§14.8, the `dataImport` overlay)", () => {
  async function settled(): Promise<void> {
    await vi.dynamicImportSettled();
    await flush();
  }

  it('opens when a file is picked; Cancel closes it; Back closes it and forgets the file', async () => {
    const h = launch(new FakeStorage());
    h.dispatch({ type: 'go', screen: 'settings' });
    await settled();
    h.dispatch({ type: 'importFile', file: new Blob(['not json']) });
    expect(h.state().ui.overlays).toEqual(['dataImport']);
    await settled();
    expect(h.state().data.importCheck).toEqual({ status: 'failed', why: 'notStats' });
    h.dispatch({ type: 'importCancel' });
    expect(h.state().ui.overlays).toEqual([]);
    expect(h.state().data.importCheck).toBeNull();

    h.dispatch({ type: 'importFile', file: new Blob(['{}']) });
    await settled();
    expect(h.state().ui.overlays).toEqual(['dataImport']);
    h.dispatch({ type: 'back' }); // Android Back
    expect(h.state().ui.overlays).toEqual([]);
    expect(h.state().ui.screen).toBe('settings');
    await settled();
    expect(h.state().data.importCheck).toBeNull();
  }, 30_000);

  it('"Delete my stats" is an overlay of its own that Back closes', () => {
    const h = launch(new FakeStorage());
    h.dispatch({ type: 'go', screen: 'settings' });
    h.dispatch({ type: 'open', overlay: 'dataReset' });
    expect(h.state().ui.gates).toContain('dialog');
    h.dispatch({ type: 'back' });
    expect(h.state().ui.overlays).toEqual([]);
    expect(h.state().ui.screen).toBe('settings');
  });
});

describe('Export debug report (§4.5, Settings → Diagnostics)', () => {
  it('sends the stored voided hands, the counters and the features this page lacks', async () => {
    const replay = { schema: 1 } as unknown as ReplayRecord;
    const backend = new FakeStorage({
      [K.diag]: JSON.stringify({ schema: 1, records: [replay] } satisfies DiagRing),
    });
    const shared: File[] = [];
    const env: ShareEnv = {
      navigator: {
        canShare: () => true,
        share: (data) => {
          shared.push(...data.files);
          return Promise.resolve();
        },
        userAgent: 'test',
      },
      File,
      Blob,
    };
    const h = launch(backend, { shareEnv: env });
    h.dispatch({ type: 'go', screen: 'settings' });
    await vi.dynamicImportSettled();
    await flush();
    h.dispatch({ type: 'exportDebug' });
    expect(shared).toHaveLength(1); // inside the tap
    const file = shared[0] as File;
    expect(file.name).toBe(exportFileName(new Date(), 'debug'));
    const report = JSON.parse(await file.text()) as Record<string, unknown>;
    expect(report).toMatchObject({
      app: 'poker-coach',
      kind: 'debug',
      counters: { engineErrors: 0, botFallbacks: 0, voidedHands: 0 },
      standalone: false,
      userAgent: 'test',
      diag: { schema: 1, records: [replay] },
    });
    expect(Array.isArray(report.featuresOff)).toBe(true);
    expect(Array.isArray(report.errors)).toBe(true);
  }, 30_000);
});
