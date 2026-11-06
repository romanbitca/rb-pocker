/**
 * PLAN §14.9: "10,000 simulated hands keep total storage < … and the Stats screen renders in
 * < 300 ms at 6× CPU throttle" (chunk 8.2). This builds the storage of a player with 10,000 hands
 * behind them, for the unit test (its size) and the E2E spec (the Stats screen over it). No Vitest
 * here: Playwright imports it too.
 *
 * - 40 template hands are played by the engine at a full 9-seat table (the biggest records): a
 *   seeded, mostly passive random play, the hero's decisions graded in turn (with leaks, hints,
 *   quiz answers and an Undo now and then), recorded by `handRecordOf` as the controller does.
 * - 10,000 hands count them in turn (each with its own `handSeq` and time); a session ends every
 *   40 hands, so both rings (60 sessions, 500 recent hands) are full. The last 100 go through the
 *   commit protocol (`commitHand`, §14.3) into a storage, so the hand ring, the backup and the
 *   profile are exactly what the game writes; the session is a hand in play at 9 seats.
 */
import { handRecordOf } from '../../src/app/handRecord.ts';
import type { Grade, LeakId } from '../../src/brain/types.ts';
import { randInt, rngFromSeed, seedFromWords, type Rng } from '../../src/core/rng.ts';
import { legalActions } from '../../src/engine/legal.ts';
import { startHand } from '../../src/engine/start.ts';
import { step } from '../../src/engine/step.ts';
import type { EngineInput, HandState, LegalActions, PlayerAction } from '../../src/engine/types.ts';
import { commitHand } from '../../src/persist/commit.ts';
import {
  defaultProfile,
  type DecisionRecord,
  type HandRecord,
  type Profile,
  type SessionState,
} from '../../src/persist/schema.ts';
import { saveSession } from '../../src/persist/session.ts';
import { applyHand, endSession } from '../../src/persist/stats.ts';
import { createSafeStorage, STORAGE_KEYS, type StorageBackend } from '../../src/persist/storage.ts';
import { tableWith } from '../engine/helpers.ts';

export const VOLUME_HANDS = 10_000;
const TEMPLATES = 40;
const SESSION_HANDS = 40;
const START = Date.parse('2026-01-01T09:00:00.000Z');

const GRADES: readonly Grade[] = [
  'best',
  'good',
  'best',
  'inaccuracy',
  'best',
  'mistake',
  'blunder',
];
const LEAKS: readonly LeakId[] = ['limp', 'missed-value', 'call-light', 'chase', 'overfold'];

/** A map storage (keys and values counted as browsers count them). */
export class MapStorage implements StorageBackend {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  /** Characters of every key and value. */
  used(): number {
    let n = 0;
    for (const [key, value] of this.data) n += key.length + value.length;
    return n;
  }
}

function choose(legal: LegalActions, rng: Rng): PlayerAction {
  const r = randInt(rng, 100);
  if (r < 30 && legal.canFold) return { type: 'fold' };
  if (r < 85) return legal.canCheck ? { type: 'check' } : { type: 'call' };
  if (legal.bet !== null) return { type: 'bet', to: legal.bet.min };
  if (legal.raise !== null) return { type: 'raise', to: legal.raise.min };
  return legal.canCheck ? { type: 'check' } : { type: 'call' };
}

interface Played {
  hand: HandState;
  inputs: EngineInput[];
  /** A state in the middle of the hand (for the session), with its inputs so far. */
  middle: { hand: HandState; inputs: EngineInput[] };
}

function playHand(rng: Rng, k: number): { table: ReturnType<typeof tableWith>; played: Played } {
  const table = tableWith(new Array<number>(9).fill(2000), {
    sb: 10,
    bb: 20,
    startingStack: 2000,
    button: k % 9,
    nextHandSeq: k + 1,
  });
  let h = startHand(table, rngSeed(rng));
  const inputs: EngineInput[] = [];
  let middle: Played['middle'] = { hand: h, inputs: [] };
  while (h.phase !== 'complete') {
    const legal = legalActions(h);
    const input: EngineInput =
      legal === null
        ? { kind: 'advance' }
        : { kind: 'act', seat: legal.seat, action: choose(legal, rng) };
    h = step(h, input);
    inputs.push(input);
    if (inputs.length === 6) middle = { hand: h, inputs: [...inputs] };
  }
  return { table, played: { hand: h, inputs, middle } };
}

const rngSeed = (rng: Rng) => seedFromWords(rng.next(), rng.next(), rng.next(), rng.next());

