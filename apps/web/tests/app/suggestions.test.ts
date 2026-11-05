// Level suggestions (PLAN §10.4, chunk 8.4): the three rules at their exact thresholds, the full
// sample before a rule speaks, the coach sample from the ring, the 7-day snooze and the lazy
// chunk's tools. The controller's side is tests/app/controller.nudges.test.ts.
import { describe, expect, it, vi } from 'vitest';
import type { Grade } from '../../src/brain/types.ts';
import type { BotLevel, CoachLevel } from '../../src/engine/types.ts';
import {
  answered,
  botSuggestion,
  coachSample,
  coachSuggestion,
  snoozed,
  SUGGESTION,
  suggestionFor,
  suggestionTools,
} from '../../src/app/suggestions.ts';
import {
  defaultFlags,
  defaultProfile,
  defaultSettings,
  type HandRecord,
  type Profile,
  type RecentHand,
} from '../../src/persist/schema.ts';
import { decision, handRecord } from '../persist/fixtures.ts';

const NOW = new Date('2026-11-06T10:00:00.000Z');

/** `n` hands at `level`, each netting `net` milli-bb with one decision worth `points`. */
function hands(
  n: number,
  level: BotLevel,
  net: number,
  points: number,
  extra: Partial<RecentHand> = {},
): RecentHand[] {
  return Array.from({ length: n }, () => ({
    botLevel: level,
    coachLevel: 'beginner' as CoachLevel,
    assisted: false,
    netMilliBB: net,
    scorePoints: points,
    graded: 1,
    ...extra,
  }));
}

describe('bots up (§10.4): last 300 clean hands, ≥ +10 bb/100 and a decision score ≥ 80', () => {
  it('fires exactly at the thresholds: +10 bb/100 (100 milli-bb a hand) and a score of 80', () => {
    expect(botSuggestion(hands(300, 'easy', 100, 80), 'easy')).toEqual({
      rule: 'botsUp',
      from: 'easy',
      to: 'medium',
    });
    expect(botSuggestion(hands(300, 'hard', 100, 80), 'hard')).toMatchObject({ to: 'expert' });
  });

  it('is silent below either threshold, or before 300 clean hands', () => {
    expect(botSuggestion(hands(300, 'easy', 99, 80), 'easy')).toBeNull();
    expect(botSuggestion(hands(300, 'easy', 100, 79), 'easy')).toBeNull();
    expect(botSuggestion(hands(299, 'easy', 500, 100), 'easy')).toBeNull();
  });

  it('counts only clean hands (no Undo) at the table`s level, the last 300 of them', () => {
    const practice = hands(1, 'easy', 100_000, 100, { assisted: true });
    expect(botSuggestion([...hands(299, 'easy', 100, 80), ...practice], 'easy')).toBeNull();
    const old = hands(1, 'easy', 100, 80);
    expect(botSuggestion([...old, ...hands(299, 'easy', 100, 80), ...practice], 'easy')).toEqual(
      expect.objectContaining({ rule: 'botsUp' }),
    );
    // Hands at another level never count; old losing hands beyond the 300 do not either.
    expect(botSuggestion(hands(300, 'medium', 100, 80), 'easy')).toBeNull();
    const losing = hands(50, 'easy', -5000, 0);
    expect(botSuggestion([...losing, ...hands(300, 'easy', 100, 80)], 'easy')).not.toBeNull();
  });

  it('uses Σ points ÷ Σ graded: hands without a graded decision do not lower the score', () => {
    const mixed = [
      ...hands(150, 'easy', 100, 160, { graded: 2 }),
      ...hands(150, 'easy', 100, 0, { graded: 0 }),
    ];
    expect(botSuggestion(mixed, 'easy')).toMatchObject({ rule: 'botsUp' });
    // No graded decision at all: no score, no suggestion.
    expect(botSuggestion(hands(300, 'easy', 1000, 0, { graded: 0 }), 'easy')).toBeNull();
  });

  it('is not shown at Expert', () => {
    expect(botSuggestion(hands(300, 'expert', 5000, 100), 'expert')).toBeNull();
  });
});

describe('bots down (§10.4): last 200 hands, ≤ −30 bb/100 and a decision score < 60', () => {
  it('fires exactly at −30 bb/100 with a score just under 60', () => {
    expect(botSuggestion(hands(200, 'medium', -300, 59), 'medium')).toEqual({
      rule: 'botsDown',
      from: 'medium',
      to: 'easy',
    });
  });

  it('is silent at a score of 60, above −30 bb/100, or before 200 hands', () => {
    expect(botSuggestion(hands(200, 'medium', -300, 60), 'medium')).toBeNull();
    expect(botSuggestion(hands(200, 'medium', -299, 0), 'medium')).toBeNull();
    expect(botSuggestion(hands(199, 'medium', -5000, 0), 'medium')).toBeNull();
  });

  it('counts clean and practice hands alike', () => {
    const half = hands(100, 'hard', -300, 50, { assisted: true });
    expect(botSuggestion([...half, ...hands(100, 'hard', -300, 50)], 'hard')).toMatchObject({
      rule: 'botsDown',
      to: 'medium',
    });
  });

  it('is not shown at Easy', () => {
    expect(botSuggestion(hands(200, 'easy', -5000, 0), 'easy')).toBeNull();
  });
});

