/**
 * Persisted values for the persistence tests, built on the engine's hand-built states
 * (tests/engine/fixtures.ts): a table that matches a hand (the table as at hand start, §14.5),
 * sessions around it, a decision record and a hand record. Every builder returns fresh objects.
 */
import type { BotLevel, CoachLevel, HandState, TableState } from '../../src/engine/types.ts';
import { ENGINE_VERSION } from '../../src/engine/types.ts';
import type {
  DecisionRecord,
  HandMeta,
  HandRecord,
  SessionState,
  Settings,
} from '../../src/persist/schema.ts';
import { defaultProfile, emptySeatStats } from '../../src/persist/schema.ts';
import { handAtStart, headsUpFlop } from '../engine/fixtures.ts';
import profileV0 from './fixtures/profile.v0.json' with { type: 'json' };

/** A deep copy of the hand-written v0 profile fixture (fixtures/profile.v0.json). */
export const v0Profile = (): unknown => JSON.parse(JSON.stringify(profileV0)) as unknown;

/**
 * A hand-written migration from the made-up v0 fixture to schema 1. There never was a real v0:
 * it only exercises the H.2 mechanism now (§14.9). Pure, and every field it does not understand
 * moves to `legacy` (H.2 rule 2).
 */
export function profileV0ToV1(x: unknown): unknown {
  const v0 = x as Record<string, unknown> & {
    savedAt: string;
    setup: {
      players: number;
      chips: number;
      blinds: [number, number];
      bots: BotLevel;
      coach: CoachLevel;
    };
    speed: Settings['speed'];
    muted: boolean;
  };
  const known = new Set(['schema', 'savedAt', 'setup', 'speed', 'muted']);
  const legacy = Object.fromEntries(Object.entries(v0).filter(([key]) => !known.has(key)));
  const base = defaultProfile(new Date(v0.savedAt));
  const settings: Settings = {
    ...base.settings,
    players: v0.setup.players,
    startingStack: v0.setup.chips,
    sb: v0.setup.blinds[0],
    bb: v0.setup.blinds[1],
    botLevel: v0.setup.bots,
    coachLevel: v0.setup.coach,
    seatLevels: Array.from({ length: v0.setup.players }, () => null),
    speed: v0.speed,
    sound: !v0.muted,
  };
  return { ...base, settings, legacy };
}

export const NOW = new Date('2026-09-28T10:00:00.000Z');
export const TABLE_SEED = 'fedcba9876543210fedcba9876543210';

const BOT_NAMES = ['Anna', 'Ben', 'Carla', 'Dev', 'Emeka', 'Fatima', 'Gus', 'Hana'];

/** The table `h` was dealt from: its stacks are h.startStacks, its nextHandSeq is h.handSeq. */
export function tableFor(h: HandState): TableState {
  const n = h.seats.length;
  return {
    schema: 1,
    engineVersion: ENGINE_VERSION,
    tableId: 'fedcba98',
    tableSeed: TABLE_SEED,
    config: {
      seatCount: n,
      sb: h.sb,
      bb: h.bb,
      startingStack: 100 * h.bb,
      botLevel: 'easy',
      seatLevels: h.seats.map(() => null),
    },
    slots: h.startStacks.map((stack, i) =>
      i === 0
        ? { playerId: 'hero', name: 'You', kind: 'hero', personality: null, stack }
        : {
            playerId: `bot-${i - 1}`,
            name: BOT_NAMES[i - 1] as string,
            kind: 'bot',
            personality: 'station',
            stack,
          },
    ),
    button: (h.button + n - 1) % n,
    prevBB: null,
    nextHandSeq: h.handSeq,
    handsDealt: h.handSeq - 1,
    personalityCursor: n - 1,
    nameCursor: n - 1,
    reloads: 0,
  };
}

export function decision(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    decisionId: 1,
    street: 'preflop',
    taken: { type: 'call' },
    rec: { type: 'raise', to: 300 },
    grade: 'inaccuracy',
    lossMilliBB: 420,
    eRandom: 0.53,
    need: 0.25,
    hintSeen: true,
    undone: false,
    leak: 'call-pre-wide',
    quiz: null,
    ...overrides,
  };
}

export function meta(): HandMeta {
  return {
    decisions: [decision(), decision({ decisionId: 2, street: 'flop', grade: null, leak: null })],
    undoCount: 1,
    hintShown: { 1: true, 2: false },
  };
}

/** Between hands: a table and no hand. */
export function idleSession(table: TableState): SessionState {
  return {
    schema: 1,
    savedAt: '2026-09-28T09:59:00.000Z',
    sessionStart: '2026-09-28T09:30:00.000Z',
    table,
    hand: null,
    handInputs: [],
    meta: { decisions: [], undoCount: 0, hintShown: {} },
    undoSnapshot: null,
    seatStats: table.slots.map((_, i) => (i === 0 ? emptySeatStats() : null)),
    resumeAfterUpdate: false,
  };
}

/**
 * Mid-hand, heads-up on the flop (button 0 called, BB 1 checked, the flop is dealt, the BB is to
 * act), with the undo snapshot taken at the hero's first decision (preflop, before the call).
 */
export function midHandSession(): SessionState {
  const hand = headsUpFlop();
  const start = handAtStart({ stacks: [10000, 10000], button: 0 });
  const table = tableFor(hand);
  return {
    ...idleSession(table),
    hand,
    handInputs: [
      { kind: 'act', seat: 0, action: { type: 'call' } },
      { kind: 'act', seat: 1, action: { type: 'check' } },
      { kind: 'advance' },
    ],
    meta: meta(),
    undoSnapshot: {
      decisionId: 1,
      state: start,
      meta: { decisions: [], undoCount: 0, hintShown: { 1: true } },
      inputCount: 0,
    },
    seatStats: [
      { ...emptySeatStats(), hands: 12, vpip: [5, 12], pfr: [2, 12] },
      { ...emptySeatStats(), hands: 12, vpip: [9, 12], aggActions: 3, passiveActions: 10 },
    ],
  };
}

export function handRecord(): HandRecord {
  const session = midHandSession();
  const hand = session.hand as HandState;
  return {
    handSeq: hand.handSeq,
    at: '2026-09-28T10:00:00.000Z',
    seed: hand.seed,
    commit: null,
    engineVersion: ENGINE_VERSION,
    table: session.table,
    inputs: session.handInputs,
    heroHole: hand.seats[0]?.hole as [number, number],
    board: [...hand.board],
    net: [-100, 100],
    heroNetMilliBB: -1000,
    decisions: [decision()],
    assisted: true,
    undoCount: 0,
    botLevel: 'easy',
    coachLevel: 'beginner',
    bestCategory: 'pair',
    allIn: null,
  };
}
