import { describe, expect, it } from 'vitest';
import {
  BOT_LEVELS,
  COACH_LEVELS,
  PERSONALITY_IDS,
  STREETS,
  type HandState,
} from '../../src/engine/types.ts';
import { HAND_CATEGORIES } from '../../src/eval/evaluate.ts';
import {
  defaultFlags,
  defaultProfile,
  defaultSettings,
  emptyDecisionBucket,
  emptyHandMeta,
  emptyResultBucket,
  emptySeatStats,
  emptyStats,
  handRecordProblem,
  isBotLevel,
  isCoachLevel,
  isDecisionRecord,
  isEngineInput,
  isGrade,
  isHandCategory,
  isHandMeta,
  isHandRecord,
  isIsoDate,
  isLeakId,
  isPersonalityId,
  isProfile,
  isSeatStats,
  isSessionState,
  isSettings,
  isStats,
  isStreet,
  isTableState,
  parseJson,
  profileProblem,
  sessionStateProblem,
  settingsProblem,
  tableStateProblem,
  type Profile,
  type SessionState,
  type Settings,
} from '../../src/persist/schema.ts';
import { clone, foldedToBigBlind, handAtStart } from '../engine/fixtures.ts';
import { NOW, decision, handRecord, idleSession, midHandSession, tableFor } from './fixtures.ts';

/** A copy of `x` changed by `edit` (which may mutate the copy freely). */
function edited<T>(x: T, edit: (copy: T) => void): T {
  const copy = clone(x);
  edit(copy);
  return copy;
}

const loose = <T>(x: T): Record<string, unknown> => x as unknown as Record<string, unknown>;

describe('persist/schema defaults (schema defaults for every Profile field)', () => {
  it('pass their own guards and survive a JSON round trip deep-equal', () => {
    const profile = defaultProfile(NOW);
    expect(profileProblem(profile)).toBeNull();
    expect(isSettings(defaultSettings())).toBe(true);
    expect(isStats(emptyStats())).toBe(true);
    expect(isSeatStats(emptySeatStats())).toBe(true);
    expect(isHandMeta(emptyHandMeta())).toBe(true);
    expect(clone(profile)).toStrictEqual(profile);
  });

  it('are the §12.1 first-launch settings: you + 5 bots, 2,000 chips, 10/20, Easy, Beginner', () => {
    expect(defaultSettings()).toEqual({
      schema: 1,
      botLevel: 'easy',
      coachLevel: 'beginner',
      players: 6,
      startingStack: 2000,
      sb: 10,
      bb: 20,
      seatLevels: [null, null, null, null, null, null],
      speed: 'normal',
      autoNext: true,
      amounts: 'chips',
      showEquity: true,
      fourColour: true,
      textSize: 'normal',
      reduceMotion: 'system',
      keepAwake: true,
      sound: true,
      haptics: true,
      handsPanel: 'open',
    });
  });

  it('a new profile has nothing committed, empty stats and default flags', () => {
    const p = defaultProfile(NOW);
    expect(p).toMatchObject({
      schema: 1,
      rev: 0,
      lastCommittedHandSeq: 0,
      createdAt: '2026-09-28T10:00:00.000Z',
      updatedAt: '2026-09-28T10:00:00.000Z',
      persistGranted: null,
    });
    expect(p.heroModel).toEqual(emptySeatStats());
    expect(p.flags).toEqual({
      tips: {},
      iosInstall: false,
      safariImport: false,
      offlineReady: false,
      suggestionSnoozedUntil: { botsUp: null, botsDown: null, coachDown: null },
    });
  });

  it('the stats have one bucket per level, street, grade and hand category', () => {
    const s = emptyStats();
    expect(Object.keys(s.results.byBotLevel)).toEqual([...BOT_LEVELS]);
    expect(Object.keys(s.decisions.byCoachLevel)).toEqual([...COACH_LEVELS]);
    expect(Object.keys(s.decisions.byStreet)).toEqual([...STREETS]);
    expect(Object.keys(s.collection)).toEqual([...HAND_CATEGORIES]);
    expect(Object.keys(s.decisions.all.byGrade)).toEqual([
      'best',
      'good',
      'inaccuracy',
      'mistake',
      'blunder',
    ]);
    expect(s.results.clean).toEqual(emptyResultBucket());
    expect(s.decisions.all).toEqual(emptyDecisionBucket());
    expect(s.collection.royalFlush).toEqual({ count: 0, first: null });
  });

  it('every call returns fresh objects', () => {
    const a = defaultProfile(NOW);
    const b = defaultProfile(NOW);
    a.settings.seatLevels.push('hard');
    a.stats.results.byBotLevel.easy.hands = 5;
    a.stats.decisions.byStreet.flop.byGrade.best = 3;
    a.stats.collection.pair.count = 1;
    a.heroModel.vpip[0] = 9;
    a.flags.tips.first = true;
    expect(b).toStrictEqual(defaultProfile(NOW));
    expect(a.stats.results.byBotLevel.medium.hands).toBe(0);
    expect(defaultFlags()).not.toBe(defaultFlags());
  });
});

