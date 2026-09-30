import { describe, expect, it } from 'vitest';
import { className, classCombos } from '../../src/core/cards.ts';
import {
  classByName,
  COMBOS_TOTAL,
  comboCount,
  decodePushFold,
  decodeRanges,
  orderProblem,
  PUSH_FOLD_BYTES,
  PUSH_FOLD_SPOTS,
  pushFoldAcceptance,
  RANGE_CLASSES,
  RANGE_KNOTS,
  RANGES_BYTES,
  rangeAcceptance,
  rankPctFromOrder,
  topWeights,
} from '../../src/data/rangesLayout.ts';

const identity = Array.from({ length: RANGE_CLASSES }, (_, i) => i);

describe('class helpers', () => {
  it('counts the combos of every class like core/cards and adds up to 1,326', () => {
    let total = 0;
    for (let cls = 0; cls < RANGE_CLASSES; cls++) {
      expect(comboCount(cls)).toBe(classCombos(cls));
      total += comboCount(cls);
    }
    expect(total).toBe(COMBOS_TOTAL);
  });

  it('rejects a class that does not exist', () => {
    expect(() => comboCount(-1)).toThrow(RangeError);
    expect(() => comboCount(169)).toThrow(RangeError);
    expect(() => comboCount(1.5)).toThrow(RangeError);
  });

  it('finds a class by name, the inverse of className', () => {
    for (let cls = 0; cls < RANGE_CLASSES; cls++) expect(classByName(className(cls))).toBe(cls);
    expect(classByName('AA')).toBe(0);
    expect(classByName('AKs')).toBe(1);
    expect(classByName('AKo')).toBe(13);
    expect(classByName('22')).toBe(168);
  });

  it('rejects names that are not classes', () => {
    for (const name of ['', 'A', 'AK', 'AAs', 'KAs', 'A1s', 'AKx', 'AKss', 'KKo']) {
      expect(() => classByName(name), name).toThrow(RangeError);
    }
  });
});

describe('the ranking', () => {
  it('accepts a ranking and names what is wrong with others', () => {
    expect(orderProblem(identity)).toBeNull();
    expect(orderProblem(identity.slice(1))).toMatch(/168 classes/);
    expect(orderProblem([0, ...identity.slice(0, 168)])).toMatch(/missing or twice/);
    expect(orderProblem([...identity.slice(0, 168), 169])).toMatch(/missing or twice/);
    expect(orderProblem([...identity.slice(0, 168), 1.5])).toMatch(/missing or twice/);
  });

  it('turns an order into the share of combos that rank at least as well', () => {
    const pct = rankPctFromOrder(identity);
    expect(pct[0]).toBeCloseTo((100 * 6) / COMBOS_TOTAL, 12);
    expect(pct[1]).toBeCloseTo((100 * 10) / COMBOS_TOTAL, 12);
    expect(pct[168]).toBeCloseTo(100, 12);
    for (let cls = 1; cls < RANGE_CLASSES; cls++) {
      expect(pct[cls] as number).toBeGreaterThan(pct[cls - 1] as number);
    }
    expect(() => rankPctFromOrder(identity.slice(1))).toThrow(RangeError);
  });

  it('builds the exact top X% of the combos, the class on the edge in part', () => {
    const reverse = [...identity].reverse();
    for (const order of [identity, reverse]) {
      for (const pct of [...RANGE_KNOTS, 0.5, 7.77]) {
        const weights = topWeights(order, pct);
        let combos = 0;
        for (let cls = 0; cls < RANGE_CLASSES; cls++) {
          const w = weights[cls] as number;
          expect(w).toBeGreaterThanOrEqual(0);
          expect(w).toBeLessThanOrEqual(1);
          combos += w * comboCount(cls);
        }
        expect(combos).toBeCloseTo((pct / 100) * COMBOS_TOTAL, 9);
      }
    }
    // The best classes are in whole, the worst not at all, and the rule is one class deep.
    const top3 = topWeights(identity, 3);
    expect(top3[0]).toBe(1);
    expect(top3[168]).toBe(0);
    expect(Array.from(topWeights(identity, 100)).every((w) => w === 1)).toBe(true);
    expect(() => topWeights(identity, 0)).toThrow(RangeError);
    expect(() => topWeights(identity, 100.1)).toThrow(RangeError);
    expect(() => topWeights(identity, Number.NaN)).toThrow(RangeError);
    expect(() => topWeights(identity.slice(1), 10)).toThrow(RangeError);
  });
});

