export type FrameState = "none" | "warming" | "live" | "parked";
export type PictureLevel = "tiny" | "small" | "page";
export type PageCopyState = "none" | "queued" | "loading" | "built" | "missing";
export type ScreenTier = "picture" | "snapshot" | "warming" | "live" | "parked";

export const TIER_BUDGETS = { live: 1, warming: 1, parked: 3, pageLoads: 4 } as const;

export const TINY_DEVICE_PX = 160;
export const SMALL_CSS_PX = 230;

export interface TierEntry {
  readonly frame: FrameState;
  readonly level: PictureLevel;
  readonly near: boolean;
  readonly distance: number;
  readonly pictured: boolean;
  readonly page: PageCopyState;
  readonly capture: boolean;
  readonly failed: boolean;
}

export interface ViewScreen {
  readonly id: string;
  readonly width: number;
  readonly dpr: number;
  readonly near: boolean;
  readonly distance: number;
  readonly pictured: boolean;
}

export type TierEvent =
  | { readonly type: "view"; readonly screens: ReadonlyArray<ViewScreen> }
  | { readonly type: "camera"; readonly moving: boolean }
  | { readonly type: "activate"; readonly id: string }
  | { readonly type: "edited"; readonly id: string }
  | { readonly type: "deactivate" }
  | { readonly type: "hold"; readonly id: string | undefined }
  | { readonly type: "ready"; readonly id: string }
  | { readonly type: "loadFailed"; readonly id: string }
  | { readonly type: "pageBuilt"; readonly id: string }
  | { readonly type: "pageMissing"; readonly id: string }
  | { readonly type: "picture"; readonly id: string }
  | { readonly type: "captured"; readonly id: string }
  | { readonly type: "captureFailed"; readonly id: string }
  | { readonly type: "hidden"; readonly hidden: boolean }
  | { readonly type: "removed"; readonly ids: ReadonlyArray<string> };

export interface TierState {
  readonly entries: ReadonlyMap<string, TierEntry>;
  readonly active: string | undefined;
  readonly held: string | undefined;
  readonly parked: ReadonlyArray<string>;
  readonly moving: boolean;
  readonly hidden: boolean;
  readonly pending: Extract<TierEvent, { type: "view" }> | undefined;
}

export const pictureLevel = (width: number, dpr: number): PictureLevel => (width * dpr <= TINY_DEVICE_PX ? "tiny" : width <= SMALL_CSS_PX ? "small" : "page");

export const tierOf = (entry: TierEntry): ScreenTier =>
  entry.frame === "live" ? "live" : entry.frame === "warming" ? "warming" : entry.frame === "parked" ? "parked" : entry.page === "built" ? "snapshot" : "picture";

export const emptyTiers = (): TierState => ({ entries: new Map(), active: undefined, held: undefined, parked: [], moving: false, hidden: false, pending: undefined });

const FRESH: TierEntry = { frame: "none", level: "small", near: true, distance: 0, pictured: false, page: "none", capture: false, failed: false };

const same = (a: TierEntry, b: TierEntry): boolean =>
  a.frame === b.frame && a.level === b.level && a.near === b.near && a.distance === b.distance && a.pictured === b.pictured && a.page === b.page && a.capture === b.capture && a.failed === b.failed;

class Draft {
  readonly entries: Map<string, TierEntry>;
  active: string | undefined;
  held: string | undefined;
  parked: string[];
  moving: boolean;
  hidden: boolean;
  pending: TierState["pending"];
  private readonly from: TierState;

  constructor(from: TierState) {
    this.from = from;
    this.entries = new Map(from.entries);
    this.active = from.active;
    this.held = from.held;
    this.parked = [...from.parked];
    this.moving = from.moving;
    this.hidden = from.hidden;
    this.pending = from.pending;
  }

  get(id: string): TierEntry {
    return this.entries.get(id) ?? FRESH;
  }

  set(id: string, patch: Partial<TierEntry>): void {
    const before = this.get(id);
    const next = { ...before, ...patch };
    if (this.entries.has(id) && same(before, next)) return;
    this.entries.set(id, next);
  }

  done(): TierState {
    const unchanged =
      this.active === this.from.active &&
      this.held === this.from.held &&
      this.moving === this.from.moving &&
      this.hidden === this.from.hidden &&
      this.pending === this.from.pending &&
      this.parked.length === this.from.parked.length &&
      this.parked.every((id, index) => this.from.parked[index] === id) &&
      this.entries.size === this.from.entries.size &&
      [...this.entries].every(([id, entry]) => this.from.entries.get(id) === entry);
    if (unchanged) return this.from;
    return { entries: this.entries, active: this.active, held: this.held, parked: this.parked, moving: this.moving, hidden: this.hidden, pending: this.pending };
  }
}

const dropFrame = (draft: Draft, id: string) => {
  draft.parked = draft.parked.filter((parked) => parked !== id);
  if (draft.entries.has(id)) draft.set(id, { frame: "none" });
};

