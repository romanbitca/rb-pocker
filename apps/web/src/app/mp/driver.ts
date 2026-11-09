/**
 * `MpDriver` (PLAN §19.6): while a table of the server's is on, it writes the store's `game` slice
 * instead of the `TableController`, so the one Table plays it. It also owns the `mp` slice, the
 * socket, and what the remote handler answers.
 *
 * ⚠️ Privacy: `hello` sends the player's Telegram identity, so the socket opens only for a player
 * who asked for Play with friends: the `mpCreate` screen is on show, the launch has a table code
 * in `startapp`, or this device remembers a table it sits at (`STORAGE_KEYS.mpTable`). Someone
 * who only plays alone inside Telegram makes no connection at all.
 *
 * Entering (the first `table`): `controller.park()`, the `offTable` hold, the Back trap, the
 * screen. Leaving (`left`, or the OK of a dialog that ends the table) is the reverse, Home first,
 * so the local game cannot move for an instant on a Table screen that is still on show.
 */
import {
  MP_WS_PATH,
  OFFLINE_TURN_MS,
  START_NEW,
  TABLE_CODE_RE,
  WS_CLOSE,
  type ClientMsg,
  type EndReason,
  type Notice,
  type ServerMsg,
  type TableSettings,
  type TableView,
} from '../../net/protocol.ts';
import type { PlayerAction } from '../../engine/types.ts';
import { createSafeStorage, STORAGE_KEYS, type SafeStorage } from '../../persist/storage.ts';
import { TIMING, type TableController, type Timers } from '../controller.ts';
import {
  initialMp,
  updateUi,
  type AppState,
  type AppStore,
  type Command,
  type GameCommand,
  type MpConnection,
  type MpProblem,
  type MpSlice,
  type Toast,
} from '../store.ts';
import { localView, notesOf, turnOf } from './localView.ts';
import { MpSocket, type WebSocketLike } from './socket.ts';

export interface MpDriverOptions {
  store: AppStore;
  controller: Pick<TableController, 'park' | 'unpark'>;
  timers: Timers;
  /** The viewer's own name on the Table (F.10: the hero is always "You"). */
  heroName: string;
  /** Telegram's launch parameters (`TgLaunch`, §19.7). */
  launch: { readonly initData: string; readonly startParam: string | null };
  location: Pick<Location, 'protocol' | 'host'>;
  /** Makes the WebSocket (default: the browser's). */
  openSocket?: (url: string) => WebSocketLike;
  /** Default: the browser's `localStorage`, through `persist/storage.ts`. */
  storage?: SafeStorage;
  /** What a reload keeps and a new launch does not (default: `sessionStorage`), §19.6. */
  session?: SafeStorage;
  /** A clock the phone's own clock cannot move (default: `performance.now()`), §19.6. */
  monotonic?: () => number;
  /** For the socket's ±20% (tests fix it). */
  random?: () => number;
  /** Telegram asks before closing while a table is on (`shell.confirmClosing`, §19.7). */
  confirmClosing?: (need: boolean) => void;
  /** Telegram's own share list (`shell.shareInvite`, §19.7). */
  shareInvite?: (url: string, text: string) => void;
}

type Intent = { kind: 'create'; settings: TableSettings } | { kind: 'join'; code: string };

/**
 * sessionStorage: the launch whose start code is used up (the `hash` of its `initData`). A reload
 * keeps the launch and its code; a new tap on a link is a new launch, with another signature.
 */
export const START_SPENT_KEY = 'pc.tg.startSpent';

/** A toast id no controller toast has (its ids count up from 1). */
const FIRST_TOAST_ID = 1_000_000_000;

