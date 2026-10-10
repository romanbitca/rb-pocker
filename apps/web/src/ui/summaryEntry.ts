/**
 * The entry of the end-of-hand summary's lazy chunk (PLAN §10.2, §12.9, §15.3; chunk 6.4): the
 * summary sheet, the Exam result and their words. The Table asks for it when it mounts, so the
 * sheet is there when the first hand ends; nothing in the initial bundle imports it at run time.
 */
export { HandSummary } from './components/HandSummary.tsx';
