/**
 * The resting composer (spec 08, t3code's `composerFooterLayout` and `composerScrollGesture`):
 * when the rail's composer folds to one line with its controls in a strip below, and the
 * scroll gesture and keys that fold it.
 */

export const COMPOSER_SCROLL_COLLAPSE_THRESHOLD_PX = 24;
export const COMPOSER_SCROLL_GESTURE_RESET_MS = 120;
const RESTING_IMAGE_THUMBNAIL_LIMIT = 3;

export interface RestingComposerInput {
  readonly isExistingChat: boolean;
  /** t3code's phone breakpoint (`max-sm`), where the composer never rests. */
  readonly isNarrowViewport: boolean;
  readonly isScrollCollapsed: boolean;
  /** Anything the person must see or is using: a panel above the box, a menu, a notice, an upload. */
  readonly hasExpandedChrome: boolean;
  readonly hasMultilinePrompt: boolean;
  readonly transcriptOverflows: boolean;
}

export const shouldRestComposer = (input: RestingComposerInput): boolean =>
  input.isExistingChat && !input.isNarrowViewport && input.transcriptOverflows && input.isScrollCollapsed && !input.hasMultilinePrompt && !input.hasExpandedChrome;

export interface ComposerScrollGesture {
  accumulatedDeltaPx: number;
  collapseSuppressed: boolean;
  lastEventAt: number;
}

export const createComposerScrollGesture = (): ComposerScrollGesture => ({ accumulatedDeltaPx: 0, collapseSuppressed: false, lastEventAt: Number.NEGATIVE_INFINITY });

export const resetComposerScrollGesture = (state: ComposerScrollGesture): void => {
  state.accumulatedDeltaPx = 0;
  state.collapseSuppressed = false;
  state.lastEventAt = Number.NEGATIVE_INFINITY;
};

/** Typing during a gesture keeps that gesture from folding the composer the person is using. */
export const suppressComposerScrollGesture = (state: ComposerScrollGesture, now: number, gestureResetMs = COMPOSER_SCROLL_GESTURE_RESET_MS): void => {
  if (now - state.lastEventAt <= gestureResetMs) state.collapseSuppressed = true;
};

/** Records one wheel event of a gesture; answers whether the composer rests now. */
export const recordComposerScrollGesture = (
  state: ComposerScrollGesture,
  input: {
    readonly now: number;
    readonly deltaPx: number;
    readonly collapseEligible: boolean;
    readonly canScrollInGestureDirection: boolean;
    readonly scrollsTowardEnd: boolean;
    readonly collapseThresholdPx?: number;
  },
): boolean => {
  state.lastEventAt = input.now;
  if (state.collapseSuppressed || !input.collapseEligible || !input.canScrollInGestureDirection || input.scrollsTowardEnd) {
    state.accumulatedDeltaPx = 0;
    return false;
  }
  state.accumulatedDeltaPx += input.deltaPx;
  if (state.accumulatedDeltaPx < (input.collapseThresholdPx ?? COMPOSER_SCROLL_COLLAPSE_THRESHOLD_PX)) return false;
  state.accumulatedDeltaPx = 0;
  return true;
};

export const shouldCollapseComposerForScrollKey = (input: {
  readonly key: string;
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly isAtEnd: boolean;
}): boolean => {
  switch (input.key) {
    case "PageUp":
    case "Home":
      return input.scrollTop > 1;
    case "PageDown":
    case "End":
      return !input.isAtEnd && input.scrollTop < input.scrollHeight - input.clientHeight - 1;
    default:
      return false;
  }
};

export const shouldAnimateRestingTransition = (input: {
  readonly hasCompletedInitialLayout: boolean;
  readonly stateChanged: boolean;
  readonly hasInterruptedAnimation: boolean;
}): boolean => input.hasCompletedInitialLayout && (input.stateChanged || input.hasInterruptedAnimation);

export const restingImagePreviewCounts = (imageCount: number): { visibleCount: number; overflowCount: number } => {
  const visibleCount = Math.min(imageCount, RESTING_IMAGE_THUMBNAIL_LIMIT);
  return { visibleCount, overflowCount: Math.max(0, imageCount - visibleCount) };
};
