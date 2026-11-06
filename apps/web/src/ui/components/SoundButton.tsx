/**
 * The top bar's mute button (PLAN §12.3, §12.8; chunk 9.1): a 44×44 toggle named "Sound", pressed
 * while sound is on. A tap flips `settings.sound`, saved like any setting; turning sound on inside
 * this tap also starts the audio (§12.13, `app/cues.ts`). In compact mode Undo takes its place and
 * the Menu offers "Turn sound off" / "Turn sound on" instead (§12.3).
 *
 * The speaker is drawn here as one path (never emoji, pitfall 31; §16.4: art is drawn in code):
 * the button costs three DOM nodes of the Table's 600 (§15.3).
 */
import { memo } from 'react';
import { useAppStore, useDispatch, type AppState } from '../../app/store.ts';
import { deviceWords } from '../../i18n/device.ts';

/** A speaker; with sound on, two waves; off, a cross. Lines only, in a 24×24 box. */
const SPEAKER = 'M3 9h4l5-4v14l-5-4H3z';
const WAVES = 'M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13';
const CROSS = 'M16 9l6 6M22 9l-6 6';

const selectSound = (s: AppState): boolean => s.settings.sound;

export interface SoundButtonProps {
  readonly className?: string | undefined;
  readonly iconClassName?: string | undefined;
}

export const SoundButton = memo(function SoundButton({
  className,
  iconClassName,
}: SoundButtonProps) {
  const on = useAppStore(selectSound);
  const dispatch = useDispatch();
  return (
    <button
      type="button"
      className={className}
      aria-label={deviceWords.muteButton}
      aria-pressed={on}
      data-sound={on ? 'on' : 'off'}
      onClick={(e) => {
        e.currentTarget.focus();
        dispatch({ type: 'settings', patch: { sound: !on } });
      }}
    >
      <svg className={iconClassName} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d={SPEAKER + (on ? WAVES : CROSS)}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
});
