// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe as suite, expect, it, vi } from 'vitest';
import { describe } from '../../../src/eval/describe.ts';
import { en } from '../../../src/i18n/en.ts';
import { HandsTab } from '../../../src/ui/components/HandsTab.tsx';
import { RankingsColumn } from '../../../src/ui/components/RankingsColumn.tsx';
import {
  centreRow,
  RankingsDrawer,
  type RankingsCloseReason,
} from '../../../src/ui/components/RankingsDrawer.tsx';
import { SvgSprite } from '../../../src/ui/components/SvgSprite.tsx';
import { heroHandView } from '../../../src/ui/rankings.ts';
import { cards, hole } from '../../helpers/cards.ts';
import { interactiveCount, smallTapTargets, SUIT_CODE_POINTS } from '../dom.ts';

afterEach(cleanup);

const HOLE = hole('Kh Kc');
const HERO = heroHandView(describe(HOLE, cards('Qh 7h 2h Kd 4s')), HOLE, false, 12);

/** A table stand-in: the edge tab, a top-bar button, a hand label and the drawer, all wired to one
 * `open` state as the controller will (Android Back = the controller setting `open` to false). */
function Table({ onChange }: { onChange?: (open: boolean, reason: RankingsCloseReason) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        {en.rankings.tab}
      </button>
      <button type="button" onClick={() => setOpen(true)}>
        Three of a Kind, Kings
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        Android Back
      </button>
      <HandsTab onOpen={() => setOpen(true)} expanded={open} />
      <div style={{ position: 'relative' }}>
        <RankingsDrawer
          open={open}
          onOpenChange={(next, reason) => {
            onChange?.(next, reason);
            setOpen(next);
          }}
          hero={HERO}
        />
      </div>
    </div>
  );
}

const tab = () => screen.getByRole('button', { name: en.rankings.open });
const dialog = () => screen.queryByRole('dialog');

function openByTab() {
  fireEvent.pointerDown(tab(), { pointerId: 1, clientX: 360, clientY: 300 });
  fireEvent.pointerUp(tab(), { pointerId: 1, clientX: 361, clientY: 301 });
  fireEvent.click(tab(), { clientX: 361, clientY: 301 });
}

