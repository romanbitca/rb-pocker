// The coach speaks the PLAN's words (chunk 5.9): the strip and sheet words (§10.2, §12.6, §12.11,
// Appendix F.10), every Appendix F.1 template and its placeholder words, and every F.9 glossary
// line must appear verbatim in docs/PLAN.md. The copy is plain on purpose, for a reader whose
// first language is not English.
import { describe, expect, it } from 'vitest';
import type { ReasonCode } from '../../src/brain/types.ts';
import { coachText, coachWords, glossary } from '../../src/i18n/coachUi.ts';
import { en } from '../../src/i18n/en.ts';

const PLAN = Object.values(
  import.meta.glob<string>('../../../../docs/PLAN.md', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
)[0] as string;

/** The PLAN writes plain spaces where the app keeps "3 BB" on one line (U+00A0). */
const plain = (s: string): string => s.replace(/\u00A0/g, ' ');

/** Every placeholder as its own name: `{E}`, `{need}`, … (`Draw` is F.1's `{draw}`). */
const NAMES = new Proxy({} as Record<string, string>, {
  get: (_, key: string) => (key === 'Draw' ? '{draw}' : `{${key}}`),
});

describe('the coach’s words are the PLAN’s', () => {
  it('loaded the plan', () => {
    expect(PLAN.length).toBeGreaterThan(100_000);
  });

  it('the strip, the sheet and the action bar (§10.2, §12.6, §12.11, F.10)', () => {
    const w = coachWords;
    const words = [
      w.thinking,
      w.prefix,
      w.hint,
      w.why,
      w.openSheet,
      w.failed,
      w.pill,
      w.winNeed('45', '25'),
      w.pair('{eRandom}', '{eRange}'),
      w.close,
      w.doThis,
      w.clear,
      w.whyTitle,
      w.numbers,
      w.winAny('45'),
      w.winLikely('38'),
      w.need('25'),
      w.barGood,
      w.barBad,
      w.barLabel('{win line}', '{need}'),
      w.yourHand,
      w.nextRiver('x', 'y'),
      w.beaters('n', 'N'),
      w.whyNotTitle,
      w.learnMore,
      w.useSize,
      ...Object.values(w.strength),
      w.strengthLabel('{label}'),
      w.headline.fold,
      w.headline.call('40'),
      plain(w.headline.raise(w.size('60', '3'))),
      plain(w.size('{to}', '{bb}')),
      w.narrate.raise('Ben', '60'),
      w.narrate.fold('{name}'),
      w.narrate.check('{name}'),
      w.narrate.call('{name}', '{x}'),
      w.narrate.bet('{name}', '{x}'),
      w.narrate.raise('{name}', '{x}'),
      w.narrate.youFold,
      w.narrate.youCheck,
      w.narrate.youCall('{x}'),
      w.narrate.youBet('{x}'),
      w.narrate.youRaise('{x}'),
      w.narrate.allIn,
      en.coachUi.title,
      en.coachUi.badge,
      en.coachUi.chip,
      en.coachUi.chipName('{x}'),
    ];
    const missing = words.filter((word) => !PLAN.includes(word));
    expect(missing).toEqual([]);
  });

  it('every Appendix F.1 template, word for word', () => {
    const codes = Object.keys(coachText.reason) as ReasonCode[];
    expect(codes).toHaveLength(36);
    const missing = codes.filter(
      (code) => !PLAN.includes(`| ${code} | "${coachText.reason[code](NAMES)}" |`),
    );
    expect(missing).toEqual([]);
  });

  it('the words F.1’s placeholders map to, and F.2’s preflop names', () => {
    const words = [
      ...Object.values(coachText.example),
      ...Object.values(coachText.actionDescription),
      ...Object.values(coachText.guardrail),
    ].map((w) => `"${w}"`);
    words.push(
      coachText.pocket('{Ranks}'),
      coachText.suited('{Rank}', '{Rank}'),
      coachText.offsuit('{Rank}', '{Rank}'),
    );
    expect(words.filter((w) => !PLAN.includes(w))).toEqual([]);
  });

  it('every Appendix F.9 glossary line', () => {
    expect(glossary.length).toBe(33);
    const missing = glossary.filter((g) => !PLAN.includes(`| ${g.term} | ${g.text} |`));
    expect(missing).toEqual([]);
  });
});
