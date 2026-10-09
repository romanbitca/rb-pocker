// The screens use the PLAN's own words (Appendix F.10, G.1, §10.1, §12.1–§12.3, §12.11, §18):
// every string below must appear verbatim in docs/PLAN.md. The copy is plain on purpose, for a
// reader whose first language is not English.
import { describe, expect, it } from 'vitest';
import { en } from '../../../src/i18n/en.ts';

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
  'dialog.newTable buttons': `"${en.dialog.newTable.confirm}" · "${en.dialog.newTable.cancel}"`,
  'menu.resume': en.menu.resume,
  'menu.newTable': en.menu.newTable,
  // The mistake feedback card and Undo (§11, §12.6, Appendix F.4, F.5, F.10; chunk 6.2).
  'toast.undone': `Undo: "${en.toast.undone}"`,
  'feedback buttons': `Buttons: "${en.feedback.undo}" · "${en.feedback.keep}". Small print: "${en.feedback.smallPrint}"`,
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

  it('the Welcome bullets are the four §12.1 bullets, capitalised', () => {
    const joined = en.welcome.bullets
      .map((b) => b.charAt(0).toLowerCase() + b.slice(1))
      .join(' · ');
    expect(PLAN).toContain(`Four short bullets (${joined})`);
  });
});
