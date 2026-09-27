/**
 * Dev-only visual preview of the table components: open `/?preview=ui` on the dev server
 * (`?preview=ui&view=cards` for the card gallery). `main.tsx` loads this module only when
 * `import.meta.env.DEV`, so production builds never contain it (tests/ui/dev/bundle.test.ts).
 *
 * The shell around the table (top bar, hero strip, coach, action bar, side column) is a rough
 * mock drawn from the same numbers as `layout/seats.ts`, so pods, bets, board and pot sit where
 * the real Table screen will put them. Its labels are developer text, never shown to players,
 * so they stay here instead of in `i18n/en.ts`.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { newDeck, parseCard } from '../../core/cards.ts';
import { Board } from '../components/Board.tsx';
import { Card, type CardSize } from '../components/Card.tsx';
import { Pot } from '../components/Pot.tsx';
import { Seat } from '../components/Seat.tsx';
import { SvgSprite } from '../components/SvgSprite.tsx';
import { SHELL, tableFrame, tableGeometry, type Rect, type Size } from '../layout/seats.ts';
import {
  PREVIEW_STATES,
  previewBoard,
  previewPot,
  previewSeats,
  SAMPLE,
  type PreviewState,
} from './fixtures.ts';
import styles from './Preview.module.css';

/** Marks the preview in the DOM; the bundle test checks this string never ships. */
export const PREVIEW_MARKER = 'rb-ui-preview';

