/**
 * The owner's standalone Hand Drill's own hand logic, kept only as a test oracle (PLAN §13.5): its
 * `score5`, `cmp` and `bestOf`, copied from its `index.html` with nothing changed but the types
 * and the card form. The drill page uses RB's evaluator (`eval/`); the differential test checks
 * that both agree.
 *
 * Its cards are `{ r, s }` with r 2..14 (Ace 14) and its own suit order; only "same suit or not"
 * matters to it, so an RB card maps to `{ r: rank + 2, s: suit }`. A score is
 * `[position, ...tiebreak ranks]`: position 1 = royal flush … 10 = high card, as the drill's
 * ladder numbers them.
 */
import { rankOf, suitOf, type Card } from '../../src/core/cards.ts';

interface OracleCard {
  r: number;
  s: number;
}

export type OracleScore = number[];

const toOracle = (c: Card): OracleCard => ({ r: rankOf(c) + 2, s: suitOf(c) });

// score5 -> [position, ...tiebreak ranks]; lower position wins, then higher tiebreaks
function score5Of(cs: OracleCard[]): OracleScore {
  const rs = cs.map((c) => c.r).sort((a, b) => b - a);
  const flush = cs.every((c) => c.s === (cs[0] as OracleCard).s);
  let sHigh = 0;
  if (new Set(rs).size === 5) {
    if ((rs[0] as number) - (rs[4] as number) === 4) sHigh = rs[0] as number;
    else if (rs.join() === '14,5,4,3,2') sHigh = 5;
  }
  const cnt: Record<number, number> = {};
  rs.forEach((r) => (cnt[r] = (cnt[r] ?? 0) + 1));
  const grp = Object.keys(cnt)
    .map(Number)
    .sort((a, b) => (cnt[b] as number) - (cnt[a] as number) || b - a);
  const shape = grp.map((r) => cnt[r]).join('');
  if (sHigh && flush) return [sHigh === 14 ? 1 : 2, sHigh];
  if (shape === '41') return [3, ...grp];
  if (shape === '32') return [4, ...grp];
  if (flush) return [5, ...rs];
  if (sHigh) return [6, sHigh];
  if (shape === '311') return [7, ...grp];
  if (shape === '221') return [8, ...grp];
  if (shape === '2111') return [9, ...grp];
  return [10, ...rs];
}

export function cmp(a: OracleScore, b: OracleScore): number {
  if (a[0] !== b[0]) return (b[0] as number) - (a[0] as number);
  for (let i = 1; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  }
  return 0;
}

const COMBOS: Record<number, number[][]> = {};
function combos(n: number): number[][] {
  const known = COMBOS[n];
  if (known) return known;
  const out: number[][] = [];
  const rec = (st: number, acc: number[]) => {
    if (acc.length === 5) {
      out.push(acc.slice());
      return;
    }
    for (let i = st; i < n; i++) {
      acc.push(i);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return (COMBOS[n] = out);
}

function bestOfOracle(cs: OracleCard[]): { score: OracleScore; idx: number[] } {
  let bs: OracleScore | null = null;
  let bi: number[] | null = null;
  for (const idx of combos(cs.length)) {
    const sc = score5Of(idx.map((i) => cs[i] as OracleCard));
    if (!bs || cmp(sc, bs) > 0) {
      bs = sc;
      bi = idx;
    }
  }
  return { score: bs as OracleScore, idx: bi as number[] };
}

/** The old drill's `score5` of five RB cards. */
export function score5(cards: readonly Card[]): OracleScore {
  return score5Of(cards.map(toOracle));
}

/** The old drill's `bestOf` (best five of 5–7 RB cards): the score and the indices it used. */
export function bestOf(cards: readonly Card[]): { score: OracleScore; idx: number[] } {
  return bestOfOracle(cards.map(toOracle));
}
