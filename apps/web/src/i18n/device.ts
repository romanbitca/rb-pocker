/**
 * The words of sounds, vibration and keeping the screen on (PLAN §12.1, §12.3, §12.8, §12.13,
 * Appendix F.10; chunk 9.1): Settings' Display and Sound sections, the top bar's mute button and,
 * in compact mode, its Menu item. Chunk 9.1b adds the other Settings rows of §12.1 that had none:
 * "Show win chance" (Game), "Text size" and "Reduce motion" (Display; "Four-colour cards" keeps
 * Setup's words, `en.setup.more.fourColour`). Only the screens after the first tap use them, so they
 * load with that lazy chunk (§15.3), not with `en.ts`.
 */
export const deviceWords = {
  /** Settings, the Game section: the win chance badge on or off (§7.6, §12.1). */
  winChance: {
    label: 'Show win chance',
    hint: 'Off: practise guessing your chances yourself.',
  },
  /** Settings, the Display section (§12.1). */
  display: 'Display',
  /** Normal, or Large: every screen's words ×1.15 (§12.8 notes, §12.12). */
  textSize: {
    label: 'Text size',
    hint: 'Large makes the words bigger.',
    normal: 'Normal',
    large: 'Large',
  },
  /** §12.8: the device's own setting, or always less movement, or always the full motion. */
  reduceMotion: {
    label: 'Reduce motion',
    hint: 'On: less movement. Follow system: as your phone or computer is set.',
    system: 'Follow system',
    on: 'On',
    off: 'Off',
  },
  keepAwake: {
    label: 'Keep screen on',
    hint: 'The screen stays on while you play a hand.',
    /** Added after the hint where the page cannot keep the screen on (§12.14). */
    insecure: 'Needs a secure connection (https).',
    missing: 'This browser cannot do this.',
  },
  /** Settings, the Sound section (§12.1). */
  soundSection: 'Sound',
  sound: {
    label: 'Sound',
    hint: 'Short sounds for cards, chips and your turn.',
  },
  vibration: {
    label: 'Vibration',
    hint: 'Android only: a short buzz on your turn and when you win.',
  },
  /** The top bar's mute button (§12.3): a toggle, pressed while sound is on. */
  muteButton: 'Sound',
  /** Compact mode: the mute button moves to the Menu (§12.3). */
  menu: {
    soundOff: 'Turn sound off',
    soundOn: 'Turn sound on',
  },
} as const;
