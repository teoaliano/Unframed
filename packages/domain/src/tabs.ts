/**
 * The project tab rules (spec 17). Pure: the web keeps the tab store and the engine answers
 * the activity; these functions say what the order, the neighbour, the restore and the width are.
 */

/** Tabs never get narrower than this, and the strip scrolls rather than squeezing them further. */
export const TAB_MIN_WIDTH = 120;
/** Tabs never get wider than this, however few are open. */
export const TAB_MAX_WIDTH = 200;
/** How many closed projects the reopen stack keeps (spec 17). */
export const CLOSED_TAB_LIMIT = 10;

/** One project's live work and waiting requests, as the engine reports them (spec 17's activity stream). */
export interface TabActivity {
  readonly running: number;
  readonly needsYou: number;
}

/** What a tab shows in its status slot. `needs-you` wins over `running`; `finished` is the web's own unseen mark. */
export type TabStatus = "needs-you" | "running" | "finished" | "none";

/** Appends `name` when it is not open, else keeps its place. Answers the new order. */
export const openTab = (order: ReadonlyArray<string>, name: string): ReadonlyArray<string> => (order.includes(name) ? [...order] : [...order, name]);

const EDITOR_MARK = "/";

export const editorTabKey = (project: string, shape: string): string => `${project}${EDITOR_MARK}${shape}`;

export const isEditorTab = (key: string): boolean => key.includes(EDITOR_MARK);

export const projectOfTab = (key: string): string => (isEditorTab(key) ? key.slice(0, key.indexOf(EDITOR_MARK)) : key);

export const shapeOfTab = (key: string): string | undefined => (isEditorTab(key) ? key.slice(key.indexOf(EDITOR_MARK) + 1) : undefined);

export const editorTabsOf = (order: ReadonlyArray<string>, project: string): ReadonlyArray<string> =>
  order.filter((key) => isEditorTab(key) && projectOfTab(key) === project);

export const closeTab = (
  order: ReadonlyArray<string>,
  active: string | undefined,
  name: string,
): { readonly order: ReadonlyArray<string>; readonly active: string | undefined } => {
  const index = order.indexOf(name);
  if (index === -1) return { order: [...order], active };
  const removed = new Set(isEditorTab(name) ? [name] : [name, ...editorTabsOf(order, name)]);
  const rest = order.filter((each) => !removed.has(each));
  if (active === undefined || !removed.has(active)) return { order: rest, active };
  if (isEditorTab(name) && order.includes(projectOfTab(name))) return { order: rest, active: projectOfTab(name) };
  const next = order.slice(index + 1).find((each) => !removed.has(each)) ?? order.slice(0, index).reverse().find((each) => !removed.has(each));
  return { order: rest, active: next };
};

export const openEditorTab = (tabs: PinnedTabs, key: string): ReadonlyArray<string> => {
  if (tabs.order.includes(key)) return [...tabs.order];
  const project = projectOfTab(key);
  let at = tabs.order.indexOf(project);
  if (at === -1) return [...tabs.order];
  at += 1;
  const pinnedCount = tabs.order.filter((each) => tabs.pinned.includes(each)).length;
  if (at < pinnedCount) at = pinnedCount;
  while (at < tabs.order.length && isEditorTab(tabs.order[at]!) && projectOfTab(tabs.order[at]!) === project) at += 1;
  return [...tabs.order.slice(0, at), key, ...tabs.order.slice(at)];
};

export interface PinnedTabs {
  readonly order: ReadonlyArray<string>;
  readonly pinned: ReadonlyArray<string>;
}

const withPins = (order: ReadonlyArray<string>, pinned: ReadonlySet<string>): PinnedTabs => {
  const first = order.filter((name) => pinned.has(name));
  return { order: [...first, ...order.filter((name) => !pinned.has(name))], pinned: first };
};

export const tabGroup = (tabs: PinnedTabs, name: string): { readonly low: number; readonly high: number } => {
  const pinnedCount = tabs.order.filter((each) => tabs.pinned.includes(each)).length;
  return tabs.pinned.includes(name) ? { low: 0, high: Math.max(0, pinnedCount - 1) } : { low: pinnedCount, high: Math.max(pinnedCount, tabs.order.length - 1) };
};

export const moveTab = (tabs: PinnedTabs, name: string, to: number): PinnedTabs => {
  const pinned = new Set(tabs.pinned);
  if (!tabs.order.includes(name)) return withPins(tabs.order, pinned);
  const { low, high } = tabGroup(tabs, name);
  const rest = tabs.order.filter((each) => each !== name);
  const at = Math.max(low, Math.min(high, to));
  return withPins([...rest.slice(0, at), name, ...rest.slice(at)], pinned);
};

export const pinTab = (tabs: PinnedTabs, name: string): PinnedTabs => {
  const pinned = new Set(tabs.pinned);
  if (!tabs.order.includes(name) || pinned.has(name) || isEditorTab(name)) return withPins(tabs.order, pinned);
  const current = withPins(tabs.order, pinned);
  pinned.add(name);
  return withPins([...current.pinned, name, ...current.order.filter((each) => !current.pinned.includes(each) && each !== name)], pinned);
};

export const unpinTab = (tabs: PinnedTabs, name: string): PinnedTabs => {
  const pinned = new Set(tabs.pinned);
  if (!pinned.has(name)) return withPins(tabs.order, pinned);
  pinned.delete(name);
  const current = withPins(tabs.order, pinned);
  const rest = current.order.filter((each) => each !== name && !pinned.has(each));
  return withPins([...current.pinned, name, ...rest], pinned);
};

/**
 * Restores the saved order against the projects that exist. A saved name that no longer exists is
 * dropped. The active tab is the saved one when it survived, else the first tab. With nothing
 * left, the result is empty and the caller falls back the way spec 02 does.
 */
export const restoreTabs = (
  saved: { readonly order: ReadonlyArray<string>; readonly active: string | null | undefined; readonly pinned?: ReadonlyArray<string> | undefined },
  projects: ReadonlyArray<string>,
): { readonly order: ReadonlyArray<string>; readonly active: string | undefined; readonly pinned: ReadonlyArray<string> } => {
  const known = new Set(projects);
  const seen = new Set<string>();
  const open: string[] = [];
  const openProjects = new Set(saved.order.filter((name) => !isEditorTab(name) && known.has(name)));
  for (const name of saved.order) {
    if ((isEditorTab(name) ? openProjects.has(projectOfTab(name)) : known.has(name)) && !seen.has(name)) {
      seen.add(name);
      open.push(name);
    }
  }
  const pinned = open.filter((name) => !isEditorTab(name) && (saved.pinned ?? []).includes(name));
  const order = [...pinned, ...open.filter((name) => !pinned.includes(name))];
  const active = typeof saved.active === "string" && seen.has(saved.active) ? saved.active : order[0];
  return { order, active, pinned };
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
