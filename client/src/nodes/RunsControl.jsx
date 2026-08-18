import { useState } from 'react';
// The cap lives in the pure module, which is where truncation is computed; see it there.
import { MAX_RUNS } from '../graph/resolve.js';

// Typed input is clamped rather than rejected: 15 becomes 10, 0 or empty becomes 1.
export const clampRuns = (v) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_RUNS, Math.max(1, n));
};

/**
 * The run count and the Free mode are one choice, so they are one control: a
 * segmented pill whose left half is the number and whose right half is Free.
 *
 * Both halves stay live in both modes. The number is always readable, and
 * touching it is what switches back to a fixed count — an earlier version
 * blanked and disabled it under Free, which left no way back to a fixed number
 * except toggling Free off, and no clue that was the way.
 *
 * ponytail: a plain input and button rather than TextInput/ToggleButton. The
 * design system has no segmented input, and joining two of its controls means
 * stripping the border, radius and background off each — more CSS than building
 * the pill outright, and it breaks whenever those internals change.
 */
export default function RunsControl({ runs, freeRuns, onRunsChange, onModeChange }) {
  // Holds exactly what was typed (including "" or "0" mid-edit) so the field
  // doesn't fight the user, while the value handed upward is always clamped.
  const [draft, setDraft] = useState(null);

  return (
    <span className="xruns nodrag" role="group" aria-label="Runs">
      <input
        className="xruns-num"
        type="number"
        min={1}
        max={MAX_RUNS}
        step={1}
        aria-label="Number of runs"
        data-active={!freeRuns}
        value={draft ?? String(runs)}
        onChange={(e) => {
          const digits = e.target.value.replace(/[^\d]/g, '').slice(0, 2);
          setDraft(digits);
          onRunsChange(clampRuns(digits));
          onModeChange(false);
        }}
        // Reaching for the number IS choosing a fixed count; requiring a separate
        // click on some other control first would be a step with no purpose.
        // Both gestures, unconditionally: pointerdown is the mouse path, focus the
        // keyboard one, and re-asserting a mode already set costs nothing, while a
        // `freeRuns &&` guard here reads a prop that can be a render behind.
        onPointerDown={() => onModeChange(false)}
        onFocus={() => onModeChange(false)}
        onBlur={() => setDraft(null)}
      />
      <button
        type="button"
        className="xruns-free"
        data-active={freeRuns}
        aria-pressed={freeRuns}
        title="Free takes the number of runs from the flow. Wire in a prompt or text node listing what to generate — sections split by lines containing only ---, or prose a text model can split — and each item becomes one image."
        onClick={() => {
          setDraft(null);
          onModeChange(true);
        }}
      >
        Free
      </button>
    </span>
  );
}