describe('persist/schema union guards match the engine and evaluator lists', () => {
  const cases: [readonly string[], (x: unknown) => boolean][] = [
    [BOT_LEVELS, isBotLevel],
    [COACH_LEVELS, isCoachLevel],
    [STREETS, isStreet],
    [PERSONALITY_IDS, isPersonalityId],
    [HAND_CATEGORIES, isHandCategory],
    [['best', 'good', 'inaccuracy', 'mistake', 'blunder'], isGrade],
  ];
  it.each(cases)('%j', (list, is) => {
    for (const x of list) expect(is(x)).toBe(true);
    for (const x of ['', 'pro', 'Easy', 'toString', '__proto__', 0, null, undefined, {}]) {
      expect(is(x)).toBe(false);
    }
  });

  it('leak ids', () => {
    expect(isLeakId('call-pre-wide')).toBe(true);
    expect(isLeakId('sizing')).toBe(true);
    expect(isLeakId('tilt')).toBe(false);
  });
});

describe('persist/schema settings guard (§3.2, §12.2)', () => {
  const valid = defaultSettings();
  const bad: [string, (s: Settings) => void, string][] = [
    ['one player', (s) => (s.players = 1), 'settings.players'],
    ['ten players', (s) => (s.players = 10), 'settings.players'],
    ['fractional players', (s) => (s.players = 2.5), 'settings.players'],
    ['players as text', (s) => (loose(s).players = '6'), 'settings.players'],
    ['odd big blind', (s) => ((s.bb = 21), (s.sb = 10.5)), 'settings.sb'],
    ['odd big blind, whole sb', (s) => ((s.bb = 22), (s.sb = 10), (s.bb = 21)), 'settings.bb'],
    ['sb not half the bb', (s) => (s.sb = 9), 'settings.sb: expected half the big blind (10)'],
    ['bb too big', (s) => (s.bb = 100_002), 'settings.bb'],
    ['stack below 200', (s) => (s.startingStack = 199), 'settings.startingStack'],
    ['stack below 10 bb', (s) => ((s.bb = 100), (s.sb = 50), (s.startingStack = 900)), '10 to 500'],
    ['stack above 500 bb', (s) => (s.startingStack = 10_020), 'settings.startingStack'],
    ['seat levels too short', (s) => s.seatLevels.pop(), 'settings.seatLevels: expected 6'],
    ['hero has a level', (s) => (s.seatLevels[0] = 'easy'), 'settings.seatLevels[0]'],
    ['unknown seat level', (s) => (loose(s.seatLevels)[3] = 'pro'), 'settings.seatLevels[3]'],
    ['unknown speed', (s) => (loose(s).speed = 'turbo'), 'settings.speed'],
    ['text for a flag', (s) => (loose(s).autoNext = 'yes'), 'settings.autoNext'],
    ['missing field', (s) => delete loose(s).handsPanel, 'settings.handsPanel'],
    ['newer schema', (s) => (loose(s).schema = 2), 'settings.schema'],
  ];
  it.each(bad)('rejects: %s', (_, edit, path) => {
    const s = edited(valid, edit);
    expect(isSettings(s)).toBe(false);
    expect(settingsProblem(s)).toContain(path);
  });

  it('rejects what is not a plain object', () => {
    class Box {
      v = 1;
    }
    for (const x of [null, undefined, [], 'settings', 6, new Date(), new Box()]) {
      expect(settingsProblem(x)).toBe('settings: expected an object');
    }
  });

  it('accepts the extremes of §3.2, custom values and unknown extra fields', () => {
    const extremes: Partial<Settings>[] = [
      { players: 2, seatLevels: [null, 'expert'], bb: 2, sb: 1, startingStack: 200 },
      { players: 9, seatLevels: Array.from({ length: 9 }, () => null) },
      { bb: 100_000, sb: 50_000, startingStack: 1_000_000 },
      { bb: 20, sb: 10, startingStack: 3500 },
    ];
    for (const change of extremes) expect(settingsProblem({ ...valid, ...change })).toBeNull();
    expect(isSettings({ ...valid, legacy: { theme: 'blue' } })).toBe(true);
  });
});

