/**
 * The waiting room of Play with friends (PLAN §19.10), screen `mpRoom`: the invite on top, the
 * seats filling up, the host's "Start game". Before the first view it says "Joining the table…".
 * Telegram's share list opens through the driver (the bridge, §19.7); the link's words are
 * here because `app` has no words (§2.1).
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { selectMpView, useAppStore, useDispatch } from '../../../app/store.ts';
import { mpWords } from '../../../i18n/mp.ts';
import type { SeatInfo, TableView } from '../../../net/protocol.ts';
import o from '../Overlays.module.css';
import { ScreenBar } from '../ScreenBar.tsx';
import styles from '../Screen.module.css';
import { ConnectionLine } from './TableParts.tsx';

const t = mpWords.waiting;

/** How long "Link copied." stays. A display timer (§0.3 leaves the UI's to the UI). */
const COPIED_MS = 3000;

const ROW: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12 };

/** Who the server would deal in (§19.4 `start`: at least 2 of them). */
const canPlay = (seat: SeatInfo | null): boolean =>
  seat !== null && seat.stack > 0 && (seat.status === 'nextHand' || seat.status === 'playing');

function Joining() {
  const dispatch = useDispatch();
  return (
    <main className={styles.page}>
      <ScreenBar title={mpWords.joining} onBack={() => dispatch({ type: 'back' })} />
      <div className={styles.content}>
        <ConnectionLine />
      </div>
    </main>
  );
}

/** One row per seat of the table: "You", the name or "Empty seat", then "Host" and "Offline". */
function Seats({ view }: { view: TableView }) {
  return (
    <ul className={o.items}>
      {view.seats.map((seat, i) => (
        <li key={i} style={ROW}>
          <span style={seat === null ? { color: 'var(--muted)' } : undefined}>
            {seat === null ? t.emptySeat : i === view.you ? t.you : seat.name}
          </span>
          {seat !== null && (seat.host || !seat.online) && (
            <strong>
              {[seat.host && t.host, !seat.online && t.offline].filter(Boolean).join(' · ')}
            </strong>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * "Invite friends" opens Telegram's own share list; "Copy link" only where the page has a
 * clipboard, and "Link copied." says it worked.
 */
function Invite({ link }: { link: string }) {
  const dispatch = useDispatch();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  // Absent on a page that is not a secure context (`navigator.clipboard` is then undefined).
  const clipboard = navigator.clipboard as Clipboard | undefined;
  const copy = () => {
    clipboard?.writeText(link).then(
      () => {
        setCopied(true);
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_MS);
      },
      () => {
        // The browser said no: the button stays, and "Invite friends" works anyway.
      },
    );
  };
  return (
    <section className={styles.section}>
      <p style={{ margin: 0 }}>{t.inviteLine}</p>
      <button
        type="button"
        className={styles.primary}
        onClick={() => dispatch({ type: 'mpShareInvite', text: t.shareText })}
      >
        {t.invite}
      </button>
      {clipboard !== undefined && (
        <button type="button" className={styles.secondary} onClick={copy}>
          {t.copy}
        </button>
      )}
      <p className={styles.hint} role="status" style={{ minHeight: '1.25em' }}>
        {copied ? t.copied : ''}
      </p>
    </section>
  );
}

function Room({ view }: { view: TableView }) {
  const dispatch = useDispatch();
  const me = view.seats[view.you] ?? null;
  const host = view.seats.find((seat) => seat?.host === true) ?? null;
  const enough = view.seats.filter(canPlay).length >= 2;
  return (
    <main className={styles.page}>
      {/* Back asks "Leave this table?" here: the driver's trap (§19.6). */}
      <ScreenBar title={t.title(view.code)} onBack={() => dispatch({ type: 'back' })} />
      <div className={styles.content}>
        <ConnectionLine />
        <Invite link={view.invite} />
        <Seats view={view} />
        {view.started ? (
          <p className={styles.hint}>{t.tooFew}</p>
        ) : me?.host === true ? (
          <div className={styles.section}>
            <button
              type="button"
              className={styles.primary}
              disabled={!enough}
              onClick={() => dispatch({ type: 'mpStartGame' })}
            >
              {t.start}
            </button>
            {!enough && <p className={styles.hint}>{t.needPlayers}</p>}
          </div>
        ) : (
          host !== null && <p className={styles.hint}>{t.guest(host.name)}</p>
        )}
        <button
          type="button"
          className={styles.secondary}
          onClick={() => dispatch({ type: 'open', overlay: 'mpLeave' })}
        >
          {t.leave}
        </button>
      </div>
    </main>
  );
}

export function WaitingRoom() {
  const view = useAppStore(selectMpView);
  return view === null ? <Joining /> : <Room view={view} />;
}
