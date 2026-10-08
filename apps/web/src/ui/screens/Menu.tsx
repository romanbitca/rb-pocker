/**
 * The Table's ☰ Menu (PLAN §12.3): a modal sheet. While it is open the controller keeps its `menu`
 * gate closed, so no bot acts (Appendix A.8). Esc and the scrim resume; Android Back closes it
 * through the navigation reducer.
 *
 * Items for screens that do not exist yet are hidden, not disabled (§18 Stage 3): Hand rankings,
 * Recent hands, Stats, Learn and Install app show only when their callback is given.
 */
import { useId } from 'react';
import { en } from '../../i18n/en.ts';
import { Modal } from '../components/Modal.tsx';
import { formatChips } from './numbers.ts';
import o from './Overlays.module.css';

export interface MenuProps {
  /** Resume: close the menu (also Esc and a tap outside). */
  onResume: () => void;
  /**
   * "Top up to {startingStack} chips": between hands and only when the hero is below the
   * starting stack (§3.1), else null.
   */
  topUpTo: number | null;
  /** A reload up to the starting stack (§3.1). */
  onTopUp: () => void;
  onOpenRankings?: (() => void) | undefined;
  /** "Recent hands" (Review, §12.10); given only once a hand is finished. */
  onOpenHands?: (() => void) | undefined;
  onOpenSettings: () => void;
  onOpenStats?: (() => void) | undefined;
  onOpenLearn?: (() => void) | undefined;
  onInstall?: (() => void) | undefined;
  /** To Home; the unfinished hand stays saved (§3.1). */
  onLeaveTable: () => void;
  /** Setup for a new table; the controller asks first when a hand is unfinished (§3.1). */
  onNewTable: () => void;
}

export function Menu(props: MenuProps) {
  const titleId = useId();
  const items: { key: string; label: string; run: () => void }[] = [
    { key: 'resume', label: en.menu.resume, run: props.onResume },
  ];
  const add = (key: string, label: string, run: (() => void) | undefined) => {
    if (run) items.push({ key, label, run });
  };
  if (props.topUpTo !== null) {
    add('topUp', en.menu.topUp(formatChips(props.topUpTo)), props.onTopUp);
  }
  add('rankings', en.menu.rankings, props.onOpenRankings);
  add('hands', en.menu.hands, props.onOpenHands);
  add('settings', en.menu.settings, props.onOpenSettings);
  add('stats', en.menu.stats, props.onOpenStats);
  add('learn', en.menu.learn, props.onOpenLearn);
  add('install', en.menu.install, props.onInstall);
  add('leave', en.menu.leaveTable, props.onLeaveTable);
  add('newTable', en.menu.newTable, props.onNewTable);

  return (
    <Modal kind="sheet" labelledBy={titleId} onDismiss={props.onResume}>
      <h2 id={titleId} className={o.title}>
        {en.menu.title}
      </h2>
      <ul className={o.items}>
        {items.map((item) => (
          <li key={item.key}>
            <button type="button" className={o.item} onClick={() => item.run()}>
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