describe('persist/schema profile guard (A.7, H)', () => {
  const valid = (): Profile => defaultProfile(NOW);
  const bad: [string, (p: Profile) => void, string][] = [
    ['negative rev', (p) => (p.rev = -1), 'profile.rev'],
    ['fractional handSeq', (p) => (p.lastCommittedHandSeq = 1.5), 'profile.lastCommittedHandSeq'],
    ['a local time', (p) => (p.createdAt = '2026-09-28T10:00:00'), 'profile.createdAt'],
    ['not a time', (p) => (p.updatedAt = 'yesterday'), 'profile.updatedAt'],
    ['bad settings', (p) => (p.settings.players = 0), 'profile.settings.players'],
    ['stats schema', (p) => (loose(p.stats).schema = 0), 'profile.stats.schema'],
    [
      'a missing level bucket',
      (p) => delete loose(p.stats.results.byBotLevel).expert,
      'profile.stats.results.byBotLevel.expert',
    ],
    [
      'a negative grade count',
      (p) => (p.stats.decisions.byStreet.flop.byGrade.best = -1),
      'profile.stats.decisions.byStreet.flop.byGrade.best',
    ],
    [
      'a missing hand category',
      (p) => delete loose(p.stats.collection).royalFlush,
      'profile.stats.collection.royalFlush',
    ],
    [
      'an unknown leak',
      (p) => (loose(p.stats.leaks).tilt = { count: 1, lossMilliBB: 5 }),
      'profile.stats.leaks: unknown key "tilt"',
    ],
    [
      'a fractional net',
      (p) => (p.stats.results.clean.netChips = 0.5),
      'profile.stats.results.clean.netChips',
    ],
    ['a short pair', (p) => (loose(p.heroModel).vpip = [1]), 'profile.heroModel.vpip'],
    [
      'a bad snooze time',
      (p) => (p.flags.suggestionSnoozedUntil.botsUp = 'soon'),
      'profile.flags.suggestionSnoozedUntil.botsUp',
    ],
    [
      'a tip flag as text',
      (p) => (loose(p.flags.tips).heroStrip = 'yes'),
      'profile.flags.tips.heroStrip',
    ],
    ['persistGranted as text', (p) => (loose(p).persistGranted = 'yes'), 'profile.persistGranted'],
    [
      'a session summary with 12 players',
      (p) => {
        p.stats.currentSession = {
          start: '2026-09-28T09:00:00.000Z',
          end: '2026-09-28T10:00:00.000Z',
          hands: 3,
          netChips: -40,
          decisionScore: 82.5,
          mistakes: 1,
          blunders: 0,
          decisions: 7,
          botLevel: 'easy',
          coachLevel: 'beginner',
          players: 12,
          bb: 20,
        };
      },
      'profile.stats.currentSession.players',
    ],
  ];
  it.each(bad)('rejects: %s', (_, edit, path) => {
    const p = edited(valid(), edit);
    expect(isProfile(p)).toBe(false);
    expect(profileProblem(p)).toContain(path);
  });

  it('accepts a profile with played stats, leaks, sessions and recent hands', () => {
    const p = valid();
    p.rev = 412;
    p.lastCommittedHandSeq = 1287;
    p.stats.firstPlayedAt = '2026-09-01T08:00:00Z';
    p.stats.results.clean = {
      ...p.stats.results.clean,
      hands: 1150,
      netChips: -300,
      netMilliBB: -15000,
    };
    p.stats.results.clean.allInExpectedChips = 1200.5;
    p.stats.leaks = { chase: { count: 3, lossMilliBB: 2400 }, limp: { count: 1, lossMilliBB: -2 } };
    p.stats.collection.fullHouse = { count: 2, first: '2026-09-02T20:15:00.000Z' };
    p.stats.recentSessions = [
      {
        start: '2026-09-27T19:00:00.000Z',
        end: '2026-09-27T20:00:00.000Z',
        hands: 45,
        netChips: 640,
        decisionScore: null,
        mistakes: 4,
        blunders: 1,
        decisions: 60,
        botLevel: 'medium',
        coachLevel: 'intermediate',
        players: 6,
        bb: 20,
      },
    ];
    p.stats.recentHands = [
      {
        botLevel: 'easy',
        coachLevel: 'exam',
        assisted: false,
        netMilliBB: -500,
        scorePoints: 190,
        graded: 2,
      },
    ];
    p.heroModel = { ...p.heroModel, hands: 1287, vpip: [301, 1287] };
    p.persistGranted = true;
    p.flags.tips = { heroStrip: true, coachStrip: false };
    expect(profileProblem(p)).toBeNull();
    expect(clone(p)).toStrictEqual(p);
  });
});

