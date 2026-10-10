/**
 * The entry of the Advanced quiz's lazy chunk (PLAN §10.3, §15.3; chunk 6.4): the quiz and its
 * words. The Table loads it when the coach level in force is Advanced; nothing in the initial
 * bundle imports these modules at run time.
 */
export { QuizStrip, type QuizVariant } from './components/QuizStrip.tsx';
