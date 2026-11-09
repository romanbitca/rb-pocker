/**
 * The table machine (PLAN §19.5): one table's seats, hands and timers, and what each player is
 * told. No sockets and no timers of its own: it gets a `send` and a `Clock`, so all of it runs on a
 * fake clock. The server is authoritative: a client only ever asks, and every message it gets is
 * built here from `publicHand` (§19.9).
 */
import { EngineError, InvariantError } from '../game/core/assert.js';
import type { Seed128 } from '../game/core/rng.js';
import { legalActions } from '../game/engine/legal.js';
import { publicHand } from '../game/engine/project.js';
import { startHand } from '../game/engine/start.js';
import { step } from '../game/engine/step.js';
import { createTable, nextTable } from '../game/engine/table.js';
import type { HandState, LegalActions, PlayerAction, TableState } from '../game/engine/types.js';
import type {
  Decision,
  EndReason,
  MpErrorCode,
  Notice,
  ServerMsg,
  TableSettings,
  TableView,
} from '../game/net/protocol.js';
import type { Clock, TimerHandle } from './clock.js';
import {
  countReady,
  engineConfig,
  engineSlots,
  nextHost,
  roomSettings,
  safestAction,
  seatName,
  type MpUser,
  type RoomSeat,
  type RoomSettings,
} from './seating.js';
import {
  AWAY_TURN_MS,
  DEAL_GRACE_MS,
  HAND_END_FOLD_MS,
  HAND_END_SHOWDOWN_MS,
  IDLE_NOBODY_MS,
  IDLE_WAITING_MS,
  OFFLINE_TURN_MS,
  RESUME_MS,
  REVEAL_MS,
  RUNOUT_PAUSE_MS,
  SEAT_LOST_MS,
  STREET_PAUSE_MS,
  TIMEOUTS_TO_SIT_OUT,
  VOIDED_HANDS_TO_END,
} from './timing.js';

export interface RoomDeps {
  readonly clock: Clock;
  readonly newSeed: () => Seed128;
  readonly send: (userId: number, msg: ServerMsg) => void;
  /** The room has ended: forget it and whoever sat in it. */
  readonly onClosed: (code: string) => void;
  /** This table's invite link, `TableView.invite`. */
  readonly inviteUrl: string;
}

type FlowKind = 'turn' | 'advance' | 'nextHand' | 'resume';

export class Room {
  private readonly settings: RoomSettings;
  private readonly seats: (RoomSeat | null)[];
  private readonly clock: Clock;
  /** The last host's seat, kept when that seat empties so the next host is found clockwise of it. */
  private hostSeat = 0;
  private status: 'waiting' | 'playing' = 'waiting';
  private started = false;
  private closed = false;
  private rev = 0;
  private decisionSeq = 0;
  private handsPlayed = 0;
  private voidedInARow = 0;
  /** The last `nextTable` (or the first `createTable`); it is what the current hand was dealt from. */
  private table: TableState | null = null;
  /** The hand in play or the one just finished, on show until the next deal. */
  private hand: HandState | null = null;
  private decision: Decision | null = null;
  /** The next decision opened is the first of its hand. */
  private firstDecision = false;
  private nextHandAt: number | null = null;
  /** Said with the next broadcast, then forgotten. */
  private notices: { notice: Notice; to: (seat: number) => boolean }[] = [];
  /** The chips each user took away from a seat here: sitting down again gives them back (§19.5). */
  private readonly keptStacks = new Map<number, number>();

  /** Bumped by every arm and disarm: a callback from before that does nothing (pitfall 53). */
  private flowToken = 0;
  private flow: { kind: FlowKind; handle: TimerHandle } | null = null;

  private idleToken = 0;
  private idleHandle: TimerHandle | null = null;
  private idleAt = Infinity;
  private nobodySince: number | null = null;
  private waitingSince: number | null = null;

  constructor(
    readonly code: string,
    settings: TableSettings,
    private readonly deps: RoomDeps,
  ) {
    this.clock = deps.clock;
    this.settings = roomSettings(settings);
    this.seats = new Array<RoomSeat | null>(settings.seats).fill(null);
  }

  // -------------------------------------------------------------------------------------------
  // Who sits here

  /** The seat `userId` plays at. A `leaving` seat is no longer theirs: they got `left`. */
  seatOf(userId: number): number | null {
    const seat = this.seats.findIndex((row) => row?.userId === userId && row.status !== 'leaving');
    return seat === -1 ? null : seat;
  }