function decisionsOf(hand: HandState, k: number): DecisionRecord[] {
  const out: DecisionRecord[] = [];
  let id = 0;
  for (const e of hand.log) {
    if (e.e !== 'act' || e.seat !== 0) continue;
    const grade = GRADES[(k + id) % GRADES.length] as Grade;
    const bad = grade !== 'best' && grade !== 'good';
    out.push({
      decisionId: id,
      street: e.street,
      taken: e.action,
      rec: bad ? { type: 'fold' } : e.action,
      grade,
      lossMilliBB: bad ? 400 + 37 * ((k + id) % 50) : 0,
      eRandom: 0.31 + ((k + id) % 50) / 100,
      need: e.action.type === 'call' ? 0.25 : null,
      hintSeen: (k + id) % 3 === 0,
      undone: false,
      leak: bad ? (LEAKS[(k + id) % LEAKS.length] as LeakId) : null,
      quiz: (k + id) % 4 === 0 ? { correct: 2, of: 3 } : null,
    });
    id++;
  }
  // An Undo now and then: the first decision taken back (it still counts, §11.4).
  if (k % 9 === 0 && out[0] !== undefined)
    out.unshift({ ...out[0], grade: 'mistake', undone: true });
  return out;
}

/** The 40 template records (9 seats), their hand-in-play states, played once per process. */
let templates: { records: HandRecord[]; middle: SessionState } | null = null;

function makeTemplates(): { records: HandRecord[]; middle: SessionState } {
  const rng = rngFromSeed('5ca1ab1e00000000000000000000000a');
  const records: HandRecord[] = [];
  let session: SessionState | null = null;
  for (let k = 0; k < TEMPLATES; k++) {
    const { table, played } = playHand(rng, k);
    const decisions = decisionsOf(played.hand, k);
    const record = handRecordOf({
      hand: played.hand,
      table,
      inputs: played.inputs,
      meta: { decisions, undoCount: decisions.some((d) => d.undone) ? 1 : 0, hintShown: {} },
      coachLevel: k % 2 === 0 ? 'intermediate' : 'advanced',
      allIn: null,
      at: new Date(START).toISOString(),
    });
    if (record === null) throw new Error(`template ${k}: no record`);
    records.push(record);
    if (session === null && played.middle.hand.phase === 'betting') {
      const at = new Date(START).toISOString();
      session = {
        schema: 1,
        savedAt: at,
        sessionStart: at,
        table,
        hand: played.middle.hand,
        handInputs: played.middle.inputs,
        meta: { decisions: decisions.slice(0, 1), undoCount: 0, hintShown: { 0: true } },
        undoSnapshot: {
          decisionId: 0,
          state: played.middle.hand,
          meta: { decisions: [], undoCount: 0, hintShown: {} },
          inputCount: played.middle.inputs.length,
        },
        seatStats: table.slots.map(() => null),
        resumeAfterUpdate: false,
      };
    }
  }
  if (session === null) throw new Error('no hand in play for the session');
  return { records, middle: session };
}

/** Hand `n` (1-based) of the run: a template with its own number and time. */
function recordAt(records: readonly HandRecord[], n: number): HandRecord {
  const t = records[n % records.length] as HandRecord;
  const at = new Date(START + n * 90_000).toISOString();
  return { ...t, handSeq: n, at, table: { ...t.table, nextHandSeq: n, handsDealt: n - 1 } };
}

export interface VolumeStorage {
  storage: MapStorage;
  profile: Profile;
}

/** The storage after `hands` hands (default 10,000), as described in the module note. */
export function volumeStorage(hands = VOLUME_HANDS): VolumeStorage {
  templates ??= makeTemplates();
  const { records, middle } = templates;
  const storage = new MapStorage();
  const store = createSafeStorage(() => storage);
  const now = new Date(START + hands * 90_000);
  let profile: Profile = defaultProfile(new Date(START));
  const committed = Math.max(0, hands - 100);
  // Counted the quick way (the same reducer the commit runs)…
  let stats = profile.stats;
  for (let n = 1; n <= committed; n++) {
    stats = applyHand(stats, recordAt(records, n));
    if (n % SESSION_HANDS === 0) stats = endSession(stats);
  }
  profile = { ...profile, stats, lastCommittedHandSeq: committed };
  store.set(STORAGE_KEYS.profile, JSON.stringify(profile));
  // …and the last 100 through the commit protocol (§14.3: ring, backup, profile, session).
  for (let n = committed + 1; n <= hands; n++) {
    const record = recordAt(records, n);
    const result = commitHand(
      store,
      profile,
      {
        record,
        apply: (p) => ({ ...p, stats: applyHand(p.stats, record) }),
        session: { ...middle, savedAt: record.at },
      },
      new Date(Date.parse(record.at)),
    );
    if (result.status !== 'committed') throw new Error(`hand ${n}: ${result.status}`);
    profile = result.profile;
    if (n % SESSION_HANDS === 0) {
      profile = { ...profile, stats: endSession(profile.stats), rev: profile.rev + 1 };
      store.set(STORAGE_KEYS.profile, JSON.stringify(profile));
    }
  }
  saveSession(store, { ...middle, savedAt: now.toISOString() });
  return { storage, profile };
}
