/**
 * PLAN §19.3 and Appendix A.3: a table of the server's has `remote` slots only. It must pass every
 * table check and play like any table; the rule "hero at 0, bots after" stays for every other
 * table, and the engine never replaces a busted remote player.
 */
import { describe, expect, it } from 'vitest';
import { rngFromSeed, type Seed128 } from '../../src/core/rng.ts';
import { startHand } from '../../src/engine/start.ts';
import { step } from '../../src/engine/step.ts';
import { buttonForHand, createTable, nextTable, validateTable } from '../../src/engine/table.ts';
import type {
  HandState,
  LegalActions,
  PlayerSlot,
  TableConfig,
  TableState,
} from '../../src/engine/types.ts';
import { isTableState } from '../../src/persist/schema.ts';
import { SEED, TABLE_SEED, rigDeck } from './helpers.ts';
import { ADVANCE, engineError, legalOf, play, randomInput } from './play.ts';

const remote = (seat: number, stack = 2000): PlayerSlot => ({
  playerId: `s${seat}`,
  name: `s${seat}`,
  kind: 'remote',
  personality: null,
  stack,
});
const hero = (stack = 2000): PlayerSlot => ({
  playerId: 'hero',
  name: 'You',
  kind: 'hero',
  personality: null,
  stack,
});
const bot = (seat: number, stack = 2000): PlayerSlot => ({
  playerId: `bot-${seat}`,
  name: `Bot${seat}`,
  kind: 'bot',
  personality: 'tag',
  stack,
});
const configFor = (seatCount: number): TableConfig => ({
  seatCount,
  sb: 10,
  bb: 20,
  startingStack: 2000,
  botLevel: 'easy',
  seatLevels: new Array<null>(seatCount).fill(null),
});
const remoteTable = (stacks: readonly number[]): TableState =>
  createTable(
    configFor(stacks.length),
    stacks.map((stack, seat) => remote(seat, stack)),
    TABLE_SEED,
  );

/** Plays the hand of `table` to its end with seeded random legal play. */
function playHand(table: TableState, handSeed: Seed128): HandState {
  const rng = rngFromSeed(handSeed);
  let h = startHand(table, handSeed);
  for (let i = 0; i < 400 && h.phase !== 'complete'; i++) h = step(h, randomInput(h, rng));
  return h;
}

describe('createTable accepts a table of remote players (§19.3)', () => {
  it.each([2, 3, 4, 5, 6, 7, 8, 9])('%i seats', (seatCount) => {
    const table = remoteTable(new Array<number>(seatCount).fill(2000));
    expect(() => validateTable(table)).not.toThrow();
    expect(table.slots.map((slot) => slot.kind)).toEqual(
      new Array<string>(seatCount).fill('remote'),
    );
  });

  it('with empty seats and sitting-out seats at 0 chips, while two have chips', () => {
    const table = remoteTable([2000, 0, 1500, 0]);
    expect(table.slots.map((slot) => slot.stack)).toEqual([2000, 0, 1500, 0]);
    expect(engineError(() => remoteTable([2000, 0, 0])).code).toBe('BAD_AMOUNT');
  });

  it('keeps the other checks: unique ids and names, whole stacks', () => {
    const slots = [remote(0), remote(1), remote(2)];
    const withSlot = (i: number, patch: Partial<PlayerSlot>): PlayerSlot[] =>
      slots.map((slot, seat) => (seat === i ? { ...slot, ...patch } : slot));
    const create = (s: PlayerSlot[]): TableState => createTable(configFor(3), s, TABLE_SEED);
    expect(engineError(() => create(withSlot(1, { playerId: 's0' }))).code).toBe('ILLEGAL_ACTION');
    expect(engineError(() => create(withSlot(1, { playerId: '' }))).code).toBe('ILLEGAL_ACTION');
    expect(engineError(() => create(withSlot(2, { name: 's1' }))).code).toBe('ILLEGAL_ACTION');
    expect(engineError(() => create(withSlot(2, { stack: 1.5 }))).code).toBe('BAD_AMOUNT');
    expect(engineError(() => create(withSlot(2, { stack: -1 }))).code).toBe('BAD_AMOUNT');
    expect(engineError(() => create([slots[0] as PlayerSlot, remote(1)])).code).toBe('BAD_AMOUNT');
  });
});

