// @vitest-environment jsdom
/**
 * The toolbar Undo (PLAN §12.3, §12.5): disabled is `aria-disabled` (focusable, taps ignored),
 * one DOM node; the U shortcut never while typing, with a modifier or on a key repeat.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UndoButton, useUndoKey } from '../../../src/ui/components/UndoButton.tsx';

afterEach(cleanup);

function Keyed({ active, onUndo }: { active: boolean; onUndo: () => void }) {
  useUndoKey(active, onUndo);
  return <input aria-label="amount" />;
}

describe('the toolbar Undo (§12.3)', () => {
  it('enabled: a tap undoes; disabled: shown, focusable, the tap does nothing', () => {
    const onUndo = vi.fn();
    const { rerender } = render(<UndoButton state="enabled" onUndo={onUndo} />);
    const button = screen.getByRole('button', { name: 'Undo' });
    expect(button.getAttribute('aria-disabled')).toBeNull();
    expect(button.getAttribute('aria-keyshortcuts')).toBe('U');
    expect(button.childElementCount).toBe(0); // one DOM node (§15.3)
    fireEvent.click(button);
    expect(onUndo).toHaveBeenCalledTimes(1);
    rerender(<UndoButton state="disabled" onUndo={onUndo} />);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('U undoes while active; never in a text field, with a modifier, or repeated', () => {
    const onUndo = vi.fn();
    const { rerender } = render(<Keyed active={true} onUndo={onUndo} />);
    fireEvent.keyDown(document, { key: 'u' });
    fireEvent.keyDown(document, { key: 'U' });
    expect(onUndo).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(document, { key: 'u', repeat: true });
    fireEvent.keyDown(document, { key: 'u', metaKey: true });
    fireEvent.keyDown(document, { key: 'u', altKey: true });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'u' });
    expect(onUndo).toHaveBeenCalledTimes(2);
    rerender(<Keyed active={false} onUndo={onUndo} />);
    fireEvent.keyDown(document, { key: 'u' });
    expect(onUndo).toHaveBeenCalledTimes(2);
  });
});