  // -------------------------------------------------------------------------------------------
  // The client's messages. Each returns the error code, or null.

  /** The first seat: `create` of §19.4. */
  create(user: MpUser): MpErrorCode | null {
    return this.command(() => {
      this.sit(user, 0);
      this.changed();
      return null;
    });
  }

  join(user: MpUser): MpErrorCode | null {
    return this.command(() => {
      const own = this.seats.findIndex((row) => row?.userId === user.id);
      if (own !== -1) return this.rejoin(own);
      const free = this.seats.indexOf(null);
      if (free === -1) return 'full';
      this.sit(user, free);
      this.say({ n: 'joined', name: this.nameAt(free) }, (seat) => seat !== free);
      this.passHost();
      this.resumeIfTwoCanPlay();
      this.changed();
      return null;
    });
  }

  leave(userId: number): MpErrorCode | null {
    return this.command(() => {
      const seatNo = this.seatOf(userId);
      if (seatNo === null) return 'not_seated';
      const seat = this.seats[seatNo] as RoomSeat;
      this.tell(userId, { t: 'left' });
      this.say({ n: 'left', name: seat.name }, (other) => other !== seatNo);
      if (this.hand?.seats[seatNo]?.dealtIn === true) {
        // ⚠️ Also while the finished hand is on show: every seat number of `view.hand` must stay in
        // `view.seats` (§19.6), and a joiner in this seat would be shown the leaver's cards.
        seat.status = 'leaving';
        seat.online = false;
        if (this.decision?.seat === seatNo) this.moveDeadline(0);
      } else {
        this.vacate(seatNo);
      }
      this.passHost();
      if (this.isEmpty()) this.end('idle');
      else this.changed();
      return null;
    });
  }

  start(userId: number): MpErrorCode | null {
    return this.command(() => {
      const seatNo = this.seatOf(userId);
      if (seatNo === null) return 'not_seated';
      if (seatNo !== this.hostSeat) return 'not_host';
      if (this.started) return 'already_started';
      if (countReady(this.seats) < 2) return 'not_enough_players';
      this.started = true;
      this.deal();
      return null;
    });
  }

  act(userId: number, seq: number, action: PlayerAction): MpErrorCode | null {
    return this.command(() => {
      const seatNo = this.seatOf(userId);
      if (seatNo === null) return 'not_seated';
      const decision = this.decision;
      if (decision === null || decision.seq !== seq) return 'stale_action';
      if (decision.seat !== seatNo) return 'not_your_turn';
      try {
        this.hand = step(this.hand as HandState, { kind: 'act', seat: seatNo, action });
      } catch (err) {
        if (err instanceof EngineError) return 'illegal_action';
        throw err;
      }
      (this.seats[seatNo] as RoomSeat).timeouts = 0;
      this.nextStep();
      return null;
    });
  }

  back(userId: number): MpErrorCode | null {
    return this.command(() => {
      const seatNo = this.seatOf(userId);
      if (seatNo === null) return 'not_seated';
      const seat = this.seats[seatNo] as RoomSeat;
      if (seat.status !== 'sittingOut') return null;
      seat.status = seat.stack > 0 ? 'nextHand' : 'busted';
      seat.timeouts = 0;
      this.resumeIfTwoCanPlay();
      this.changed();
      return null;
    });
  }

  reload(userId: number): MpErrorCode | null {
    return this.command(() => {
      const seatNo = this.seatOf(userId);
      if (seatNo === null) return 'not_seated';
      const seat = this.seats[seatNo] as RoomSeat;
      if (seat.status !== 'busted') return 'not_busted';
      seat.stack = this.settings.stack;
      seat.status = 'nextHand';
      // Asking for chips is the player being here: old timeouts must not sit them out again.
      seat.timeouts = 0;
      this.resumeIfTwoCanPlay();
      this.changed();
      return null;
    });
  }

  // -------------------------------------------------------------------------------------------
  // Sockets coming and going

  connected(userId: number): void {
    this.event(() => {
      const seatNo = this.seatOf(userId);
      if (seatNo === null) return;
      const seat = this.seats[seatNo] as RoomSeat;
      if (seat.online) {
        // A new socket took over from one still open: nothing changed for anybody else (§19.5).
        this.tell(userId, { t: 'table', view: this.viewFor(seatNo), notices: [] });
        return;
      }
      seat.online = true;
      seat.offlineSince = null;
      this.changed();
    });
  }

