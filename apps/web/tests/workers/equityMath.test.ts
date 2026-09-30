/**
 * equity.worker with the real maths (PLAN §6, §7; Stage 4 acceptance 1–2): the job runner and
 * `equityMath.ts` give the Appendix D values, progressive Monte Carlo replies, exact finals where
 * §7.2 says so, run-out equities that add up to 1, and bit-identical replies for identical
 * requests. (The maths itself is tested in tests/analysis.)
 */
import { describe, expect, it } from 'vitest';
import { parseCards, type Card } from '../../src/core/cards.ts';
import { handInfo, equityMath } from '../../src/workers/equityMath.ts';
import { createEquityService } from '../../src/workers/equityService.ts';
import type { EquityReply, EquityRequest } from '../../src/workers/protocol.ts';

const two = (s: string): [Card, Card] => parseCards(s) as [Card, Card];

/** Runs one request to its end in a fresh worker (no pauses: now() never moves). */
function run(req: EquityRequest): EquityReply[] {
  const posted: EquityReply[] = [];
  const service = createEquityService({
    math: equityMath,
    post: (reply) => posted.push(reply),
    now: () => 0,
  });
  service.handle(req);
  return posted;
}

describe('handInfo (§6)', () => {
  it('A♥K♥ on Q♥7♥2♣: 15 outs, exact next-card and by-river chances, D.3 flush chance', () => {
    const a = handInfo(two('Ah Kh'), parseCards('Qh 7h 2c'));
    expect(a.outs).toHaveLength(15);
    // The draw chips (D.2); backdoor draws are for the coach sheet only.
    const chips = a.draws.filter((d) => !d.kind.startsWith('backdoor')).map((d) => d.kind);
    expect(chips).toEqual(['nutFlush', 'overcards']);
    expect(a.nextCardPct).toBeCloseTo((100 * 15) / 47, 10);
    expect(a.byRiverPct).toBeCloseTo(100 * (1 - (32 * 31) / (47 * 46)), 10); // 54.1%
    expect(a.chances?.flush.exactly).toBeCloseTo(34.88, 2);
    expect(a.chances?.royalFlush.exactly).toBeCloseTo(0.09, 2);
    expect(a.beaters?.total).toBe(1081);
    expect(a.nuts).toBe(false);
  });

  it('preflop: no outs, no beaters; the chances wait for the finals table (chunk 4.4)', () => {
    const a = handInfo(two('2c 2d'), []);
    expect(a).toEqual({
      draws: [],
      outs: [],
      nextCardPct: null,
      byRiverPct: null,
      chances: null,
      beaters: null,
      nuts: false,
    });
  });

  it('on the river the chances are the made hand, and the nuts show', () => {
    const a = handInfo(two('Ah Kh'), parseCards('Qh Jh Th 2c 3d'));
    expect(a.nuts).toBe(true);
    expect(a.chances?.royalFlush.exactly).toBe(100);
    expect(a.outs).toEqual([]);
    expect(a.nextCardPct).toBeNull();
  });

  it('answers through the worker in one reply', () => {
    const replies = run({
      kind: 'handInfo',
      jobId: 3,
      epoch: 1,
      hero: two('9s 8s'),
      board: parseCards('Jd 7c 2h'),
    });
    expect(replies).toHaveLength(1);
    const [reply] = replies;
    expect(reply?.kind).toBe('handInfo');
    if (reply?.kind !== 'handInfo') return;
    expect(reply.analysis.chances?.straight.exactly).toBeCloseTo(17.95, 2); // D.3
    expect(reply.analysis.outs).toHaveLength(10); // D.2
  });
});

describe('equity (§7.2–7.3)', () => {
  it('Monte Carlo sends progress at 2,500 and 10,000, then the final', () => {
    const replies = run({
      kind: 'equity',
      jobId: 1,
      epoch: 2,
      hero: two('Ah Kh'),
      board: parseCards('Qh 7h 2c'),
      nOpp: 3,
    });
    const results = replies.map((r) => (r.kind === 'equity' ? r.result : null));
    expect(results.map((r) => r?.n)).toEqual([2_500, 10_000, 40_000]);
    expect(results.map((r) => r?.final)).toEqual([false, false, true]);
    for (const r of results) {
      expect(r?.exact).toBe(false);
      expect(r?.truncated).toBe(false);
      expect(r?.equity).toBe((r?.win ?? 0) + (r?.split ?? 0));
    }
  });

  it('heads-up on the river is exact: one final reply', () => {
    const replies = run({
      kind: 'equity',
      jobId: 1,
      epoch: 1,
      hero: two('Ah Kh'),
      board: parseCards('Qh 7h 2c 9d 3s'),
      nOpp: 1,
    });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      kind: 'equity',
      result: { n: 990, exact: true, final: true },
    });
  });

  it('identical requests give bit-identical replies (acceptance 2)', () => {
    const requests: EquityRequest[] = [
      {
        kind: 'equity',
        jobId: 1,
        epoch: 1,
        hero: two('Ah Kh'),
        board: parseCards('Qh 7h 2c'),
        nOpp: 3,
      },
      { kind: 'equity', jobId: 1, epoch: 1, hero: two('7c 2d'), board: [], nOpp: 5 },
      {
        kind: 'equity',
        jobId: 1,
        epoch: 1,
        hero: two('Qs Qd'),
        board: parseCards('9h 4c 2s 8d'),
        nOpp: 1,
      },
      { kind: 'equityKnown', jobId: 1, epoch: 1, hands: [two('As Ah'), two('Ks Kh')], board: [] },
    ];
    for (const req of requests) {
      const a = JSON.stringify(run(req));
      const b = JSON.stringify(run(structuredClone(req)));
      expect(b).toBe(a);
    }
    // The hero's cards in the other order: the same seed, the same number (§7.3).
    const swapped = run({
      ...(requests[0] as EquityRequest & { kind: 'equity' }),
      hero: two('Kh Ah'),
    });
    expect(JSON.stringify(swapped)).toBe(JSON.stringify(run(requests[0] as EquityRequest)));
  });
});

describe('equityKnown (§7.2 run-outs)', () => {
  it('preflop: 20,000 seeded trials with progress; A♠A♥ vs K♠K♥ is near C.2 (82.64%)', () => {
    const replies = run({
      kind: 'equityKnown',
      jobId: 1,
      epoch: 1,
      hands: [two('As Ah'), two('Ks Kh')],
      board: [],
    });
    expect(replies.map((r) => r.kind === 'equityKnown' && r.final)).toEqual([false, false, true]);
    const last = replies.at(-1);
    if (last?.kind !== 'equityKnown') throw new Error('no final run-out reply');
    expect(last.exact).toBe(false);
    expect(last.perPlayer[0]).toBeGreaterThan(0.8264 - 0.015);
    expect(last.perPlayer[0]).toBeLessThan(0.8264 + 0.015);
    expect((last.perPlayer[0] ?? 0) + (last.perPlayer[1] ?? 0)).toBeCloseTo(1, 9);
  });

  it('from the flop it is exact, three players add up to 1', () => {
    const replies = run({
      kind: 'equityKnown',
      jobId: 1,
      epoch: 1,
      hands: [two('Ah Kh'), two('Qs Qd'), two('9c 8c')],
      board: parseCards('Qh 7h 2c'),
    });
    expect(replies).toHaveLength(1);
    const [reply] = replies;
    if (reply?.kind !== 'equityKnown') throw new Error('no run-out reply');
    expect(reply.exact).toBe(true);
    expect(reply.final).toBe(true);
    expect(reply.perPlayer.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });
});
