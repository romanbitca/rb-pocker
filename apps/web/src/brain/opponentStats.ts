/**
 * Per-seat statistics and the opponent model built from them (PLAN §9.5).
 *
 * - `updateSeatStats(stats, log, seat)`: the controller calls it at hand end for every seat dealt
 *   in, so every observation inside a hand sees the same numbers (and `observationKey` stays
 *   stable). Counters are `[x, n]` = times done, opportunities (Appendix A.4 `SeatStats`).
 * - `seatModel` / `observedSeatModel`: the estimates, shrunk toward a prior with k = 20
 *   opportunities, `est = (x + k·prior) / (n + k)`; the prior is the personality target when its
 *   label is visible, else the average of the seat level's personality list (§9.3).
 * - `loosenessEstimate = clamp(estVPIP / 0.22, 0.5, 3.0)` widens or narrows every preflop range
 *   of that seat (§8.6).
 *
 * Definitions (standard tracker ones; the PLAN §9.5 change-log row of 1 Oct records them):
 * - VPIP, PFR: an opportunity is a hand where the seat made a preflop decision (a blind post alone
 *   is none: no walk, no all-in by posting); done = it called or raised (VPIP), raised (PFR).
 * - 3-bet: the first time it acts preflop facing exactly one raise that is not its own; done = it
 *   raised. Fold to 3-bet: it made the first raise and its next preflop action faces the second
 *   raise; done = it folded.
 * - C-bet: it made the last full preflop raise, and at its first flop action nobody had bet the
 *   flop; done = it bet. Fold to c-bet: its first flop action facing that c-bet with no raise
 *   after it; done = it folded.
 * - WTSD: an opportunity is a hand where it saw the flop (not folded when the flop came); done =
 *   it is among the seats revealed at the showdown or run-out.
 * - AF = aggActions / passiveActions over postflop actions: bets and raises / calls. Shrinkage works
 *   on the aggression frequency `agg / (agg + passive)` with prior `AF0 / (1 + AF0)`, and converts
 *   back, so `n = 0` gives exactly `AF0`.
 */
import type { BotLevel, LogEvent, Observation, PersonalityId, SeatStats } from '../engine/types.ts';
import {
  LEVEL_PERSONALITIES,
  LOOSENESS_BASE_VPIP,
  LOOSENESS_MAX,
  LOOSENESS_MIN,
  PERSONALITIES,
  STATS_PRIOR_WEIGHT,
} from './tunables.ts';

/** A seat nobody has seen play yet. */
export function emptySeatStats(): SeatStats {
  return {
    hands: 0,
    vpip: [0, 0],
    pfr: [0, 0],
    threeBet: [0, 0],
    foldTo3bet: [0, 0],
    cbet: [0, 0],
    foldToCbet: [0, 0],
    wtsd: [0, 0],
    aggActions: 0,
    passiveActions: 0,
  };
}

type Counter = [number, number];

const bump = (c: Counter, opportunity: boolean, done: boolean): Counter =>
  opportunity ? [c[0] + (done ? 1 : 0), c[1] + 1] : [c[0], c[1]];

/**
 * `stats` plus what `seat` did in one finished hand (`log` = that hand's `HandState.log`). Pure:
 * returns a new object. `null` stats count as empty; a seat that was not dealt in (no post and no
 * action in the log) gets its stats back unchanged (as a copy).
 */
export function updateSeatStats(
  stats: SeatStats | null,
  log: readonly LogEvent[],
  seat: number,
): SeatStats {
  const base = stats ?? emptySeatStats();
  let dealt = false;
  let folded = false;
  // Preflop.
  let raises = 0; // bets and raises so far (every seat)
  let aggressor: number | null = null; // the last full raise
  let decided = false;
  let vpip = false;
  let pfr = false;
  let opened = false;
  const threeBet = { opp: false, done: false };
  const foldTo3bet = { opp: false, done: false };
  // Flop and later.
  let sawFlop = false;
  let flopBets = 0;
  let cbettor: number | null = null;
  let actedOnFlop = false;
  const cbet = { opp: false, done: false };
  const foldToCbet = { opp: false, done: false };
  let agg = 0;
  let passive = 0;
  let showdown = false;

  for (const ev of log) {
    if (ev.e === 'post') {
      if (ev.seat === seat) dealt = true;
    } else if (ev.e === 'street') {
      if (ev.street === 'flop' && dealt && !folded) sawFlop = true;
    } else if (ev.e === 'reveal') {
      if (ev.seats.includes(seat)) showdown = true;
    } else if (ev.e === 'act') {
      const mine = ev.seat === seat;
      const type = ev.action.type;
      const aggressive = type === 'bet' || type === 'raise';
      if (mine) dealt = true;
      if (ev.street === 'preflop') {
        if (mine) {
          decided = true;
          if (aggressive || type === 'call') vpip = true;
          if (aggressive) pfr = true;
          if (raises === 1 && !opened && !threeBet.opp) {
            threeBet.opp = true;
            threeBet.done = aggressive;
          }
          if (raises === 2 && opened && !foldTo3bet.opp) {
            foldTo3bet.opp = true;
            foldTo3bet.done = type === 'fold';
          }
          if (aggressive && raises === 0) opened = true;
        }
        if (aggressive) {
          raises++;
          if (ev.full) aggressor = ev.seat;
        }
      } else {
        if (mine && aggressive) agg++;
        if (mine && type === 'call') passive++;
        if (ev.street === 'flop') {
          if (mine && !actedOnFlop) {
            actedOnFlop = true;
            if (aggressor === seat && flopBets === 0) {
              cbet.opp = true;
              cbet.done = aggressive;
            }
          }
          if (mine && cbettor !== null && cbettor !== seat && flopBets === 1 && !foldToCbet.opp) {
            foldToCbet.opp = true;
            foldToCbet.done = type === 'fold';
          }
          if (aggressive) {
            if (flopBets === 0 && ev.seat === aggressor) cbettor = ev.seat;
            flopBets++;
          }
        }
      }
      if (mine && type === 'fold') folded = true;
    }
  }

  if (!dealt) return copyStats(base);
  return {
    hands: base.hands + 1,
    vpip: bump(base.vpip, decided, vpip),
    pfr: bump(base.pfr, decided, pfr),
    threeBet: bump(base.threeBet, threeBet.opp, threeBet.done),
    foldTo3bet: bump(base.foldTo3bet, foldTo3bet.opp, foldTo3bet.done),
    cbet: bump(base.cbet, cbet.opp, cbet.done),
    foldToCbet: bump(base.foldToCbet, foldToCbet.opp, foldToCbet.done),
    wtsd: bump(base.wtsd, sawFlop, showdown),
    aggActions: base.aggActions + agg,
    passiveActions: base.passiveActions + passive,
  };
}

