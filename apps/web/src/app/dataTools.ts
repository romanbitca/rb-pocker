/**
 * The Data commands' lazy chunk (PLAN §14.8, §15.3; chunk 8.3): Export, Import and Reset. First
 * paint does not need them, so the controller loads this module with `import()`: when a screen
 * that offers them opens (`DATA_SCREENS`), so the first tap on Export finds it loaded (the share
 * sheet opens only inside that tap: browsers allow `navigator.share()` only during a user
 * activation, and Safari is strict about it), else when a Data command first needs it.
 *
 * Export goes out the first way that works (§14.8):
 * 1. the share sheet, `navigator.share({ files })` when `navigator.canShare({ files })` says yes
 *    (iOS: Share → "Save to Files"; Android: any app). Closing the sheet is the player's choice:
 *    nothing else happens then;
 * 2. a download: a Blob URL and a temporary `<a download>`. Not in an iOS home-screen app, where it
 *    is reported broken (UNVERIFIED): the clipboard instead;
 * 3. the clipboard, `navigator.clipboard.writeText()`, as the last resort ("Your stats were copied…").
 *
 * Import: the picked file is read and checked (`persist/transfer.ts`), its preview goes to the
 * store (`data.importCheck`), and Replace writes it. Reset empties the stats. The storage protocols
 * are `persist/transfer.ts`; what they do to the game in this tab (a hand waiting for its grade, an
 * unfinished hand, the new profile in memory) goes through `DataHost`, the controller's side.
 *
 * Only pure modules are imported at run time (pitfall 47): the persist functions come in
 * `DataHost.kit`.
 */
import type { TableState } from '../engine/types.ts';
import type { Profile } from '../persist/schema.ts';
import type { SafeStorage } from '../persist/storage.ts';
import {
  exportData,
  importProfile,
  IMPORT_MAX_CHARS,
  readImport,
  resetProfile,
  type ImportFile,
  type ImportProblem,
  type ImportRead,
  type PersistKit,
  type TransferResult,
} from '../persist/transfer.ts';
import type { ImportCheck } from './store.ts';

/** Where an export went (`shared`, `downloaded`, `copied`), or did not (`cancelled`, `failed`). */
export type ExportOutcome = 'shared' | 'cancelled' | 'downloaded' | 'copied' | 'failed';

/** The browser parts Export uses (`globalThis` in the app; fakes in tests). */
export interface ShareEnv {
  navigator?: {
    canShare?: (data: { files: File[] }) => boolean;
    share?: (data: { files: File[] }) => Promise<void>;
    clipboard?: { writeText(text: string): Promise<void> };
    /** iOS only: true in a home-screen app. */
    standalone?: boolean;
  };
  document?: Pick<Document, 'createElement' | 'body'>;
  URL?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
  File?: typeof File;
  Blob?: typeof Blob;
}

/** The Data commands' toasts (§12.11). */
export type DataToast =
  'exportCopied' | 'exportFailed' | 'imported' | 'statsReset' | 'dataNotChanged';

/** The controller's side of the Data commands (`TableController`). */
export interface DataHost {
  readonly storage: SafeStorage;
  readonly kit: PersistKit;
  readonly env: ShareEnv;
  now(): Date;
  /** Import and Reset may write: this tab is the writer (§14.7) and no hand is being folded (§3.1). */
  canChange(): boolean;
  /** The profile Export writes: this tab's when it writes, else the stored one (a read-only tab). */
  exportProfile(): Profile;
  /** The profile Import and Reset replace (only while `canChange()`). */
  profile(): Profile;
  /**
   * Before Replace or Reset: a finished hand waiting for its grade is counted, in the stats that go
   * to `pc.v1.preimport` (§14.3). With `cancel` an unfinished hand is cancelled (Import: its number
   * may be counted in the file already): its chips go back, and its table comes back.
   */
  prepare(cancel: boolean): TableState | null;
  /**
   * After Replace or Reset: `profile` (when not null) is the profile in memory now, and a
   * cancelled hand's `table` deals the next hand at once.
   */
  adopt(profile: Profile | null, table: TableState | null): void;
  /** Another tab wrote the profile since (§14.3 step 2): this tab becomes read-only (§14.7). */
  conflict(storedRev: number): void;
  importCheck(check: ImportCheck | null): void;
  toast(kind: DataToast): void;
  log(what: string, detail?: unknown): void;
}

/** The commands the controller hands over (`GameCommand`s of the same names). */
export type DataCommand =
  | { type: 'exportStats' }
  | { type: 'importFile'; file: Blob }
  | { type: 'importConfirm' }
  | { type: 'importCancel' }
  | { type: 'resetStats' };

export interface DataCommands {
  run(cmd: DataCommand): void;
}

const JSON_TYPE = 'application/json';

const isAbort = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';

/**
 * The share sheet, opened synchronously (inside the tap). Null when this browser cannot share a
 * file; a promise of null when sharing failed for another reason than the player closing it.
 */
function share(env: ShareEnv, name: string, text: string): Promise<ExportOutcome | null> | null {
  const nav = env.navigator;
  const FileType = env.File;
  if (typeof nav?.share !== 'function' || typeof nav.canShare !== 'function') return null;
  if (FileType === undefined) return null;
  try {
    const data = { files: [new FileType([text], name, { type: JSON_TYPE })] };
    if (!nav.canShare(data)) return null;
    return nav.share(data).then(
      () => 'shared',
      (e: unknown) => (isAbort(e) ? 'cancelled' : null),
    );
  } catch {
    return Promise.resolve(null);
  }
}

