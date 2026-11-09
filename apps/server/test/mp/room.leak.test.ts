import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicHand } from '../../src/game/engine/types.js';
import { HAND_END_SHOWDOWN_MS } from '../../src/mp/timing.js';
import { leakProblems, type LeakRules } from '../helpers/leak-check.js';
import { foldOrCheck, Harness, passive, shove, userId } from '../helpers/room-harness.js';

/** Remembers each hand `publicHand` made, and for which viewer: L1. */
const made = vi.hoisted(() => ({ viewers: new Map<unknown, number | null>() }));
vi.mock('../../src/game/engine/project.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/game/engine/project.js')>();
  const publicHand: typeof real.publicHand = (hand, viewer) => {
    const result = real.publicHand(hand, viewer);
    made.viewers.set(result, viewer);
    return result;
  };
  return { ...real, publicHand };
});

const NAMES = ['Ann', 'Bob', 'Cid', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy'];

/** Things a real Telegram user has that must never reach a client. */
const USERNAME = 'very_secret_username';
const PHOTO = 'https://t.me/i/userpic/320/very-secret-photo.jpg';

function rulesFor(h: Harness): LeakRules {
  return {
    ids: NAMES.map((_, i) => userId(i)),
    secrets: [USERNAME, PHOTO],
    names: new Set(NAMES),
    seeds: h.seeds,
  };
}

/** A harness whose users carry the fields a Telegram user has, in case one is ever copied whole. */
function harness(seats = 6): Harness {
  const h = new Harness({ seats });
  const plain = h.user.bind(h);
  h.user = (i, name) =>
    Object.assign(plain(i, name), { username: USERNAME, photo_url: PHOTO, first_name: 'Raw' });
  return h;
}

/** L1–L6 for every frame recorded so far. */
function expectNoLeak(h: Harness): void {
  const rules = rulesFor(h);
  expect(h.sent.length).toBeGreaterThan(0);
  for (const { userId: to, msg } of h.sent) {
    expect(leakProblems(msg, rules)).toEqual([]);
    if (msg.t !== 'table') continue;
    const { view } = msg;
    // The frame went to the player of that seat.
    expect(userId(view.you)).toBe(to);
    if (view.hand !== null) {
      // L1: this very object came from publicHand, for this viewer.
      expect(made.viewers.has(view.hand)).toBe(true);
      expect(made.viewers.get(view.hand)).toBe(view.you);
    }
  }
}

/** Heads-up all-ins until someone busts. */
function bust(h: Harness): number {
  for (let tries = 0; tries < 50; tries++) {
    h.playHand(shove);
    const busted = h.latest().seats.findIndex((seat) => seat?.status === 'busted');
    if (busted !== -1) return busted;
    h.clock.next();
  }
  throw new Error('nobody busted');
}

describe('§19.9 L1–L6 on every frame to every player', () => {
  beforeEach(() => {
    made.viewers.clear();
  });

  it('a hand ended by folds', () => {
    const h = harness().deal(4);
    h.playHand(foldOrCheck);
    h.clock.next();
    expectNoLeak(h);
    expect(h.hand().revealed).toEqual([]);
  });

  it('a showdown: only live hands are shown, a folded hand never', () => {
    const h = harness().deal(3);
    const folder = h.toAct();
    h.play(foldOrCheck);
    h.playHand(passive);
    expectNoLeak(h);
    const hand = h.view((folder + 1) % 3).hand as PublicHand;
    expect(hand.result?.endedBy).toBe('showdown');
    expect(hand.revealed).toHaveLength(2);
    expect(hand.seats[folder]?.hole).toBeNull();
    expect(h.view(folder).hand?.seats[folder]?.hole).not.toBeNull();
  });

  it('an all-in run-out', () => {
    const h = harness().deal(3);
    h.playHand(shove);
    expectNoLeak(h);
    expect(h.hand().result).not.toBeNull();
  });

  it('a reload', () => {
    const h = harness(2).deal(2);
    const busted = bust(h);
    h.room.reload(userId(busted));
    h.clock.advance(HAND_END_SHOWDOWN_MS);
    h.playHand(foldOrCheck);
    expectNoLeak(h);
  });

  it("a reconnect: the view after the drop is that player's own, and shows only their cards", () => {
    const h = harness().deal(3);
    const seat = (h.toAct() + 1) % 3;
    h.room.disconnected(userId(seat));
    h.play(passive);
    h.room.connected(userId(seat));
    const hand = h.view(seat).hand as PublicHand;
    expect(hand.seats[seat]?.hole).not.toBeNull();
    expect(hand.seats.filter((s) => s.hole !== null)).toHaveLength(1);
    h.playHand(passive);
    expectNoLeak(h);
  });

  it("a joiner mid-hand sees nobody's cards", () => {
    const h = harness().deal(3);
    h.play(passive);
    h.room.join(h.user(3));
    const hand = h.view(3).hand as PublicHand;
    expect(hand.seats.every((s) => s.hole === null)).toBe(true);
    h.playHand(passive);
    expectNoLeak(h);
  });

  it('a leaver and a timeout: nothing about them is shown that should not be', () => {
    const h = harness().deal(4);
    h.room.leave(userId((h.toAct() + 1) % 4));
    h.timeOut();
    h.playHand(passive);
    h.clock.next();
    expectNoLeak(h);
  });

  it('nobody can sit down in a seat whose cards are still on show', () => {
    const h = harness(2).deal(2);
    h.playHand(foldOrCheck);
    const leaver = h.hand().seats.findIndex((s) => s.dealtIn);
    const leaverHole = h.view(leaver).hand?.seats[leaver]?.hole;
    expect(leaverHole).not.toBeNull();
    h.room.leave(userId(leaver));
    expect(h.room.join(h.user(5))).toBe('full');
    expectNoLeak(h);
  });

  it('L1: the code of the table never reads hole, deck, deckPos or seed', () => {
    const dir = join(import.meta.dirname, '../../src/mp');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const file of files) {
      const source = readFileSync(join(dir, file), 'utf8');
      expect(source.match(/\.(hole|deck|deckPos|seed)\b/g), file).toBeNull();
    }
  });

  it('the checker catches what it should', () => {
    const h = harness().deal(3);
    const rules = rulesFor(h);
    const frame = h.tablesTo(0).at(-1);
    expect(frame).toBeDefined();
    const copy = () => JSON.parse(JSON.stringify(frame)) as Record<string, never>;

    const other = copy() as unknown as {
      view: { you: number; hand: { seats: { hole: unknown }[] } };
    };
    (other.view.hand.seats[1] as { hole: unknown }).hole = [1, 2];
    other.view.you = 0;
    expect(leakProblems(other, rules).some((p) => p.startsWith('L2'))).toBe(true);

    const seed = { t: 'table', x: { seed: 'a'.repeat(32) } };
    expect(leakProblems(seed, rules).map((p) => p.slice(0, 2))).toEqual(
      expect.arrayContaining(['L3', 'L6']),
    );

    expect(leakProblems({ t: 'welcome', anything: userId(1) }, rules)[0]).toMatch(/^L5/);

    const legal = {
      t: 'table',
      view: { you: 0, seats: [], hand: null, decision: { seat: 1 }, legal: { seat: 1 } },
    };
    expect(leakProblems(legal, rules)[0]).toMatch(/^L4/);
  });
});
