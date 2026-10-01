/**
 * The postflop policy (PLAN §8.5): the rule action of the coach and of every bot (`A*`, §9.4)
 * after the flop, sized by §8.7 (`sizing.ts`), with reason codes (§8.10) and never English.
 *
 * Reads (HEURISTIC, constants in `tunables.ts`):
 * - Realisation `R`: river and in position 1; out of position flop 0.85, turn 0.92; −0.05 in a
 *   multiway pot (every street).
 * - Implied odds only for draws to a non-dominated hand: flush draws, and straight draws on a
 *   board with no pair and no three of a suit. `P_hit` = the exact next-card chance of the outs
 *   that complete such a draw (§6.6); `implied = P_hit × 0.5 × min(stackBehind, winPot + toCall)`.
 * - Facing a bet: raise for value with Monster, or with Strong on a Wet or Very wet board; else
 *   call if `EV(call) = E·R·(winPot + toCall) − toCall + implied > 0`; else fold.
 * - Checked to the hero: Monster or Strong bet (never a slow-play); Medium checks except thin
 *   value (1/3 pot) in position heads-up on a Dry board, or on the river in position with
 *   `p ≥ 0.6`; a Draw semi-bluffs heads-up when in position or the preflop aggressor; Air checks
 *   except the flop continuation bet (1/3 pot) as the aggressor, heads-up, on a Dry board.
 * - SPR commitment: `spr ≤ 3` commits top pair or better (heads-up read as `p ≥ 0.6`): never
 *   fold, and a raise goes all-in. `3 < spr ≤ 6` commits two pair or better, or an overpair / top
 *   pair top kicker on a Dry board: never fold. `spr > 6`: one pair never raises (pot control)
 *   and bets for value on at most two streets.
 *
 * `E` is `eRange` (§8.9); a bot passes its perceived equity through `withEquity` (§9.4 step 1).
 * `postflopSpot(obs)` collects the few facts the rules need beyond `Features`.
 */
import { outsChances } from '../analysis/chances.ts';
import { countBeaters, findOuts } from '../analysis/handinfo.ts';
import type { DrawKind } from '../analysis/types.ts';
import { rankOf, suitOf, type Card } from '../core/cards.ts';
import type { Observation } from '../engine/types.ts';
import type { HandInfo } from '../eval/describe.ts';
import { score7, scoreNibbles, type HandCategory } from '../eval/evaluate.ts';
import { bucketOf } from './features.ts';
import { liveOpponents } from './ranges.ts';
import { sizeIntent, type SizedAction } from './sizing.ts';
import {
  COMMIT_P_HEADS_UP,
  IMPLIED_SHARE,
  ONE_PAIR_VALUE_STREETS,
  REALISATION_FULL,
  REALISATION_MULTIWAY,
  REALISATION_OOP_FLOP,
  REALISATION_OOP_TURN,
  RIVER_THIN_VALUE_P,
  SPR_COMMIT,
  SPR_COMMIT_ALL_IN,
} from './tunables.ts';
import type {
  Features,
  PolicyDecision,
  PolicyIntent,
  PostflopSpot,
  Reason,
  ReasonCode,
  SizeSet,
} from './types.ts';

// ── Spot ───────────────────────────────────────────────────────────────────────────────────────

/** The `PostflopSpot` of an observation whose seat is to act after the flop. */
export function postflopSpot(obs: Observation): PostflopSpot {
  if (obs.board.length < 3) throw new RangeError('postflopSpot: the flop is not dealt');
  if (!obs.legal.canCheck && !obs.legal.canCall) {
    throw new RangeError(`postflopSpot: seat ${obs.seat} is not to act`);
  }
  const hero = obs.seat;
  const heroStack = obs.stacks[hero] as number;
  const deepest = Math.max(0, ...liveOpponents(obs).map((s) => obs.stacks[s] as number));
  const drawStreet = obs.board.length < 5;
  const beaters = countBeaters(obs.hole, obs.board);
  const betStreets = new Set(
    obs.history
      .filter(
        (a) =>
          a.seat === hero &&
          a.street !== 'preflop' &&
          a.street !== obs.street &&
          (a.type === 'bet' || a.type === 'raise'),
      )
      .map((a) => a.street),
  );
  return {
    hole: [obs.hole[0], obs.hole[1]],
    board: [...obs.board],
    sb: obs.sb,
    bb: obs.bb,
    legal: obs.legal,
    currentBet: Math.max(0, ...obs.streetBets),
    heroStreetBet: obs.streetBets[hero] as number,
    heroStack,
    stackBehind: Math.max(0, Math.min(heroStack - obs.legal.callAmount, deepest)),
    outCards: drawStreet ? findOuts(obs.hole, obs.board) : [],
    nuts: beaters !== null && beaters.count === 0,
    heroBetStreets: betStreets.size,
  };
}

