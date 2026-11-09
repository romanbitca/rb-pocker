// The screens use the PLAN's own words (Appendix F.10, G.1, §10.1, §12.1–§12.5, §12.11, §18):
// every string below must appear verbatim in docs/PLAN.md. The copy is plain on purpose, for a
// reader whose first language is not English.
import { describe, expect, it } from 'vitest';
import { en } from '../../../src/i18n/en.ts';
import { coachWords } from '../../../src/i18n/coachUi.ts';
import { dataWords as D } from '../../../src/i18n/data.ts';
import { deviceWords } from '../../../src/i18n/device.ts';
import { learnWords as W } from '../../../src/i18n/learn.ts';
import { statsWords } from '../../../src/i18n/stats.ts';
import { suggestionWords } from '../../../src/i18n/suggestions.ts';
import { quizWords } from '../../../src/i18n/quiz.ts';
import { shortcutWords } from '../../../src/i18n/shortcuts.ts';
import { summaryWords } from '../../../src/i18n/summary.ts';
import { drillWords } from '../../../src/i18n/drill.ts';
import { tipWords } from '../../../src/i18n/tips.ts';
import { whichWinsWords } from '../../../src/i18n/whichWins.ts';
import { enReview } from '../../../src/i18n/review.ts';

const PLAN = Object.values(
  import.meta.glob<string>('../../../../../docs/PLAN.md', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
)[0];

/** Renders a template with the PLAN's placeholder names, e.g. "Reload {startingStack} chips". */
const placeholder = (name: string) => `{${name}}`;

const PLAN_WORDS: Record<string, string> = {
  'app.tagline': en.app.tagline,
  'welcome.play': en.welcome.play,
  'welcome.setup': en.welcome.setup,
  'welcome.guide': en.welcome.guide,
  'home.newTable': en.home.newTable,
  'home.session': [
    en.home.session.hand(0).replace('0', placeholder('n')),
    en.home.session.players(0).replace('0', placeholder('players')),
    en.home.session.chips(placeholder('chips')),
    en.home.session.bots(placeholder('botLevel')),
    en.home.session.coach(placeholder('coachLevel')),
  ].join(en.home.session.separator),
  'legal.playMoneyOnly': en.legal.playMoneyOnly,
  'setup footer': `${en.legal.playMoneyOnly} ${en.legal.chipsHaveNoValue}`,
  'setup.title': en.setup.title,
  'setup.players.question': en.setup.players.question,
  'setup.players.caption': en.setup.players.caption(5),
  'setup.chips.range': en.setup.chips.range,
  'setup.depth.caption': en.setup.depth.caption('2,000', '100'),
  'setup.depth.short': en.setup.depth.short,
  'setup.depth.deep': en.setup.depth.deep,
  'setup.depth.tooShallow': en.setup.depth.tooShallow,
  'setup.depth.tooDeep': en.setup.depth.tooDeep,
  'setup.bots.question': en.setup.bots.question,
  'setup.coach.question': en.setup.coach.question,
  'setup.start': en.setup.start,
  'levels.comingSoon': en.levels.comingSoon,
  'menu.topUp': en.menu.topUp(placeholder('startingStack')),
  'menu.leaveTable': en.menu.leaveTable,
  'menu.rankings': en.menu.rankings,
  'dialog.outOfChips.text': en.dialog.outOfChips.text,
  'dialog.outOfChips.reload': en.dialog.outOfChips.reload(placeholder('startingStack')),
  'dialog.outOfChips.changeTable': en.dialog.outOfChips.changeTable,
  'dialog.newTable.text': en.dialog.newTable.text,
  // The Stage 3 words listed in Appendix F.10 ("Screens, plain words…").
  back: `"${en.back}"`,
  'setup.chips.question': `"${en.setup.chips.question}"`,
  'setup.blinds.question': `"${en.setup.blinds.question}"`,
  'setup.custom': `"${en.setup.custom}"`,
  'setup.blinds.bigBlind': `"${en.setup.blinds.bigBlind}"`,
  'setup.blinds.smallBlind': `"${en.setup.blinds.smallBlind(placeholder('sb'))}"`,
  'setup.blinds.range': `"${en.setup.blinds.range}"`,
  'settings.game': `"${en.settings.game}"`,
  'settings.speed': `"${en.settings.speed.label}" (${en.settings.speed.normal} · ${en.settings.speed.fast} · ${en.settings.speed.instant}; "${en.settings.speed.hint}")`,
  'settings.autoNext': `"${en.settings.autoNext.label}" ("${en.settings.autoNext.hint}")`,
  'settings.amounts': `"${en.settings.amounts.label}" (${en.settings.amounts.chips} · ${en.settings.amounts.bb}; "${en.settings.amounts.hint}")`,
  // Chunk 9.1: sounds, vibration and keeping the screen on (§12.1, §12.3, F.10).
  'device.display': `Settings "${deviceWords.display}" with "${deviceWords.keepAwake.label}" ("${deviceWords.keepAwake.hint}"; where the page cannot keep it on, "${deviceWords.keepAwake.insecure}" or "${deviceWords.keepAwake.missing}" after it)`,
  'device.sound': `"${deviceWords.soundSection}" with "${deviceWords.sound.label}" ("${deviceWords.sound.hint}") and "${deviceWords.vibration.label}" ("${deviceWords.vibration.hint}")`,
  'device.mute': `the top bar's mute button is named "${deviceWords.muteButton}" (pressed while sound is on)`,
  'device.menu': `"${deviceWords.menu.soundOff}" · "${deviceWords.menu.soundOn}"`,
  'dialog.newTable buttons': `"${en.dialog.newTable.confirm}" · "${en.dialog.newTable.cancel}"`,
  'menu.resume': en.menu.resume,
  'menu.newTable': en.menu.newTable,
  // The mistake feedback card and Undo (§11, §12.6, Appendix F.4, F.5, F.10; chunk 6.2).
  'toast.undone': `Undo: "${en.toast.undone}"`,
  'feedback buttons': `Buttons: "${en.feedback.undo}" · "${en.feedback.keep}". Small print: "${en.feedback.smallPrint}"`,
  // Why [Undo: try again] is grey, in place of the small print (§11.3 notes, F.5; 1.3.86).
  'feedback.undoBlocked': `"${en.feedback.undoUsed}" (the decision was taken back once: §11.3 rule 2) · "${en.feedback.undoOver}" · "${en.feedback.undoNot}"`,
  'feedback.coachMove': `"${en.feedback.coachMove('Call 40')}"`,
  ...Object.fromEntries(
    (['inaccuracy', 'mistake', 'blunder'] as const).map((grade) => [
      `feedback.title.${grade}`,
      `| "${en.feedback.title[grade]}" |`,
    ]),
  ),
  ...Object.fromEntries(
    Object.entries(en.levels.botText).map(([level, text]) => [`levels.botText.${level}`, text]),
  ),
  ...Object.fromEntries(
    Object.entries(en.levels.coachText).map(([level, text]) => [
      `levels.coachText.${level}`,
      `"${text}"`,
    ]),
  ),
  // Chunk 5.10: the Settings level rows and the bot card (Appendix F.10, F.6, §9.3).
  'settings.coachLevel': `"${en.settings.coachLevel.label}" ("${en.settings.coachLevel.hint}")`,
  'settings.botLevel': `"${en.settings.botLevel.label}" ("${en.settings.botLevel.hint}")`,
  'botCard.close': `"${en.botCard.close}"`,
  'botCard.howToBeat': `"${en.botCard.howToBeat}"`,
  'botCard.stack': `"${en.botCard.stack(placeholder('x'))}"`,
  'botCard.unknownStyle': `"${en.botCard.unknownStyle}`,
  // Chunk 7.1: what a Hard or Expert bot card says the player has seen (§9.3, F.10).
  'botCard.seenIntro': `"${en.botCard.seenIntro}"`,
  'botCard.notSeenYet': `"${en.botCard.notSeenYet}"`,
  'botCard.seen line': `"${[en.botCard.plays(34), en.botCard.raises(20), en.botCard.aggression.betsOften].join(en.botCard.separator)}"`,
  'botCard.aggression': `"${en.botCard.aggression.betsOften}" · "${en.botCard.aggression.betsSometimes}" · "${en.botCard.aggression.mostlyCalls}"`,
  'botCard.handsSeen': `"${en.botCard.handsSeen(placeholder('n'))}"`,
  // Chunk 7.2: the per-seat levels (§9.3, Appendix F.10).
  'botCard.level': `the group "${en.botCard.level.legend}" with the choices "${en.botCard.level.sameAsTable(placeholder('level'))}" · "${en.levels.bot.easy}" · "${en.levels.bot.medium}" · "${en.levels.bot.hard}" · "${en.levels.bot.expert}" and the line "${en.botCard.level.hint}"`,
  'setup.more.title': `a button "${en.setup.more.title}" that opens`,
  'setup.more.bots': `"${en.setup.more.bots.legend}" ("${en.setup.more.bots.hint}", one row "${en.setup.more.bots.bot(0).replace('0', placeholder('n'))}" per bot, "${en.setup.more.bots.sameAsTable(placeholder('level'))}" first)`,
  'setup.more.fourColour': `"${en.setup.more.fourColour.label}" ("${en.setup.more.fourColour.hint}")`,
  'setup.more.ownLevels': `the lines "${en.setup.more.ownLevels(1)}" · "${en.setup.more.ownLevels(2).replace('2', placeholder('n'))}"`,
  'settings.botLevel.own': `"${en.settings.botLevel.own(1)}" · "${en.settings.botLevel.own(2).replace('2', placeholder('n'))}"`,
  // feature/stage-9-follow-ups: a leak's lesson link on Stats (§8.9 "Lesson links", F.10).
  'stats.lessonLink': `each leak's lesson link "${statsWords.progress.lessonLink(0, placeholder('title')).replace('0', placeholder('n'))}" ("${statsWords.progress.lessonLink(6, statsWords.lessons[6])}"`,
  ...Object.fromEntries(
    Object.entries(en.personality).map(([id, name]) => [`personality.${id}`, `| ${name} |`]),
  ),
  ...Object.fromEntries(
    Object.entries(en.personalityText).flatMap(([id, t]) => [
      [`personalityText.${id}.description`, `"${t.description}"`],
      [`personalityText.${id}.tip`, `"${t.tip}"`],
    ]),
  ),
};

describe('screen copy comes from docs/PLAN.md', () => {
  it('loaded the plan', () => {
    expect(PLAN?.length ?? 0).toBeGreaterThan(100_000);
  });

  it.each(Object.entries(PLAN_WORDS))('%s', (_key, words) => {
    expect(PLAN).toContain(words);
  });

  // Chunk 6.4 (§10.2, §10.3, §12.9, §13.2, F.10): the coach levels' words, each quoted in PLAN.
  it.each(
    Object.entries({
      hintExam: `"${coachWords.hintExam}"`,
      quizFirst: `"${en.actions.quizFirst}"`,
      whichWins: `"${en.rankings.whichWins}"`,
      quizQuestions: Object.values(quizWords.questions).map((q) => `"${q}"`),
      quizChoices: [
        ...quizWords.choices.win,
        ...quizWords.choices.need,
        ...quizWords.choices.move,
      ].map((c) => `[${c}]`),
      quizStep: `"${quizWords.step(0, 0).replace(/0/, '{i}').replace(/0/, '{n}')}"`,
      quizScore: `"${quizWords.score(0, 0).replace(/0/, '{correct}').replace(/0/, '{of}')}"`,
      quizRight: [
        quizWords.right.win('{band}'),
        quizWords.right.need('{band}'),
        quizWords.right.move('{moves}'),
      ].map((w) => `"${w}"`),
      summaryTitle: `"${summaryWords.title('{n}', '{net}')}"`,
      summary: [
        summaryWords.exam,
        summaryWords.score(0).replace('0', '{score}'),
        ...Object.values(summaryWords.streets),
        summaryWords.did.fold,
        summaryWords.did.check,
        summaryWords.did.call,
        summaryWords.did.bet('{x}'),
        summaryWords.did.raise('{x}'),
        summaryWords.coach.fold,
        summaryWords.coach.check,
        summaryWords.coach.call,
        summaryWords.coach.bet('{x}'),
        summaryWords.coach.raise('{x}'),
        summaryWords.numbers('{win}', '{need}'),
        summaryWords.win('{win}'),
        summaryWords.undone,
        summaryWords.noGrade,
        summaryWords.review,
        summaryWords.next,
      ].map((w) => `"${w}"`),
      whichWinsQuiz: [
        whichWinsWords.ask,
        whichWinsWords.hand(1, '{cards}'),
        whichWinsWords.hand(2, '{cards}'),
        whichWinsWords.right,
        whichWinsWords.wrong,
        whichWinsWords.beats('{winner}', '{loser}'),
        whichWinsWords.same('{name}'),
        whichWinsWords.score(0, 0).replace(/0/, '{right}').replace(/0/, '{asked}'),
        whichWinsWords.next,
      ].map((w) => `"${w}"`),
    }),
  )('6.4 %s', (_key, words) => {
    for (const w of Array.isArray(words) ? words : [words]) expect(PLAN).toContain(w);
  });

  // Chunk 8.4 (§10.4, §12.11, §12.13, §14.8, §4.5, F.10): Settings → Data, Diagnostics, the Data
  // dialogs, the install cards and the level suggestion card, each quoted in PLAN.
  it.each(
    Object.entries({
      data: [
        D.title,
        D.saved,
        D.export.label,
        D.export.hint,
        D.import.label,
        D.import.hint,
        D.reset.label,
        D.reset.hint,
        D.protectedYes,
        D.protectedNo,
        D.protectedHint,
      ].map((w) => `"${w}"`),
      importDialog: [
        D.importTitle,
        D.reading,
        D.preview('{n}', false, '{date}'),
        D.replaceText,
        D.handCancelled,
        D.replace,
        D.cancel,
        ...Object.values(D.failed),
        D.ok,
      ].map((w) => `"${w}"`),
      resetDialog: [D.resetTitle, D.resetText, D.deleteMyStats].map((w) => `"${w}"`),
      diagnostics: [
        D.diagnostics.title,
        D.diagnostics.since,
        D.diagnostics.errors,
        D.diagnostics.voided,
        D.diagnostics.fallbacks,
        `${D.diagnostics.off} {features}.`,
        D.diagnostics.allOn,
        ...Object.values(D.diagnostics.features),
        D.diagnostics.export,
        D.diagnostics.exportHint,
      ].map((w) => `"${w}"`),
      nudges: [
        `"${en.nudge.iosTip}" | [${en.nudge.gotIt}]`,
        `"${en.nudge.installCard}" | [${en.nudge.installNow}] [${en.nudge.notNow}]`,
        `"${en.nudge.safariImport}" | [${en.nudge.import}] [${en.nudge.skip}]`,
      ],
      toasts: [`toast "${en.toast.debugCopied}"`, en.storage.banner],
      suggestions: [
        `"${suggestionWords.botsUp('{Easy}', '{Medium}')}"`,
        `"${suggestionWords.botsDown}"`,
        `"${suggestionWords.coachDown}"`,
        `[${suggestionWords.accept('{level}')}]`,
        `[${suggestionWords.notNow}]`,
      ],
    }),
  )('8.4 %s', (_key, words) => {
    for (const w of words) expect(PLAN).toContain(w);
  });

  // Chunk 9.2 (§12.1, Appendix F.10): Learn's own words, each quoted in PLAN.
  it.each(
    Object.entries({
      list: [W.title, W.lessons, W.more, W.rankings, W.glossary, W.drill],
      lessonName: W.lessonName(0, '{title}').replace('0', '{n}'),
      hints: [W.rankingsHint, W.glossaryHint],
      lesson: [
        W.lessonOf(1, 2).replace('1', '{n}').replace('2', '{of}'),
        W.next('{title}'),
        W.allLessons,
        W.seeRankings,
      ],
      price: [
        W.price(1, 2).replace('1', '{win}').replace('2', '{need}'),
        W.priceLabel(1, 2).replace('1', '{win}').replace('2', '{need}'),
      ],
      notCounted: W.notCounted('{card}'),
      glossary: [W.search, W.matches(2).replace('2', '{n}'), W.matches(1), W.noMatch],
      waiting: [en.screens.loading, en.screens.loadFailed, en.back],
    }),
  )('9.2 %s', (_key, words) => {
    for (const w of Array.isArray(words) ? words : [words]) expect(PLAN).toContain(`"${w}"`);
  });

  // The hand drill (§13.5): every word of `i18n/drill.ts` is in the F.10 line, quoted, with the
  // plan's placeholder names.
  it('the hand drill speaks the words of F.10', () => {
    const W = drillWords;
    const A = W.answer;
    const Y = W.why;
    const words: string[] = [
      'Hand drill',
      W.streak,
      W.score,
      W.best,
      W.scoreValue(0, 0).replace(/^0/, '{right}').replace(/0$/, '{answered}'),
      W.choose,
      W.allHands,
      W.stats,
      W.hand,
      W.pickOne,
      W.position,
      W.ladder,
      W.positionName(0).replace('0', '{n}'),
      W.keyboard,
      W.next,
      W.table,
      W.yourHand,
      W.you,
      W.opponent,
      W.handA,
      W.handB,
      W.stronger,
      W.weaker,
      W.trap,
      W.thisRound,
      ...Object.values(W.games).flatMap((g) => [g.name, g.desc]),
      ...Object.values(W.difficulties).flatMap((d) => [d.name, d.desc]),
      W.gamesTitle,
      W.difficulty,
      W.game,
      W.playing,
      W.close,
      ...Object.values(W.prompts),
      ...Object.values(W.hints),
      ...Object.values(W.options),
      A.right('{name}', 0).replace('0', '{pos}'),
      A.itIs('{name}', 0).replace('0', '{pos}'),
      A.nameWrong('{name}'),
      A.uses(0),
      A.uses(1),
      A.uses(2),
      A.pickedPosition(0, '{name}').replace('0', '{pos}'),
      A.both('{target}', 0, '{name}', 1).replace('0', '{tpos}').replace('1', '{pos}'),
      A.correct('{result}'),
      A.splitPot,
      A.youWin,
      A.opponentWins,
      A.legend,
      Y.rows('{w}', 0, '{l}', 1).replace('0', '{wpos}').replace('1', '{lpos}'),
      Y.split('{name}', true),
      Y.straight(false, '{A}', '{B}', true),
      Y.fullHouse('{As}', '{Bs}'),
      Y.twoPairSecond('{Mains}', '{As}', '{Bs}'),
      Y.pairKicker('{Mains}', true, '{A}', '{B}'),
      Y.nthCard(true, 3, '{A}', '{B}'),
      ...Object.values(W.traps).map((t) => (typeof t === 'function' ? t('{Ranks}') : t)),
      W.statsTitle,
      W.notSeen,
      W.reset,
      W.resetConfirm,
      W.statsRowNone('{name}'),
    ];
    for (const w of words) expect(PLAN).toContain(`"${w}"`);
  });

  // Chunk 9.3 (§12.11, §12.5 notes): the first-table tips word for word, and the keys' list.
  it.each(Object.entries(tipWords))('9.3 tip %s', (_key, words) => {
    expect(PLAN).toContain(`"${words}"`);
  });

  it('9.3 the "Keyboard shortcuts" list, its note and its Close', () => {
    const rows = shortcutWords.rows.map(([keys, what]) => `${keys} ${what}`).join(' · ');
    expect(PLAN).toContain(
      `opens "${shortcutWords.title}", a dialog (\`components/ShortcutsDialog.tsx\``,
    );
    expect(PLAN).toContain(`"${rows}", then "${shortcutWords.note}" and [${shortcutWords.close}]`);
    expect(PLAN).toContain(`The Menu's "${shortcutWords.title}" opens it too`);
  });

  // 1.3.92 (§12.9, F.10): the hand-end banner's button that opens the summary, quoted in PLAN; the
  // sheet's Exam heading is the same words.
  it('1.3.92 the banner`s "Hand summary" and "Exam result"', () => {
    for (const w of [en.handEnd.summary, en.handEnd.examResult]) expect(PLAN).toContain(`"${w}"`);
    expect(summaryWords.exam).toBe(en.handEnd.examResult);
  });

  // Chunk 9.4 (§16.3, F.10): Review's "Check the shuffle" row, each string quoted in PLAN.
  it.each(Object.entries(enReview.shuffle))('9.4 shuffle.%s', (_key, words) => {
    expect(PLAN).toContain(`"${words}"`);
  });

  it('the Welcome bullets are the four §12.1 bullets, capitalised', () => {
    const joined = en.welcome.bullets
      .map((b) => b.charAt(0).toLowerCase() + b.slice(1))
      .join(' · ');
    expect(PLAN).toContain(`Four short bullets (${joined})`);
  });
});