describe('the blobs', () => {
  const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

  it('reads the ranges blob: the order, then the equities from two planes', () => {
    const bytes = new Uint8Array(RANGES_BYTES);
    identity.forEach((cls, i) => (bytes[i] = cls));
    const words = RANGE_CLASSES * RANGE_KNOTS.length;
    bytes[RANGE_CLASSES + 5] = 0x12; // word 5: high byte
    bytes[RANGE_CLASSES + words + 5] = 0x34; // low byte
    const table = decodeRanges(b64(bytes));
    expect(Array.from(table.order)).toEqual(identity);
    expect(table.eq).toHaveLength(words);
    expect(table.eq[5]).toBe(0x1234);
    expect(table.eq[6]).toBe(0);
    expect(() => decodeRanges(b64(bytes.slice(1)))).toThrow(/ranges: .* bytes/);
  });

  it('reads the pushfold blob: little-endian words, pushPct then callPct', () => {
    const bytes = new Uint8Array(PUSH_FOLD_BYTES);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 10_000, true);
    view.setUint16(2 * 119, 1234, true); // the last pushPct word
    view.setUint16(2 * 120, 4321, true); // the first callPct word
    const table = decodePushFold(b64(bytes));
    expect(table.push).toHaveLength(120);
    expect(table.call).toHaveLength(15);
    expect([table.push[0], table.push[119], table.call[0]]).toEqual([10_000, 1234, 4321]);
    expect(() => decodePushFold(b64(bytes.slice(2)))).toThrow(/pushfold: .* bytes/);
  });
});

describe('acceptance functions', () => {
  it('range acceptance fails an order that puts KK far from the top and 72o in the middle', () => {
    const problems = rangeAcceptance((cls) => rankPctFromOrder(identity)[cls] as number);
    expect(problems.some((p) => p.startsWith('KK '))).toBe(true);
    expect(problems.some((p) => p.startsWith('72o '))).toBe(true);
  });

  it('range acceptance passes when every criterion holds and reports a failure on each edge', () => {
    const at = (overrides: Record<string, number>) => (cls: number) =>
      overrides[className(cls)] ?? 50;
    const good: Record<string, number> = {};
    for (const name of ['AA', 'KK', 'QQ', 'JJ', 'AKs']) good[name] = 5;
    for (const name of ['88', '99', 'TT', 'ATs', 'AJs', 'AQs', 'KQs', 'AJo', 'AQo', 'AKo', 'KQo']) {
      good[name] = 15;
    }
    good['72o'] = 99;
    good['76s'] = 40;
    good['K2o'] = 41;
    expect(rangeAcceptance(at(good))).toEqual([]);
    expect(rangeAcceptance(at({ ...good, JJ: 5.01 }))).toHaveLength(1);
    expect(rangeAcceptance(at({ ...good, KQo: 15.01 }))).toHaveLength(1);
    expect(rangeAcceptance(at({ ...good, '72o': 98.99 }))).toHaveLength(1);
    expect(rangeAcceptance(at({ ...good, '76s': 41 }))).toHaveLength(1);
  });

  it('push/fold acceptance carries the five published spots of the plan', () => {
    expect(PUSH_FOLD_SPOTS.map((s) => [s.k, s.S, s.min, s.max])).toEqual([
      [1, 10, 55, 70],
      [2, 10, 35, 45],
      [3, 10, 28, 38],
      [5, 10, 18, 26],
      [8, 12, 10, 15],
    ]);
    const middle = (k: number, S: number): number => {
      const spot = PUSH_FOLD_SPOTS.find((s) => s.k === k && s.S === S);
      return spot === undefined ? 0 : (spot.min + spot.max) / 2;
    };
    expect(pushFoldAcceptance(middle)).toEqual([]);
    expect(pushFoldAcceptance(() => 0)).toHaveLength(5);
    expect(pushFoldAcceptance((k, S) => (k === 3 ? 27.99 : middle(k, S)))).toHaveLength(1);
  });
});
