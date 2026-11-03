import {
  COMPOSER_SCROLL_GESTURE_RESET_MS,
  createComposerScrollGesture,
  recordComposerScrollGesture,
  resetComposerScrollGesture,
  shouldAnimateRestingTransition,
  shouldCollapseComposerForScrollKey,
  shouldRestComposer,
  suppressComposerScrollGesture,
} from "@unframed/domain";
import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent, type RefObject } from "react";

const TRANSCRIPT = '[data-testid="transcript"]';
/** The transcript's own "following" distance (Transcript.tsx). */
const AT_END_PX = 40;
const SCROLL_KEYS = new Set(["PageUp", "PageDown", "Home", "End"]);
export const RESTING_TRANSITION_MS = 240;
const RESTING_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
const ARRIVAL_DRIFT_PX = 4;
const REDUCED_FADE_MS = 160;

const atEnd = (element: HTMLElement) => element.scrollHeight - element.scrollTop - element.clientHeight <= AT_END_PX;

/** t3code's `isTimelineScrollTarget`: a wheel over a nested scroller that can still move belongs to that scroller. */
const targetsTranscript = (target: EventTarget | null, transcript: HTMLElement, deltaY: number): boolean => {
  if (!(target instanceof Element) || !transcript.contains(target) || deltaY === 0) return false;
  for (let element: Element | null = target; element && element !== transcript; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (style.overflowY !== "auto" && style.overflowY !== "scroll") continue;
    const canScroll = deltaY < 0 ? element.scrollTop > 0 : element.scrollTop < element.scrollHeight - element.clientHeight;
    if (canScroll || style.overscrollBehaviorY === "contain" || style.overscrollBehaviorY === "none") return false;
  }
  return true;
};

/** t3code's `useComposerMultilinePrompt`: whether the prompt runs past one line at the expanded width. */
const promptWraps = (shell: HTMLElement): boolean | null => {
  const editor = shell.querySelector<HTMLElement>(".ProseMirror");
  if (!editor || editor.clientWidth === 0) return null;
  const style = getComputedStyle(shell);
  const width = shell.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
  const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight);
  const range = document.createRange();
  range.selectNodeContents(editor);
  // A resting prompt does not wrap: its scroll width is the line's own width.
  return range.getBoundingClientRect().height > lineHeight + 1 || editor.scrollWidth > width + 1;
};

