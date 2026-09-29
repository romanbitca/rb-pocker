import { describe as suite, expect, it } from 'vitest';
import { describe } from '../../../src/eval/describe.ts';
import { previewBoard, previewSeats, SAMPLE } from '../../../src/ui/dev/fixtures.ts';

suite('dev preview fixtures', () => {
  it('state the sample hand exactly as describe() does', () => {
    const river = describe(SAMPLE.hole, [...SAMPLE.board]);
    expect({
      category: river.category,
      best5: river.best5,
      core: river.core,
      kickers: river.kickers,
    }).toEqual(SAMPLE.river);

    const flop = describe(SAMPLE.hole, SAMPLE.board.slice(0, 3));
    expect({
      category: flop.category,
      best5: flop.best5,
      core: flop.core,
      kickers: flop.kickers,
    }).toEqual(SAMPLE.flop);
  });

  it('highlight the board like §6.1: core raised, kickers outlined, the rest dimmed', () => {
    expect(previewBoard('river').map((c) => c.highlight)).toEqual([
      'kicker', // Qh
      'kicker', // 7h
      'off', // 2h
      'core', // Kd
      'off', // 4s
    ]);
    expect(previewBoard('preflop')).toEqual([]);
  });

  it('give every seat count a full set of seats with distinct cards', () => {
    for (let m = 1; m <= 8; m++) {
      const seats = previewSeats(m, 'showdown');
      expect(seats.map((s) => s.seat)).toEqual(Array.from({ length: m }, (_, i) => i + 1));
      const shown = seats.flatMap((s) => (s.cards.kind === 'revealed' ? s.cards.cards : []));
      const all = [...SAMPLE.hole, ...SAMPLE.board, ...shown.map((c) => c.card)];
      expect(new Set(all).size).toBe(all.length);
    }
  });
});