/** A ring record at `level` with these decisions (only the fields the coach rule reads matter). */
function record(
  level: CoachLevel,
  decisions: { grade: Grade | null; hintSeen?: boolean }[],
): HandRecord {
  return {
    ...handRecord(),
    coachLevel: level,
    decisions: decisions.map((d, i) =>
      decision({ decisionId: i + 1, grade: d.grade, hintSeen: d.hintSeen ?? false }),
    ),
  };
}

const grades = (best: number, inaccuracy: number, mistake: number): Grade[] => [
  ...Array<Grade>(best).fill('best'),
  ...Array<Grade>(inaccuracy).fill('inaccuracy'),
  ...Array<Grade>(mistake).fill('mistake'),
];

describe('coach down (§10.4): last 100 decisions without the hint, Best+Good ≥ 75%, Mistake+Blunder ≤ 5%', () => {
  it('fires at exactly 75 good and 5 bad of 100, one level less help', () => {
    expect(coachSuggestion(grades(75, 20, 5), 'intermediate')).toEqual({
      rule: 'coachDown',
      from: 'intermediate',
      to: 'advanced',
    });
    expect(coachSuggestion(grades(100, 0, 0), 'advanced')).toMatchObject({ to: 'exam' });
    expect(coachSuggestion(grades(100, 0, 0), 'beginner')).toMatchObject({ to: 'intermediate' });
  });

  it('is silent at 74 good, at 6 bad, before 100 decisions, and at Exam', () => {
    expect(coachSuggestion(grades(74, 21, 5), 'intermediate')).toBeNull();
    expect(coachSuggestion(grades(80, 14, 6), 'intermediate')).toBeNull();
    expect(coachSuggestion(grades(99, 0, 0), 'intermediate')).toBeNull();
    expect(coachSuggestion(grades(100, 0, 0), 'exam')).toBeNull();
  });

  it('reads only the newest 100 of a longer sample', () => {
    expect(coachSuggestion([...grades(100, 0, 0), ...grades(0, 0, 50)], 'advanced')).not.toBeNull();
  });

  it('the sample: graded decisions without the hint, outside Beginner, newest first', () => {
    const ring = [
      record('intermediate', [{ grade: 'blunder' }]),
      record('beginner', [{ grade: 'mistake', hintSeen: true }]),
      record('advanced', [
        { grade: 'good' },
        { grade: 'mistake', hintSeen: true },
        { grade: null },
        { grade: 'best' },
      ]),
    ];
    expect(coachSample(ring)).toEqual(['best', 'good', 'blunder']);
  });

  it('the sample stops at 100, from the newest hands', () => {
    const ring = [
      record(
        'intermediate',
        Array.from({ length: 60 }, () => ({ grade: 'blunder' as Grade })),
      ),
      record(
        'intermediate',
        Array.from({ length: 60 }, () => ({ grade: 'good' as Grade })),
      ),
      record(
        'intermediate',
        Array.from({ length: 60 }, () => ({ grade: 'best' as Grade })),
      ),
    ];
    const sample = coachSample(ring);
    expect(sample).toHaveLength(SUGGESTION.coach.decisions);
    expect(sample.filter((g) => g === 'blunder')).toHaveLength(0);
    expect(sample.slice(0, 60).every((g) => g === 'best')).toBe(true);
  });
});

describe('"Not now" and yes (§10.4: at most once per 7 days)', () => {
  it('"Not now" hides only that rule for 7 days', () => {
    const offer = { rule: 'botsUp', from: 'easy', to: 'medium' } as const;
    const flags = answered(defaultFlags(), offer, false, NOW);
    expect(flags.suggestionSnoozedUntil).toEqual({
      botsUp: '2026-11-13T10:00:00.000Z',
      botsDown: null,
      coachDown: null,
    });
    expect(snoozed(flags, 'botsUp', new Date('2026-11-13T09:59:59.999Z'))).toBe(true);
    expect(snoozed(flags, 'botsUp', new Date('2026-11-13T10:00:00.000Z'))).toBe(false);
    expect(snoozed(flags, 'botsDown', NOW)).toBe(false);
  });

  it('a yes to the bots hides both bot rules; a yes to the coach only the coach rule', () => {
    const bots = answered(
      defaultFlags(),
      { rule: 'botsDown', from: 'medium', to: 'easy' },
      true,
      NOW,
    );
    expect(bots.suggestionSnoozedUntil.botsUp).not.toBeNull();
    expect(bots.suggestionSnoozedUntil.botsDown).not.toBeNull();
    expect(bots.suggestionSnoozedUntil.coachDown).toBeNull();
    const coach = answered(
      defaultFlags(),
      { rule: 'coachDown', from: 'intermediate', to: 'advanced' },
      true,
      NOW,
    );
    expect(coach.suggestionSnoozedUntil).toMatchObject({
      botsUp: null,
      coachDown: expect.any(String),
    });
  });

  it('a hidden bot rule lets the coach rule speak; the bots come first otherwise', () => {
    const input = {
      recent: hands(300, 'easy', 100, 80),
      botLevel: 'easy' as const,
      coachLevel: 'intermediate' as const,
      sample: grades(100, 0, 0),
      flags: defaultFlags(),
      now: NOW,
    };
    expect(suggestionFor(input)).toMatchObject({ rule: 'botsUp' });
    const hidden = answered(
      defaultFlags(),
      { rule: 'botsUp', from: 'easy', to: 'medium' },
      false,
      NOW,
    );
    expect(suggestionFor({ ...input, flags: hidden })).toMatchObject({ rule: 'coachDown' });
    expect(suggestionFor({ ...input, flags: hidden, sample: null })).toBeNull();
  });
});