const useNarrowViewport = () => {
  const [narrow, setNarrow] = useState(() => window.matchMedia("(width < 40rem)").matches);
  useEffect(() => {
    const query = window.matchMedia("(width < 40rem)");
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
};

export interface RestingOptions {
  /** A rail's composer on a chat that exists. */
  readonly enabled: boolean;
  readonly chatId: string | null;
  /** The rail, which holds the transcript. */
  readonly rail: HTMLElement | null;
  readonly shell: RefObject<HTMLDivElement | null>;
  readonly text: string;
  readonly expandedChrome: boolean;
}

/**
 * The resting composer (t3code's): a wheel or scroll key that moves a long transcript
 * away from where it is folds the rail's composer to one line, its controls in a strip
 * below; a click in it, a focus, typing, or scrolling back down to the end unfolds it.
 */
export const useRestingComposer = ({ enabled, chatId, rail, shell, text, expandedChrome }: RestingOptions) => {
  const narrow = useNarrowViewport();
  const [scrollCollapsed, setScrollCollapsed] = useState(false);
  const [wrapped, setWrapped] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const multiline = text.includes("\n") || wrapped;
  const canCollapse = enabled && !narrow && !multiline && !expandedChrome;
  const resting = shouldRestComposer({
    isExistingChat: enabled,
    isNarrowViewport: narrow,
    isScrollCollapsed: scrollCollapsed,
    hasExpandedChrome: expandedChrome,
    hasMultilinePrompt: multiline,
    transcriptOverflows: overflows,
  });
  const collapsed = useRef(scrollCollapsed);
  collapsed.current = scrollCollapsed;
  const gesture = useRef(createComposerScrollGesture());
  const eligible = useRef(false);
  eligible.current = canCollapse && !resting;
  const windowRefocus = useRef(false);

  useEffect(() => setScrollCollapsed(false), [chatId]);
  useEffect(() => {
    if (!canCollapse) setScrollCollapsed(false);
  }, [canCollapse]);

  useEffect(() => {
    const element = shell.current;
    if (!enabled || !element) return;
    const measure = () => {
      const next = promptWraps(element);
      if (next !== null) setWrapped(next);
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    const mutations = new MutationObserver(measure);
    mutations.observe(element, { childList: true, characterData: true, subtree: true });
    return () => {
      resize.disconnect();
      mutations.disconnect();
    };
  }, [enabled, shell]);

  useEffect(() => {
    if (!enabled || !rail) return;
    const transcript = () => rail.querySelector<HTMLElement>(TRANSCRIPT);
    let resetTimer: number | undefined;
    const finishGesture = () => {
      window.clearTimeout(resetTimer);
      resetTimer = undefined;
      resetComposerScrollGesture(gesture.current);
    };
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || !(event.target instanceof Element)) return;
      // The canvas's own wheel (a pan) costs one containment check.
      if (!rail.contains(event.target) && !gesture.current.collapseSuppressed) return;
      const scroller = transcript();
      if (!scroller || (!scroller.contains(event.target) && !gesture.current.collapseSuppressed)) return;
      window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(finishGesture, COMPOSER_SCROLL_GESTURE_RESET_MS);
      setOverflows(scroller.scrollHeight > scroller.clientHeight + 1);
      const onTranscript = targetsTranscript(event.target, scroller, event.deltaY);
      if (onTranscript && event.deltaY > 0 && atEnd(scroller)) setScrollCollapsed(false);
      const canScroll = onTranscript && (event.deltaY < 0 ? scroller.scrollTop > 0 : scroller.scrollTop < scroller.scrollHeight - scroller.clientHeight);
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? scroller.clientHeight : 1;
      const collapse = recordComposerScrollGesture(gesture.current, {
        now: performance.now(),
        deltaPx: Math.abs(event.deltaY) * unit,
        collapseEligible: onTranscript && eligible.current,
        canScrollInGestureDirection: canScroll,
        scrollsTowardEnd: event.deltaY > 0 && atEnd(scroller),
      });
      if (collapse) setScrollCollapsed(true);
    };
    const onKey = (event: KeyboardEvent) => {
      const scroller = transcript();
      if (!SCROLL_KEYS.has(event.key) || !scroller || !(event.target instanceof Node) || !scroller.contains(event.target)) return;
      if (eligible.current && shouldCollapseComposerForScrollKey({ key: event.key, scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight, isAtEnd: atEnd(scroller) }))
        setScrollCollapsed(true);
    };
    // Scrolling down to the end unfolds the composer, and a transcript at its end stays there while the composer's height moves.
    let lastTop = transcript()?.scrollTop ?? 0;
    let wasAtEnd = true;
    const onScroll = (event: Event) => {
      const scroller = transcript();
      if (!scroller || event.target !== scroller) return;
      setOverflows(scroller.scrollHeight > scroller.clientHeight + 1);
      if (scroller.scrollTop > lastTop && atEnd(scroller)) setScrollCollapsed(false);
      lastTop = scroller.scrollTop;
      wasAtEnd = atEnd(scroller);
    };
    let observed: HTMLElement | null = null;
    const resize = new ResizeObserver(() => {
      const scroller = transcript();
      if (!scroller) return;
      if (wasAtEnd) scroller.scrollTop = scroller.scrollHeight;
      setOverflows(scroller.scrollHeight > scroller.clientHeight + 1);
    });
    const observe = () => {
      const scroller = transcript();
      if (scroller === observed) return;
      if (observed) resize.unobserve(observed);
      observed = scroller;
      if (scroller) {
        resize.observe(scroller);
        lastTop = scroller.scrollTop;
        wasAtEnd = atEnd(scroller);
      }
    };
    observe();
    const swaps = new MutationObserver(observe);
    swaps.observe(rail, { childList: true, subtree: true });
    const onWindowFocus = () => {
      windowRefocus.current = true;
      requestAnimationFrame(() => {
        windowRefocus.current = false;
      });
    };
    document.addEventListener("wheel", onWheel, { capture: true, passive: true });
    rail.addEventListener("keydown", onKey, true);
    rail.addEventListener("scroll", onScroll, true);
    window.addEventListener("focus", onWindowFocus);
    return () => {
      document.removeEventListener("wheel", onWheel, true);
      rail.removeEventListener("keydown", onKey, true);
      rail.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("focus", onWindowFocus);
      resize.disconnect();
      swaps.disconnect();
      finishGesture();
    };
  }, [enabled, rail, chatId]);

  const inStrip = (target: EventTarget | null) => target instanceof Element && target.closest("[data-resting-controls]") !== null;

  return {
    resting,
    /** Unfolds it, and keeps a wheel gesture still running from folding it again (typing). */
    expand: () => {
      suppressComposerScrollGesture(gesture.current, performance.now());
      // Called from the editor's own change: a state update there when nothing changes moves the caret.
      if (collapsed.current) setScrollCollapsed(false);
    },
    shellProps: {
      onPointerDownCapture: (event: PointerEvent<HTMLElement>) => {
        const target = event.target;
        if (inStrip(target) || !(target instanceof Element)) return;
        if (target.closest('button, a, input, select, [role="button"], [role="menuitem"]')) return;
        setScrollCollapsed(false);
      },
      onFocusCapture: (event: FocusEvent<HTMLElement>) => {
        if (inStrip(event.target) || windowRefocus.current) return;
        setScrollCollapsed(false);
      },
    },
  };
};

/**
 * t3code's resting transition: the shell's height moves between its two layouts on the
 * drawer curve while the prompt line and Send slide from where they were, and the arriving
 * controls drift in. Under reduced motion nothing moves: the arriving controls only fade.
 */
export const useRestingTransition = (shell: RefObject<HTMLDivElement | null>, resting: boolean) => {
  const previous = useRef<{ resting: boolean; height: number | null; promptFromTop: number | null; actionsFromBottom: number | null }>({
    resting,
    height: null,
    promptFromTop: null,
    actionsFromBottom: null,
  });
  const running = useRef<Animation[]>([]);
  const laidOut = useRef(false);
  const cleanup = useRef<number | undefined>(undefined);

  const measure = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const prompt = element.querySelector<HTMLElement>("[data-composer-prompt]")?.getBoundingClientRect();
    const actions = element.querySelector<HTMLElement>("[data-composer-actions]")?.getBoundingClientRect();
    return { height: rect.height, promptFromTop: prompt ? prompt.top - rect.top : null, actionsFromBottom: actions ? rect.bottom - actions.top : null };
  };

  useLayoutEffect(() => {
    const element = shell.current;
    if (!element) return;
    const before = previous.current;
    const stateChanged = before.resting !== resting;
    const interrupted = running.current.length > 0;
    for (const animation of running.current) animation.cancel();
    running.current = [];
    window.clearTimeout(cleanup.current);
    element.style.removeProperty("overflow");
    const next = measure(element);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animate = shouldAnimateRestingTransition({ hasCompletedInitialLayout: laidOut.current, stateChanged, hasInterruptedAnimation: interrupted });
    const arriving = element.querySelector<HTMLElement>(resting ? "[data-resting-controls]" : "[data-composer-controls]");
    if (animate && reduced) {
      if (arriving) running.current.push(arriving.animate([{ opacity: 0 }, { opacity: 1 }], { duration: REDUCED_FADE_MS, easing: "ease-out" }));
    } else if (animate && before.height !== null && Math.abs(before.height - next.height) >= 0.5) {
      const options = { duration: RESTING_TRANSITION_MS, easing: RESTING_EASING };
      element.style.overflow = "clip";
      const height = element.animate([{ height: `${before.height}px` }, { height: `${next.height}px` }], { ...options, fill: "both" });
      running.current.push(height);
      // The shell keeps its bottom edge: its top moves, so the content is placed from the bottom.
      const rect = element.getBoundingClientRect();
      const slide = (content: HTMLElement | null, previousTop: number | null) => {
        if (!content || previousTop === null) return;
        const offset = previousTop - content.getBoundingClientRect().top;
        if (Math.abs(offset) >= 0.5) running.current.push(content.animate([{ transform: `translate(0px, ${offset}px)` }, { transform: "none" }], options));
      };
      slide(element.querySelector<HTMLElement>("[data-composer-prompt]"), before.promptFromTop === null ? null : rect.bottom - before.height + before.promptFromTop);
      slide(element.querySelector<HTMLElement>("[data-composer-actions]"), before.actionsFromBottom === null ? null : rect.bottom - before.actionsFromBottom);
      if (arriving) {
        const drift = resting ? -ARRIVAL_DRIFT_PX : ARRIVAL_DRIFT_PX;
        running.current.push(
          arriving.animate([{ opacity: 0, transform: `translateY(${drift}px)` }, { opacity: 1, transform: "none" }], {
            ...options,
            duration: resting ? RESTING_TRANSITION_MS : RESTING_TRANSITION_MS / 2,
            delay: resting ? 0 : RESTING_TRANSITION_MS / 2,
            fill: "backwards",
          }),
        );
      }
      const finish = () => {
        if (running.current[0] !== height) return;
        for (const animation of running.current) animation.cancel();
        running.current = [];
        element.style.removeProperty("overflow");
      };
      void height.finished.catch(() => undefined).then(finish);
      // A hidden tab's timeline may never finish: the natural layout wins after the duration either way.
      cleanup.current = window.setTimeout(finish, RESTING_TRANSITION_MS + 50);
    }
    previous.current = { resting, ...next };
  }, [resting, shell]);

  // Between transitions the shell's size follows its content: remember it, so the next transition starts from it.
  useEffect(() => {
    const element = shell.current;
    if (!element) return;
    laidOut.current = true;
    const resize = new ResizeObserver(() => {
      if (running.current.length > 0) return;
      previous.current = { resting: previous.current.resting, ...measure(element) };
    });
    resize.observe(element);
    return () => {
      resize.disconnect();
      window.clearTimeout(cleanup.current);
      for (const animation of running.current) animation.cancel();
      running.current = [];
    };
  }, [shell]);
};