describe('persist/schema table guard (A.3 TableState, §3.2, §9.3)', () => {
  const valid = tableFor(handAtStart({ stacks: [10000, 10000, 0, 30], button: 0 }));

  it('accepts a table (seats with no chips too) and round-trips it', () => {
    expect(tableStateProblem(valid)).toBeNull();
    expect(clone(valid)).toStrictEqual(valid);
  });

  const bad: [string, (t: typeof valid) => void, string][] = [
    ['fewer slots than seats', (t) => t.slots.pop(), 'table.slots: expected 4 seats'],
    ['the hero off seat 0', (t) => t.slots.reverse(), 'table.slots[0]: expected the hero'],
    [
      'a bot without personality',
      (t) => ((t.slots[2] as { personality: null }).personality = null),
      'table.slots[2]',
    ],
    [
      'a duplicate name',
      (t) => ((t.slots[3] as { name: string }).name = 'Anna'),
      '"Anna" is used twice',
    ],
    [
      'a duplicate id',
      (t) => ((t.slots[3] as { playerId: string }).playerId = 'bot-0'),
      '"bot-0" is used twice',
    ],
    [
      'a negative stack',
      (t) => ((t.slots[1] as { stack: number }).stack = -5),
      'table.slots[1].stack',
    ],
    [
      'a fractional stack',
      (t) => ((t.slots[1] as { stack: number }).stack = 2.5),
      'table.slots[1].stack',
    ],
    ['the button off the table', (t) => (t.button = 4), 'table.button'],
    ['the button below -1', (t) => (t.button = -2), 'table.button'],
    ['prevBB off the table', (t) => (t.prevBB = 4), 'table.prevBB'],
    ['handSeq 0', (t) => (t.nextHandSeq = 0), 'table.nextHandSeq'],
    ['blinds that do not match', (t) => (t.config.sb = 40), 'table.config.sb'],
    [
      'a level for the hero',
      (t) => (t.config.seatLevels[0] = 'hard'),
      'table.config.seatLevels[0]',
    ],
    ['an uppercase seed', (t) => (t.tableSeed = t.tableSeed.toUpperCase()), 'table.tableSeed'],
    ['no engine version', (t) => (t.engineVersion = ''), 'table.engineVersion'],
    ['a newer schema', (t) => (loose(t).schema = 2), 'table.schema'],
    ['ten seats', (t) => (t.config.seatCount = 10), 'table.config.seatCount'],
  ];
  it.each(bad)('rejects: %s', (_, edit, path) => {
    const t = edited(valid, edit);
    expect(isTableState(t)).toBe(false);
    expect(tableStateProblem(t)).toContain(path);
  });
});

