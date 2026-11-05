/**
 * The persist functions the lazy Data chunk needs (`persist/transfer.ts`, `app/dataTools.ts`;
 * chunk 8.3), gathered in the initial bundle and handed to that chunk at run time. A static import
 * of these modules from the lazy chunk would make the bundler cut the entry chunk into pieces
 * (pitfall 47). They are the functions the rest of the app already uses: nothing is written twice,
 * and the initial bundle carries no code for the lazy chunk's sake.
 */
import { HANDS_KEEP } from './hands.ts';
import { checkWriter, writeProfile } from './profile.ts';
import {
  emptySeatStats,
  emptyStats,
  handRecordProblem,
  isIsoDate,
  parseJson,
  profileProblem,
} from './schema.ts';
import type { PersistKit } from './transfer.ts';

export const PERSIST_KIT: PersistKit = {
  parseJson,
  isIsoDate,
  profileProblem,
  handRecordProblem,
  emptyStats,
  emptySeatStats,
  checkWriter,
  writeProfile,
  handsKeep: HANDS_KEEP,
};
