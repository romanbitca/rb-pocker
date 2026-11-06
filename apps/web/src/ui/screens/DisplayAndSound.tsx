/**
 * Settings' Display and Sound sections (PLAN §12.1; chunk 9.1): "Keep screen on" (the wake lock,
 * §12.13) and "Sound" and "Vibration" (§12.8). A change applies at once through `onChange`, like
 * the Game rows; the controller saves it (Appendix A.7).
 *
 * Where the page cannot keep the screen on (§12.14: the Screen Wake Lock needs https, and older
 * browsers lack it), the row says why after its hint: the switch is kept, so the choice is still
 * there on a page that can. The other Display rows of §12.1 come with later chunks.
 */
import { useId } from 'react';
import { deviceWords as w } from '../../i18n/device.ts';
import { SwitchRow } from './Controls.tsx';
import styles from './Screen.module.css';

/** The rows' settings, named as in `Settings` (Appendix A.7). */
export interface DisplayAndSoundSettings {
  keepAwake: boolean;
  sound: boolean;
  haptics: boolean;
}

/** Can this page keep the screen on: yes, not on plain http, or not in this browser. */
export type WakeLockSupport = 'yes' | 'insecure' | 'missing';

/**
 * The page's wake lock support (§12.14), read the way `app/secure.ts` does. Kept here, in the
 * screens' lazy chunk: reading `secureFeatures` through the store would put `secure.ts` in the
 * initial JS (pitfall 47).
 */
export function wakeLockSupport(win: Window | undefined): WakeLockSupport {
  try {
    if (win === undefined || win.isSecureContext !== true) return 'insecure';
    const lock = (win.navigator as { wakeLock?: unknown }).wakeLock;
    return lock !== null && typeof lock === 'object' ? 'yes' : 'missing';
  } catch {
    return 'missing';
  }
}

export interface DisplayAndSoundProps {
  settings: DisplayAndSoundSettings;
  wakeLock: WakeLockSupport;
  /** Only the changed field. */
  onChange: (patch: Partial<DisplayAndSoundSettings>) => void;
}

export function DisplayAndSound({ settings, wakeLock, onChange }: DisplayAndSoundProps) {
  const id = useId();
  const why =
    wakeLock === 'insecure'
      ? w.keepAwake.insecure
      : wakeLock === 'missing'
        ? w.keepAwake.missing
        : null;
  return (
    <>
      <section className={styles.rows} aria-labelledby={`${id}-display`}>
        <h2 id={`${id}-display`} className={styles.sectionTitle}>
          {w.display}
        </h2>
        <SwitchRow
          id={`${id}-awake`}
          label={w.keepAwake.label}
          hint={why === null ? w.keepAwake.hint : `${w.keepAwake.hint} ${why}`}
          checked={settings.keepAwake}
          onChange={(keepAwake) => onChange({ keepAwake })}
        />
      </section>
      <section className={styles.rows} aria-labelledby={`${id}-sound`}>
        <h2 id={`${id}-sound`} className={styles.sectionTitle}>
          {w.soundSection}
        </h2>
        <SwitchRow
          id={`${id}-sound-on`}
          label={w.sound.label}
          hint={w.sound.hint}
          checked={settings.sound}
          onChange={(sound) => onChange({ sound })}
        />
        <SwitchRow
          id={`${id}-vibration`}
          label={w.vibration.label}
          hint={w.vibration.hint}
          checked={settings.haptics}
          onChange={(haptics) => onChange({ haptics })}
        />
      </section>
    </>
  );
}