// ── Made hand (for the §8.5 step 6 commitment bands) ───────────────────────────────────────────

/**
 * The hero's made hand by what its own cards do: a pair, two pair or trips counts only when a hole
 * card is in it (two pair with one pair on the board reads as the hero's own pair), and a straight
 * or better only when a hole card is in its core; when the board plays it is `nothing`.
 */
export type MadeHand =
  'nothing' | 'weakPair' | 'topPair' | 'overpair' | 'twoPair' | 'trips' | 'straightPlus';

export interface MadeHandRead {
  made: MadeHand;
  /** Top pair whose other hole card is the best kicker left (the highest rank off the board). */
  topKicker: boolean;
}

const ONE_PAIR: ReadonlySet<MadeHand> = new Set(['weakPair', 'topPair', 'overpair']);
const TOP_PAIR_PLUS: ReadonlySet<MadeHand> = new Set([
  'topPair',
  'overpair',
  'twoPair',
  'trips',
  'straightPlus',
]);
const TWO_PAIR_PLUS: ReadonlySet<MadeHand> = new Set(['twoPair', 'trips', 'straightPlus']);

export function madeHand(
  hole: readonly Card[],
  board: readonly Card[],
  info: HandInfo,
): MadeHandRead {
  const nothing: MadeHandRead = { made: 'nothing', topKicker: false };
  if (board.length === 0 || info.playsTheBoard) return nothing;
  const holeRanks = hole.map(rankOf);
  const inHole = (r: number): number => holeRanks.filter((h) => h === r).length;
  const boardRanks = new Set(board.map(rankOf));
  const top = Math.max(...boardRanks);
  const pairOf = (r: number): MadeHandRead => {
    if (inHole(r) === 2) return { made: r > top ? 'overpair' : 'weakPair', topKicker: false };
    if (r !== top) return { made: 'weakPair', topKicker: false };
    let best = 12;
    while (best === r || boardRanks.has(best)) best--;
    return { made: 'topPair', topKicker: holeRanks.some((h) => h !== r && h === best) };
  };
  const [n0, n1] = scoreNibbles(info.score);
  switch (info.category) {
    case 'highCard':
      return nothing;
    case 'pair':
      return inHole(n0) > 0 ? pairOf(n0) : nothing;
    case 'twoPair': {
      const mine = [n0, n1].filter((r) => inHole(r) > 0);
      if (mine.length === 2) return { made: 'twoPair', topKicker: false };
      return mine.length === 1 ? pairOf(mine[0] as number) : nothing;
    }
    case 'trips':
      return inHole(n0) > 0 ? { made: 'trips', topKicker: false } : nothing;
    default:
      return info.core.some((c) => hole.includes(c))
        ? { made: 'straightPlus', topKicker: false }
        : nothing;
  }
}

/** §8.5 step 6 SPR band: 1 (`spr ≤ 3`), 2 (`3 < spr ≤ 6`) or 3 (`spr > 6`). */
export function sprBand(spr: number): 1 | 2 | 3 {
  return spr <= SPR_COMMIT_ALL_IN ? 1 : spr <= SPR_COMMIT ? 2 : 3;
}

/** §8.5 step 6: the hero may not fold (band 1 or 2), and band 1 raises all-in. */
export function isCommitted(
  f: Pick<Features, 'spr' | 'nOpp' | 'p' | 'texture'>,
  read: MadeHandRead,
): boolean {
  switch (sprBand(f.spr)) {
    case 1:
      return f.nOpp === 1 ? f.p >= COMMIT_P_HEADS_UP : TOP_PAIR_PLUS.has(read.made);
    case 2:
      return (
        TWO_PAIR_PLUS.has(read.made) ||
        (f.texture === 'dry' &&
          (read.made === 'overpair' || (read.made === 'topPair' && read.topKicker)))
      );
    default:
      return false;
  }
}