  disconnected(userId: number): void {
    this.event(() => {
      const seatNo = this.seatOf(userId);
      if (seatNo === null) return;
      const seat = this.seats[seatNo] as RoomSeat;
      seat.online = false;
      seat.offlineSince = this.clock.now();
      const decision = this.decision;
      if (decision?.seat === seatNo && decision.deadlineAt - this.clock.now() > OFFLINE_TURN_MS) {
        this.moveDeadline(OFFLINE_TURN_MS);
      }
      this.changed();
    });
  }

  /** Terminal: every timer stops, and each player still here is told why. */
  end(reason: EndReason): void {
    if (this.closed) return;
    this.closed = true;
    this.disarm();
    this.clearIdle();
    for (const seat of this.seats) {
      if (seat?.online === true) this.tell(seat.userId, { t: 'ended', code: this.code, reason });
    }
    this.deps.onClosed(this.code);
  }

  // -------------------------------------------------------------------------------------------
  // The flow (§19.5)

  private deal(): void {
    // The old hand goes first: anything below that fails must not void a hand that was settled.
    this.hand = null;
    this.decision = null;
    this.nextHandAt = null;
    this.emptyLeftSeats();
    this.passHost();
    if (this.isEmpty()) {
      this.end('idle');
      return;
    }
    for (const seat of this.seats) {
      if (seat?.status === 'nextHand') seat.status = seat.stack > 0 ? 'playing' : 'busted';
    }
    const eligible = this.seats.filter((seat) => seat?.status === 'playing' && seat.stack > 0);
    if (eligible.length < 2) {
      this.status = 'waiting';
      this.changed();
      return;
    }
    const slots = engineSlots(this.seats);
    this.table =
      this.table === null
        ? createTable(engineConfig(this.settings), slots, this.deps.newSeed())
        : { ...this.table, slots };
    this.hand = startHand(this.table, this.deps.newSeed());
    this.status = 'playing';
    this.firstDecision = true;
    this.nextStep();
  }

  private emptyLeftSeats(): void {
    const now = this.clock.now();
    this.seats.forEach((seat, i) => {
      if (seat === null) return;
      const lost = seat.offlineSince !== null && now - seat.offlineSince >= SEAT_LOST_MS;
      if (seat.status !== 'leaving' && !lost) return;
      // The others were told when a `leaving` player left; a lost seat goes without a word.
      if (seat.status !== 'leaving') this.say({ n: 'left', name: seat.name });
      this.vacate(i);
    });
  }

  private nextStep(): void {
    const hand = this.hand as HandState;
    switch (hand.phase) {
      case 'betting':
        this.openDecision(hand);
        return;
      case 'roundComplete':
      case 'showdown': {
        this.decision = null;
        this.changed();
        let pause = hand.runout ? RUNOUT_PAUSE_MS : STREET_PAUSE_MS;
        if (hand.phase === 'showdown') pause = REVEAL_MS * hand.revealed.length;
        this.arm('advance', pause, () => {
          this.hand = step(this.hand as HandState, { kind: 'advance' });
          this.nextStep();
        });
        return;
      }
      case 'complete':
        this.handEnd(hand);
    }
  }

  private openDecision(hand: HandState): void {
    const seatNo = hand.toAct as number;
    const ms = this.turnMs(this.seats[seatNo] as RoomSeat);
    this.firstDecision = false;
    this.decisionSeq++;
    this.decision = { seat: seatNo, seq: this.decisionSeq, deadlineAt: this.clock.now() + ms };
    this.changed();
    this.armTurn(ms);
  }

  private turnMs(seat: RoomSeat): number {
    if (seat.status === 'leaving') return 0;
    if (seat.timeouts >= TIMEOUTS_TO_SIT_OUT) return AWAY_TURN_MS;
    const turn = this.settings.turnSeconds * 1000;
    if (!seat.online) return Math.min(OFFLINE_TURN_MS, turn);
    return this.firstDecision ? turn + DEAL_GRACE_MS : turn;
  }

  private armTurn(ms: number): void {
    this.arm('turn', ms, () => {
      this.turnFires();
    });
  }

  private moveDeadline(ms: number): void {
    (this.decision as Decision).deadlineAt = this.clock.now() + ms;
    this.armTurn(ms);
  }

