// @vitest-environment jsdom
// The level suggestion card (PLAN §10.4; chunk 8.4): the §10.4 words, [Try {level}] [Not now],
// on the hand summary from the store. The rules are tests/app/suggestions.test.ts.
import '../../../src/ui/styles/tokens.css';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appStore, initialData, type Suggestion } from '../../../src/app/store.ts';
import {
  LevelSuggestion,
  SuggestionCard,
  suggestionText,
} from '../../../src/ui/components/SuggestionCard.tsx';
import { smallTargets } from '../screens/targets.ts';

afterEach(() => {
  cleanup();
  appStore.setState({ data: initialData() });
});

describe('the card (§10.4)', () => {
  it('bots up: "You beat Easy bots. Try Medium?" [Try Medium] [Not now]', () => {
    const onAnswer = vi.fn();
    const { container } = render(
      <SuggestionCard
        suggestion={{ rule: 'botsUp', from: 'easy', to: 'medium' }}
        onAnswer={onAnswer}
      />,
    );
    expect(screen.getByRole('region', { name: 'You beat Easy bots. Try Medium?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try Medium' }));
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onAnswer.mock.calls).toEqual([[true], [false]]);
    expect(smallTargets(container, () => false)).toEqual([]);
  });

  it('bots down and coach down: the §10.4 questions, the level the yes picks', () => {
    const down: Suggestion = { rule: 'botsDown', from: 'hard', to: 'medium' };
    expect(suggestionText(down)).toEqual({
      text: 'These bots are tough. Want easier bots for a while?',
      to: 'Medium',
    });
    const coach: Suggestion = { rule: 'coachDown', from: 'intermediate', to: 'advanced' };
    expect(suggestionText(coach)).toEqual({
      text: 'You rarely need help. Try less coach help?',
      to: 'Advanced',
    });
  });

  it('wired to the store: nothing without a suggestion; an answer is the `suggestion` command', () => {
    const dispatch = vi.fn();
    const original = appStore.getState().dispatch;
    appStore.setState({ dispatch });
    try {
      const { container } = render(<LevelSuggestion />);
      expect(container.innerHTML).toBe('');
      act(() => {
        appStore.setState({
          data: { ...initialData(), suggestion: { rule: 'botsUp', from: 'easy', to: 'medium' } },
        });
      });
      fireEvent.click(screen.getByRole('button', { name: 'Try Medium' }));
      expect(dispatch).toHaveBeenCalledWith({ type: 'suggestion', accept: true });
    } finally {
      appStore.setState({ dispatch: original });
    }
  });
});