suite('RankingsDrawer (PLAN §13.1, Stage 3 acceptance 3)', () => {
  it('opens from the edge tab as a labelled modal dialog, with focus inside', () => {
    render(<Table />);
    expect(dialog()).toBeNull();
    openByTab();
    const d = dialog();
    expect(d).not.toBeNull();
    expect(d?.getAttribute('aria-modal')).toBe('true');
    const title = document.getElementById(d?.getAttribute('aria-labelledby') ?? '');
    expect(title?.textContent).toBe(en.rankings.title);
    expect(d?.contains(document.activeElement)).toBe(true);
    expect(tab().getAttribute('aria-expanded')).toBe('true');
  });

  it('opens from the top-bar button and from the hand label too, and returns focus to each', () => {
    render(<Table />);
    for (const name of [en.rankings.tab, 'Three of a Kind, Kings']) {
      const opener = screen.getByRole('button', { name });
      opener.focus(); // as a keyboard user, or a browser that focuses on tap
      fireEvent.click(opener);
      expect(dialog()).not.toBeNull();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(opener);
    }
  });

  it('⚠️ never opens from an edge swipe that ends on the tab', () => {
    render(<Table />);
    fireEvent.pointerDown(tab(), { pointerId: 1, clientX: 372, clientY: 300 });
    fireEvent.pointerMove(tab(), { pointerId: 1, clientX: 300, clientY: 302 });
    fireEvent.pointerUp(tab(), { pointerId: 1, clientX: 250, clientY: 305 });
    fireEvent.click(tab(), { clientX: 250, clientY: 305 });
    expect(dialog()).toBeNull();
    // A keyboard press (a click with no pointer) and a plain tap do open it.
    fireEvent.click(tab());
    expect(dialog()).not.toBeNull();
  });

  const closes: [RankingsCloseReason, () => void][] = [
    ['scrim', () => fireEvent.click(document.querySelector('[class*="scrim"]') as Element)],
    ['close', () => fireEvent.click(screen.getByRole('button', { name: en.rankings.close }))],
    ['escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
    [
      'drag',
      () => {
        const d = dialog() as HTMLElement;
        fireEvent.pointerDown(d, {
          pointerId: 7,
          clientX: 100,
          clientY: 200,
          pointerType: 'touch',
        });
        fireEvent.pointerMove(d, {
          pointerId: 7,
          clientX: 130,
          clientY: 204,
          pointerType: 'touch',
        });
        fireEvent.pointerMove(d, {
          pointerId: 7,
          clientX: 190,
          clientY: 206,
          pointerType: 'touch',
        });
        fireEvent.pointerUp(d, { pointerId: 7, clientX: 190, clientY: 206, pointerType: 'touch' });
      },
    ],
  ];
  for (const [reason, act] of closes) {
    it(`closes by ${reason}, and focus returns to the opener`, () => {
      const onChange = vi.fn();
      render(<Table onChange={onChange} />);
      openByTab();
      act();
      expect(onChange).toHaveBeenCalledWith(false, reason);
      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(tab());
    });
  }

  it('closes when the controller sets open to false (Android Back)', () => {
    render(<Table />);
    openByTab();
    fireEvent.click(screen.getByRole('button', { name: 'Android Back', hidden: true }));
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(tab());
  });

  it('stays open for a drag to the left, a vertical scroll, or a short drag', () => {
    const onChange = vi.fn();
    render(<Table onChange={onChange} />);
    openByTab();
    const d = dialog() as HTMLElement;
    const drag = (dx: number, dy: number) => {
      fireEvent.pointerDown(d, { pointerId: 3, clientX: 200, clientY: 200 });
      fireEvent.pointerMove(d, { pointerId: 3, clientX: 200 + dx / 2, clientY: 200 + dy / 2 });
      fireEvent.pointerMove(d, { pointerId: 3, clientX: 200 + dx, clientY: 200 + dy });
      fireEvent.pointerUp(d, { pointerId: 3, clientX: 200 + dx, clientY: 200 + dy });
    };
    drag(-120, 0);
    drag(4, 160);
    drag(40, 0);
    expect(onChange).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
  });

  it('traps focus: Tab and Shift+Tab wrap, and focus outside is pulled back', () => {
    render(<Table />);
    openByTab();
    const d = dialog() as HTMLElement;
    const items = [...d.querySelectorAll<HTMLElement>('button')];
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    expect(first.getAttribute('aria-label')).toBe(en.rankings.close);

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    d.focus(); // where focus lands on open
    fireEvent.keyDown(d, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    act(() => {
      screen.getByRole('button', { name: 'Android Back', hidden: true }).focus();
    });
    expect(d.contains(document.activeElement)).toBe(true);
  });

  it('removes the sheet after its slide-out', () => {
    vi.useFakeTimers();
    try {
      render(<Table />);
      openByTab();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(document.querySelector('[data-state="closing"]')).not.toBeNull();
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(document.querySelector('[data-state]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the hero’s row highlighted inside the drawer', () => {
    render(<Table />);
    openByTab();
    const row = dialog()?.querySelector('li[aria-current="true"]') as HTMLElement;
    expect(row.dataset.category).toBe('trips');
  });

  it('has no suit characters and only ≥ 44 px targets (acceptance 3 and 6)', () => {
    const { container } = render(
      <>
        <SvgSprite />
        <Table />
      </>,
    );
    openByTab();
    expect(document.documentElement.outerHTML).not.toMatch(SUIT_CODE_POINTS);
    const d = dialog() as HTMLElement;
    expect(interactiveCount(d)).toBe(11); // ✕ and ten rows
    expect(smallTapTargets(d)).toEqual([]);
    expect(container.querySelectorAll('use[href^="#s-"]').length).toBeGreaterThan(50);
  });
});

suite('RankingsColumn (wide screens, §13.1)', () => {
  function Wide() {
    const [collapsed, setCollapsed] = useState(false);
    return <RankingsColumn hero={HERO} collapsed={collapsed} onCollapsedChange={setCollapsed} />;
  }

  it('is a persistent, non-modal column with the live highlight', () => {
    const { container } = render(<Wide />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('complementary', { name: en.rankings.title })).toBeTruthy();
    expect(container.querySelector('li[aria-current="true"]')?.getAttribute('data-category')).toBe(
      'trips',
    );
    // Wide mini cards are 30×42 (md).
    expect(container.querySelector('li [role="img"]')?.className).toMatch(/md/);
  });

  it('collapses to a 44 px rail and back', () => {
    const { container } = render(<Wide />);
    fireEvent.click(screen.getByRole('button', { name: en.rankings.collapse }));
    expect(container.querySelector('li[data-category]')).toBeNull();
    const rail = screen.getByRole('button', { name: en.rankings.open });
    expect(rail.getAttribute('aria-expanded')).toBe('false');
    expect(smallTapTargets(container)).toEqual([]);
    fireEvent.click(rail);
    expect(container.querySelectorAll('li[data-category]')).toHaveLength(10);
    expect(smallTapTargets(container)).toEqual([]);
  });
});

// Found by the Stage 3 E2E suite (tests/e2e/rankings.spec.ts, WebKit): `scrollIntoView` and a
// plain `focus()` also scroll the drawer's `overflow: hidden` root while the sheet slides in
// past its edge, which pushed the scrim off the table.
suite('RankingsDrawer scrolling on open', () => {
  it('scrolls only the list: no scrollIntoView, focus without scrolling', () => {
    const scrollIntoView = vi.fn();
    const saved = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      render(<Table />);
      openByTab();
      expect(dialog()).not.toBeNull();
      expect(scrollIntoView).not.toHaveBeenCalled();
      const sheetFocus = focus.mock.calls.filter((_, i) => focus.mock.contexts[i] === dialog());
      expect(sheetFocus).toEqual([[{ preventScroll: true }]]);
    } finally {
      Element.prototype.scrollIntoView = saved;
      focus.mockRestore();
    }
  });

  it('centreRow puts the row in the middle of the list', () => {
    const list = document.createElement('div');
    const row = document.createElement('li');
    let top = 50;
    Object.defineProperty(list, 'scrollTop', { get: () => top, set: (v: number) => (top = v) });
    Object.defineProperty(list, 'clientHeight', { value: 400 });
    list.getBoundingClientRect = () => ({ top: 100, height: 400 }) as DOMRect;
    row.getBoundingClientRect = () => ({ top: 900, height: 60 }) as DOMRect;
    centreRow(list, row);
    // The row's top moves from 800 px below the list's top to (400 − 60) / 2 = 170 px below it.
    expect(top).toBe(50 + 800 - 170);
    centreRow(null, row); // nothing to scroll: no error
    expect(top).toBe(680);
  });
});

suite('HandsTab (§13.1)', () => {
  it('is 44 px wide to touch and shows the improvement dot', () => {
    const { container, rerender } = render(<HandsTab onOpen={() => {}} expanded={false} />);
    expect(smallTapTargets(container)).toEqual([]);
    expect(container.querySelector('[class*="dot"]')).toBeNull();
    rerender(<HandsTab onOpen={() => {}} expanded={false} dot />);
    expect(container.querySelector('[class*="dot"]')).not.toBeNull();
    expect(container.textContent).toBe(en.rankings.tab);
  });
});