/** The Blob URL of the last download: revoked at the next one (no timers here, §0.3). */
let lastUrl: string | null = null;

/** A download through a temporary `<a download>`; false when this page cannot start one. */
function download(env: ShareEnv, name: string, text: string): boolean {
  const { document: doc, URL: urls, Blob: BlobType } = env;
  if (doc === undefined || urls === undefined || BlobType === undefined) return false;
  if (env.navigator?.standalone === true) return false; // iOS home-screen app (module note)
  try {
    const url = urls.createObjectURL(new BlobType([text], { type: JSON_TYPE }));
    if (lastUrl !== null) urls.revokeObjectURL(lastUrl);
    lastUrl = url;
    const a = doc.createElement('a');
    a.href = url;
    a.download = name;
    a.hidden = true;
    doc.body.append(a);
    a.click();
    a.remove();
    return true;
  } catch {
    return false;
  }
}

/**
 * Sends the export file out (module note). Call it inside the tap: everything up to the share
 * sheet runs before the first `await`.
 */
export async function deliverExport(
  env: ShareEnv,
  name: string,
  text: string,
): Promise<ExportOutcome> {
  const sharing = share(env, name, text);
  const shared = sharing === null ? null : await sharing;
  if (shared !== null) return shared;
  if (download(env, name, text)) return 'downloaded';
  const clipboard = env.navigator?.clipboard;
  if (clipboard === undefined) return 'failed';
  try {
    await clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/** Why a picked file cannot be imported: `persist/transfer.ts`'s reasons, or it could not be read. */
export type ImportCheckProblem = ImportProblem | 'unreadable';

export type ImportCheckRead =
  Extract<ImportRead, { ok: true }> | { ok: false; why: ImportCheckProblem; problem: string };

/** Reads the file the player picked (§14.8: `<input type="file">`) and checks it. */
export async function readImportFile(kit: PersistKit, file: Blob): Promise<ImportCheckRead> {
  if (file.size > IMPORT_MAX_CHARS) {
    return { ok: false, why: 'notStats', problem: `${file.size} bytes` };
  }
  let text: string;
  try {
    text = await file.text();
  } catch (e) {
    return { ok: false, why: 'unreadable', problem: e instanceof Error ? e.message : String(e) };
  }
  return readImport(kit, text);
}

/** The Data commands of one controller (one tab). */
export function dataCommands(host: DataHost): DataCommands {
  /** The file Import checked, waiting for Replace. */
  let pending: ImportFile | null = null;
  /** Each picked file's number: only the latest one's check counts. */
  let picked = 0;

  const forget = (): void => {
    picked++;
    pending = null;
    host.importCheck(null);
  };

  /** Export (§14.8): synchronous up to the share sheet, so it opens inside the tap. */
  const exportStats = (): void => {
    const { name, text } = exportData(host.kit, host.storage, host.exportProfile(), host.now());
    void deliverExport(host.env, name, text).then((outcome) => {
      host.log('export', outcome);
      if (outcome === 'copied') host.toast('exportCopied');
      else if (outcome === 'failed') host.toast('exportFailed');
    });
  };

  const importFile = (file: Blob): void => {
    if (!host.canChange()) {
      host.toast('dataNotChanged');
      return;
    }
    const mine = ++picked;
    pending = null;
    host.importCheck({ status: 'reading' });
    void readImportFile(host.kit, file).then((read) => {
      if (mine !== picked) return; // cancelled, or another file since
      if (read.ok) {
        pending = read.file;
        host.log('import ready', { hands: read.file.hands.length, dropped: read.file.dropped });
        host.importCheck({ status: 'ready', ...read.file.preview });
      } else {
        host.log('import refused', read.problem);
        host.importCheck({ status: 'failed', why: read.why });
      }
    });
  };

  /** A protocol's result: the new profile in memory and its toast, or why nothing changed. */
  const finish = (
    result: TransferResult,
    done: 'imported' | 'statsReset',
    table: TableState | null,
  ): void => {
    if (result.status === 'done') {
      if (!result.result.ok) host.log(`${done}: in memory only`, result.result.reason);
      host.adopt(result.profile, table);
      host.toast(done);
      return;
    }
    if (result.status === 'conflict') host.conflict(result.storedRev);
    else host.log(`${done}: nothing changed`, result);
    host.adopt(null, table);
    host.toast('dataNotChanged');
  };

  /** Replace (§14.8): the checked file replaces the stats. */
  const importConfirm = (): void => {
    const file = pending;
    forget();
    if (file === null || !host.canChange()) {
      host.toast('dataNotChanged');
      return;
    }
    const table = host.prepare(true);
    if (!host.canChange()) {
      host.toast('dataNotChanged');
      return;
    }
    finish(
      importProfile(host.kit, host.storage, host.profile(), file, host.now()),
      'imported',
      table,
    );
  };

  /** Reset stats (§14.8), after its confirmation ("Delete my stats", chunk 8.4). */
  const resetStats = (): void => {
    if (host.canChange()) host.prepare(false);
    if (!host.canChange()) {
      host.toast('dataNotChanged');
      return;
    }
    finish(resetProfile(host.kit, host.storage, host.profile(), host.now()), 'statsReset', null);
  };

  return {
    run(cmd) {
      switch (cmd.type) {
        case 'exportStats':
          exportStats();
          break;
        case 'importFile':
          importFile(cmd.file);
          break;
        case 'importConfirm':
          importConfirm();
          break;
        case 'importCancel':
          forget();
          break;
        case 'resetStats':
          resetStats();
          break;
      }
    },
  };
}
