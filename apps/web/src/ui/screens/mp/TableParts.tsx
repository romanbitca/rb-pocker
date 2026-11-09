/**
 * The small parts of Play with friends that sit in the screens of the game (PLAN §19.6, §19.10):
 * the connection's banner over the Table, the same words under the form screens, and what replaces
 * Row A while the player sits out.
 */
import { memo, type CSSProperties } from 'react';
import { selectConnection, useAppStore, useDispatch } from '../../../app/store.ts';
import { mpWords } from '../../../i18n/mp.ts';
import bar from '../../components/ActionBar.module.css';
import styles from '../Screen.module.css';

const t = mpWords;

/** Over the table box, under its top bar: what a thin line can say, or the card with its buttons. */
const OVER_TABLE: CSSProperties = { position: 'absolute', top: 4, right: 4, left: 4, zIndex: 20 };
const THIN_LINE: CSSProperties = {
  width: 'fit-content',
  margin: '0 auto',
  padding: '2px 12px',
  borderRadius: 'var(--radius-2)',
  background: 'var(--surface)',
  fontSize: '0.875rem',
  textAlign: 'center',
};

/**
 * §19.10 Disconnected: a thin line over the Table while the socket tries again ("The bar is
 * locked": the driver's `legal: null`), and after two minutes the card with "Try again" and "Leave
 * table". The table underneath stays on show.
 */
export const ConnectionBanner = memo(function ConnectionBanner() {
  const connection = useAppStore(selectConnection);
  const dispatch = useDispatch();
  if (connection === 'reconnecting') {
    return (
      <div style={OVER_TABLE} role="status">
        <p style={THIN_LINE}>{t.connection.lost}</p>
      </div>
    );
  }
  if (connection !== 'lost') return null;
  return (
    <div style={OVER_TABLE}>
      {/* A solid card: the seat under it would show through the words. */}
      <div className={styles.card} role="alert" style={{ background: 'var(--surface)' }}>
        <p>{t.connection.gone}</p>
        <div className={styles.cardButtons}>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => dispatch({ type: 'mpTryAgain' })}
          >
            {t.connection.tryAgain}
          </button>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => dispatch({ type: 'leaveTable' })}
          >
            {t.leave.confirm}
          </button>
        </div>
      </div>
    </div>
  );
});

/**
 * The same two states on a screen with no table behind it ("New table", "Joining the table…", the
 * waiting room): one line, and "Try again" once the socket has given up. Empty while all is well.
 */
export const ConnectionLine = memo(function ConnectionLine() {
  const connection = useAppStore(selectConnection);
  const dispatch = useDispatch();
  if (connection === 'reconnecting') {
    return (
      <p className={styles.hint} role="status">
        {t.connection.lost}
      </p>
    );
  }
  if (connection !== 'lost') return null;
  return (
    <div className={styles.action} role="alert">
      <p className={styles.hint}>{t.connection.gone}</p>
      <button
        type="button"
        className={styles.secondary}
        onClick={() => dispatch({ type: 'mpTryAgain' })}
      >
        {t.connection.tryAgain}
      </button>
    </div>
  );
});

/**
 * §19.10 Sitting out: the line and "I'm back" take Row A's place (and its height: the same bar, so
 * nothing above moves). `column`: the landscape column's two rows.
 */
export const SittingOut = memo(function SittingOut({ column }: { column: boolean }) {
  const dispatch = useDispatch();
  return (
    <div className={column ? `${bar.bar} ${bar.column}` : bar.bar}>
      <p style={{ gridColumn: 'span 2', margin: 0, alignSelf: 'center', textAlign: 'center' }}>
        {t.sittingOut.line}
      </p>
      <button
        type="button"
        className={styles.primary}
        style={{ padding: 0 }}
        data-slot="right"
        onClick={() => dispatch({ type: 'mpImBack' })}
      >
        {t.sittingOut.back}
      </button>
    </div>
  );
});
