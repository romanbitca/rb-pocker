/**
 * A button that picks a stats file (PLAN §14.8 Import: `<input type="file"
 * accept="application/json,.json">`; chunk 8.4): Settings → Data, Stats → History and the
 * "Played in Safari before?" card.
 *
 * The native file input lies over the button's face (`.fileButton` of Screen.module.css, like the
 * Settings chips), so a tap anywhere opens the browser's own picker with no script in between (iOS
 * opens it only from a real tap); with the keyboard, Tab to it and press Enter or Space. The picked
 * file goes to `onFile`, and the input is emptied so the same file can be picked again.
 */
export interface FileButtonProps {
  label: string;
  /** The look, with `.fileButton`: e.g. `${styles.secondary} ${styles.fileButton}`. */
  className: string;
  describedBy?: string | undefined;
  onFile: (file: File) => void;
}

export function FileButton({ label, className, describedBy, onFile }: FileButtonProps) {
  return (
    <label className={className}>
      <input
        type="file"
        accept="application/json,.json"
        aria-describedby={describedBy}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (file !== undefined) onFile(file);
        }}
      />
      <span>{label}</span>
    </label>
  );
}