const park = (draft: Draft, id: string) => {
  draft.set(id, { frame: "parked", capture: true });
  draft.parked = [id, ...draft.parked.filter((parked) => parked !== id)];
  while (draft.parked.length > TIER_BUDGETS.parked) {
    const oldest = draft.parked.pop()!;
    draft.set(oldest, { frame: "none" });
  }
};

const deactivate = (draft: Draft) => {
  const id = draft.active;
  if (id === undefined) return;
  draft.active = undefined;
  const frame = draft.get(id).frame;
  if (frame === "live") park(draft, id);
  else if (frame === "warming") dropFrame(draft, id);
};

const activate = (draft: Draft, id: string) => {
  if (draft.active === id) return;
  deactivate(draft);
  draft.active = id;
  if (draft.get(id).frame === "parked") {
    draft.parked = draft.parked.filter((parked) => parked !== id);
    draft.set(id, { frame: "live", failed: false });
    return;
  }
  for (const [other, entry] of draft.entries) if (other !== id && entry.frame === "warming") draft.set(other, { frame: "none" });
  draft.set(id, { frame: "warming", failed: false });
};

const applyView = (draft: Draft, screens: ReadonlyArray<ViewScreen>) => {
  const seen = new Set<string>();
  for (const screen of screens) {
    seen.add(screen.id);
    const entry = draft.get(screen.id);
    const level = pictureLevel(screen.width, screen.dpr);
    const wantsPage = screen.pictured && screen.near && level === "page";
    const page = entry.page === "missing" ? "missing" : wantsPage ? (entry.page === "none" ? "queued" : entry.page) : "none";
    draft.set(screen.id, { level, near: screen.near, distance: screen.distance, pictured: screen.pictured, page });
  }
  for (const id of [...draft.entries.keys()]) if (!seen.has(id)) forget(draft, id);
};

const forget = (draft: Draft, id: string) => {
  if (draft.active === id) draft.active = undefined;
  if (draft.held === id) draft.held = undefined;
  draft.parked = draft.parked.filter((parked) => parked !== id);
  draft.entries.delete(id);
};

const admitPages = (draft: Draft) => {
  let loading = 0;
  const queued: [string, TierEntry][] = [];
  for (const [id, entry] of draft.entries) {
    if (entry.page === "loading") loading++;
    else if (entry.page === "queued") queued.push([id, entry]);
  }
  queued.sort((a, b) => a[1].distance - b[1].distance);
  for (const [id] of queued) {
    if (loading >= TIER_BUDGETS.pageLoads) break;
    draft.set(id, { page: "loading" });
    loading++;
  }
};

const known = (draft: Draft, id: string) => draft.entries.has(id);

export const reduceTiers = (state: TierState, event: TierEvent): TierState => {
  const draft = new Draft(state);
  switch (event.type) {
    case "view":
      if (draft.moving) draft.pending = event;
      else applyView(draft, event.screens);
      break;
    case "camera":
      draft.moving = event.moving;
      if (!event.moving && draft.pending !== undefined) {
        const pending = draft.pending;
        draft.pending = undefined;
        applyView(draft, pending.screens);
      }
      break;
    case "activate":
      if (draft.held === undefined) activate(draft, event.id);
      break;
    case "edited":
      if (draft.active === undefined) activate(draft, event.id);
      break;
    case "deactivate":
      if (draft.held === undefined) deactivate(draft);
      break;
    case "hold":
      draft.held = event.id;
      if (event.id !== undefined) activate(draft, event.id);
      break;
    case "ready":
      if (draft.active === event.id && draft.get(event.id).frame === "warming") draft.set(event.id, { frame: "live" });
      break;
    case "loadFailed":
      if (!known(draft, event.id)) break;
      if (draft.active === event.id) draft.active = undefined;
      draft.parked = draft.parked.filter((parked) => parked !== event.id);
      draft.set(event.id, { frame: "none", failed: true });
      break;
    case "pageBuilt":
      if (draft.get(event.id).page === "loading") draft.set(event.id, { page: "built" });
      break;
    case "pageMissing":
      if (known(draft, event.id)) draft.set(event.id, { page: "missing" });
      break;
    case "picture": {
      if (!known(draft, event.id)) break;
      const entry = draft.get(event.id);
      draft.set(event.id, { page: entry.pictured && entry.near && entry.level === "page" ? "queued" : "none" });
      break;
    }
    case "captured":
    case "captureFailed":
      if (known(draft, event.id)) draft.set(event.id, { capture: false });
      break;
    case "hidden":
      draft.hidden = event.hidden;
      if (event.hidden) for (const id of [...draft.parked]) dropFrame(draft, id);
      break;
    case "removed":
      for (const id of event.ids) forget(draft, id);
      break;
  }
  admitPages(draft);
  return draft.done();
};
