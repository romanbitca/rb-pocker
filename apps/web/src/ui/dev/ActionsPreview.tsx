/**
 * Dev-only preview of the action bar and sizing tray: open `/?preview=actions` on the dev server
 * (`&spot=shortCall`, `&unit=bb`, `&tray=open`). `main.tsx` loads this module only when
 * `import.meta.env.DEV`, so production builds never contain it (tests/ui/dev/actionsBundle.test.ts).
 *
 * Around the bar is a rough mock of the PLAN §12.3 / §12.5 layouts (top bar, table with the board,
 * hero strip, coach strip), so the tray can be checked where it will really sit: above Row A in
 * portrait, over the bottom 104 px of the table in compact mode (375×667), in the right column in
 * landscape. The mock's texts are developer text, never shown to players, so they stay here
 * instead of in `i18n/en.ts`.
 */
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { PlayerAction } from '../../engine/types.ts';
import {
  actionBarView,
  formatAmount,
  potOf,
  useSizing,
  type ActionBarInput,
  type AmountUnit,
} from '../actionBar.ts';
import { ActionBar } from '../components/ActionBar.tsx';
import { SizingTray } from '../components/SizingTray.tsx';
import { ACTION_SPOT_IDS, ACTION_SPOTS, type ActionSpotId } from './actionFixtures.ts';
import styles from './ActionsPreview.module.css';

/** Marks the preview in the DOM; the bundle test checks this string never ships. */
export const ACTIONS_PREVIEW_MARKER = 'rb-actions-preview';

/** The PLAN §12.3 layout selection (first match wins), plus compact mode. */
type Layout = 'wide' | 'landscape' | 'compact' | 'portrait';

function currentLayout(): Layout {
  if (matchMedia('(min-width: 900px) and (min-height: 560px)').matches) return 'wide';
  if (matchMedia('(orientation: landscape) and (max-height: 559px)').matches) return 'landscape';
  return matchMedia('(max-height: 640px)').matches ? 'compact' : 'portrait';
}

function useLayout(): Layout {
  const [layout, setLayout] = useState(currentLayout);
  useEffect(() => {
    const onResize = () => setLayout(currentLayout());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return layout;
}

const param = (name: string): string | null =>
  new URLSearchParams(window.location.search).get(name);

function describeAction(a: PlayerAction, input: ActionBarInput): string {
  const amount = (to: number) => formatAmount(to, input.bb, input.amounts);
  switch (a.type) {
    case 'bet':
      return `You bet ${amount(a.to)}`;
    case 'raise':
      return `You raise to ${amount(a.to)}`;
    default:
      return `You ${a.type}`;
  }
}

/** A white card with only a rank on it (the real cards are PR #15's `Card`). */
function MockCard({ rank, red = false }: { rank: string; red?: boolean }) {
  return <span className={red ? `${styles.card} ${styles.red}` : styles.card}>{rank}</span>;
}

export function ActionsPreview() {
  const [spot, setSpot] = useState<ActionSpotId>(() => {
    const s = param('spot');
    return ACTION_SPOT_IDS.find((id) => id === s) ?? 'facing';
  });
  const [unit, setUnit] = useState<AmountUnit>(() => (param('unit') === 'bb' ? 'bb' : 'chips'));
  const [last, setLast] = useState('');
  const layout = useLayout();
  const trayId = useId();

  const input = useMemo<ActionBarInput>(
    () => ({ ...ACTION_SPOTS[spot], amounts: unit }),
    [spot, unit],
  );
  const view = useMemo(() => actionBarView(input), [input]);
  const sizing = useSizing(view.tray);
  const { openTray } = sizing;

  // `&tray=open`: open the tray on load and after every spot change (for screenshots).
  useEffect(() => {
    if (param('tray') === 'open') openTray();
  }, [openTray]);

  const onAct = useCallback((a: PlayerAction) => setLast(describeAction(a, input)), [input]);

  const tray =
    sizing.open && view.tray !== null ? (
      <SizingTray
        id={trayId}
        tray={view.tray}
        amount={sizing.amount}
        onAmount={sizing.setAmount}
        onClose={sizing.closeTray}
        placement={layout === 'compact' ? 'overlay' : layout === 'landscape' ? 'panel' : 'inline'}
      />
    ) : null;

  const bar = (
    <ActionBar
      view={view}
      trayOpen={sizing.open}
      amount={sizing.amount}
      trayId={trayId}
      onAct={onAct}
      onOpenTray={sizing.openTray}
      onCloseTray={sizing.closeTray}
      layout={layout === 'landscape' ? 'column' : 'row'}
      className={styles.bar}
    />
  );

  const pot = formatAmount(potOf(input.seats), input.bb, input.amounts);
  const topBar = (
    <header className={styles.top}>
      <select
        className={styles.select}
        value={spot}
        aria-label="Spot"
        onChange={(e) => {
          setSpot(e.currentTarget.value as ActionSpotId);
          setLast('');
        }}
      >
        {ACTION_SPOT_IDS.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setUnit((u) => (u === 'chips' ? 'bb' : 'chips'))}
      >
        {unit === 'chips' ? 'Chips' : 'BB'}
      </button>
      <span className={styles.info}>
        Blinds {input.sb}/{input.bb} · {layout}
      </span>
    </header>
  );

  const table = (
    <section className={styles.table}>
      <div className={styles.felt} />
      <p className={styles.last}>{last}</p>
      <p className={styles.pot}>Pot {pot}</p>
      <div className={styles.board} data-check="board">
        <MockCard rank="Q" red />
        <MockCard rank="7" red />
        <MockCard rank="2" />
        {input.street === 'flop' ? null : <MockCard rank="J" />}
      </div>
      {layout === 'compact' ? tray : null}
    </section>
  );

  const hero = (
    <section className={styles.hero}>
      <div className={styles.hole} data-check="hole">
        <MockCard rank="K" red />
        <MockCard rank="K" />
      </div>
      <div className={styles.handText}>
        <strong>Pair of Kings</strong>
        <span className={styles.muted}>You · 1,940</span>
      </div>
      {layout === 'compact' ? <span className={styles.pill}>Coach</span> : null}
    </section>
  );

  if (layout === 'landscape') {
    return (
      <div className={styles.landscape} data-preview={ACTIONS_PREVIEW_MARKER} data-layout={layout}>
        <div className={styles.leftColumn}>
          {topBar}
          {table}
          {hero}
        </div>
        <aside className={styles.side}>
          {tray ?? <p className={styles.coachText}>Coach: Call 120. The price is good.</p>}
          {bar}
        </aside>
      </div>
    );
  }

  return (
    <div className={styles.shell} data-preview={ACTIONS_PREVIEW_MARKER} data-layout={layout}>
      {topBar}
      {table}
      {hero}
      {layout === 'compact' ? null : (
        <p className={styles.coach}>Coach: Call 120. The price is good. ›</p>
      )}
      {layout === 'compact' ? null : tray}
      {bar}
    </div>
  );
}