function copyStats(s: SeatStats): SeatStats {
  return {
    hands: s.hands,
    vpip: [s.vpip[0], s.vpip[1]],
    pfr: [s.pfr[0], s.pfr[1]],
    threeBet: [s.threeBet[0], s.threeBet[1]],
    foldTo3bet: [s.foldTo3bet[0], s.foldTo3bet[1]],
    cbet: [s.cbet[0], s.cbet[1]],
    foldToCbet: [s.foldToCbet[0], s.foldToCbet[1]],
    wtsd: [s.wtsd[0], s.wtsd[1]],
    aggActions: s.aggActions,
    passiveActions: s.passiveActions,
  };
}

/** What the model expects of a seat before seeing it play (fractions; AF a ratio). */
export interface SeatPrior {
  vpip: number;
  pfr: number;
  af: number;
}

/**
 * §9.5 prior: the personality's targets when its label is visible, else the average of the
 * targets over the seat level's personality list (§9.3).
 */
export function seatPrior(visible: PersonalityId | null, level: BotLevel): SeatPrior {
  if (visible !== null) {
    const p = PERSONALITIES[visible];
    return { vpip: p.vpip, pfr: p.pfr, af: p.af };
  }
  const list = LEVEL_PERSONALITIES[level];
  const mean = (f: (id: PersonalityId) => number): number =>
    list.reduce((sum, id) => sum + f(id), 0) / list.length;
  return {
    vpip: mean((id) => PERSONALITIES[id].vpip),
    pfr: mean((id) => PERSONALITIES[id].pfr),
    af: mean((id) => PERSONALITIES[id].af),
  };
}

/** `est = (x + k·prior) / (n + k)`, k = 20 opportunities (§9.5). */
export function shrink(x: number, n: number, prior: number, k = STATS_PRIOR_WEIGHT): number {
  return (x + k * prior) / (n + k);
}

/** `clamp(estVPIP / 0.22, 0.5, 3.0)` (§9.5). */
export function loosenessEstimate(estVpip: number): number {
  return Math.min(LOOSENESS_MAX, Math.max(LOOSENESS_MIN, estVpip / LOOSENESS_BASE_VPIP));
}

/** The shrunk estimates of one seat and how much evidence is behind each (`n`). */
export interface SeatModel {
  hands: number;
  vpip: number;
  vpipN: number;
  pfr: number;
  pfrN: number;
  /** Estimated postflop aggression factor (bets + raises) / calls. */
  af: number;
  /** Postflop bets, raises and calls seen. */
  afN: number;
  looseness: number;
}

export function seatModel(stats: SeatStats | null, prior: SeatPrior): SeatModel {
  const s = stats ?? emptySeatStats();
  const vpip = shrink(s.vpip[0], s.vpip[1], prior.vpip);
  const afN = s.aggActions + s.passiveActions;
  const aggFreq = shrink(s.aggActions, afN, prior.af / (1 + prior.af));
  return {
    hands: s.hands,
    vpip,
    vpipN: s.vpip[1],
    pfr: shrink(s.pfr[0], s.pfr[1], prior.pfr),
    pfrN: s.pfr[1],
    af: aggFreq / (1 - aggFreq),
    afN,
    looseness: loosenessEstimate(vpip),
  };
}

/** The observer's model of `seat`, from the observation alone (its stats, label and level). */
export function observedSeatModel(obs: Observation, seat: number): SeatModel {
  const prior = seatPrior(
    obs.visiblePersonality[seat] as PersonalityId | null,
    obs.seatLevels[seat] as BotLevel,
  );
  return seatModel(obs.seatStats[seat] as SeatStats | null, prior);
}
