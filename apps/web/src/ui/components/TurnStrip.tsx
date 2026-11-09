/**
 * The status strip of a table of the server's (PLAN §19.6, §19.10), in the coach's place: whose
 * turn it is and the seconds left, the wait for the next hand, or that the viewer is not dealt in.
 * Below 10 seconds the seconds are bold, so the warning is not colour alone.
 *
 * A display timer (§0.3 leaves the UI's to the UI): one `setTimeout` chain, a tick at each whole
 * second of what is left. It reads `performance.now()`, the clock the driver's `endsAt` is on, so
 * the phone's own clock does not matter (§19.1 decision 3). Only the words that change once a turn
 * are announced; the running seconds are not.
 *
 * Look: inline, so this chunk adds nothing to the one stylesheet (its budget is nearly used, §15.3).
 */
import { memo, useEffect, useState, type CSSProperties } from 'react';
import { selectTurn, useAppStore, type MpTurn } from '../../app/store.ts';
import { mpWords } from '../../i18n/mp.ts';

const t = mpWords.strip;

/** Where it sits: portrait's 56 px row, compact mode's pill, the landscape column, the wide panel. */
export type TurnStripVariant = 'strip' | 'pill' | 'side' | 'panel';

const BOX: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  minWidth: 0,
  padding: '0 8px',
  fontWeight: 600,
  lineHeight: 1.2,
  textAlign: 'center',
};

const VARIANT: Readonly<Record<TurnStripVariant, CSSProperties>> = {
  strip: { height: 50 },
  pill: { height: 44, maxWidth: 200, gap: 6, fontSize: '0.875rem' },
  side: { minHeight: 44, flexWrap: 'wrap' },
  panel: { minHeight: 44 },
};

const NUMBERS: CSSProperties = {
  flex: 'none',
  fontVariantNumeric: 'tabular-nums',
  fontWeight: 400,
};
/** Below this many seconds they are bold (§19.10). */
const LOW_SECONDS = 10;

/** The whole seconds left on `endsAt`, kept fresh by a timer while there is a clock. */
function useSecondsLeft(endsAt: number | null): number {
  const [, tick] = useState(0);
  useEffect(() => {
    if (endsAt === null) return;
    let timer: ReturnType<typeof setTimeout>;
    const next = (): void => {
      const left = endsAt - performance.now();
      if (left <= 0) return;
      timer = setTimeout(
        () => {
          tick((n) => n + 1);
          next();
        },
        left % 1000 || 1000,
      );
    };
    next();
    return () => clearTimeout(timer);
  }, [endsAt]);
  return endsAt === null ? 0 : Math.max(0, Math.ceil((endsAt - performance.now()) / 1000));
}

const endsAtOf = (turn: MpTurn | null): number | null =>
  turn === null || turn.kind === 'notDealtIn' ? null : turn.endsAt;

export interface TurnStripProps {
  variant: TurnStripVariant;
  className?: string | undefined;
}

export const TurnStrip = memo(function TurnStrip({ variant, className }: TurnStripProps) {
  const turn = useAppStore(selectTurn);
  const seconds = useSecondsLeft(endsAtOf(turn));
  const box = { ...BOX, ...VARIANT[variant] };
  // Nothing to say (cards are being turned, the hand is between streets): its row stays.
  if (turn === null) return <div className={className} style={box} data-turn="" />;
  if (turn.kind === 'nextHand') {
    return (
      <div className={className} style={box} data-turn="nextHand">
        <span>{t.nextHand(seconds)}</span>
      </div>
    );
  }
  if (turn.kind === 'notDealtIn') {
    return (
      <div className={className} style={box} data-turn="notDealtIn" role="status">
        <span>{t.notDealtIn}</span>
      </div>
    );
  }
  const low = seconds < LOW_SECONDS;
  return (
    <div className={className} style={box} data-turn={turn.kind}>
      {/* A long name wraps: no "…" on the Table (1.3.100). */}
      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }} role="status">
        {turn.kind === 'you' ? t.yourTurn : t.thinking(turn.name)}
      </span>
      <span
        style={low ? { ...NUMBERS, fontWeight: 700 } : NUMBERS}
        aria-hidden="true"
        data-seconds={low ? 'low' : ''}
      >
        {t.seconds(seconds)}
      </span>
    </div>
  );
});
