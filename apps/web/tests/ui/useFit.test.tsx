// @vitest-environment jsdom
/**
 * `useFit` and its users (PLAN §12.3, §12.6, §12.8 notes, 1.3.100): a text picks the longest form
 * that fits, never "…". jsdom has no layout, so `withRoom(n)` stubs it: a text of more than `n`
 * characters overflows. Real layouts: tests/e2e/noCutWords.spec.ts.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HeroView } from '../../src/app/tableViews.ts';
import { en } from '../../src/i18n/en.ts';
import type { StripView } from '../../src/ui/coach.ts';
import { CoachStrip } from '../../src/ui/components/CoachStrip.tsx';
import { DrawChips } from '../../src/ui/components/DrawChips.tsx';
import { HeroLabel } from '../../src/ui/components/HeroStrip.tsx';
import { drawChipViews } from '../../src/ui/equity.ts';
import { useFit } from '../../src/ui/hooks.ts';

const STUBBED = ['clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight'] as const;

afterEach(() => {
  cleanup();
  for (const key of STUBBED)
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
});

/** Stubs the layout (see the header); the box's width can change, as a phone turns. */
function withRoom(room: number): { setRoom(n: number): void; setBoxWidth(w: number): void } {
  let r = room;
  let box = 200;
  const size = (el: HTMLElement, key: (typeof STUBBED)[number]): number => {
    if (el.tagName === 'DIV') return key === 'clientWidth' ? box : 0;
    // The box the hero's label measures against: in this stub its words always fit it.
    if (el.querySelector('[data-hero-label]') !== null) return key === 'clientWidth' ? 200 : 0;
    const over = (el.textContent ?? '').length > r;
    if (key === 'clientWidth') return 100;
    if (key === 'clientHeight') return 20;
    if (key === 'scrollWidth') return over ? 150 : 100;
    return over ? 60 : 20;
  };
  for (const key of STUBBED) {
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      get(this: HTMLElement) {
        return size(this, key);
      },
    });
  }
  return {
    setRoom: (n) => {
      r = n;
    },
    setBoxWidth: (w) => {
      box = w;
    },
  };
}

function Faces({ faces, axis }: { faces: readonly string[]; axis: 'width' | 'height' }) {
  const fit = useFit<HTMLSpanElement>(faces, axis);
  return (
    <div>
      <span ref={fit.ref} data-testid="text" data-tight={fit.tight ? '' : undefined}>
        {faces[fit.index]}
      </span>
    </div>
  );
}

describe('useFit', () => {
  it('shows the first face that fits, and only measures its axis', () => {
    withRoom(10);
    render(<Faces faces={['a long long text', 'shorter one', 'short']} axis="width" />);
    expect(screen.getByTestId('text').textContent).toBe('short');
    cleanup();
    // A chip's hit area sticks out of its height: 'width' never reads scrollHeight.
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get: () => 100,
    });
    render(<Faces faces={['a long long text', 'short']} axis="width" />);
    expect(screen.getByTestId('text').textContent).toBe('a long long text');
  });

  it('without layout (0 everywhere) the first face stays', () => {
    render(<Faces faces={['a long long text', 'short']} axis="height" />);
    expect(screen.getByTestId('text').textContent).toBe('a long long text');
  });

  it('none fits: the last face, marked tight (its last resort)', () => {
    withRoom(2);
    render(<Faces faces={['a long long text', 'shorter']} axis="height" />);
    const text = screen.getByTestId('text');
    expect(text.textContent).toBe('shorter');
    expect(text.hasAttribute('data-tight')).toBe(true);
  });

  it('a text for screen readers only (a 1×1 box) stays whole', () => {
    withRoom(2);
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 1,
    });
    render(<Faces faces={['a long long text', 'short']} axis="height" />);
    expect(screen.getByTestId('text').textContent).toBe('a long long text');
  });

  it('new words and a new width start over from the longest', () => {
    const layout = withRoom(5);
    const { rerender } = render(<Faces faces={['too long', 'short']} axis="width" />);
    expect(screen.getByTestId('text').textContent).toBe('short');
    rerender(<Faces faces={['other long', 'tiny']} axis="width" />);
    expect(screen.getByTestId('text').textContent).toBe('tiny');
    layout.setRoom(50);
    layout.setBoxWidth(300);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByTestId('text').textContent).toBe('other long');
  });
});

const ADVICE: Extract<StripView, { kind: 'advice' }> = {
  kind: 'advice',
  headline: 'Raise to 1,240 (62 BB)',
  headlineShort: 'Raise to 1,240',
  line: 'Your Two Pair, Queens and Sevens is strong against 5 players (about 45%).',
  lineShort: 'Your hand is strong against 5 players (about 45%).',
  why: true,
};

const stripWords = (container: HTMLElement) => {
  const advice = container.querySelector('[data-coach-advice]') as HTMLElement;
  const [head, line] = [...advice.children];
  return { head: head?.textContent, line: line?.textContent ?? null };
};

function strip(view: StripView) {
  return render(
    <CoachStrip view={view} variant="strip" onOpen={vi.fn()} onHint={vi.fn()} onRetry={vi.fn()} />,
  );
}

