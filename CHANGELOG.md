# Changelog

## v1.0.0: the first release

RB Poker Coach teaches No-Limit Texas Hold'em. You play against friendly bots, and a coach tells
you what to do, and why. Play money only. It is live at https://poker.romanbitca.com.

### Play

- One tap on **Play** deals a hand. You choose 2 to 9 players, the chips and the blinds.
- Four bot levels: Easy, Medium, Hard and Expert.
- **Undo** a move and try again (not in Exam).
- After a hand, the result stays until you tap **Next hand** (or turn on "Deal the next hand by itself"
  in Settings).
- It works offline, and you can install it on the home screen (iPhone and Android).
- A new version installs only between hands, never during one.

### Learn

- The coach has four levels:
  - Beginner: full help.
  - Intermediate: help on tap.
  - Advanced: mistakes only.
  - Exam: test yourself.
- It shows your win chance against all players and against their likely hands, plus the pot odds,
  your outs and your draws.
- Every decision gets a grade. After a hand, tap **Hand summary** (in Exam: **Exam result**) to see
  them all; it never opens by itself.
- **Learn** has 7 short lessons, a glossary, the hand rankings and "Which hand wins?".
- The **Hand Drill** has 8 quiz games about poker hands, at three difficulties.

### Your progress

- **Stats** has your results, your progress, your collection (the hands you have made) and your
  history. Each of your leaks links to the lesson about it.
- **Review** replays any hand step by step, and "Check the shuffle" proves the cards were fair.
- **Export**, **Import** and **Reset** your data. Nothing about you leaves your device.

### Settings

- Sound, vibration, keep the screen on, text size, reduce motion, four-colour cards and game speed.

### Quality

- 3,761 unit tests and 485 browser tests (Chromium and WebKit, phone to desktop sizes).
- 10 bot-against-bot self-play checks, and an accessibility check on every screen.
- Lighthouse on a phone: Performance 94, Accessibility 100, Best practices 100, installable.
- A review of 964 coach decisions found the coach's maths correct. Its advice and words were fixed
  where they taught the wrong thing, and two rounds of play-testing (about 850 hands at phone sizes)
  fixed the rest of what they found.