/** The page's own host (§19.6): `wss:`, or `ws:` on a plain-http test page. */
export function socketUrl(location: Pick<Location, 'protocol' | 'host'>): string {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${MP_WS_PATH}`;
}

/** Sorts `hostChanged` before the other notices of one view, which keep their order. */
const hostChangedFirst = (a: Notice, b: Notice): number =>
  Number(b.n === 'hostChanged') - Number(a.n === 'hostChanged');

/** Why a socket that closed for good stopped (§19.4), for the player. */
function problemOfClose(code: number): MpProblem {
  switch (code) {
    case WS_CLOSE.authFailed:
      return { kind: 'login' };
    case WS_CLOSE.replaced:
      return { kind: 'replaced' };
    case WS_CLOSE.outdated:
      return { kind: 'outdated' };
    case 1012:
      return { kind: 'ended', reason: 'server_restart' };
    default:
      return { kind: 'ended', reason: 'error' }; // 1009, 4005: a bug
  }
}

export class MpDriver {
  private readonly o: MpDriverOptions;
  private readonly store: AppStore;
  private readonly storage: SafeStorage;
  private readonly session: SafeStorage;
  private readonly monotonic: () => number;
  private readonly unsubscribe: () => void;
  private readonly toastTimers = new Map<number, unknown>();
  private socket: MpSocket | null = null;
  private view: TableView | null = null;
  private active = false;
  /**
   * What to ask the server for, until a `table` (or a refusal) answers it. An invite to another
   * table stays here while the player, already seated, is asked what to do (§19.10).
   */
  private intent: Intent | null = null;
  /** `startapp=new` with a remembered table: the Create screen, if that table is gone. */
  private createScreenAfterWelcome = false;
  /** "Leave it and join this one": what to ask for once `left` has come. */
  private afterLeft: Intent | null = null;
  /** `leave` was sent: a table that is gone after a reconnect is what the player asked for. */
  private leaving = false;
  /** An `act` is on its way: the bar stays locked until the next view or a refusal. */
  private acting = false;
  /** A new socket: its first view may repeat the last `rev` (§19.4), and the bar waits for it. */
  private awaitsView = false;
  /** When the connection went, until a view from the server says how things stand (§19.10). */
  private offlineSince: number | null = null;
  /** This launch's start code has done its job: `launch()` asks nothing of it (§19.6). */
  private startSpent = false;
  private toastSeq = FIRST_TOAST_ID;

  constructor(options: MpDriverOptions) {
    this.o = options;
    this.store = options.store;
    this.storage = options.storage ?? createSafeStorage();
    this.session = options.session ?? createSafeStorage(() => sessionStorage);
    this.monotonic = options.monotonic ?? (() => performance.now());
    this.unsubscribe = this.store.subscribe(this.onStore);
    // One registration for the driver's life: `handle` answers only `mp*` until a table is on.
    this.store.setRemoteHandler(this.handle);
  }

  /** At launch, inside Telegram. Does nothing at all for a player who only plays alone. */
  launch(): void {
    // A reload keeps the launch and its code: what was used or left is not asked for again.
    const spent = this.session.get(START_SPENT_KEY);
    this.startSpent = spent.ok && spent.value === this.launchMark();
    const startParam = this.startSpent ? null : this.o.launch.startParam;
    // Play with friends was tapped before this chunk had loaded: `onStore` could not see it.
    if (this.store.getState().ui.screen === 'mpCreate') this.ensureSocket();
    if (startParam !== null && TABLE_CODE_RE.test(startParam)) {
      this.intent = { kind: 'join', code: startParam };
      this.dispatch({ type: 'go', screen: 'mpRoom' }); // "Joining the table…"
      this.ensureSocket();
      return;
    }
    const wantsCreate = startParam === START_NEW;
    if (this.rememberedTable() !== null) {
      this.createScreenAfterWelcome = wantsCreate;
      this.ensureSocket();
    } else if (wantsCreate) {
      this.dispatch({ type: 'go', screen: 'mpCreate' }); // `onStore` opens the socket
    }
  }

  dispose(): void {
    this.unsubscribe();
    this.store.setRemoteHandler(null);
    this.closeSocket();
    for (const handle of this.toastTimers.values()) this.o.timers.clearTimeout(handle);
    this.toastTimers.clear();
    if (this.active) this.releaseController();
  }

  // -------------------------------------------------------------------------------------------
  // The store's side

  private readonly onStore = (s: AppState, prev: AppState): void => {
    if (s.ui.hidden !== prev.ui.hidden) this.socket?.setHidden(s.ui.hidden);
    if (s.ui.screen === prev.ui.screen) return;
    if (s.ui.screen === 'mpCreate') {
      this.ensureSocket();
    } else if ((prev.ui.screen === 'mpCreate' || prev.ui.screen === 'mpRoom') && !this.active) {
      // Back before any table: nothing is on, so nothing stays connected.
      this.intent = null;
      this.spendStart();
      this.closeSocket();
    }
  };

  /** The remote handler: true means the command is the driver's and the controller never sees it. */
  private readonly handle = (cmd: GameCommand): boolean => {
    switch (cmd.type) {
      case 'mpCreateTable':
        this.create(cmd.settings);
        return true;
      case 'mpShareInvite':
        if (this.view !== null) this.o.shareInvite?.(this.view.invite, cmd.text);
        return true;
      case 'mpStartGame':
        this.socket?.send({ t: 'start' });
        return true;
      case 'mpImBack':
        this.socket?.send({ t: 'back' });
        return true;
      case 'mpTryAgain':
        this.ensureSocket();
        return true;
      case 'mpDismiss':
        this.dismissProblem();
        return true;
      case 'mpGoToMyTable':
        this.goToMyTable();
        return true;
      case 'mpLeaveAndJoin':
        this.leaveAndJoin();
        return true;
      default:
        break;
    }
    if (!this.active) return false;
    switch (cmd.type) {
      case 'act':
        this.act(cmd.action);
        return true;
      case 'reload':
        this.socket?.send({ t: 'reload' });
        return true;
      case 'leaveTable':
      case 'changeTable':
        this.leaveTable();
        return true;
      case 'nextHand':
      case 'skipHand':
      case 'topUp':
      case 'undo':
      case 'keepMove':
        return true;
      default:
        return false; // Settings, Export, the sound button…
    }
  };

  private dispatch(cmd: Command): void {
    this.store.getState().dispatch(cmd);
  }

  private setMp(patch: Partial<MpSlice>): void {
    this.store.setState((s) => ({ mp: { ...s.mp, ...patch } }));
  }

  // -------------------------------------------------------------------------------------------
  // What the player asks for

  private create(settings: TableSettings): void {
    if (this.active || this.intent !== null) return; // a second tap
    this.intent = { kind: 'create', settings };
    if (this.socket?.online === true) this.sendIntent();
    else this.ensureSocket();
  }

  private sendIntent(): void {
    const intent = this.intent;
    if (intent === null) return;
    const msg: ClientMsg =
      intent.kind === 'create'
        ? { t: 'create', settings: intent.settings }
        : { t: 'join', code: intent.code };
    this.socket?.send(msg);
  }

  private act(action: PlayerAction): void {
    const decision = this.view?.decision;
    if (decision === undefined || decision === null || this.view?.legal === null) return;
    if (this.acting || this.awaitsView) return;
    if (this.socket?.send({ t: 'act', seq: decision.seq, action }) !== true) return;
    this.acting = true;
    this.publish();
  }

  private leaveTable(): void {
    this.leaving = true;
    if (this.socket?.send({ t: 'leave' }) === true) return; // `left` answers it
    // Trying to reconnect: `welcome` sends it again. Given up ("We can't reach the game." →
    // "Leave table"): leave without the server; the seat empties by itself (§19.5).
    if (this.socket === null || this.store.getState().mp.connection === 'lost') this.leave();
  }

  private goToMyTable(): void {
    const { problem } = this.store.getState().mp;
    if (problem?.kind !== 'alreadySeated') return;
    this.clearProblem();
    if (this.view?.code === problem.other) {
      this.intent = null; // "Stay at my table": it is on show already
      return;
    }
    this.intent = { kind: 'join', code: problem.other };
    this.sendIntent();
  }

  private leaveAndJoin(): void {
    if (this.store.getState().mp.problem?.kind !== 'alreadySeated') return;
    this.clearProblem();
    this.afterLeft = this.intent;
    this.socket?.send({ t: 'leave' });
  }

  private dismissProblem(): void {
    const { problem } = this.store.getState().mp;
    if (problem === null) return;
    this.clearProblem();
    this.intent = null;
    const over =
      problem.kind === 'ended' ||
      problem.kind === 'login' ||
      problem.kind === 'outdated' ||
      problem.kind === 'replaced';
    if (over || this.store.getState().ui.screen === 'mpRoom') this.leave();
  }

  // -------------------------------------------------------------------------------------------
  // The socket

  private ensureSocket(): void {
    if (this.socket !== null) {
      this.socket.retry();
      return;
    }
    const socket = new MpSocket({
      url: socketUrl(this.o.location),
      initData: this.o.launch.initData,
      timers: this.o.timers,
      open: this.o.openSocket ?? ((url) => new WebSocket(url)),
      onStatus: this.onStatus,
      onMessage: this.onMessage,
      onStopped: this.onStopped,
      ...(this.o.random !== undefined && { random: this.o.random }),
    });
    this.socket = socket;
    socket.setHidden(this.store.getState().ui.hidden);
    socket.connect();
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  /** Nothing of Play with friends is on show: a remembered table was only being checked. */
  private quiet(): boolean {
    if (this.active || this.intent !== null) return false;
    const { screen } = this.store.getState().ui;
    return screen !== 'mpCreate' && screen !== 'mpRoom';
  }

  private readonly onStatus = (connection: MpConnection): void => {
    this.setMp({ connection });
    if (connection === 'lost' && this.quiet()) {
      this.closeSocket();
    } else if (this.view !== null && this.active) {
      // A new socket: `welcome` comes first, then the `table` the bar waits for.
      if (connection === 'online') this.awaitsView = true;
      else this.offlineSince ??= this.monotonic();
      this.publish(); // the bar locks while offline
    }
  };

  private readonly onStopped = (code: number): void => {
    this.socket = null;
    if (this.quiet()) return;
    if (code === 1012 && !this.active) {
      // A redeploy with no table on (the Create screen, "Joining the table…"): nothing ended, and
      // the new server answers in a moment.
      this.ensureSocket();
      return;
    }
    if (this.store.getState().mp.problem === null) this.showProblem(problemOfClose(code));
  };

  private readonly onMessage = (msg: ServerMsg): void => {
    switch (msg.t) {
      case 'welcome':
        this.onWelcome(msg.code);
        break;
      case 'table':
        this.onTable(msg.view, msg.notices);
        break;
      case 'left':
        this.onLeft();
        break;
      case 'ended':
        if (msg.code === this.view?.code) this.tableEnded(msg.reason);
        break;
      case 'error':
        this.onError(msg);
        break;
      case 'pong':
        break;
    }
  };

  private onWelcome(code: string | null): void {
    if (this.view !== null) {
      if (code === null) {
        if (this.afterLeft !== null) this.onLeft();
        else if (this.leaving) this.leave();
        else this.tableEnded('gone');
        return;
      }
      if (this.leaving || this.afterLeft !== null) this.socket?.send({ t: 'leave' });
      return;
    }
    if (code !== null) {
      // Seated (§19.6): a `table` follows, whatever was asked for. An invite to another table is
      // kept: the player is asked what to do when that `table` comes (§19.10).
      if (this.intent?.kind !== 'join' || this.intent.code === code) this.intent = null;
      return;
    }
    this.forgetTable();
    if (this.intent !== null) {
      this.sendIntent();
    } else if (this.createScreenAfterWelcome) {
      this.createScreenAfterWelcome = false;
      this.dispatch({ type: 'go', screen: 'mpCreate' });
    } else if (this.store.getState().ui.screen !== 'mpCreate') {
      this.closeSocket(); // the remembered table is gone, and nothing else was asked for
    }
  }

  private onTable(view: TableView, notices: readonly Notice[]): void {
    const last = this.view;
    if (last !== null && last.code === view.code) {
      if (view.rev < last.rev || (view.rev === last.rev && !this.awaitsView)) return;
    }
    this.awaitsView = false;
    this.offlineSince = null;
    this.acting = false;
    const invitedElsewhere = this.intent?.kind === 'join' && this.intent.code !== view.code;
    if (!invitedElsewhere) this.intent = null;
    this.spendStart();
    this.createScreenAfterWelcome = false;
    const entering = !this.active;
    if (entering) this.enter();
    this.publish(view);
    this.view = view;
    if (last?.code !== view.code) this.rememberTable(view.code);
    this.showScreen(view, entering);
    this.syncBustDialog();
    if (entering && invitedElsewhere) this.showProblem({ kind: 'alreadySeated', other: view.code });
    // The Table's bar holds one toast, the newest (§12.11): who left says more than who is host.
    for (const notice of [...notices].sort(hostChangedFirst)) this.say(notice);
  }

  private onLeft(): void {
    const next = this.afterLeft;
    if (next === null) {
      this.leave();
      return;
    }
    this.afterLeft = null;
    this.intent = next;
    // The old table is over for this player: "Joining the table…" until the new one answers, so a
    // refusal has nothing stale behind it (`dismissProblem` goes Home from that screen).
    this.forgetTable();
    this.view = null;
    this.offlineSince = null;
    this.setMp({ view: null, turnEndsAt: null, nextHandEndsAt: null, turn: null, notes: [] });
    this.dispatch({ type: 'close', overlay: 'outOfChips' });
    this.dispatch({ type: 'replace', screen: 'mpRoom' });
    this.sendIntent();
  }

  private onError(msg: Extract<ServerMsg, { t: 'error' }>): void {
    switch (msg.code) {
      case 'stale_action':
      case 'not_your_turn':
        return; // §19.4: the next view says what happened
      case 'illegal_action':
        this.refused();
        return;
      case 'not_found':
        this.joinFailed({ kind: 'joinGone' });
        return;
      case 'full':
        this.joinFailed({ kind: 'joinFull' });
        return;
      case 'server_full':
        this.joinFailed({ kind: 'tooManyTables' });
        return;
      case 'rate_limited':
        if (msg.re === 'create' || msg.re === 'join') this.joinFailed({ kind: 'tooManyTables' });
        else if (msg.re === 'act') this.refused();
        return;
      case 'already_seated':
        if (msg.other !== undefined) this.showProblem({ kind: 'alreadySeated', other: msg.other });
        return;
      case 'auth_failed':
        this.stoppedByServer({ kind: 'login' });
        return;
      case 'outdated':
        this.stoppedByServer({ kind: 'outdated' });
        return;
      case 'replaced':
        this.stoppedByServer({ kind: 'replaced' });
        return;
      case 'not_seated':
        if (msg.re === 'leave') this.onLeft();
        else if (msg.re === 'act') this.refused();
        return;
      default:
        return; // a tap that came too late (`not_host`, `not_busted`…): the view is right
    }
  }

  /** The server refused this `act`: the same decision is open again (§19.6). */
  private refused(): void {
    if (!this.acting) return;
    this.acting = false;
    this.publish();
  }

  private joinFailed(problem: MpProblem): void {
    this.intent = null;
    this.afterLeft = null;
    this.spendStart();
    this.showProblem(problem);
  }

  /** `error` comes just before the close with the same meaning; the close then says nothing. */
  private stoppedByServer(problem: MpProblem): void {
    if (this.quiet()) this.closeSocket();
    else this.showProblem(problem);
  }

  private tableEnded(reason: EndReason | 'gone'): void {
    this.closeSocket();
    this.forgetTable();
    this.showProblem({ kind: 'ended', reason });
  }

  // -------------------------------------------------------------------------------------------
  // The `game` and `mp` slices

  private publish(view: TableView = this.view as TableView): void {
    const local = localView(view, this.o.heroName);
    const locked = this.acting || this.awaitsView || this.socket?.online !== true;
    const mp = this.store.getState().mp;
    const now = this.monotonic();
    // The same decision or hand end keeps its end, so a view that changed something else does
    // not restart the ring (the ±latency of each message would).
    const { decision, nextHandAt } = view;
    const old = mp.view;
    const turnEndsAt =
      decision === null
        ? null
        : old?.decision?.seq === decision.seq &&
            old.decision.deadlineAt === decision.deadlineAt &&
            mp.turnEndsAt !== null
          ? mp.turnEndsAt
          : now + (decision.deadlineAt - view.now);
    const nextHandEndsAt =
      nextHandAt === null
        ? null
        : old?.nextHandAt === nextHandAt && mp.nextHandEndsAt !== null
          ? mp.nextHandEndsAt
          : now + (nextHandAt - view.now);
    const offlineEndsAt = this.offlineSince === null ? null : this.offlineSince + OFFLINE_TURN_MS;
    const turn = turnOf(view, turnEndsAt, nextHandEndsAt, offlineEndsAt);
    const notes = old === view ? mp.notes : notesOf(view);
    this.store.setState((s) => ({
      game: { ...local, legal: locked ? null : local.legal, diag: s.game.diag },
      mp: { ...s.mp, active: true, view, turnEndsAt, nextHandEndsAt, turn, notes },
    }));
  }

  /** `status: 'waiting'` is the waiting room, `'playing'` the Table (§19.6). */
  private showScreen(view: TableView, entering: boolean): void {
    const want = view.status === 'waiting' ? 'mpRoom' : 'table';
    const { screen } = this.store.getState().ui;
    if (screen === want) return;
    if (entering || screen === 'mpRoom' || screen === 'table') {
      this.dispatch({ type: 'replace', screen: want });
    }
  }

  /**
   * §19.10: the out-of-chips dialog is open while the viewer's seat is busted, but first the hand
   * that took the last chips stays on show: its result would be under the dialog, and the next
   * deal (a new view, whatever it holds) comes by itself. A later hand end changes nothing: the
   * viewer was not dealt in, and an open dialog stays.
   */
  private syncBustDialog(): void {
    const { game, ui } = this.store.getState();
    const open = ui.overlays.includes('outOfChips');
    const resultOnShow = game.mode === 'handEnd' && game.hand?.seats[0]?.dealtIn === true;
    const want = game.heroBust && !resultOnShow;
    if (want === open) return;
    this.dispatch(
      want ? { type: 'open', overlay: 'outOfChips' } : { type: 'close', overlay: 'outOfChips' },
    );
  }

  private showProblem(problem: MpProblem): void {
    this.setMp({ problem });
    this.dispatch({ type: 'backTrap', overlay: 'mpProblem' }); // only its own buttons close it
    this.dispatch({ type: 'open', overlay: 'mpProblem' });
  }

  private clearProblem(): void {
    this.setMp({ problem: null });
    this.dispatch({ type: 'backTrap', overlay: this.active ? 'mpLeave' : null });
    this.dispatch({ type: 'close', overlay: 'mpProblem' });
  }

  private say(notice: Notice): void {
    const id = ++this.toastSeq;
    const toast: Toast =
      notice.n === 'handVoided' ? { id, kind: 'handVoided' } : { id, kind: 'mpNotice', notice };
    updateUi(this.store, (ui) => ({ ...ui, toasts: [...ui.toasts, toast] }));
    const handle = this.o.timers.setTimeout(() => {
      this.toastTimers.delete(id);
      this.dispatch({ type: 'dismissToast', id });
    }, TIMING.toastMs);
    this.toastTimers.set(id, handle);
  }

  // -------------------------------------------------------------------------------------------
  // Entering and leaving

  private enter(): void {
    this.active = true;
    this.o.controller.park();
    this.dispatch({ type: 'gate', gate: 'offTable', closed: true, owner: 'mp' });
    this.dispatch({ type: 'backTrap', overlay: 'mpLeave' });
    this.o.confirmClosing?.(true);
  }

  /** Back to the local game. Home first: `offTable` must not open while the Table is on show. */
  private releaseController(): void {
    this.active = false;
    this.dispatch({ type: 'go', screen: 'home' });
    this.o.controller.unpark();
    this.dispatch({ type: 'gate', gate: 'offTable', closed: false, owner: 'mp' });
    this.o.confirmClosing?.(false);
  }

  private leave(): void {
    this.closeSocket();
    this.forgetTable();
    this.spendStart();
    this.intent = null;
    this.afterLeft = null;
    this.leaving = false;
    this.acting = false;
    this.awaitsView = false;
    this.offlineSince = null;
    this.view = null;
    if (this.active) {
      this.releaseController();
    } else {
      const { screen } = this.store.getState().ui;
      if (screen === 'mpCreate' || screen === 'mpRoom')
        this.dispatch({ type: 'go', screen: 'home' });
    }
    this.dispatch({ type: 'backTrap', overlay: null });
    this.store.setState({ mp: initialMp() });
  }

  // -------------------------------------------------------------------------------------------
  // The start code of this launch, used once (§19.6)

  /** Which launch this is: its signature. A reload has the same one, a new tap on a link not. */
  private launchMark(): string {
    const { initData } = this.o.launch;
    return new URLSearchParams(initData).get('hash') ?? initData;
  }

  private spendStart(): void {
    if (this.startSpent || this.o.launch.startParam === null) return;
    this.startSpent = true;
    this.session.set(START_SPENT_KEY, this.launchMark());
  }

  // -------------------------------------------------------------------------------------------
  // The table this device sits at: why a later launch may open the socket by itself

  private rememberedTable(): string | null {
    const read = this.storage.get(STORAGE_KEYS.mpTable);
    return read.ok && read.value !== null && TABLE_CODE_RE.test(read.value) ? read.value : null;
  }

  private rememberTable(code: string): void {
    this.storage.set(STORAGE_KEYS.mpTable, code);
  }

  private forgetTable(): void {
    this.storage.remove(STORAGE_KEYS.mpTable);
  }
}

/** The driver on `options.store`. `launch()` next, once, inside Telegram only. */
export function createMpDriver(options: MpDriverOptions): MpDriver {
  return new MpDriver(options);
}