// ── Numbers ────────────────────────────────────────────────────────────────────────────────────

/** §8.5 step 2 realisation `R`. */
export function realisation(f: Pick<Features, 'street' | 'position' | 'nOpp'>): number {
  const base =
    f.street === 'river' || f.position === 'IP'
      ? REALISATION_FULL
      : f.street === 'flop'
        ? REALISATION_OOP_FLOP
        : REALISATION_OOP_TURN;
  return f.nOpp > 1 ? base - REALISATION_MULTIWAY : base;
}

const FLUSH_DRAWS: ReadonlySet<DrawKind> = new Set(['flush', 'nutFlush']);
const STRAIGHT_DRAWS: ReadonlySet<DrawKind> = new Set(['oesd', 'doubleGutshot', 'gutshot']);
const MAKES_FLUSH: ReadonlySet<HandCategory> = new Set(['flush', 'straightFlush', 'royalFlush']);
const MAKES_STRAIGHT: ReadonlySet<HandCategory> = new Set([
  'straight',
  'straightFlush',
  'royalFlush',
]);

function boardHasPair(board: readonly Card[]): boolean {
  return new Set(board.map(rankOf)).size < board.length;
}

function boardMaxSuit(board: readonly Card[]): number {
  const n = [0, 0, 0, 0];
  for (const c of board) n[suitOf(c)] = (n[suitOf(c)] as number) + 1;
  return Math.max(...n);
}

/**
 * §8.5 step 3 `P_hit`: the exact next-card chance (§6.6) of the outs that complete a draw to a
 * non-dominated hand (a flush draw; a straight draw on a board with no pair and no three of a
 * suit). An out counts when it makes that draw's hand (a flush, or a straight; a straight flush
 * for either). 0 when there is no such draw, and on the river.
 */
export function impliedHitChance(
  f: Pick<Features, 'street' | 'draws'>,
  spot: Pick<PostflopSpot, 'board' | 'outCards'>,
): number {
  if (f.street !== 'flop' && f.street !== 'turn') return 0;
  const flush = f.draws.some((d) => FLUSH_DRAWS.has(d.kind));
  const straight =
    f.draws.some((d) => STRAIGHT_DRAWS.has(d.kind)) &&
    !boardHasPair(spot.board) &&
    boardMaxSuit(spot.board) < 3;
  if (!flush && !straight) return 0;
  const hits = spot.outCards.filter(
    (o) => (flush && MAKES_FLUSH.has(o.makes)) || (straight && MAKES_STRAIGHT.has(o.makes)),
  ).length;
  return (outsChances(hits, spot.board.length).nextCardPct as number) / 100;
}

/** §8.5 step 3: `implied = P_hit × 0.5 × min(stackBehind, winPot + toCall)`. */
export function impliedOdds(
  f: Pick<Features, 'street' | 'draws' | 'winPot' | 'toCall'>,
  spot: Pick<PostflopSpot, 'board' | 'outCards' | 'stackBehind'>,
): number {
  const hit = impliedHitChance(f, spot);
  return hit === 0 ? 0 : hit * IMPLIED_SHARE * Math.min(spot.stackBehind, f.winPot + f.toCall);
}

/** §8.5 step 4: `EV(call) = E·R·(winPot + toCall) − toCall + implied` (chips vs folding). */
export function callEV(
  f: Pick<Features, 'eRange' | 'winPot' | 'toCall'>,
  r: number,
  implied: number,
): number {
  return f.eRange * r * (f.winPot + f.toCall) - f.toCall + implied;
}

/**
 * §9.4 steps 1–2: the features as a bot perceives them with equity `e` (clamped to [0, 1]): `p`
 * and the bucket follow it.
 */
export function withEquity(f: Features, e: number): Features {
  const eRange = Math.min(1, Math.max(0, e));
  const p = f.nOpp === 0 ? 1 : eRange ** (1 / f.nOpp);
  return { ...f, eRange, p, bucket: bucketOf(p, f.outs, f.street) };
}

// ── §9.4 step 4 defence (bots) ─────────────────────────────────────────────────────────────────

/**
 * The minimum defence frequency against the current street's last bet or raise: `pot / (pot +
 * inv)` (§8.9) with that action's `potBefore` and `amountIn`; 1 when there is none.
 */
