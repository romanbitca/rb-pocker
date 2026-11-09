/**
 * The dialogs of Play with friends (PLAN §19.6, §19.10). `LeaveDialog`: what Back and the Menu ask
 * at a table. `ProblemDialog`: a table that ended, a join that failed, a login that was refused;
 * only its own buttons close it.
 */
import { useId } from 'react';
import { selectMpProblem, useAppStore, useDispatch, type MpProblem } from '../../../app/store.ts';
import { mpWords } from '../../../i18n/mp.ts';
import { Modal } from '../../components/Modal.tsx';
import o from '../Overlays.module.css';
import styles from '../Screen.module.css';

const t = mpWords;

export function LeaveDialog() {
  const dispatch = useDispatch();
  const textId = useId();
  const stay = () => dispatch({ type: 'close', overlay: 'mpLeave' });
  return (
    <Modal kind="dialog" alert labelledBy={textId} onDismiss={stay}>
      <p id={textId} className={o.text}>
        {t.leave.text}
      </p>
      {/* The safe answer comes first: it has the gold and the focus (§19.10). */}
      <div className={o.buttons}>
        <button type="button" className={styles.primary} onClick={stay}>
          {t.leave.stay}
        </button>
        <button
          type="button"
          className={styles.secondary}
          onClick={() => {
            stay();
            dispatch({ type: 'leaveTable' });
          }}
        >
          {t.leave.confirm}
        </button>
      </div>
    </Modal>
  );
}

/** What the `mpProblem` dialog says (§19.10). */
export function problemText(problem: MpProblem): string {
  switch (problem.kind) {
    case 'ended':
      return t.ended[problem.reason];
    case 'alreadySeated':
      return t.alreadySeated;
    default:
      return t[problem.kind];
  }
}

export function ProblemDialog() {
  const problem = useAppStore(selectMpProblem);
  const dispatch = useDispatch();
  const textId = useId();
  if (problem === null) return null;
  return (
    <Modal kind="dialog" alert labelledBy={textId}>
      <p id={textId} className={o.text}>
        {problemText(problem)}
      </p>
      <div className={o.buttons}>
        {problem.kind === 'alreadySeated' ? (
          <>
            <button
              type="button"
              className={styles.primary}
              onClick={() => dispatch({ type: 'mpGoToMyTable' })}
            >
              {t.stayAtMyTable}
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => dispatch({ type: 'mpLeaveAndJoin' })}
            >
              {t.leaveAndJoin}
            </button>
          </>
        ) : (
          <button
            type="button"
            className={styles.primary}
            onClick={() => dispatch({ type: 'mpDismiss' })}
          >
            {t.ok}
          </button>
        )}
      </div>
    </Modal>
  );
}
