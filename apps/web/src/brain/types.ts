/**
 * Brain types (PLAN Appendix A.5). So far only the two that earlier stages persist live here:
 * a `DecisionRecord` (A.7) stores a `Grade` and a `LeakId`. Stage 5 adds the rest of A.5 to this
 * file (`BrainProfile`, `Decision`, `ReasonCode`, …).
 */

/** The five grades of a hero decision, best first (§8.9). */
export type Grade = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

/** Leak tags attached to a graded mistake (§8.9). */
export type LeakId =
  | 'open-loose'
  | 'open-tight'
  | 'limp'
  | 'call-pre-wide'
  | 'fold-pre-much'
  | 'pushfold'
  | 'missed-value'
  | 'bluff-much'
  | 'overfold'
  | 'chase'
  | 'river-call'
  | 'call-light'
  | 'sizing';
