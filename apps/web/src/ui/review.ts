/**
 * Review's words (PLAN §12.10): what a step of a replay says, and the result lines. Pure: it turns
 * the store's `ReviewFrame` data into the sentences of `en.review`. Cards are named in words
 * ("King of spades"), never with suit symbols (pitfall 31).
 *
 * The last frame shows the result as the hand-end banner worded it (`resultLines`, §12.9), the
 * hero's own result included, instead of the step's own events.
 *
 * The hero's decisions go on their steps (1.3.101): `decisionSteps` matches the records to the
 * replay, `openingStep` picks where a replay opens, `jumpFrom` is "Next decision" and "Previous
 * decision". What a decision says is the hand summary's row (`ui/summary.ts`, §12.9).
 */
import type { HandEndView, ReviewEvent, ReviewFrame, ReviewReplay } from '../app/store.ts';
import { cardAriaLabel } from '../core/cards.ts';
import { en } from '../i18n/en.ts';
import { enReview } from '../i18n/review.ts';
import { formatChips } from './format.ts';
import { handEndLines } from './handEnd.ts';
import { joinNames } from './names.ts';
import { rowOf, type SummaryRow } from './summary.ts';

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

/**
 * The result as the hand-end banner said it (§12.9, §12.10); a hand that did not change the hero's
 * stack says so too (the banner has no line for it).
 */
export function resultLines(end: HandEndView): string[] {
  const lines = handEndLines(end);
  return end.heroNet === 0 ? [...lines, enReview.even] : lines;
}

/** The lines under the table at `frame`: its events, or the result on the last frame. */
export function frameLines(view: ReviewReplay, frame: ReviewFrame): string[] {
  if (frame.index === view.frames.length - 1) return resultLines(view.end);
  const lines = frame.events.flatMap(eventLines);
  return frame.index === 0 ? [enReview.says.deal, ...lines] : lines;
}

/** "Start" on the deal, else "Step 7 of 23" (the deal is step 0). */
export function stepLabel(index: number, last: number): string {
  return index === 0 ? enReview.steps.start : enReview.steps.of(index, last);
}

/** A hero decision on the replay: the frame it shows on, and its row of the hand summary. */
export interface DecisionStep {
  readonly index: number;
  readonly row: SummaryRow;
}

/**
 * The hero's decisions as steps of the replay, in order (§12.10). A decision's `decisionId` is the
 * number of hero moves before it (§11.3 r1), so the n-th hero move of the replay is decision n and
 * shows the record that stood. An Undo took its move out of the replay and left a step of its own
 * (`reshuffle`, right after the moves before it): the record it took back shows there. A move
 * without a record (a hand the app finished by itself, §3.1) gets no row.
 */
export function decisionSteps(view: ReviewReplay): DecisionStep[] {
  const stood = new Map<number, SummaryRow>();
  const undone = new Map<number, SummaryRow>();
  for (const d of view.decisions) (d.undone ? undone : stood).set(d.decisionId, rowOf(d));
  const steps: DecisionStep[] = [];
  let moves = 0;
  for (const frame of view.frames) {
    for (const e of frame.events) {
      const move = e.kind === 'act' && e.who.hero;
      if (!move && e.kind !== 'reshuffle') continue;
      const row = (move ? stood : undone).get(moves);
      if (row !== undefined) steps.push({ index: frame.index, row });
      if (move) moves++;
    }
  }
  return steps;
}

/** Where a replay opens (§12.10): at the first mistake that stands, else at the deal. */
export function openingStep(steps: readonly DecisionStep[]): number {
  const mistake = steps.find(
    ({ row }) => !row.undone && (row.grade === 'mistake' || row.grade === 'blunder'),
  );
  return mistake?.index ?? 0;
}

/** The frame of the next decision after `index` (`by` 1) or before it (-1), or null. */
export function jumpFrom(steps: readonly DecisionStep[], index: number, by: 1 | -1): number | null {
  const order = by === 1 ? steps : [...steps].reverse();
  return order.find((step) => by * (step.index - index) > 0)?.index ?? null;
}