export function mdfFacing(obs: Observation): number {
  for (let i = obs.history.length - 1; i >= 0; i--) {
    const a = obs.history[i] as Observation['history'][number];
    if (a.street !== obs.street) break;
    if (a.type === 'bet' || a.type === 'raise') return a.potBefore / (a.potBefore + a.amountIn);
  }
  return 1;
}

/**
 * The hero's hand-strength percentile among every two-card hand on this board (the hands that
 * use none of the hero's or the board's cards; ties count half): §9.4's `handPct`.
 */
export function handPercentile(hole: readonly Card[], board: readonly Card[]): number {
  const known = new Uint8Array(52);
  for (const c of hole) known[c] = 1;
  for (const c of board) known[c] = 1;
  const mine = score7([...hole, ...board], hole.length + board.length);
  const cards = [0, 0, ...board];
  let below = 0;
  let equal = 0;
  let n = 0;
  for (let a = 0; a < 52; a++) {
    if (known[a] === 1) continue;
    cards[0] = a;
    for (let b = a + 1; b < 52; b++) {
      if (known[b] === 1) continue;
      cards[1] = b;
      const s = score7(cards, cards.length);
      n++;
      if (s < mine) below++;
      else if (s === mine) equal++;
    }
  }
  return (below + equal / 2) / n;
}

/** §9.4 step 4: a bot facing a bet also continues when `1 − handPct ≤ MDF × defenseFactor`. */
export function mdfDefends(handPct: number, mdfShare: number, defenseFactor: number): boolean {
  return 1 - handPct <= mdfShare * defenseFactor;
}

// ── The policy ─────────────────────────────────────────────────────────────────────────────────

/** Everything the rules derive from the features and the spot. */
export interface PostflopRead {
  r: number;
  implied: number;
  /** EV(call) with and without the implied odds (chips vs folding; 0 when nothing to call). */
  ev: number;
  evPrice: number;
  made: MadeHandRead;
  band: 1 | 2 | 3;
  committed: boolean;
  /** `spr > 6` with one pair: no raise, at most two value streets. */
  potControl: boolean;
  /** One pair at `spr > 6` that already bet two streets: no more value bets. */
  valueCapped: boolean;
}

export function postflopRead(f: Features, spot: PostflopSpot): PostflopRead {
  const r = realisation(f);
  const implied = f.toCall > 0 ? impliedOdds(f, spot) : 0;
  const made = madeHand(spot.hole, spot.board, f.handInfo);
  const band = sprBand(f.spr);
  const potControl = band === 3 && ONE_PAIR.has(made.made);
  const evPrice = f.toCall > 0 ? callEV(f, r, 0) : 0;
  return {
    r,
    implied,
    ev: evPrice + implied,
    evPrice,
    made,
    band,
    committed: isCommitted(f, made),
    potControl,
    valueCapped: potControl && spot.heroBetStreets >= ONE_PAIR_VALUE_STREETS,
  };
}

const intent = (
  kind: PolicyIntent['kind'],
  purpose: PolicyIntent['purpose'] = null,
  allIn = false,
): PolicyIntent => ({ kind, purpose, allIn });

/** §8.5 steps 4–6: the rule action before sizing. */
export function postflopIntent(
  f: Features,
  spot: PostflopSpot,
  read = postflopRead(f, spot),
): PolicyIntent {
  if (f.toCall > 0) {
    const raise =
      (f.bucket === 'monster' || (f.bucket === 'strong' && f.texture !== 'dry')) &&
      !read.potControl;
    if (raise) {
      return intent(
        'raise',
        f.bucket === 'monster' ? 'value' : 'protect',
        read.committed && read.band === 1,
      );
    }
    return read.ev > 0 || read.committed ? intent('call') : intent('fold');
  }
  switch (f.bucket) {
    case 'monster':
    case 'strong':
      return read.valueCapped ? intent('check') : intent('bet', 'value');
    case 'medium': {
      const thin =
        f.position === 'IP' &&
        ((f.nOpp === 1 && f.texture === 'dry') ||
          (f.street === 'river' && f.p >= RIVER_THIN_VALUE_P));
      return thin && !read.valueCapped ? intent('bet', 'thinValue') : intent('check');
    }
    case 'draw':
      return f.nOpp === 1 && (f.position === 'IP' || f.wasPreflopAggressor)
        ? intent('bet', 'semiBluff')
        : intent('check');
    default:
      return f.street === 'flop' && f.wasPreflopAggressor && f.nOpp === 1 && f.texture === 'dry'
        ? intent('bet', 'cbet')
        : intent('check');
  }
}

