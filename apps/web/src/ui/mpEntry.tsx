/**
 * Play with friends' screens and words (PLAN §19.3, §19.10), one lazy chunk: `mpModule.ts` asks
 * for it when a screen of it comes on show or a table of the server's is on. Only inside Telegram,
 * so the game outside it never fetches this.
 */
import { mpWords } from '../i18n/mp.ts';
import { mpNoticeWords, type MpNotice } from './mpNotices.ts';

export { mpWords };
export { TurnStrip } from './components/TurnStrip.tsx';
export { Create } from './screens/mp/Create.tsx';
export { LeaveDialog, ProblemDialog } from './screens/mp/Dialogs.tsx';
export { ConnectionBanner, SittingOut } from './screens/mp/TableParts.tsx';
export { WaitingRoom } from './screens/mp/WaitingRoom.tsx';

/** A table's notice as a toast (§19.10). */
export function noticeText(notice: MpNotice): string {
  const t = mpWords.toast;
  switch (notice.n) {
    case 'joined':
      return t.joined(notice.name);
    case 'left':
      return t.left(notice.name);
    case 'hostChanged':
      return t.hostChanged(notice.name);
    case 'timedOut':
      return notice.action === 'fold' ? t.timedOutFold : t.timedOutCheck;
    case 'sittingOut':
      return mpWords.sittingOut.line;
  }
}

// The toasts are in the first paint, and these words are not: they arrive with this chunk.
mpNoticeWords.text = noticeText;
