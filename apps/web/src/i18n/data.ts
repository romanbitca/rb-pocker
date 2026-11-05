/**
 * The words of Settings' Data and Diagnostics sections and of the Import and "Delete my stats"
 * dialogs (PLAN §12.1, §14.8, §4.5, Appendix F.10; chunk 8.4). They load with the screens after the
 * first tap (`ui/screensEntry.tsx`, §15.3), not with the first paint. Numbers arrive formatted.
 */
export const dataWords = {
  title: 'Data',
  saved: 'Your stats are saved only on this device.',
  export: { label: 'Export', hint: 'Save your stats and settings in a file.' },
  import: { label: 'Import', hint: 'Replace your stats with a file you saved.' },
  reset: { label: 'Reset stats', hint: 'Delete your stats. Your settings stay.' },
  /** §14.8: `navigator.storage.persist()` granted (Yes) or not, or never asked (No). */
  protectedYes: 'Protected from automatic clean-up: Yes',
  protectedNo: 'Protected from automatic clean-up: No',
  protectedHint:
    'If not, the browser may delete your stats to free space. Export them now and then.',

  /** Import's dialog (§14.8): the file is read, then its preview and Replace. */
  importTitle: 'Import stats',
  reading: 'Reading the file…',
  /** "1,234 hands, exported 12 Sep 2026" (§14.8). */
  preview: (hands: string, one: boolean, date: string) =>
    `${hands} ${one ? 'hand' : 'hands'}, exported ${date}`,
  replaceText: 'The stats on this device will be replaced by the stats in this file.',
  /** An unfinished hand cannot go on after Replace (§14.8 notes of chunk 8.3). */
  handCancelled: 'Your unfinished hand will be cancelled, and its chips go back.',
  replace: 'Replace',
  cancel: 'Cancel',
  /** Why a file cannot be imported (`data.importCheck.why`). */
  failed: {
    notStats: 'This is not a stats file of RB Poker Coach.',
    newer: 'This file is from a newer version of the game. Update the game, then try again.',
    damaged: 'This stats file is damaged, so it cannot be imported.',
    unreadable: 'This file could not be read. Please try again.',
  },
  ok: 'OK',
  /** Months for the preview's date, as the player's calendar shows it ("12 Sep 2026"). */
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],

  /** Reset (§14.8): its confirmation with a red "Delete my stats" button. */
  resetTitle: 'Delete your stats?',
  resetText:
    'Your stats and saved hands will be deleted. Your settings stay. You cannot undo this.',
  deleteMyStats: 'Delete my stats',

  /** Settings → Diagnostics (§4.5, §12.14): this launch's counters and what this page lacks. */
  diagnostics: {
    title: 'Diagnostics',
    since: 'Since the game was opened:',
    errors: 'Errors',
    voided: 'Hands cancelled',
    fallbacks: 'Bot moves made safe',
    off: 'Not available here:',
    allOn: 'Every feature works here.',
    features: {
      secureContext: 'Secure connection (https)',
      serviceWorker: 'Offline play',
      webLocks: 'One tab at a time',
      cryptoSubtle: 'Shuffle check',
      persistentStorage: 'Storage protection',
      wakeLock: 'Keep screen on',
      webShare: 'Share',
      randomValues: 'Random numbers',
    },
    export: 'Export debug report',
    exportHint:
      'A file with the hands that went wrong, for the developer. Nothing is sent by itself.',
  },
} as const;
