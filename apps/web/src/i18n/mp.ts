/**
 * The words of Play with friends (PLAN §19.10, where they are final; `tests/ui/mpCopy.test.ts`
 * holds the two equal). A lazy chunk with its screens (`ui/mpEntry.tsx`), asked for only inside
 * Telegram. The one word of the first paint, "Play with friends", is in `i18n/start.ts`; a voided
 * hand's line is F.10's (`en.toast.handVoided`).
 */
export const mpWords = {
  create: {
    title: 'New table',
    players: 'Players',
    playersHint: 'You can start with fewer.',
    game: 'Game',
    games: {
      quick: { name: 'Quick game', detail: '1,000 chips · blinds 25/50' },
      normal: { name: 'Normal game', detail: '2,000 chips · blinds 10/20' },
      long: { name: 'Long game', detail: '5,000 chips · blinds 10/20' },
    },
    time: 'Time to act',
    seconds: { 15: '15 seconds', 30: '30 seconds', 60: '60 seconds' },
    button: 'Create table',
    playMoney: 'Play money only.',
    noValue: 'Chips have no value.',
    notInStats: 'Hands here do not count in your Stats.',
  },

  joining: 'Joining the table…',

  waiting: {
    title: (code: string) => `Table ${code}`,
    inviteLine: 'Send this link to your friends.',
    invite: 'Invite friends',
    /** What Telegram's share list puts under the link. */
    shareText: 'Join my poker table! Play money only.',
    /** Only where `navigator.clipboard` exists. */
    copy: 'Copy link',
    copied: 'Link copied.',
    you: 'You',
    host: 'Host',
    offline: 'Offline',
    emptySeat: 'Empty seat',
    start: 'Start game',
    needPlayers: 'You need at least 2 players.',
    guest: (name: string) => `Waiting for ${name} to start the game.`,
    /** The host started the table, and fewer than two can play now. */
    tooFew: 'Waiting for more players.',
    leave: 'Leave table',
  },

  /** The status strip (`TurnStrip`): the coach's place at these tables. */
  strip: {
    yourTurn: 'Your turn',
    /** No connection on our own turn: the seconds beside it are the most the server allows. */
    yourTurnOffline: 'Your turn (offline)',
    thinking: (name: string) => `${name} is thinking`,
    seconds: (s: number | string) => `${s} s`,
    nextHand: (s: number | string) => `Next hand in ${s} s`,
    notDealtIn: 'You get cards in the next hand.',
  },

  /** On a pod: not online; sitting out, busted or leaving; dealt in from the next hand. */
  seatNote: { offline: 'Offline', out: 'Out', next: 'Next' },

  sittingOut: { line: 'You are sitting out.', back: "I'm back" },

  toast: {
    timedOutFold: 'Your time ran out. You folded.',
    timedOutCheck: 'Your time ran out. You checked.',
    joined: (name: string) => `${name} joined the table.`,
    left: (name: string) => `${name} left the table.`,
    hostChanged: (name: string) => `${name} is now the host.`,
  },

  busted: {
    text: "You are out of chips. That's okay: chips are free here.",
    reload: (x: string) => `Get ${x} chips`,
    leave: 'Leave table',
  },

  leave: {
    text: 'Leave this table? If a hand is running, you fold it. Your chips will be gone.',
    confirm: 'Leave table',
    stay: 'Stay',
  },

  connection: {
    lost: 'Connection lost. Trying again…',
    gone: "We can't reach the game.",
    tryAgain: 'Try again',
  },

  /** The `mpProblem` dialog (§19.6), by what ended the table or refused the join. */
  ended: {
    server_restart: 'The game was updated, so this table ended. Chips are not kept.',
    idle: 'This table closed because nobody played.',
    error: 'Something went wrong, so this table ended.',
    gone: 'This table has ended.',
  },
  ok: 'OK',
  joinGone: 'This table is gone.',
  joinFull: 'This table is full.',
  alreadySeated:
    'You are already at a table. This invite is for another table. If you leave, your chips will be gone.',
  stayAtMyTable: 'Stay at my table',
  leaveAndJoin: 'Leave and join the new table',
  tooManyTables: 'Too many tables are open right now. Please try again later.',
  login: 'We could not check your Telegram login. Please close the game and open it again.',
  outdated: 'A new version is ready. Please close the game and open it again.',
  replaced: 'You opened the game in another place. This window has stopped.',
} as const;

export type MpWords = typeof mpWords;
