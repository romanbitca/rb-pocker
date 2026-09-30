/**
 * Brain test fixtures: range tables, observation extras, and scripted spots played through the
 * real engine (tests may run the engine; the brain never does) and observed with `observe()`.
 */
import { RANGE_TABLES, type RangeTables } from '../../src/brain/ranges.ts';
import { observe } from '../../src/engine/observe.ts';
import type {
  BotLevel,
  EngineInput,
  HandState,
  Observation,
  ObserveExtras,
  PersonalityId,
  SeatStats,
} from '../../src/engine/types.ts';
import { deal, rigDeck, tableWith } from '../engine/helpers.ts';
import { ADVANCE, play } from '../engine/play.ts';

/** The real build-time tables (chunk 5.1). */
export const TABLES: RangeTables = RANGE_TABLES;

export interface ExtrasSpec {
  stats?: (SeatStats | null)[];
  labels?: (PersonalityId | null)[];
  levels?: BotLevel[];
}

export function extrasFor(n: number, spec: ExtrasSpec = {}): ObserveExtras {
  return {
    seatStats: spec.stats ?? new Array<SeatStats | null>(n).fill(null),
    visiblePersonality: spec.labels ?? new Array<PersonalityId | null>(n).fill(null),
    seatLevels: spec.levels ?? new Array<BotLevel>(n).fill('medium'),
  };
}

export interface SpotSpec {
  /** Stacks in chips (50/100 blinds unless `bb` says otherwise). */
  stacks: number[];
  button: number;
  bb?: number;
  /** "Ah Kh" per seat. */
  holes?: Record<number, string>;
  /** Up to five cards, flop first. */
  board?: string;
  /** Actions in order; `advance` inputs between streets are added automatically. */
  inputs: EngineInput[];
}

/** Plays the spot: deals with rigged cards, then each input (dealing streets as needed). */
export function playSpot(spec: SpotSpec): HandState {
  const bb = spec.bb ?? 100;
  let h = deal(tableWith(spec.stacks, { button: spec.button, bb, sb: bb / 2 }));
  if (spec.holes !== undefined || spec.board !== undefined) {
    h = rigDeck(h, { holes: spec.holes ?? {}, board: spec.board ?? '' });
  }
  for (const input of spec.inputs) {
    while (h.phase === 'roundComplete') h = play(h, ADVANCE);
    h = play(h, input);
  }
  while (h.phase === 'roundComplete') h = play(h, ADVANCE);
  return h;
}

/** `observe()` of a played spot for `seat`. */
export function observeSpot(h: HandState, seat: number, spec: ExtrasSpec = {}): Observation {
  return observe(h, seat, extrasFor(h.seats.length, spec));
}
