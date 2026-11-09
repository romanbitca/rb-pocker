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
import { selectTurn, useAppStore, type AppState, type MpTurn } from '../../app/store.ts';
import { mpWords } from '../../i18n/mp.ts';

const t = mpWords.strip;

/**
 * Where it sits: portrait's 56 px row, compact mode's pill, the landscape column, the wide panel,
 * the Hands drawer (which covers the first two).
 */
export type TurnStripVariant = 'strip' | 'pill' | 'side' | 'panel' | 'drawer';

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
  // At 360 px it ends before "You · 975 SB", on the same row of the hero strip. The padding: its
  // lower 8 px are over Row A's edge, and two lines of words stay above that.
  pill: {
    height: 44,
    maxWidth: 'min(200px, 40vw)',
    gap: 6,
    paddingBottom: 8,
    fontSize: '0.875rem',
  },
  side: { minHeight: 44, flexWrap: 'wrap' },
  panel: { minHeight: 44 },
  drawer: {
    flex: 'none',
    height: 40,
    gap: 8,
    borderBottom: '1px solid rgb(242 245 243 / 8%)',
    fontSize: '0.875rem',
  },
};

const NUMBERS: CSSProperties = {
  flex: 'none',
  fontVariantNumeric: 'tabular-nums',
  fontWeight: 400,
};
/** Below this many seconds they are bold (§19.10). */
const LOW_SECONDS = 10;

/**
 * A name of up to 24 characters, one line (§19.10): it gives way, the rest stays. Beside "is
 * thinking" when both fit on the line, above it when they do not.
 */
const NAME: CSSProperties = {
  display: 'inline-block',
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  verticalAlign: 'bottom',
  whiteSpace: 'nowrap',
};

/** The table's own setting: the first decision's 1.5 s of grace (§19.5) is not said (61 of 60). */
const selectLimit = (s: AppState): number => s.mp.view?.settings.turnSeconds ?? Infinity;

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
  const limit = useAppStore(selectLimit);
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
  // The time an offline player has is up: the server has played the turn, and the next view says
  // how. Until then nothing here is known.
  if (turn.kind === 'youOffline' && seconds === 0) {
    return <div className={className} style={box} data-turn="" />;
  }
  const shown = Math.min(seconds, limit);
  const low = shown < LOW_SECONDS;
  return (
    <div className={className} style={box} data-turn={turn.kind}>
      <span style={{ minWidth: 0 }} role="status">
        {turn.kind === 'you' ? (
          t.yourTurn
        ) : turn.kind === 'youOffline' ? (
          t.yourTurnOffline
        ) : (
          <>
            <span style={NAME}>{turn.name}</span>
            {t.thinking('')}
          </>
        )}
      </span>
      <span
        style={low ? { ...NUMBERS, fontWeight: 700 } : NUMBERS}
        aria-hidden="true"
        data-seconds={low ? 'low' : ''}
      >
        {t.seconds(shown)}
      </span>
    </div>
  );
});
