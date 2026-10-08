/**
 * Review's words (PLAN §12.10): what a step of a replay says, and the result lines. Pure: it turns
 * the store's `ReviewFrame` data into the sentences of `en.review`. Cards are named in words
 * ("King of spades"), never with suit symbols (pitfall 31).
 *
 * The last frame shows the result as the hand-end banner worded it (`handEndLines`, §12.9) and the
 * hero's net, instead of the step's own events.
 */
import type { ReviewEvent, ReviewFrame, ReviewReplay } from '../app/store.ts';
import { cardAriaLabel } from '../core/cards.ts';
import { en } from '../i18n/en.ts';
import { enReview } from '../i18n/review.ts';
import { formatChips } from './format.ts';
import { handEndLines, joinNames } from './handEnd.ts';

const T = enReview.says;

/** Auto-play: how long each step stays on screen. A local display timer (PLAN §0.3 "Time"). */
export const AUTOPLAY_MS = 1500;

const named = (who: { name: string; hero: boolean }): string =>
  who.hero ? en.handEnd.you : who.name;

/** The sentences of one event (one, or two with "All-in."). */
export function eventLines(e: ReviewEvent): string[] {
  switch (e.kind) {
    case 'blind': {
      const say = e.blind === 'sb' ? T.smallBlind : T.bigBlind;
      return [say(e.who.name, e.who.hero, formatChips(e.amount))];
    }
    case 'act': {
      const { name, hero } = e.who;
      const first =
        e.action === 'fold'
          ? T.fold(name, hero)
          : e.action === 'check'
            ? T.check(name, hero)
            : e.action === 'call'
              ? T.call(name, hero, formatChips(e.amountIn))
              : e.action === 'bet'
                ? T.bet(name, hero, formatChips(e.to))
                : T.raise(name, hero, formatChips(e.to));
      return e.allIn ? [first, T.allIn] : [first];
    }
    case 'street':
      return [T[e.street](e.cards.map(cardAriaLabel).join(en.handEnd.comma))];
    case 'reveal': {
      const names = joinNames(e.who.map(named));
      return [e.reason === 'runout' ? T.runout(names) : T.showdown(names)];
    }
    case 'refund':
      return [T.refund(e.who.name, e.who.hero, formatChips(e.amount))];
    case 'reshuffle':
      return [T.reshuffle];
  }
}

/** "+160", "−80" (a real minus sign) or "0". */
export function netText(net: number): string {
  if (net > 0) return `+${formatChips(net)}`;
  return net < 0 ? `−${formatChips(-net)}` : '0';
}

/** What a screen reader says for the hero's net: "You won 160 chips." */
export function netSpoken(net: number): string {
  if (net > 0) return enReview.youWon(formatChips(net));
  return net < 0 ? enReview.youLost(formatChips(-net)) : enReview.even;
}

/** The lines under the table at `frame`: its events, or the result on the last frame. */
export function frameLines(view: ReviewReplay, frame: ReviewFrame): string[] {
  if (frame.index === view.frames.length - 1) {
    return [...handEndLines(view.end), netSpoken(view.end.heroNet)];
  }
  const lines = frame.events.flatMap(eventLines);
  return frame.index === 0 ? [enReview.says.deal, ...lines] : lines;
}

/** "Start" on the deal, else "Step 7 of 23" (the deal is step 0). */
export function stepLabel(index: number, last: number): string {
  return index === 0 ? enReview.steps.start : enReview.steps.of(index, last);
}
