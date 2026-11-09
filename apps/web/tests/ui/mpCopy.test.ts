/**
 * The words of Play with friends (PLAN §19.10, Stage 10 acceptance 15): every string of
 * `i18n/mp.ts` appears in §19.10's table, and every quoted word of that table is in `i18n/mp.ts`
 * (or is one of the two that live elsewhere), so the two cannot drift apart.
 */
import { describe, expect, it } from 'vitest';
import { en } from '../../src/i18n/en.ts';
import { mpWords } from '../../src/i18n/mp.ts';
import { enStart } from '../../src/i18n/start.ts';
import { STAKES, TURN_SECONDS } from '../../src/net/protocol.ts';
import { formatChips } from '../../src/ui/format.ts';

const PLAN = Object.values(
  import.meta.glob<string>('../../../../docs/PLAN.md', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
)[0] as string;

/** §19.10, from its heading to the next one. */
const SECTION = PLAN.slice(
  PLAN.indexOf('### 19.10 Screens and words'),
  PLAN.indexOf('### 19.11 Headers'),
);
/** The table of the words, up to the paragraph after it. */
const TABLE = SECTION.slice(
  SECTION.indexOf('**The words.**'),
  SECTION.indexOf('**E2E fixture and test env'),
);

/** Stands for an argument, so a template can be matched against "{name}" in the plan. */
const HOLE = '\u0001';

/** Each string and template of the words, as written (`{}` for an argument), with its path. */
function words(value: unknown, path: string, out: { path: string; text: string }[]): void {
  if (typeof value === 'string') {
    out.push({ path, text: value });
  } else if (typeof value === 'function') {
    out.push({ path, text: (value as (arg: string) => string)(HOLE) });
  } else if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) words(inner, `${path}.${key}`, out);
  }
}

const ALL: { path: string; text: string }[] = [];
words(mpWords, 'mpWords', ALL);

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** "Table \u0001" as /"Table \{\w+\}"/, the way the plan writes a template. */
const inPlan = (text: string): RegExp =>
  new RegExp(`"${text.split(HOLE).map(escape).join('\\{\\w+\\}')}"`);

/** The words in the plan's table, each between double quotes. */
const QUOTED = [...TABLE.matchAll(/"([^"\n]+)"/g)].map((m) => m[1] as string);

/** What the table quotes that is said elsewhere: the first paint's word, F.10's voided-hand line. */
const ELSEWHERE = new Set<string>([enStart.playWithFriends, en.toast.handVoided]);

describe('i18n/mp.ts and §19.10', () => {
  it('finds the table and all its words', () => {
    expect(TABLE.length).toBeGreaterThan(1000);
    expect(ALL.length).toBeGreaterThan(50);
    expect(QUOTED.length).toBeGreaterThan(50);
  });

  it.each(ALL)('$path is in §19.10 word for word', ({ text }) => {
    expect(TABLE).toMatch(inPlan(text));
  });

  it('every word of the table is in i18n/mp.ts, or one of the two that live elsewhere', () => {
    const ours = ALL.map(
      ({ text }) => new RegExp(`^${text.split(HOLE).map(escape).join('\\{\\w+\\}')}$`),
    );
    const missing = QUOTED.filter(
      (word) => !ELSEWHERE.has(word) && !ours.some((re) => re.test(word)),
    );
    expect(missing).toEqual([]);
  });

  it("the first-paint word is §19.10's, and F.10's line is the one the table points at", () => {
    expect(enStart.playWithFriends).toBe('Play with friends');
    expect(TABLE).toContain(`"${enStart.playWithFriends}"`);
    expect(TABLE).toContain(`"${en.toast.handVoided}"`);
  });

  it('holds no secret pair: the two words of the footer are the disclaimers (§19.12)', () => {
    expect(mpWords.create.playMoney).toBe(enStart.legal.playMoneyOnly);
    expect(mpWords.create.noValue).toBe(enStart.legal.chipsHaveNoValue);
  });
});

describe('the words agree with the protocol (§19.4)', () => {
  it.each(Object.entries(STAKES))('the %s game says its real chips and blinds', (id, stakes) => {
    const detail = mpWords.create.games[id as keyof typeof STAKES].detail;
    expect(detail).toBe(`${formatChips(stakes.stack)} chips · blinds ${stakes.sb}/${stakes.bb}`);
  });

  it('there is a label for every time to act', () => {
    expect(Object.keys(mpWords.create.seconds).map(Number)).toEqual([...TURN_SECONDS]);
    for (const seconds of TURN_SECONDS) {
      expect(mpWords.create.seconds[seconds]).toBe(`${seconds} seconds`);
    }
  });

  it("the strip's words take the seconds", () => {
    expect(mpWords.strip.seconds(9)).toBe('9 s');
    expect(mpWords.strip.nextHand(4)).toBe('Next hand in 4 s');
  });
});
