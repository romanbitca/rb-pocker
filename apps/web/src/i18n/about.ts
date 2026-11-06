/**
 * The About screen's words (PLAN §12.1, Appendix G; chunk 9.2c). They load with its lazy chunk
 * (`ui/screens/About.tsx`, §15.3); the ways in say `en.about` (Settings, the Menu) and
 * `en.legal.privacy` (the footers of Welcome and Setup).
 *
 * Every string is the PLAN's own, word for word (`tests/ui/screens/About.copy.test.ts`): G.5 "How
 * this app works" (the §1.5 assumptions and §16.3's "Fair cards"), G.6 "How the coach works" and
 * the page's headings, G.2 Privacy, G.1 in full, G.3 the help lines. `npm run check:copy` checks
 * them too (`checkAbout`): G.6's sentences are at most 15 words, no closed help line comes back
 * (pitfall 40), and each `tel:` link dials the number it shows.
 */

/** A line that starts with its name in bold: "**Undo:** you can take back your last decision…". */
export interface AboutTerm {
  readonly name: string;
  readonly text: string;
}

/** A help line (G.3): its name, the number as written, and the number for a `tel:` link. */
export interface HelpLine {
  readonly name: string;
  readonly number: string;
  readonly tel: string;
}

export const aboutWords = {
  /** G.5: the §1.5 assumptions in plain words. */
  howItWorks: {
    title: 'How this app works',
    terms: [
      {
        name: 'The game:',
        text: "No-Limit Texas Hold'em against computer bots, with play chips only.",
      },
      {
        name: 'Undo:',
        text: 'you can take back your last decision, and the coach stops you after a mistake so you can try again. Hands where you used Undo count as practice, not in your main results.',
      },
      {
        name: 'Levels:',
        text: 'choose how strong the bots are (Easy to Expert) and how much the coach helps (Beginner to Exam). They are separate.',
      },
      {
        name: 'Win chance:',
        text: 'your chance against any cards the other players might hold. The coach may also show your chance against the hands a player likely has.',
      },
      {
        name: 'Your data:',
        text: "saved on this device only. We do not use cookies; we use the browser's local storage, which stays on your device and is never sent anywhere.",
      },
      {
        name: 'The coach:',
        text: 'it uses poker rules of thumb and maths. It is a teacher, not a perfect player.',
      },
      {
        name: 'Fair cards:',
        text: 'The bots and the coach never see hidden cards. We test this automatically. The win chance never uses the bots\' real cards. Each hand is shuffled from a secret seed. Before the cards are dealt, the game saves a shuffle code made from it. After the hand, Review shows the seed, and "Check the shuffle" shows that the cards came from it.',
      },
    ] satisfies readonly AboutTerm[],
  },

  /** G.6, written from §8 and §10 for this screen. */
  coach: {
    title: 'How the coach works',
    terms: [
      {
        name: 'What it sees:',
        text: 'only what you can see: your cards, the board, the pot and every bet.',
      },
      {
        name: 'How it thinks:',
        text: 'it guesses which hands each player likely has, from how they played. Then it works out your chance to win against those hands.',
      },
      {
        name: 'What it says:',
        text: 'it compares that chance with the price of a call. It also uses poker rules of thumb. It picks one move and tells you why, and what not to do.',
      },
      {
        name: 'Always the same:',
        text: 'the same situation always gets the same advice, at every coach level. The level changes only what you see and when the coach stops you.',
      },
      {
        name: 'Grades:',
        text: 'after you act, it grades your move, from "Best move" to "Big mistake". Doing what it advised is always "Best move".',
      },
      {
        name: 'The bots:',
        text: 'they use the same rules of thumb, each with a style of its own. Easier bots make more mistakes.',
      },
    ] satisfies readonly AboutTerm[],
  },

  /** G.2. */
  privacy: {
    title: 'Privacy',
    terms: [
      {
        name: 'What we store:',
        text: 'your settings, your game in progress, and your stats (hands, decisions, grades).',
      },
      {
        name: 'Where:',
        text: 'only on this device, inside this browser ("local storage"). There is no account, and nothing is sent to us or anyone else. While you play, the app only loads its own files and checks for updates. Nothing about you or your games is sent.',
      },
      { name: 'Why:', text: 'so you can continue your game and see your progress. Nothing else.' },
      {
        name: 'How to delete it:',
        text: "Settings → Reset stats, or clear this site's data in your browser settings.",
      },
      {
        name: 'Hosting:',
        text: "the app's files come from our own server. Like any web server, it sees your IP address so it can send you the files. The app does not store it. We do not use cookies, analytics or ads.",
      },
    ] satisfies readonly AboutTerm[],
  },

  /** G.1, in full (its first sentence is the heading). */
  playMoney: {
    title: 'Play money only',
    text: 'This is a free poker learning game. You play against computer bots with virtual chips that have no value. They cannot be bought, sold, won as prizes, or exchanged for money. Success here does not mean you will win at real-money poker. Intended for adults.',
  },

  /**
   * G.3. ⚠️ Pitfall 40: re-check both numbers on each organisation's own site at every release
   * (last checked 6 Nov 2026: gamcare.org.uk, ncpgambling.org).
   */
  help: {
    title: 'Help with gambling',
    text: 'If gambling is causing problems for you or someone you know, free confidential help is available. For example:',
    lines: [
      {
        name: 'the UK National Gambling Helpline (GamCare),',
        number: '0808 8020 133',
        tel: '+448088020133',
      },
      {
        name: 'the US National Problem Gambling Helpline, call or text',
        number: '1-800-MY-RESET (1-800-697-3738)',
        tel: '+18006973738',
      },
    ] satisfies readonly HelpLine[],
  },

  /** The packages whose code ships to the browser (`data/licences.ts`, §16.4). */
  licences: {
    title: 'Licences',
    intro: 'This app is built with open-source software:',
  },

  /**
   * The page's last line, "Version 0.1.0 (7e4a548)": without the commit when the build could not
   * know it (G.6).
   */
  version: (version: string, commit: string | null) =>
    commit === null ? `Version ${version}` : `Version ${version} (${commit})`,
} as const;