describe('suggestionTools (the lazy chunk the controller loads)', () => {
  function profileWith(own: number, recent: RecentHand[] = []): Profile {
    const p = defaultProfile(NOW);
    return {
      ...p,
      stats: {
        ...p.stats,
        recentHands: recent,
        decisions: { ...p.stats.decisions, all: { ...p.stats.decisions.all, own } },
      },
    };
  }

  function host(
    profile: Profile | null,
    ring: HandRecord[],
    coachLevel: CoachLevel = 'intermediate',
  ) {
    const state = { profile, coachLevel };
    const read = vi.fn(() => ring);
    const tools = suggestionTools({
      profile: () => state.profile,
      settings: () => ({ ...defaultSettings(), coachLevel: state.coachLevel }),
      hands: read,
      now: () => NOW,
    });
    return { tools, read, state };
  }

  const goodRing = [
    record(
      'intermediate',
      Array.from({ length: 100 }, () => ({ grade: 'best' as Grade })),
    ),
  ];

  it('works out the card once per profile and levels, and reads the ring only when it can matter', () => {
    const { tools, read, state } = host(profileWith(99), goodRing);
    expect(tools.current()).toBeNull();
    tools.counted(null);
    expect(read).not.toHaveBeenCalled(); // 99 decisions without the hint: the rule cannot fire
    state.profile = profileWith(100);
    tools.counted(null);
    expect(read).toHaveBeenCalledTimes(1);
    const card = tools.current();
    expect(card).toEqual({ rule: 'coachDown', from: 'intermediate', to: 'advanced' });
    expect(tools.current()).toBe(card); // the same answer while nothing changed
    tools.counted(null);
    expect(read).toHaveBeenCalledTimes(1); // read once
  });

  it('a counted hand joins the sample in front; forget() reads the ring again', () => {
    const { tools, read } = host(profileWith(150), goodRing);
    tools.counted(null);
    expect(tools.current()).toMatchObject({ rule: 'coachDown' });
    tools.counted(
      record(
        'advanced',
        Array.from({ length: 6 }, () => ({ grade: 'blunder' as Grade })),
      ),
    );
    expect(tools.current()).toBeNull(); // 6 blunders among the newest 100
    tools.forget();
    tools.counted(null);
    expect(read).toHaveBeenCalledTimes(2);
    expect(tools.current()).toMatchObject({ rule: 'coachDown' });
  });

  it('no read at Exam or while the coach rule is hidden; nothing without a writable profile', () => {
    const exam = host(profileWith(500), goodRing, 'exam');
    exam.tools.counted(null);
    expect(exam.read).not.toHaveBeenCalled();
    const p = profileWith(500);
    const hidden = {
      ...p,
      flags: answered(
        p.flags,
        { rule: 'coachDown', from: 'intermediate', to: 'advanced' },
        false,
        NOW,
      ),
    };
    const snoozedHost = host(hidden, goodRing);
    snoozedHost.tools.counted(null);
    expect(snoozedHost.read).not.toHaveBeenCalled();
    const none = host(null, goodRing);
    none.tools.counted(null);
    expect(none.tools.current()).toBeNull();
  });

  it('answer: a yes gives the level patch and the snooze; "Not now" only the snooze', () => {
    const { tools } = host(profileWith(0, hands(300, 'easy', 100, 80)), []);
    const offer = tools.current();
    expect(offer).toEqual({ rule: 'botsUp', from: 'easy', to: 'medium' });
    if (offer === null) return;
    expect(tools.answer(offer, true).patch).toEqual({ botLevel: 'medium' });
    expect(tools.answer(offer, false).patch).toBeNull();
    expect(tools.answer(offer, false).flags.suggestionSnoozedUntil.botsUp).toBe(
      '2026-11-13T10:00:00.000Z',
    );
    const coach = { rule: 'coachDown', from: 'advanced', to: 'exam' } as const;
    expect(tools.answer(coach, true).patch).toEqual({ coachLevel: 'exam' });
  });
});
