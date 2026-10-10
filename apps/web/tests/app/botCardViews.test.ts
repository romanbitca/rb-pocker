/**
 * The bot card's data and its store plumbing (PLAN §9.2, §9.3, chunk 5.10): what a tapped seat's
 * card holds at each bot level, how the `botCard` command opens it (the `sheet` gate closes) and
 * every way it closes. ⚠️ A card never holds more than the pod: no hole card, and at Hard and
 * Expert no personality.
 */
import { describe, expect, it } from 'vitest';
import {
  botCardOf,
  createAppStore,
  initialGame,
  initialUi,
  labelVisible,
  reduceUi,
  seatLevelOf,
  seatView,
  selectBotCard,
  type AppState,
  type AppStore,
  type BotCardData,
} from '../../src/app/store.ts';
import { seenAggression, seenPlay } from '../../src/app/botCardViews.ts';
import { emptySeatStats } from '../../src/brain/opponentStats.ts';
import type { BotLevel, HandState, SeatStats, TableState } from '../../src/engine/types.ts';
import type { BotCardView } from '../../src/ui/views.ts';
import { deal, tableWith } from '../engine/helpers.ts';

// The app builds structurally equal objects (app may not import ui, §2.1): they must fit.
const fitsCard = (v: BotCardData): BotCardView => v;

const LEVELS: readonly BotLevel[] = ['easy', 'medium', 'hard', 'expert'];

/** Three seats: the hero and two bots (personality `tag` from the test slots). */
function dealt(spec: Parameters<typeof tableWith>[1] = {}): { table: TableState; hand: HandState } {
  const table = tableWith([10000, 10000, 10000], spec);
  return { table, hand: deal(table) };
}

/** A store with a table on screen and `hand` dealt, as the controller leaves it. */
function storeWith(table: TableState, hand: HandState): AppStore {
  const store = createAppStore();
  store.setState({ game: { ...initialGame(), mode: 'heroTurn', table, hand } });
  store.getState().dispatch({ type: 'go', screen: 'table' });
  return store;
}

describe('which levels show the personality (§9.2 "Personality label visible")', () => {
  it('Easy and Medium show it; Hard and Expert do not', () => {
    expect(LEVELS.map(labelVisible)).toEqual([true, true, false, false]);
  });

  it("a seat's level is its own override, else the table's (§9.3)", () => {
    const { table } = dealt({ botLevel: 'easy', seatLevels: [null, 'expert', null] });
    expect(seatLevelOf(table, 1)).toBe('expert');
    expect(seatLevelOf(table, 2)).toBe('easy');
  });
});

