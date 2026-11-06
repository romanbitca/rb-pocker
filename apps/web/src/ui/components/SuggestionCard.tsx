/**
 * The level suggestion card (PLAN §10.4; chunk 8.4): "You beat Easy bots. Try Medium?" [Try
 * Medium] [Not now]. Never automatic: yes changes the level as Settings does (the bots from the
 * next hand, the coach from the next decision, §10), and either answer hides the card for 7 days.
 * On the hand summary and Stats → Progress (lazy chunks); the controller decides when there is one
 * (`data.suggestion`, `app/suggestions.ts`).
 */
import { useId } from 'react';
import { selectSuggestion, useAppStore, useDispatch, type Suggestion } from '../../app/store.ts';
import { en } from '../../i18n/en.ts';
import { suggestionWords as W } from '../../i18n/suggestions.ts';
import screen from '../screens/Screen.module.css';

/** The card's question and the level its yes picks. */
export function suggestionText(s: Suggestion): { text: string; to: string } {
  if (s.rule === 'coachDown') return { text: W.coachDown, to: en.levels.coach[s.to] };
  const to = en.levels.bot[s.to];
  return { text: s.rule === 'botsUp' ? W.botsUp(en.levels.bot[s.from], to) : W.botsDown, to };
}

export interface SuggestionCardProps {
  suggestion: Suggestion;
  /** true: "Try {level}"; false: "Not now". */
  onAnswer: (accept: boolean) => void;
}

export function SuggestionCard({ suggestion, onAnswer }: SuggestionCardProps) {
  const id = useId();
  const { text, to } = suggestionText(suggestion);
  return (
    <section className={screen.card} aria-labelledby={id} data-suggestion={suggestion.rule}>
      <p id={id}>{text}</p>
      <div className={screen.cardButtons}>
        <button type="button" className={screen.secondary} onClick={() => onAnswer(true)}>
          {W.accept(to)}
        </button>
        <button type="button" className={screen.secondary} onClick={() => onAnswer(false)}>
          {W.notNow}
        </button>
      </div>
    </section>
  );
}

/** The card wired to the store: nothing when there is no suggestion. */
export function LevelSuggestion() {
  const suggestion = useAppStore(selectSuggestion);
  const dispatch = useDispatch();
  if (suggestion === null) return null;
  return (
    <SuggestionCard
      suggestion={suggestion}
      onAnswer={(accept) => dispatch({ type: 'suggestion', accept })}
    />
  );
}