  private turnFires(): void {
    const hand = this.hand as HandState;
    const seatNo = (this.decision as Decision).seat;
    const action = safestAction(legalActions(hand) as LegalActions);
    this.hand = step(hand, { kind: 'act', seat: seatNo, action });
    const seat = this.seats[seatNo] as RoomSeat;
    if (seat.status !== 'leaving') {
      seat.timeouts++;
      this.say({ n: 'timedOut', action: action.type }, (other) => other === seatNo);
    }
    this.nextStep();
  }

  private handEnd(hand: HandState): void {
    // First: if it refuses the hand, the hand is voided and no seat has been touched.
    this.table = nextTable(this.table as TableState, hand);
    hand.seats.forEach((dealt, i) => {
      if (!dealt.dealtIn) return;
      const seat = this.seats[i] as RoomSeat;
      seat.stack = dealt.stack;
      if (seat.status === 'leaving') return;
      if (seat.stack === 0) {
        seat.status = 'busted';
      } else if (seat.timeouts >= TIMEOUTS_TO_SIT_OUT) {
        seat.status = 'sittingOut';
        this.say({ n: 'sittingOut' }, (other) => other === i);
      }
    });
    this.handsPlayed++;
    this.voidedInARow = 0;
    this.decision = null;
    const showFor = hand.result?.endedBy === 'fold' ? HAND_END_FOLD_MS : HAND_END_SHOWDOWN_MS;
    this.nextHandAt = this.clock.now() + showFor;
    this.changed();
    this.arm('nextHand', showFor, () => {
      this.deal();
    });
  }

  /** §19.5 A voided hand: the chips go back, the button does not move, and the table goes on. */
  private voidHand(): void {
    const hand = this.hand;
    hand?.seats.forEach((dealt, i) => {
      const seat = this.seats[i];
      if (dealt.dealtIn && seat !== null && seat !== undefined) {
        seat.stack = hand.startStacks[i] as number;
      }
    });
    this.hand = null;
    this.decision = null;
    this.nextHandAt = null;
    this.voidedInARow++;
    if (this.voidedInARow >= VOIDED_HANDS_TO_END) {
      this.end('error');
      return;
    }
    this.say({ n: 'handVoided' });
    this.changed();
    this.arm('nextHand', HAND_END_FOLD_MS, () => {
      this.deal();
    });
  }

  /** `back`, `reload` and a `join` at a started table that had stopped for want of players. */
  private resumeIfTwoCanPlay(): void {
    if (!this.started || this.status !== 'waiting' || this.flow?.kind === 'resume') return;
    if (countReady(this.seats) < 2) return;
    this.arm('resume', RESUME_MS, () => {
      this.deal();
    });
  }

  // -------------------------------------------------------------------------------------------
  // Seats

  private sit(user: MpUser, seat: number): void {
    // Leaving and coming back must never top up a stack: only a real bust gets a free reload.
    const stack = this.keptStacks.get(user.id) ?? this.settings.stack;
    this.seats[seat] = {
      userId: user.id,
      name: seatName(user, seat),
      status: stack > 0 ? 'nextHand' : 'busted',
      stack,
      online: true,
      offlineSince: null,
      timeouts: 0,
    };
  }

  private vacate(seatNo: number): void {
    const seat = this.seats[seatNo] as RoomSeat;
    this.keptStacks.set(seat.userId, seat.stack);
    this.seats[seatNo] = null;
  }

  /** A `join` by someone who already has a seat here. */
  private rejoin(seatNo: number): MpErrorCode | null {
    const seat = this.seats[seatNo] as RoomSeat;
    if (seat.status !== 'leaving') {
      this.tell(seat.userId, { t: 'table', view: this.viewFor(seatNo), notices: [] });
      return null;
    }
    const running = this.hand !== null && this.hand.phase !== 'complete';
    seat.status = running || seat.stack > 0 ? 'playing' : 'busted';
    seat.online = true;
    seat.offlineSince = null;
    this.say({ n: 'joined', name: seat.name }, (other) => other !== seatNo);
    this.passHost();
    this.changed();
    return null;
  }

  private nameAt(seat: number): string {
    return (this.seats[seat] as RoomSeat).name;
  }

  private isEmpty(): boolean {
    return this.seats.every((seat) => seat === null);
  }

  /** If the host's seat is gone or `leaving`, the next seat clockwise takes over (§19.5). */
  private passHost(): void {
    const host = this.seats[this.hostSeat];
    if (host !== null && host !== undefined && host.status !== 'leaving') return;
    const next = nextHost(this.seats, this.hostSeat);
    if (next === null) return;
    this.hostSeat = next;
    this.say({ n: 'hostChanged', name: this.nameAt(next) });
  }