const reason = (code: ReasonCode, data: Reason['data'] = {}): Reason => ({ code, data });

/** The largest draw (most outs; the first of equals), for `{draw}` (Appendix F.1). */
function largestDraw(f: Features): DrawKind | null {
  let best: Features['draws'][number] | null = null;
  for (const d of f.draws) if (best === null || d.outs > best.outs) best = d;
  return best === null ? null : best.kind;
}

/** Reason codes for the sized action, main first (§8.10; data per Appendix F.1). */
function traceOf(
  f: Features,
  spot: PostflopSpot,
  read: PostflopRead,
  rule: PolicyIntent,
  sized: SizedAction,
): Reason[] {
  const E = f.eRange;
  const need = f.need;
  const handName = f.handInfo.name;
  const nuts = spot.nuts && !f.handInfo.playsTheBoard;
  const { action } = sized;
  const size =
    action.type === 'bet' || action.type === 'raise'
      ? { size: action.to, sizeBB: action.to / spot.bb }
      : {};
  switch (action.type) {
    case 'fold':
      if (f.handInfo.playsTheBoard) return [reason('BOARD_PLAYS')];
      return [reason(f.facing === 'allin' ? 'FOLD_ALLIN' : 'FOLD_PRICE', { E, need })];
    case 'call': {
      if (read.committed) return [reason('COMMITTED', { handName, E, need })];
      if (f.facing === 'allin') return [reason('CALL_ALLIN', { E, need })];
      if (read.evPrice <= 0 && read.implied > 0) {
        const needImplied = f.toCall / (f.winPot + f.toCall + read.implied);
        return [reason('IMPLIED', { E, need, needImplied, draw: largestDraw(f) ?? '' })];
      }
      return [reason('CALL_PROFITABLE', { E, need, toCall: f.toCall, pot: f.winPot })];
    }
    case 'check':
      if (rule.kind === 'bet') return [reason('CHECK_FREE')]; // nobody left who could call a bet
      if (f.bucket === 'monster' || f.bucket === 'strong' || f.bucket === 'medium') {
        return [reason('POT_CONTROL', { handName })];
      }
      return [reason(f.street === 'river' ? 'CHECK_FREE' : 'CHECK_WEAK')];
    case 'raise': {
      const main = nuts ? 'NUTS' : rule.purpose === 'protect' ? 'RAISE_PROTECT' : 'VALUE_RAISE';
      const trace = [reason(main, size)];
      if (rule.allIn) trace.push(reason('COMMITTED', { handName, E, need }));
      return trace;
    }
    default: {
      // A bet.
      if (rule.purpose === 'thinValue') return [reason('THIN_VALUE', { handName, E, ...size })];
      if (rule.purpose === 'cbet') return [reason('CBET_DRY', size)];
      if (rule.purpose === 'semiBluff') {
        const hit = outsChances(f.outs, spot.board.length);
        return [
          reason('SEMI_BLUFF', {
            draw: largestDraw(f) ?? '',
            outs: f.outs,
            hitNext: (hit.nextCardPct as number) / 100,
            hitRiver: (hit.byRiverPct as number) / 100,
            ...size,
          }),
        ];
      }
      return [
        reason(nuts ? 'NUTS' : 'VALUE_BET', {
          handName,
          category: f.handInfo.category,
          E,
          ...size,
        }),
      ];
    }
  }
}

/**
 * The postflop rule action, sized and legal (§8.5 + §8.7): the coach passes `'texture'`; a bot
 * passes its features through `withEquity` and its profile's size set (§9.2, §9.4).
 */
export function postflopPolicy(
  f: Features,
  spot: PostflopSpot,
  sizing: SizeSet = 'texture',
): PolicyDecision {
  if (f.street === 'preflop') throw new RangeError('postflopPolicy: preflop is §8.3');
  const read = postflopRead(f, spot);
  const rule = postflopIntent(f, spot, read);
  const sized = sizeIntent(rule, f, spot, sizing);
  return { action: sized.action, kind: sized.kind, trace: traceOf(f, spot, read, rule, sized) };
}
