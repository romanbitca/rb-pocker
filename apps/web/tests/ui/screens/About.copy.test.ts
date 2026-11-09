/**
 * The About screen's words are the PLAN's own (Appendix G; chunk 9.2c). `i18n/about.ts` is held
 * equal to G.1, G.2, G.3, G.5 and G.6 both ways, so a change on either side fails here until the
 * other follows (for example a line that a later chunk adds to G.5). `checkAbout`, which
 * `npm run check:copy` runs, passes on these words and finds each problem it looks for.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkAbout, CLOSED_HELP_LINES, shownDigits } from '../../../scripts/copy-rules.ts';
import { aboutWords as W } from '../../../src/i18n/about.ts';
import { en } from '../../../src/i18n/en.ts';

const PLAN = readFileSync(new URL('../../../../../docs/PLAN.md', import.meta.url), 'utf8');

/** Appendix G's section `id` ("G.5"): from its heading to the next heading or rule. */
function section(id: string): string {
  const start = PLAN.indexOf(`\n### ${id} `);
  if (start < 0) throw new Error(`PLAN has no ${id}`);
  const rest = PLAN.slice(start + 1);
  const end = rest.slice(4).search(/\n(?:### |---)/);
  return rest.slice(0, end + 4);
}

/** A quote's "> **Name:** text" lines (G.2's are "> - **Name:** text"). */
const quotedTerms = (text: string) =>
  [...text.matchAll(/^> (?:- )?\*\*(.+?)\*\* (.+)$/gm)].map((m) => ({ name: m[1], text: m[2] }));

const terms = (list: readonly { name: string; text: string }[]) =>
  list.map(({ name, text }) => ({ name, text }));

describe('About says what Appendix G says, word for word', () => {
  it('How this app works = G.5', () => {
    expect(section('G.5')).toContain(W.howItWorks.title);
    expect(terms(W.howItWorks.terms)).toEqual(quotedTerms(section('G.5')));
  });

  it('How the coach works = the lines of G.6', () => {
    expect(terms(W.coach.terms)).toEqual(quotedTerms(section('G.6')));
  });

  it('Privacy = G.2', () => {
    const g2 = section('G.2');
    expect(g2).toContain(`> **${W.privacy.title}**\n`);
    expect(terms(W.privacy.terms)).toEqual(quotedTerms(g2));
  });

  it('Play money only = G.1, in full', () => {
    expect(quotedTerms(section('G.1'))).toEqual([
      { name: `${W.playMoney.title}.`, text: W.playMoney.text },
    ]);
  });

  it('Help with gambling = G.3, its help lines as a list', () => {
    const [uk, us] = W.help.lines;
    expect(uk).toBeDefined();
    expect(us).toBeDefined();
    const quote = /^> (If gambling .+)$/m.exec(section('G.3'))?.[1];
    expect(quote).toBe(`${W.help.text} ${uk?.name} ${uk?.number}, or ${us?.name} ${us?.number}.`);
  });

  it("the page's title, headings in order, licences line and version line are G.6's", () => {
    const g6 = section('G.6');
    expect(g6).toContain(`One page, "${en.about}"`);
    expect([...g6.matchAll(/^\d\. \*\*(.+?)\*\*/gm)].map((m) => m[1])).toEqual([
      W.howItWorks.title,
      W.coach.title,
      W.privacy.title,
      W.playMoney.title,
      W.help.title,
      W.licences.title,
    ]);
    expect(g6).toContain(`"${W.licences.intro}"`);
    expect(g6).toContain(`**"${W.version('{version}', '{commit}')}"**`);
    expect(g6).toContain(`"${W.version('{version}', null)}"`);
  });
});

describe('tables with friends in Telegram (§19.12)', () => {
  const plan = section('19.12');
  const privacy = (name: string) => W.privacy.terms.find((term) => term.name === name)?.text ?? '';
  const where = privacy('Where:');
  const friends = privacy('Play with friends (inside Telegram only):');

  it('§19.12 quotes the same two privacy lines as G.2, and the new one comes last', () => {
    expect(quotedTerms(plan)).toEqual([
      { name: 'Where:', text: where },
      { name: 'Play with friends (inside Telegram only):', text: friends },
    ]);
    expect(W.privacy.terms.at(-1)?.text).toBe(friends);
  });

  it("§19.12's sentences for G.1, G.2 and G.5 are the words on the page", () => {
    const game = W.howItWorks.terms.find((term) => term.name === 'The game:')?.text ?? '';
    const data = W.howItWorks.terms.find((term) => term.name === 'Your data:')?.text ?? '';
    const fair = W.howItWorks.terms.find((term) => term.name === 'Fair cards:')?.text ?? '';
    const g1 =
      'You play against computer bots, or with friends at a private table in Telegram, with virtual chips that have no value.';
    const yourData = 'Only Play with friends uses our server (see Privacy).';
    const noCode =
      'At tables with friends, our server deals the cards, so there is no shuffle code and no Review.';
    const stored =
      "While you are at a table with friends, we also store that table's code, so you can come back to it. It is deleted when you leave or the table ends.";

    expect(W.playMoney.text).toContain(g1);
    expect(plan).toContain(`"${g1}"`);
    expect(data.endsWith(yourData)).toBe(true);
    expect(plan).toContain(`"${yourData}"`);
    expect(fair.endsWith(noCode)).toBe(true);
    expect(plan).toContain(`"${noCode}"`);
    expect(plan).toContain(`"${game}"`);
    expect(privacy('What we store:').endsWith(stored)).toBe(true);
    expect(plan).toContain(`"${stored}"`);
  });

  it('says what happens alone, when the server hears from you, and what a table keeps', () => {
    // Alone: nothing about the player or the games.
    expect(where).toContain('nothing about you or your games is sent');
    expect(where).toContain('Play with friends is different: see below.');
    // Only then: the client connects for Play with friends and nothing else (§19.6, chunk 10.8).
    expect(friends).toContain('and only then, Telegram gives our server');
    // initData holds more than the server reads (§19.9).
    expect(friends).toContain('The server reads only the ID and the first name');
    expect(friends).toContain('your first name, your chips and your moves');
    expect(friends).toContain('in its memory only, and only while the table is open');
    // The per-user limits of §19.4 are the one thing that outlives a table.
    expect(friends).toContain('Nothing is saved after the table ends, except a count');
    expect(friends).toContain('gone within 10 minutes');
  });
});

describe('checkAbout (npm run check:copy)', () => {
  it('passes on the real words; every help line dials the number it shows', () => {
    expect(checkAbout()).toEqual([]);
    expect(W.help.lines.map(shownDigits)).toEqual(W.help.lines.map((l) => l.tel));
  });

  it('finds a long coach sentence, a closed help line, a wrong phone link and a stray brace', () => {
    const [first, ...rest] = W.coach.terms;
    const [uk, us] = W.help.lines;
    if (first === undefined || uk === undefined || us === undefined) throw new Error('no words');
    const bad = {
      ...W,
      coach: {
        ...W.coach,
        // "…the pot and every bet and every chip that is left.": 20 words.
        terms: [
          { name: first.name, text: `${first.text.slice(0, -1)} and every chip that is left.` },
          ...rest,
        ],
      },
      help: {
        ...W.help,
        text: `${W.help.text} 1-800-GAMBLER {or}`,
        lines: [{ ...uk, tel: '+448088020134' }, us],
      },
    } as unknown as typeof W;
    const problems = checkAbout(bad);
    expect(problems).toHaveLength(4);
    expect(problems[0]).toMatch(/^About, "What it sees:": a sentence of 20 words/);
    expect(problems[1]).toMatch(/^About names a closed help line, 1-800-GAMBLER: "If gambling/);
    expect(problems[2]).toBe('About: "0808 8020 133" dials tel:+448088020134');
    expect(problems[3]).toMatch(/^About: a stray brace in "If gambling/);
    // Spaces and case do not hide one.
    for (const closed of CLOSED_HELP_LINES) {
      const named = { ...W, help: { ...W.help, text: closed.toUpperCase().replace('-', ' - ') } };
      expect(checkAbout(named as unknown as typeof W).join(), closed).toContain(closed);
    }
  });
});