describe('botCardOf', () => {
  it.each(LEVELS)('at %s: the name and stack, and the personality only where it shows', (level) => {
    const { table, hand } = dealt({ botLevel: level });
    for (const seat of [1, 2]) {
      const card = botCardOf(hand, table, seat);
      expect(card).toEqual({
        seat,
        name: `P${seat}`,
        personality: labelVisible(level) ? 'tag' : null,
        stack: hand.seats[seat]?.stack,
        seen: null,
        nextLevel: { own: null, table: level },
      });
      fitsCard(card as BotCardData);
    }
  });

  it('follows each seat’s own level when a seat has an override', () => {
    const hardAmongEasy = dealt({ botLevel: 'easy', seatLevels: [null, 'hard', null] });
    expect(botCardOf(hardAmongEasy.hand, hardAmongEasy.table, 1)?.personality).toBeNull();
    expect(botCardOf(hardAmongEasy.hand, hardAmongEasy.table, 2)?.personality).toBe('tag');
    const easyAmongHard = dealt({ botLevel: 'hard', seatLevels: [null, null, 'medium'] });
    expect(botCardOf(easyAmongHard.hand, easyAmongHard.table, 1)?.personality).toBeNull();
    expect(botCardOf(easyAmongHard.hand, easyAmongHard.table, 2)?.personality).toBe('tag');
  });

  it('has the pod’s answer for every seat at every level (one rule for both)', () => {
    for (const level of LEVELS) {
      const { table, hand } = dealt({ botLevel: level, seatLevels: [null, null, 'expert'] });
      for (const seat of [1, 2]) {
        expect(botCardOf(hand, table, seat)?.personality).toBe(
          seatView(hand, table, seat).personality,
        );
      }
    }
  });

  it('has no card for the hero or for a seat that does not exist', () => {
    const { table, hand } = dealt();
    expect(botCardOf(hand, table, 0)).toBeNull();
    expect(botCardOf(hand, table, 3)).toBeNull();
    expect(botCardOf(hand, table, -1)).toBeNull();
  });

  it('holds nothing but the seat, name, personality, stack, seen play and next level (no hole card)', () => {
    const { table, hand } = dealt();
    const card = botCardOf(hand, table, 1) as BotCardData;
    expect(Object.keys(card).sort()).toEqual([
      'name',
      'nextLevel',
      'personality',
      'seat',
      'seen',
      'stack',
    ]);
    const hole = hand.seats[1]?.hole ?? [];
    expect(hole).toHaveLength(2);
    expect(JSON.stringify(card)).not.toContain(JSON.stringify(hole));
  });

  it('Hard and Expert: what the player has seen, from the seat statistics (§9.3, chunk 7.1)', () => {
    const { table, hand } = dealt({ botLevel: 'hard', seatLevels: [null, null, 'easy'] });
    const stats = (over: Partial<SeatStats>): SeatStats => ({ ...emptySeatStats(), ...over });
    const id1 = table.slots[1]?.playerId as string;
    const id2 = table.slots[2]?.playerId as string;
    const seen = {
      [id1]: stats({ hands: 50, vpip: [17, 50], pfr: [10, 50], aggActions: 9, passiveActions: 3 }),
      [id2]: stats({ hands: 50, vpip: [25, 50], pfr: [5, 50] }),
    };
    // The Hard seat: whole percentages of the hands with a preflop decision, AF 3 = "Bets often".
    expect(botCardOf(hand, table, 1, seen)?.seen).toEqual({
      hands: 50,
      plays: 34,
      raises: 20,
      aggression: 'betsOften',
    });
    // The Easy seat shows its personality instead: no seen play.
    expect(botCardOf(hand, table, 2, seen)?.seen).toBeNull();
    // Nobody seen yet: null.
    expect(botCardOf(hand, table, 1, {})?.seen).toBeNull();
    expect(seenPlay(stats({ hands: 3 }))).toBeNull(); // no preflop decision yet
  });

  it('puts AF into words: often from 2, sometimes from 1, else mostly calls; none unseen', () => {
    const af = (aggActions: number, passiveActions: number) =>
      seenAggression({ ...emptySeatStats(), aggActions, passiveActions });
    expect(af(0, 0)).toBeNull();
    expect(af(3, 0)).toBe('betsOften');
    expect(af(4, 2)).toBe('betsOften');
    expect(af(3, 2)).toBe('betsSometimes');
    expect(af(2, 2)).toBe('betsSometimes');
    expect(af(1, 2)).toBe('mostlyCalls');
    expect(af(0, 5)).toBe('mostlyCalls');
  });

  it('shows the chips behind, as the pod does, once a bet is in front of the seat', () => {
    const { table, hand } = dealt({ button: 0 });
    // Seat 1 is the small blind: 50 of its 10,000 are in the pot.
    expect(hand.seats[1]?.streetBet).toBe(50);
    expect(botCardOf(hand, table, 1)?.stack).toBe(9950);
    expect(seatView(hand, table, 1).stack).toBe(9950);
  });
});

