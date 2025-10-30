import type { JSX } from 'react';
import { PauseIcon } from '../icons/Pause';
import { PlayIcon } from '../icons/Play';

/**
 * A button component that toggles between paused and resumed states.
 *
 * @param paused - Indicates whether the calculations are currently paused.
 * @param setPaused - Function to update the paused state.
 *
 * The button displays different styles, icons, and labels depending on the paused state.
 * When clicked, it toggles the paused state and updates the UI accordingly.
 */
export function PauseButton({
  paused,
  setPaused,
}: {
  paused: boolean;
  setPaused: (value: boolean) => void;
}): JSX.Element {
  return (
    <div className="flex-shrink-0">
      <button
        type="button"
        onClick={() => setPaused(!paused)}
        aria-pressed={paused}
        title={paused ? 'Resume calculations' : 'Pause calculations'}
        className={`btn-base ${paused ? 'btn-brand-outline' : 'btn-brand'}`}
      >
        {paused ? <PlayIcon /> : <PauseIcon />}
        <span>{paused ? 'Resume' : 'Pause'}</span>
      </button>
    </div>
  );
}