describe('persist/schema decision records, inputs and hand meta', () => {
  it('accepts valid ones', () => {
    expect(isDecisionRecord(decision())).toBe(true);
    expect(isDecisionRecord(decision({ grade: null, leak: null, need: null }))).toBe(true);
    expect(
      isDecisionRecord(decision({ quiz: { correct: 1, of: 2 }, taken: { type: 'bet', to: 40 } })),
    ).toBe(true);
    for (const input of [
      { kind: 'advance' },
      { kind: 'act', seat: 8, action: { type: 'fold' } },
      { kind: 'act', seat: 0, action: { type: 'raise', to: 300 } },
      { kind: 'reshuffle', decisionId: 3, undoIndex: 0 },
    ]) {
      expect(isEngineInput(input)).toBe(true);
    }
  });

  it('rejects broken ones', () => {
    expect(isDecisionRecord(decision({ grade: 'great' as never }))).toBe(false);
    expect(isDecisionRecord(decision({ taken: { type: 'raise' } as never }))).toBe(false);
    expect(isDecisionRecord(decision({ rec: { type: 'bet', to: 0 } }))).toBe(false);
    expect(isDecisionRecord(decision({ eRandom: Number.NaN }))).toBe(false);
    expect(isDecisionRecord(decision({ lossMilliBB: 0.5 }))).toBe(false);
    expect(isDecisionRecord(decision({ quiz: { correct: -1, of: 2 } }))).toBe(false);
    for (const input of [
      { kind: 'jump' },
      { kind: 'act', seat: 9, action: { type: 'fold' } },
      { kind: 'act', seat: 0, action: { type: 'shove' } },
      { kind: 'act', seat: 0 },
      { kind: 'reshuffle', decisionId: 1 },
      null,
      'advance',
    ]) {
      expect(isEngineInput(input)).toBe(false);
    }
  });

  it('hand meta: hintShown is keyed by decision number', () => {
    const meta = emptyHandMeta();
    expect(isHandMeta({ ...meta, hintShown: { 0: true, 12: false } })).toBe(true);
    expect(isHandMeta({ ...meta, hintShown: { x: true } })).toBe(false);
    expect(isHandMeta({ ...meta, hintShown: { '01': true } })).toBe(false);
    expect(isHandMeta({ ...meta, hintShown: { 1: 'yes' } })).toBe(false);
    expect(isHandMeta({ ...meta, undoCount: -1 })).toBe(false);
  });
});

describe('persist/schema hand records (A.7, for Stage 8)', () => {
  it('accepts a record and round-trips it deep-equal', () => {
    const r = handRecord();
    expect(handRecordProblem(r)).toBeNull();
    expect(clone(r)).toStrictEqual(r);
  });

  it('rejects broken ones', () => {
    const r = handRecord();
    const cases: [(x: typeof r) => void, string][] = [
      [(x) => x.net.push(0), 'record.net: expected 2 numbers'],
      [(x) => (x.heroHole[1] = x.board[0] as number), 'a card appears twice'],
      [(x) => (loose(x).bestCategory = 'set'), 'record.bestCategory'],
      [
        (x) => x.inputs.push({ kind: 'act', seat: 5, action: { type: 'fold' } }),
        'record.inputs[3].seat',
      ],
      [(x) => (x.allIn = { expected: 10, actual: 0, pot: -1 }), 'record.allIn.pot'],
      [(x) => (x.commit = ''), 'record.commit'],
      [(x) => (x.board = [1, 2, 3, 4, 5, 6]), 'record.board'],
      [(x) => (x.handSeq = 0), 'record.handSeq'],
    ];
    for (const [edit, path] of cases) {
      const x = edited(r, edit);
      expect(isHandRecord(x)).toBe(false);
      expect(handRecordProblem(x)).toContain(path);
    }
  });
});

