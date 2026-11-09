/** Every word the bot says (PLAN §19.8). `test/bot/*` holds them equal to the plan, by hand. */

const PITCH = "Play Texas Hold'em and learn while you play. Free, play money only.";

export const WORDS = {
  start: 'Welcome to RB Poker Coach. Learn poker by playing. Free, play money only.',
  join: 'Tap to join the table.',
  newTable: 'Tap to open the game and make a table.',
  help: 'Open the game with the Play button. Play with friends: make a table and send the link. Play money only. Chips have no value.',
  /** The text carries the link, so a post works even if a client drops the button. */
  post: (link: string): string => `${PITCH} ${link}`,
  buttons: { play: 'Play', join: 'Join table', newTable: 'New table' },
  inlineAtTable: {
    title: 'Invite to my poker table',
    description: 'Friends tap the button to join.',
    message: 'Join my poker table! Play money only.',
  },
  inlineNoTable: {
    title: 'Play RB Poker Coach',
    description: 'Free. Play money only.',
    message: PITCH,
  },
  menuButton: 'Play',
  commands: [
    { command: 'start', description: 'Open the game' },
    { command: 'new', description: 'Make a table for friends' },
    { command: 'help', description: 'How it works' },
    { command: 'post', description: 'A message for your channel' },
  ],
} as const;
