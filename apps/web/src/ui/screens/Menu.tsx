/**
 * The Table's ☰ Menu (PLAN §12.3): a modal sheet. While it is open the controller keeps its `menu`
 * gate closed, so no bot acts (Appendix A.8). Esc and the scrim resume; Android Back closes it
 * through the navigation reducer.
 *
 * Items for screens that do not exist yet are hidden, not disabled (§18 Stage 3): Hand rankings,
 * Recent hands, Stats, Learn, About and Install app show only when their callback is given. So
 * does "Keyboard shortcuts" (§12.5, chunk 9.3): only where there is a mouse or a trackpad, and so
 * most likely a keyboard.
 */
import { useId } from 'react';
import { deviceWords } from '../../i18n/device.ts';
import { en } from '../../i18n/en.ts';
import { shortcutWords } from '../../i18n/shortcuts.ts';
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
  /** The hand drill (§13.5), pushed over the Table: Back returns to the hand. */
  onOpenDrill?: (() => void) | undefined;
  /** "Recent hands" (Review, §12.10); given only once a hand is finished. */
  onOpenHands?: (() => void) | undefined;
  /** Absent at a table of the server's (§19.6): Resume, Hand rankings, Sound and Leave table. */
  onOpenSettings?: (() => void) | undefined;
  onOpenStats?: (() => void) | undefined;
  onOpenLearn?: (() => void) | undefined;
  /** The list of keyboard shortcuts (§12.5 "?"). */
  onShowKeys?: (() => void) | undefined;
  /** About (§12.1, chunk 9.2c). */
  onOpenAbout?: (() => void) | undefined;
  onInstall?: (() => void) | undefined;
  /** To Home; the unfinished hand stays saved (§3.1). */
  onLeaveTable: () => void;
  /** Setup for a new table; the controller asks first when a hand is unfinished (§3.1). */
  onNewTable?: (() => void) | undefined;
  /**
   * Compact mode only (§12.3, chunk 9.1): Undo has the mute button's place in the top bar, so the
   * Menu turns sound off or on ("Turn sound off" / "Turn sound on"). `on`: sound is on now.
   */
  sound?: { on: boolean; onToggle: () => void } | undefined;
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
  add('drill', en.drill.title, props.onOpenDrill);
  add('hands', en.menu.hands, props.onOpenHands);
  if (props.sound) {
    const { on, onToggle } = props.sound;
    add('sound', on ? deviceWords.menu.soundOff : deviceWords.menu.soundOn, onToggle);
  }
  add('settings', en.menu.settings, props.onOpenSettings);
  add('stats', en.menu.stats, props.onOpenStats);
  add('learn', en.menu.learn, props.onOpenLearn);
  add('keys', shortcutWords.title, props.onShowKeys);
  add('about', en.about, props.onOpenAbout);
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
