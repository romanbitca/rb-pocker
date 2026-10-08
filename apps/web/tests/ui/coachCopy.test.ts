// The coach speaks the PLAN's words (chunk 5.9): the strip and sheet words (§10.2, §12.6, §12.11,
// Appendix F.10) must appear verbatim in docs/PLAN.md. (The F.1 templates and the F.9 glossary are
// chunk 5.6's, checked by its tests and `check-copy`; chunk 5.7 removed the 5.9 stand-in copies.) The copy is plain on purpose, for a reader whose
// first language is not English.
import { describe, expect, it } from 'vitest';
import { coachWords } from '../../src/i18n/coachUi.ts';
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
});
