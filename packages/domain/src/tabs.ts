/**
 * The project tab rules. Pure: the web keeps the tab store and the engine answers
 * the activity; these functions say what the order, the neighbour, the restore and the width are.
 */

/** Tabs never get narrower than this, and the strip scrolls rather than squeezing them further. */
export const TAB_MIN_WIDTH = 120;
/** Tabs never get wider than this, however few are open. */
export const TAB_MAX_WIDTH = 200;
/** How many closed projects the reopen stack keeps. */
export const CLOSED_TAB_LIMIT = 10;

/** One project's live work and waiting requests, as the engine's activity stream reports them. */
export interface TabActivity {
  readonly running: number;
  readonly needsYou: number;
}

/** What a tab shows in its status slot. `needs-you` wins over `running`; `finished` is the web's own unseen mark. */
export type TabStatus = "needs-you" | "running" | "finished" | "none";

/** Appends `name` when it is not open, else keeps its place. Answers the new order. */
export const openTab = (order: ReadonlyArray<string>, name: string): ReadonlyArray<string> => (order.includes(name) ? [...order] : [...order, name]);

/**
 * Closing `name`: the order without it, and the active tab afterwards. Closing the active tab
 * activates the tab to its right, else the one to its left, else none. Closing any other tab
 * keeps the active one.
 */
export const closeTab = (
  order: ReadonlyArray<string>,
  active: string | undefined,
  name: string,
): { readonly order: ReadonlyArray<string>; readonly active: string | undefined } => {
  const index = order.indexOf(name);
  if (index === -1) return { order: [...order], active };
  const rest = order.filter((each) => each !== name);
  if (active !== name) return { order: rest, active };
  const next = order[index + 1] ?? order[index - 1];
  return { order: rest, active: next };
};

/** Moves `name` to position `to` (clamped to the order's ends). An unknown name leaves the order as it is. */
export const moveTab = (order: ReadonlyArray<string>, name: string, to: number): ReadonlyArray<string> => {
  const from = order.indexOf(name);
  if (from === -1) return [...order];
  const rest = order.filter((each) => each !== name);
  const at = Math.max(0, Math.min(rest.length, to));
  return [...rest.slice(0, at), name, ...rest.slice(at)];
};

/**
 * Restores the saved order against the projects that exist. A saved name that no longer exists is
 * dropped. The active tab is the saved one when it survived, else the first tab. With nothing
 * left, the result is empty and the caller falls back to its default.
 */
export const restoreTabs = (
  saved: { readonly order: ReadonlyArray<string>; readonly active: string | null | undefined },
  projects: ReadonlyArray<string>,
): { readonly order: ReadonlyArray<string>; readonly active: string | undefined } => {
  const known = new Set(projects);
  const seen = new Set<string>();
  const order: string[] = [];
  for (const name of saved.order) {
    if (known.has(name) && !seen.has(name)) {
      seen.add(name);
      order.push(name);
    }
  }
  const active = typeof saved.active === "string" && seen.has(saved.active) ? saved.active : order[0];
  return { order, active };
};

/** The width each tab gets when `count` tabs share `available` pixels, clamped to the tab limits. */
export const tabWidth = (available: number, count: number): number => {
  if (count <= 0) return TAB_MAX_WIDTH;
  const share = Math.floor(available / count);
  return Math.max(TAB_MIN_WIDTH, Math.min(TAB_MAX_WIDTH, share));
};

/**
 * The status a tab shows. Waiting on the person wins over running, running over finished, and a
 * finished mark only shows while nothing is live.
 */
export const statusOf = (activity: TabActivity | undefined, finishedUnseen: boolean): TabStatus => {
  if ((activity?.needsYou ?? 0) > 0) return "needs-you";
  if ((activity?.running ?? 0) > 0) return "running";
  return finishedUnseen ? "finished" : "none";
};

/** A running count that fell from above zero to zero marks the tab finished, until someone looks at it. */
export const finishedAfter = (before: TabActivity | undefined, after: TabActivity | undefined): boolean =>
  (before?.running ?? 0) > 0 && (after?.running ?? 0) === 0;

/** The stack of recently closed projects: the newest first, at most `CLOSED_TAB_LIMIT` long. */
export const pushClosed = (stack: ReadonlyArray<string>, name: string): ReadonlyArray<string> =>
  [name, ...stack.filter((each) => each !== name)].slice(0, CLOSED_TAB_LIMIT);

/** Pops the newest closed project. `name` is undefined when the stack is empty. */
export const popClosed = (stack: ReadonlyArray<string>): { readonly name: string | undefined; readonly stack: ReadonlyArray<string> } => ({
  name: stack[0],
  stack: stack.slice(1),
});
