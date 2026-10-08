/**
 * The entry of the coach's lazy chunk (`ui/coachModule.ts`, PLAN §15.3): everything that turns a
 * coach decision into words, and the sheet that shows them. Nothing in the initial bundle imports
 * these modules at run time.
 */
export { coachView } from './coach.ts';
export { CoachDetails, CoachSheet } from './components/CoachSheet.tsx';
export { CoachStrip } from './components/CoachStrip.tsx';