describe('the level picker’s value: a seat’s level from the next hand on (§9.3, chunk 7.2)', () => {
  it('is, without more, the levels of the table the hand was dealt from', () => {
    const { table, hand } = dealt({ botLevel: 'medium', seatLevels: [null, 'expert', null] });
    expect(botCardOf(hand, table, 1)?.nextLevel).toEqual({ own: 'expert', table: 'medium' });
    expect(botCardOf(hand, table, 2)?.nextLevel).toEqual({ own: null, table: 'medium' });
  });

  it('is the given choice when there is one, and the card still describes the hand in play', () => {
    const { table, hand } = dealt({ botLevel: 'easy' });
    const card = botCardOf(hand, table, 1, {}, { own: 'expert', table: 'hard' });
    expect(card?.nextLevel).toEqual({ own: 'expert', table: 'hard' });
    // Label and statistics are those of the level in force: still Easy, so the personality shows.
    expect(card?.personality).toBe('tag');
    expect(card?.seen).toBeNull();
  });

  describe('selectBotCard reads the settings', () => {
    function open(
      spec: Parameters<typeof tableWith>[1],
      settings: Partial<AppState['settings']>,
      seat = 1,
    ): AppStore {
      const { table, hand } = dealt(spec);
      const store = storeWith(table, hand);
      store.setState({ settings: { ...store.getState().settings, ...settings } });
      store.getState().dispatch({ type: 'botCard', seat });
      return store;
    }

    it('the settings’ table level and the seat’s override, not the hand’s', () => {
      const store = open(
        { botLevel: 'easy', seatLevels: [null, null, null] },
        { botLevel: 'hard', players: 3, seatLevels: [null, 'expert', null] },
      );
      expect(selectBotCard(store.getState())).toMatchObject({
        personality: 'tag', // the hand in play is Easy: the label shows
        nextLevel: { own: 'expert', table: 'hard' },
      });
    });

    it('a seat with no override follows the settings’ table level', () => {
      const store = open(
        { botLevel: 'easy', seatLevels: [null, 'hard', null] },
        { botLevel: 'medium', players: 3, seatLevels: [null, 'hard', null] },
        2,
      );
      expect(selectBotCard(store.getState())?.nextLevel).toEqual({ own: null, table: 'medium' });
    });

    it('settings for another number of seats are not read: the table’s own levels show', () => {
      const store = open(
        { botLevel: 'easy', seatLevels: [null, 'hard', null] },
        {
          botLevel: 'medium',
          players: 6,
          seatLevels: [null, 'expert', 'expert', null, null, null],
        },
      );
      expect(selectBotCard(store.getState())?.nextLevel).toEqual({ own: 'hard', table: 'medium' });
    });

    it('keeps its object while nothing it shows changes, and changes when a level does', () => {
      const store = open(
        { botLevel: 'easy' },
        { botLevel: 'easy', players: 3, seatLevels: [null, null, null] },
      );
      const a = selectBotCard(store.getState());
      // Other settings (speed, a bot's level that is not this seat's) leave the card alone.
      store.setState({ settings: { ...store.getState().settings, speed: 'fast' } });
      expect(selectBotCard(store.getState())).toBe(a);
      store.setState({
        settings: { ...store.getState().settings, seatLevels: [null, null, 'hard'] },
      });
      expect(selectBotCard(store.getState())).toBe(a);
      store.setState({
        settings: { ...store.getState().settings, seatLevels: [null, 'hard', 'hard'] },
      });
      const b = selectBotCard(store.getState());
      expect(b).not.toBe(a);
      expect(b?.nextLevel).toEqual({ own: 'hard', table: 'easy' });
      store.setState({ settings: { ...store.getState().settings, botLevel: 'medium' } });
      expect(selectBotCard(store.getState())?.nextLevel).toEqual({ own: 'hard', table: 'medium' });
    });
  });
});