describe('every other table keeps the rule "hero at 0, bots after"', () => {
  it('passes for a hero and bots', () => {
    expect(() => createTable(configFor(3), [hero(), bot(1), bot(2)], TABLE_SEED)).not.toThrow();
  });

  it.each<[string, PlayerSlot[]]>([
    ['a hero, then remote players', [hero(), remote(1), remote(2)]],
    ['a hero, a bot and a remote player', [hero(), bot(1), remote(2)]],
    ['a remote player, then bots', [remote(0), bot(1), bot(2)]],
    ['remote players around a hero', [remote(0), hero(), remote(2)]],
    ['remote players and one bot', [remote(0), remote(1), bot(2)]],
    ['a remote player with a personality', [remote(0), remote(1), { ...remote(2), personality: 'tag' }]],
    ['only a personality on the first', [{ ...remote(0), personality: 'rock' }, remote(1), remote(2)]],
  ])('%s is refused', (_, slots) => {
    expect(engineError(() => createTable(configFor(3), slots, TABLE_SEED)).code).toBe('ILLEGAL_ACTION');
  }); // prettier-ignore

  it('the old messages still name the seat at fault', () => {
    expect(engineError(() => createTable(configFor(2), [remote(0), bot(1)], TABLE_SEED)).message).toMatch(
      /seat 0 must be the hero/,
    );
    expect(engineError(() => createTable(configFor(2), [hero(), remote(1)], TABLE_SEED)).message).toMatch(
      /seat 1 must be a bot/,
    );
  }); // prettier-ignore
});

describe('a remote table plays like any table', () => {
  it('deals in only the seats with chips and moves the button past the others (§3.1, §3.3)', () => {
    const table = remoteTable([2000, 0, 1500, 0, 900]);
    const h = startHand(table, SEED);
    expect(h.seats.map((seat) => seat.dealtIn)).toEqual([true, false, true, false, true]);
    expect(h.seats.map((seat) => seat.hole !== null)).toEqual([true, false, true, false, true]);
    expect([0, 2, 4]).toContain(h.button);
    expect(buttonForHand({ ...table, button: 0 })).toBe(2);
    expect(buttonForHand({ ...table, button: 4 })).toBe(0);
  });

  it('random hands run to the end and the chips add up, hand after hand', () => {
    for (let n = 2; n <= 9; n++) {
      let table = remoteTable(new Array<number>(n).fill(2000));
      for (let i = 0; i < 40; i++) {
        // A seat that went to 0 stays out; fewer than two with chips ends the session.
        if (table.slots.filter((slot) => slot.stack > 0).length < 2) break;
        const seed = `${String(n).padStart(2, '0')}${String(i).padStart(30, '0')}` as Seed128;
        const done = playHand(table, seed);
        expect(done.phase).toBe('complete');
        expect(done.seats.reduce((a, seat) => a + seat.stack, 0)).toBe(2000 * n);
        expect(done.result?.net.reduce((a, b) => a + b, 0)).toBe(0);
        table = nextTable(table, done); // checks every invariant of the finished hand
        expect(table.slots.map((slot) => slot.playerId)).toEqual(
          Array.from({ length: n }, (_, seat) => `s${seat}`),
        );
        expect(table.slots.every((slot) => slot.kind === 'remote')).toBe(true);
        expect(table.slots.map((slot) => slot.stack)).toEqual(done.seats.map((s) => s.stack));
        expect(table.handsDealt).toBe(i + 1);
      }
    }
  });

  it('nextTable keeps a busted remote player at 0: no bot takes the seat (§19.3)', () => {
    const table = remoteTable([2000, 2000, 2000]);
    // Seat 2's aces beat seat 1's kings all-in; seat 0 folds. Seat 1 is left with nothing.
    let h = rigDeck(startHand(table, SEED), {
      holes: { 1: 'Kd Kc', 2: 'As Ah' },
      board: '2c 7d 9h Js 3c',
    });
    while (h.phase === 'betting') {
      const legal: LegalActions = legalOf(h);
      if (legal.seat === 0) h = play(h, { kind: 'act', seat: 0, action: { type: 'fold' } });
      else if (legal.raise !== null) {
        h = play(h, {
          kind: 'act',
          seat: legal.seat,
          action: { type: 'raise', to: legal.raise.max },
        });
      } else h = play(h, { kind: 'act', seat: legal.seat, action: { type: 'call' } });
    }
    while (h.phase !== 'complete') h = play(h, ADVANCE);
    expect(h.seats.map((seat) => seat.stack)[1]).toBe(0);

    const next = nextTable(table, h);
    expect(next.slots[1]).toEqual(remote(1, 0));
    expect(next.personalityCursor).toBe(table.personalityCursor);
    expect(next.nameCursor).toBe(table.nameCursor);
    expect(next.slots.reduce((a, slot) => a + slot.stack, 0)).toBe(6000);
  });

  it('a remote table can never be saved: the persist guard refuses it (§19.3)', () => {
    expect(isTableState(remoteTable([2000, 2000]))).toBe(false);
    expect(isTableState(createTable(configFor(2), [hero(), bot(1)], TABLE_SEED))).toBe(true);
  });
});