describe('the coach strip gives way, never "…" (§12.6)', () => {
  it('the head: its big blinds go, then "Coach:"', () => {
    withRoom(100);
    const whole = strip(ADVICE);
    expect(stripWords(whole.container).head).toBe('Coach: Raise to 1,240 (62 BB)');
    cleanup();
    withRoom(25);
    const short = strip(ADVICE);
    expect(stripWords(short.container).head).toBe('Coach: Raise to 1,240');
    cleanup();
    withRoom(16);
    const bare = strip(ADVICE);
    expect(stripWords(bare.container).head).toBe('Raise to 1,240');
    // The strip's own name still says whose words these are; the aria-label keeps them whole.
    expect(bare.container.querySelector('[data-coach-strip]')?.getAttribute('aria-label')).toBe(
      en.coachUi.title,
    );
  });

  it('the line: a shorter sentence, then none (the sheet has it whole); "Why?" stays', () => {
    withRoom(60);
    const shorter = strip(ADVICE);
    expect(stripWords(shorter.container).line).toBe(ADVICE.lineShort);
    cleanup();
    withRoom(20);
    const none = strip(ADVICE);
    expect(stripWords(none.container).line).toBeNull();
    expect(screen.getByRole('button', { name: 'Why?' })).toBeTruthy();
  });
});

describe('the hero label gives way, never "…" (§12.3, F.3)', () => {
  const hero = (over: Partial<HeroView> = {}): HeroView =>
    ({
      handSeq: 1,
      hole: [{ card: 1 }, { card: 2 }],
      stack: 2000,
      bet: 0,
      dealer: false,
      blind: null,
      folded: false,
      allIn: false,
      toAct: true,
      label: 'Pair of Sevens',
      subLabel: 'The pair is on the board: everyone has it',
      category: 'pair',
      preflopClass: null,
      ...over,
    }) as HeroView;
  const label = (view: HeroView, nuts = false) => {
    const r = render(<HeroLabel hero={view} nuts={nuts} onOpenRankings={vi.fn()} />);
    const sub = r.container.querySelector('[data-hero-sub]');
    return {
      name: r.container.querySelector('[data-hero-name]')?.textContent,
      sub: sub?.textContent ?? null,
    };
  };

  it('a sub-label takes its short form, then none; a name its part before the comma', () => {
    withRoom(100);
    expect(label(hero()).sub).toBe('The pair is on the board: everyone has it');
    cleanup();
    withRoom(20);
    expect(label(hero())).toEqual({ name: 'Pair of Sevens', sub: 'Everyone has it' });
    cleanup();
    withRoom(10);
    expect(label(hero()).sub).toBeNull();
    cleanup();
    withRoom(11);
    const big = label(
      hero({
        label: 'Full House, Queens full of Sevens',
        subLabel: 'Both your cards make pairs',
      }),
    );
    expect(big).toEqual({ name: 'Full House', sub: null });
  });

  it('every short form is a sub-label of §6.1 (F.3)', () => {
    for (const long of Object.keys(en.table.subShort)) {
      expect(long).toMatch(/board|hand|set|trips|cards/i);
      expect((en.table.subShort[long] as string).length).toBeLessThan(long.length);
    }
    expect(en.table.subShort['The pair is on the board: everyone has it']).toBe('Everyone has it');
  });

  it('with the nuts: the whole line, or "Best possible hand" alone', () => {
    withRoom(100);
    expect(label(hero({ subLabel: 'Uses 2 of your cards' }), true).sub).toBe(
      `Uses 2 of your cards${en.table.nuts}`,
    );
    cleanup();
    withRoom(30);
    expect(label(hero({ subLabel: 'Uses 2 of your cards' }), true).sub).toBe(en.table.nutsAlone);
  });
});

describe('a draw chip takes the longest form that fits (§12.3, F.3)', () => {
  const data = {
    handSeq: 1,
    namesOnly: false,
    draws: [
      {
        kind: 'oesd' as const,
        outs: 8,
        pct: 17,
        when: 'nextCard' as const,
        cards: [{ card: 1, risky: true }],
      },
    ],
  };
  const chip = () => {
    const { container } = render(
      <DrawChips chips={drawChipViews(data)} max={1} placement="up" compact />,
    );
    return container.querySelector('[data-draw-chips] > *') as HTMLElement;
  };

  it('whole, its short name, the name alone, then the bare chance; the full words stay its name', () => {
    const name = drawChipViews(data)[0]?.text as string;
    withRoom(100);
    expect(chip().textContent).toContain('Open-ended straight draw');
    cleanup();
    withRoom(33);
    const short = chip();
    expect(short.textContent).toContain('Straight draw');
    expect(short.textContent).toContain('17% next card');
    expect(short.getAttribute('aria-label')).toBe(name);
    cleanup();
    withRoom(15);
    expect(chip().textContent).toBe(`Straight draw${en.draws.riskyMark}`);
    cleanup();
    withRoom(8);
    expect(chip().textContent).toBe(`17%${en.draws.riskyMark}`);
  });
});
