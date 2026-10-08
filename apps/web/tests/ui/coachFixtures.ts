/**
 * Coach test fixtures (chunk 5.9): decisions in the Appendix A.5 shape, the coach data the store
 * would select, and action-bar inputs for the spots they belong to.
 */
import type { CoachData, NarrationData } from '../../src/app/store.ts';
import type { Decision, Reason, ReasonCode } from '../../src/brain/types.ts';
import type { LegalActions, SeatState } from '../../src/engine/types.ts';
import type { ActionBarInput } from '../../src/ui/actionBar.ts';

export const r = (code: ReasonCode, data: Reason['data'] = {}): Reason => ({ code, data });

export function decision(over: Partial<Decision> = {}): Decision {
  return {
    action: { type: 'call' },
    kind: 'call',
    ev: {},
    eRandom: 0.45,
    eRange: 0.45,
    need: 0.25,
    bucket: 'medium',
    strength: 'decent',
    confidence: 'clear',
    alt: null,
    trace: [r('CALL_PROFITABLE', { E: 0.45, need: 0.25, toCall: 40, pot: 120 }), r('WHY_NOT_FOLD')],
    ...over,
  };
}

/** Facing a 40 bet into 80 (pot 120 with the bet): call 40, need 25%. */
export const FACING: LegalActions = {
  seat: 0,
  toCall: 40,
  callAmount: 40,
  callIsAllIn: false,
  canFold: true,
  canCheck: false,
  canCall: true,
  bet: null,
  raise: { min: 80, max: 2_000 },
};

/** Nothing to call on the flop, pot 120. */
export const CHECKED: LegalActions = {
  seat: 0,
  toCall: 0,
  callAmount: 0,
  callIsAllIn: false,
  canFold: false,
  canCheck: true,
  canCall: false,
  bet: { min: 20, max: 2_000 },
  raise: null,
};

const seat = (totalBet: number, over: Partial<SeatState> = {}): SeatState => ({
  dealtIn: true,
  stack: 2_000,
  hole: null,
  folded: false,
  allIn: false,
  streetBet: 0,
  totalBet,
  lastActedAtBet: null,
  ...over,
});

/** The action bar's input: heads-up flop, the hero has 40 in, the villain 80 (a 40 bet). */
export function input(
  legal: LegalActions | null,
  amounts: 'chips' | 'bb' = 'chips',
): ActionBarInput {
  const facing = legal !== null && legal.toCall > 0;
  return {
    legal,
    street: 'flop',
    currentBet: facing ? 40 : 0,
    sb: 10,
    bb: 20,
    seats: facing ? [seat(40), seat(80, { streetBet: 40 })] : [seat(60), seat(60)],
    amounts,
  };
}

export function coachData(over: Partial<CoachData> = {}): CoachData {
  return {
    level: 'beginner',
    state: 'ready',
    key: '7:12',
    decision: decision(),
    opened: false,
    ...over,
  };
}

export const NARRATION: NarrationData = {
  key: '7:11',
  hero: false,
  name: 'Ben',
  type: 'raise',
  amount: 60,
  allIn: false,
};

/** A RANGE_ADJUST hint (§8.10): any cards 62%, their likely hands 20%; fold to `FACING` (need 25%). */
export function rangeAdjusted(): Decision {
  return decision({
    action: { type: 'fold' },
    kind: 'fold',
    eRandom: 0.62,
    eRange: 0.2,
    need: 0.25,
    trace: [
      r('RANGE_ADJUST', { actionDescription: 'betBig' }),
      r('FOLD_PRICE', { E: 0.2, need: 0.25 }),
      r('WHY_NOT_CALL', { E: 0.2, need: 0.25 }),
    ],
  });
}