function useViewport(): Size {
  const read = (): Size => ({
    w: document.documentElement.clientWidth,
    h: document.documentElement.clientHeight,
  });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const onResize = () => setSize(read());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

const at = (r: Rect): CSSProperties => ({ left: r.x, top: r.y, width: r.w, height: r.h });

function param(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

function TablePreview() {
  const viewport = useViewport();
  const [players, setPlayers] = useState(() => {
    const n = Number(param('players') ?? 9);
    return Number.isInteger(n) && n >= 2 && n <= 9 ? n : 9;
  });
  const [state, setState] = useState<PreviewState>(() => {
    const s = param('state');
    return PREVIEW_STATES.find((x) => x === s) ?? 'river';
  });
  const opponents = players - 1;
  const frame = tableFrame(viewport);
  const { layout, box } = frame;
  const geometry = useMemo(
    () => tableGeometry(layout, { w: box.w, h: box.h }, opponents),
    [layout, box.w, box.h, opponents],
  );
  const seats = useMemo(() => previewSeats(opponents, state), [opponents, state]);
  const board = useMemo(() => previewBoard(state), [state]);
  const pot = useMemo(() => previewPot(state), [state]);

  const wide = layout === 'wide';
  const landscape = layout === 'landscape';
  const leftWidth = box.w + (frame.tab === null ? 0 : SHELL.edgeGutter);
  const topBar = landscape ? SHELL.topBarLandscape : SHELL.topBar;
  const below = box.y + box.h;
  const nextState = PREVIEW_STATES[(PREVIEW_STATES.indexOf(state) + 1) % PREVIEW_STATES.length];

  return (
    <div className={styles.screen}>
      <div className={styles.topBar} style={{ width: leftWidth, height: topBar }}>
        <button type="button" onClick={() => setPlayers((n) => Math.max(2, n - 1))}>
          −
        </button>
        <span className={styles.count}>{players} players</span>
        <button type="button" onClick={() => setPlayers((n) => Math.min(9, n + 1))}>
          +
        </button>
        <button
          type="button"
          className={styles.wideButton}
          onClick={() => setState(nextState ?? 'preflop')}
        >
          {state}
        </button>
        <span className={styles.layoutName}>
          {layout} {viewport.w}×{viewport.h}
        </span>
      </div>

      <div className={styles.table} style={at(box)}>
        <div className={styles.felt} />
        <Pot pot={pot} place={geometry.pot} />
        <Board cards={board} card={geometry.boardCard} place={geometry.board} />
        {seats.map((view, i) => (
          <Seat
            key={view.seat}
            view={view}
            place={{
              pod: geometry.pods[i] as Rect,
              bet: geometry.bets[i] as Rect,
              inner: geometry.inner[i] ?? 'right',
            }}
          />
        ))}
      </div>

      {frame.tab !== null && (
        <div className={styles.tab} style={at(frame.tab)}>
          Hands
        </div>
      )}

      {landscape ? (
        <>
          <div
            className={styles.heroInset}
            style={at({ ...geometry.hero, x: box.x + geometry.hero.x, y: box.y + geometry.hero.y })}
          >
            <Card card={SAMPLE.hole[0]} size="xxl" highlight="core" />
            <Card card={SAMPLE.hole[1]} size="xxl" highlight="core" className={styles.overlap} />
          </div>
          <div
            className={styles.mock}
            style={{
              left: viewport.w - SHELL.landscapeColumn,
              top: 0,
              width: SHELL.landscapeColumn,
              height: viewport.h,
            }}
          >
            Right column: label, badge, coach, actions
          </div>
        </>
      ) : (
        <>
          <div
            className={styles.heroStrip}
            style={{
              left: 0,
              top: below,
              width: leftWidth,
              height: layout === 'compact' ? SHELL.heroStripCompact : SHELL.heroStrip,
            }}
          >
            <span className={styles.heroCards}>
              <Card
                card={SAMPLE.hole[0]}
                size={layout === 'compact' ? 'xl' : 'xxl'}
                highlight="core"
              />
              <Card
                card={SAMPLE.hole[1]}
                size={layout === 'compact' ? 'xl' : 'xxl'}
                highlight="core"
                className={styles.overlap}
              />
            </span>
            <span className={styles.heroText}>Hero strip</span>
          </div>
          {layout !== 'compact' && !wide && (
            <div
              className={styles.mock}
              style={{
                left: 0,
                top: below + SHELL.heroStrip,
                width: leftWidth,
                height: SHELL.coachStrip,
              }}
            >
              Coach strip
            </div>
          )}
          {wide && (
            <div
              className={styles.mock}
              style={{
                left: 0,
                top: below + SHELL.heroStrip,
                width: leftWidth,
                height: viewport.h - below - SHELL.heroStrip - SHELL.actionBar,
              }}
            >
              Inline coach panel
            </div>
          )}
          <div
            className={styles.mock}
            style={{
              left: 0,
              top: viewport.h - SHELL.actionBar,
              width: leftWidth,
              height: SHELL.actionBar,
            }}
          >
            Action bar
          </div>
          {wide && (
            <div
              className={styles.mock}
              style={{ left: leftWidth, top: 0, width: viewport.w - leftWidth, height: viewport.h }}
            >
              Hand rankings column
            </div>
          )}
        </>
      )}
    </div>
  );
}

const SIZES: CardSize[] = ['xs', 'sm', 'md', 'lg', 'xl', 'xxl', 'board'];

function CardsPreview() {
  const sample = ['As', 'Th', 'Qd', '7c'].map(parseCard);
  return (
    <div className={styles.gallery}>
      {SIZES.map((size) => (
        <section key={size} className={styles.row}>
          <h2>{size}</h2>
          {sample.map((c) => (
            <Card key={c} card={c} size={size} />
          ))}
          <Card card={null} size={size} />
          <Card card={sample[0] ?? 0} size={size} highlight="core" />
          <Card card={sample[1] ?? 0} size={size} highlight="kicker" />
          <Card card={sample[2] ?? 0} size={size} highlight="off" />
          <Card card={sample[3] ?? 0} size={size} dim />
          <Card card={sample[0] ?? 0} size={size} used />
        </section>
      ))}
      <section className={styles.row} data-deck="two">
        <h2>two-colour</h2>
        {sample.map((c) => (
          <Card key={c} card={c} size="md" />
        ))}
      </section>
      <section className={styles.deck}>
        {newDeck().map((c) => (
          <Card key={c} card={c} size="sm" />
        ))}
      </section>
    </div>
  );
}

export function Preview() {
  const cards = param('view') === 'cards';
  return (
    <div data-preview={PREVIEW_MARKER} className={styles.root}>
      <SvgSprite />
      {cards ? <CardsPreview /> : <TablePreview />}
    </div>
  );
}