describe('the botCard command and the sheet gate', () => {
  const open = (store: AppStore, seat: number) =>
    store.getState().dispatch({ type: 'botCard', seat });

  it('opens the overlay for the seat and closes the sheet gate; nothing else is gated', () => {
    const { table, hand } = dealt();
    const store = storeWith(table, hand);
    expect(selectBotCard(store.getState())).toBeNull();
    expect(store.getState().ui.gates).toEqual([]);

    open(store, 2);
    const { ui } = store.getState();
    expect(ui.overlays).toEqual(['botCard']);
    expect(ui.botCardSeat).toBe(2);
    expect(ui.gates).toEqual(['sheet']);
    expect(selectBotCard(store.getState())).toMatchObject({ seat: 2, name: 'P2' });
  });

  it('closes by the close command (✕, Esc, the scrim), and forgets the seat', () => {
    const { table, hand } = dealt();
    const store = storeWith(table, hand);
    open(store, 1);
    store.getState().dispatch({ type: 'close', overlay: 'botCard' });
    const { ui } = store.getState();
    expect(ui.overlays).toEqual([]);
    expect(ui.botCardSeat).toBeNull();
    expect(ui.gates).toEqual([]);
    expect(selectBotCard(store.getState())).toBeNull();
  });

  it('closes by Android Back (the navigation reducer), leaving the table', () => {
    const { table, hand } = dealt();
    const store = storeWith(table, hand);
    open(store, 1);
    store.getState().dispatch({ type: 'back' });
    expect(store.getState().ui.overlays).toEqual([]);
    expect(store.getState().ui.botCardSeat).toBeNull();
    expect(store.getState().ui.screen).toBe('table');
    expect(store.getState().ui.gates).toEqual([]);
  });

  it('leaving the table closes it too', () => {
    const { table, hand } = dealt();
    const store = storeWith(table, hand);
    open(store, 1);
    store.getState().dispatch({ type: 'go', screen: 'home' });
    expect(store.getState().ui.overlays).toEqual([]);
    expect(store.getState().ui.botCardSeat).toBeNull();
  });

  it('has no card for the hero (seat 0) or a nonsense seat: nothing opens', () => {
    const base = initialUi(false);
    for (const seat of [0, -1, 1.5, Number.NaN]) {
      expect(reduceUi(base, { type: 'botCard', seat })).toBe(base);
    }
  });

  it('opening it again for the same seat changes nothing', () => {
    const base = reduceUi(initialUi(false), { type: 'botCard', seat: 3 });
    expect(reduceUi(base, { type: 'botCard', seat: 3 })).toBe(base);
    expect(reduceUi(base, { type: 'botCard', seat: 4 }).botCardSeat).toBe(4);
    expect(reduceUi(base, { type: 'botCard', seat: 4 }).overlays).toEqual(['botCard']);
  });

  it('keeps the other overlays: a card opened over the sizing tray closes first', () => {
    const base = reduceUi(initialUi(false), { type: 'open', overlay: 'tray' });
    const both = reduceUi(base, { type: 'botCard', seat: 2 });
    expect(both.overlays).toEqual(['tray', 'botCard']);
    const back = reduceUi(both, { type: 'back' });
    expect(back.overlays).toEqual(['tray']);
    expect(back.botCardSeat).toBeNull();
  });
});

describe('selectBotCard', () => {
  it('is null with no hand, no table or no open card', () => {
    const store = createAppStore();
    expect(selectBotCard(store.getState())).toBeNull();
    store.getState().dispatch({ type: 'botCard', seat: 1 });
    expect(selectBotCard(store.getState())).toBeNull(); // nothing dealt yet
  });

  it('keeps its object while the card is the same, and changes it when the stack changes', () => {
    const { table, hand } = dealt();
    const store = storeWith(table, hand);
    store.getState().dispatch({ type: 'botCard', seat: 1 });
    const a = selectBotCard(store.getState());
    expect(a).not.toBeNull();
    // The hand object changes with every step; the card does not.
    store.setState({ game: { ...store.getState().game, hand: { ...hand } } });
    expect(selectBotCard(store.getState())).toBe(a);
    // Other store updates leave it alone too.
    store.getState().dispatch({ type: 'layout', layout: 'wide' });
    expect(selectBotCard(store.getState())).toBe(a);
    // A different stack is a different card.
    const seats = hand.seats.map((s, i) => (i === 1 ? { ...s, stack: s.stack + 7 } : s));
    store.setState({ game: { ...store.getState().game, hand: { ...hand, seats } } });
    const b = selectBotCard(store.getState());
    expect(b).not.toBe(a);
    expect(b?.stack).toBe((a?.stack ?? 0) + 7);
  });
});