  // -------------------------------------------------------------------------------------------
  // What the players are told

  /** A socket's trouble is not the table's. */
  private tell(userId: number, msg: ServerMsg): void {
    try {
      this.deps.send(userId, msg);
    } catch {
      // Nothing to do: that player's next view makes up for it.
    }
  }

  private say(notice: Notice, to: (seat: number) => boolean = () => true): void {
    this.notices.push({ notice, to });
  }

  /** One change: a new `rev`, a whole view to every seated, online player, then the idle watch. */
  private changed(): void {
    this.rev++;
    const notices = this.notices;
    this.notices = [];
    this.seats.forEach((seat, i) => {
      if (seat?.online !== true) return;
      this.tell(seat.userId, {
        t: 'table',
        view: this.viewFor(i),
        notices: notices.filter(({ to }) => to(i)).map(({ notice }) => notice),
      });
    });
    this.watchIdle();
  }

  private viewFor(you: number): TableView {
    const hand = this.hand;
    const running = hand !== null && hand.phase !== 'complete';
    const decision = this.decision;
    return {
      rev: this.rev,
      now: this.clock.now(),
      code: this.code,
      invite: this.deps.inviteUrl,
      settings: { ...this.settings },
      status: this.status,
      started: this.started,
      you,
      seats: this.seats.map((seat, i) => {
        if (seat === null) return null;
        const dealt = running ? hand.seats[i] : undefined;
        return {
          name: seat.name,
          host: i === this.hostSeat && seat.status !== 'leaving',
          status: seat.status,
          stack: dealt?.dealtIn === true ? dealt.stack : seat.stack,
          online: seat.online,
        };
      }),
      handsPlayed: this.handsPlayed,
      hand: hand === null ? null : publicHand(hand, you),
      decision: decision === null ? null : { ...decision },
      legal: decision?.seat === you ? legalActions(hand as HandState) : null,
      nextHandAt: this.nextHandAt,
    };
  }

  // -------------------------------------------------------------------------------------------
  // Timers: one flow timer at a time, one idle timer, each with a token (pitfall 53).

  private arm(kind: FlowKind, ms: number, fire: () => void): void {
    this.disarm();
    const token = this.flowToken;
    const handle = this.clock.setTimeout(() => {
      if (token !== this.flowToken) return;
      this.flow = null;
      this.event(fire);
    }, ms);
    this.flow = { kind, handle };
  }

  private disarm(): void {
    this.flowToken++;
    if (this.flow !== null) this.clock.clearTimeout(this.flow.handle);
    this.flow = null;
  }

  /** §19.5 Idle watch: each condition counts from when it began, whatever happens meanwhile. */
  private watchIdle(): void {
    const now = this.clock.now();
    const nobodyOnline = !this.seats.some((seat) => seat?.online === true);
    this.nobodySince = nobodyOnline ? (this.nobodySince ?? now) : null;
    this.waitingSince = this.status === 'waiting' ? (this.waitingSince ?? now) : null;
    const at = Math.min(
      this.nobodySince === null ? Infinity : this.nobodySince + IDLE_NOBODY_MS,
      this.waitingSince === null ? Infinity : this.waitingSince + IDLE_WAITING_MS,
    );
    if (at === this.idleAt) return;
    this.clearIdle();
    if (at === Infinity) return;
    this.idleAt = at;
    const token = this.idleToken;
    this.idleHandle = this.clock.setTimeout(() => {
      if (token === this.idleToken) this.end('idle');
    }, at - now);
  }

  private clearIdle(): void {
    this.idleToken++;
    this.idleAt = Infinity;
    if (this.idleHandle !== null) this.clock.clearTimeout(this.idleHandle);
    this.idleHandle = null;
  }

  // -------------------------------------------------------------------------------------------
  // Nothing escapes: a broken hand is voided, anything else ends the table (§4.5, §19.5).

  private command(fn: () => MpErrorCode | null): MpErrorCode | null {
    if (this.closed) return 'not_found';
    try {
      return fn();
    } catch (err) {
      this.crashed(err);
      return null;
    }
  }

  private event(fn: () => void): void {
    if (this.closed) return;
    try {
      fn();
    } catch (err) {
      this.crashed(err);
    }
  }

  private crashed(err: unknown): void {
    if (err instanceof InvariantError || err instanceof EngineError) this.voidHand();
    else this.end('error');
  }
}
