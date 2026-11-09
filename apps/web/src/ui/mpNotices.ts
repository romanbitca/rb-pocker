/**
 * The toasts are in the first paint and the words of a table's notices are not (PLAN §19.10,
 * §15.3): `mpEntry.tsx` puts its `noticeText` here when its lazy chunk loads, long before the first
 * notice (the screen that shows a table needs that chunk). A file of its own because the chunk
 * must not import `Notices.tsx`: that split the first paint's code into three files.
 */
import type { Toast } from '../app/store.ts';

export type MpNotice = Extract<Toast, { kind: 'mpNotice' }>['notice'];

export const mpNoticeWords: { text: ((notice: MpNotice) => string) | null } = { text: null };
