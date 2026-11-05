/**
 * The words of the level suggestion card (PLAN §10.4, Appendix F.10; chunk 8.4), on the hand
 * summary and Stats → Progress. They load with those lazy chunks (§15.3). Level names arrive as
 * the Setup cards name them ("Easy", "Advanced").
 */
export const suggestionWords = {
  /** "You beat Easy bots. Try Medium?" */
  botsUp: (from: string, to: string) => `You beat ${from} bots. Try ${to}?`,
  botsDown: 'These bots are tough. Want easier bots for a while?',
  coachDown: 'You rarely need help. Try less coach help?',
  /** The yes button: "Try Medium". */
  accept: (level: string) => `Try ${level}`,
  notNow: 'Not now',
} as const;