describe('persist/schema session guard (A.7 SessionState, §14.5)', () => {
  it('accepts a session between hands and one mid-hand, and round-trips them deep-equal', () => {
    const idle = idleSession(tableFor(handAtStart({ stacks: [2000, 2000, 2000], button: 1 })));
    const mid = midHandSession();
    for (const s of [idle, mid]) {
      expect(sessionStateProblem(s)).toBeNull();
      expect(clone(s)).toStrictEqual(s);
    }
  });

  it('accepts a complete hand still waiting for its commit', () => {
    const done = foldedToBigBlind().complete;
    const s: SessionState = { ...idleSession(tableFor(done)), hand: done };
    expect(sessionStateProblem(s)).toBeNull();
  });

  const bad: [string, (s: SessionState) => void, string][] = [
    [
      'a hand that breaks an invariant',
      (s) => ((s.hand as HandState).seats[0] as { stack: number }).stack++,
      'session.hand: I1 chip conservation',
    ],
    ['a hand that is not a hand', (s) => (loose(s).hand = { schema: 1 }), 'session.hand: I0'],
    [
      'a hand from another table (stacks)',
      (s) => ((s.table.slots[1] as { stack: number }).stack = 9000),
      'session.hand.startStacks[1]',
    ],
    [
      'a hand from another table (handSeq)',
      (s) => (s.table.nextHandSeq = 2),
      'session.hand.handSeq',
    ],
    [
      'a hand with other blinds',
      (s) => ((s.table.config.bb = 200), (s.table.config.sb = 100)),
      'session.hand: blinds 50/100',
    ],
    ['an undo snapshot without a hand', (s) => (s.hand = null), 'session.undoSnapshot'],
    [
      'an undo snapshot from the future',
      (s) => ((s.undoSnapshot as { inputCount: number }).inputCount = 4),
      'session.undoSnapshot.inputCount',
    ],
    [
      'a broken undo snapshot state',
      (s) => ((s.undoSnapshot as { state: HandState }).state.toAct = 5),
      'session.undoSnapshot.state',
    ],
    ['seat stats for the wrong seat count', (s) => s.seatStats.push(null), 'session.seatStats'],
    [
      'an input for a seat that does not exist',
      (s) => s.handInputs.push({ kind: 'act', seat: 2, action: { type: 'fold' } }),
      'session.handInputs[3].seat',
    ],
    ['a bad saved time', (s) => (s.savedAt = 'now'), 'session.savedAt'],
    ['a bad table', (s) => (s.table.config.seatCount = 3), 'session.table'],
    ['a newer schema', (s) => (loose(s).schema = 2), 'session.schema'],
  ];
  it.each(bad)('rejects: %s', (_, edit, path) => {
    const s = edited(midHandSession(), edit);
    expect(isSessionState(s)).toBe(false);
    expect(sessionStateProblem(s)).toContain(path);
  });
});

describe('persist/schema helpers', () => {
  it('parseJson never throws', () => {
    expect(parseJson('{"a":[1,null]}')).toEqual({ ok: true, value: { a: [1, null] } });
    for (const raw of ['', '{', '{"a":', 'undefined', "{'a':1}", '{"a":1}}']) {
      const parsed = parseJson(raw);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.problem).toMatch(/^not valid JSON/);
    }
  });

  it('isIsoDate accepts UTC ISO times only', () => {
    for (const t of ['2026-09-28T10:00:00.000Z', '2026-10-01T09:12:00Z', NOW.toISOString()]) {
      expect(isIsoDate(t)).toBe(true);
    }
    for (const t of [
      '2026-09-28',
      '2026-09-28T10:00:00',
      '2026-09-28T10:00:00+02:00',
      '2026-13-45T99:99:99Z',
      'now',
      0,
      null,
    ]) {
      expect(isIsoDate(t)).toBe(false);
    }
  });
});
