import { describe, expect, it } from "vitest";
import { emptyTiers, pictureLevel, reduceTiers, tierOf, TIER_BUDGETS, type TierEvent, type TierState, type ViewScreen } from "../src/index.ts";

const run = (events: ReadonlyArray<TierEvent>, from: TierState = emptyTiers()): TierState => events.reduce(reduceTiers, from);

const screen = (id: string, over: Partial<ViewScreen> = {}): ViewScreen => ({ id, width: 100, dpr: 2, near: true, distance: 0, pictured: true, ...over });

const view = (...screens: ViewScreen[]): TierEvent => ({ type: "view", screens });

const tiers = (state: TierState) => Object.fromEntries([...state.entries].map(([id, entry]) => [id, tierOf(entry)]));

const board = (count: number) => view(...Array.from({ length: count }, (_, index) => screen(`s${index}`, { distance: index })));

describe("pictureLevel", () => {
  it("is tiny up to 160 device pixels, small up to 230 css pixels, and a page copy above", () => {
    expect(pictureLevel(40, 2)).toBe("tiny");
    expect(pictureLevel(80, 2)).toBe("tiny");
    expect(pictureLevel(81, 2)).toBe("small");
    expect(pictureLevel(160, 1)).toBe("tiny");
    expect(pictureLevel(230, 2)).toBe("small");
    expect(pictureLevel(231, 2)).toBe("page");
    expect(pictureLevel(231, 1)).toBe("page");
  });
});

describe("reduceTiers", () => {
  it("shows every Screen as a picture until one is activated, and runs no frame", () => {
    const state = run([board(3)]);
    expect(tiers(state)).toEqual({ s0: "picture", s1: "picture", s2: "picture" });
    expect(state.active).toBeUndefined();
  });

  it("warms an activated Screen behind its picture and makes it live once it is ready", () => {
    let state = run([board(3), { type: "activate", id: "s1" }]);
    expect(tiers(state).s1).toBe("warming");
    state = reduceTiers(state, { type: "ready", id: "s1" });
    expect(tiers(state).s1).toBe("live");
    expect(state.active).toBe("s1");
  });

  it("keeps one live Screen: activating another demotes the live one with a capture wanted, and parks it once captured", () => {
    let state = run([board(3), { type: "activate", id: "s0" }, { type: "ready", id: "s0" }, { type: "activate", id: "s1" }]);
    expect(tiers(state)).toMatchObject({ s0: "demoting", s1: "warming" });
    expect(state.entries.get("s0")!.capture).toBe(true);
    expect(state.active).toBe("s1");
    expect(state.parked).toEqual(["s0"]);
    state = reduceTiers(state, { type: "captured", id: "s0" });
    expect(tiers(state)).toMatchObject({ s0: "parked", s1: "warming" });
    expect(state.parked).toEqual(["s0"]);
  });

  it("drops a Screen that was still warming when another is activated", () => {
    const state = run([board(3), { type: "activate", id: "s0" }, { type: "activate", id: "s1" }]);
    expect(tiers(state)).toMatchObject({ s0: "picture", s1: "warming" });
    expect(state.parked).toEqual([]);
  });

  it("brings a parked Screen back live at once", () => {
    const state = run([
      board(3),
      { type: "activate", id: "s0" },
      { type: "ready", id: "s0" },
      { type: "activate", id: "s1" },
      { type: "captured", id: "s0" },
      { type: "ready", id: "s1" },
      { type: "activate", id: "s0" },
      { type: "captured", id: "s1" },
    ]);
    expect(tiers(state)).toMatchObject({ s0: "live", s1: "parked" });
    expect(state.parked).toEqual(["s1"]);
  });

  it("parks at most three Screens and drops the least recently live", () => {
    const events: TierEvent[] = [board(6)];
    let previous: string | undefined;
    for (const id of ["s0", "s1", "s2", "s3", "s4"]) {
      events.push({ type: "activate", id }, { type: "ready", id });
      if (previous !== undefined) events.push({ type: "captured", id: previous });
      previous = id;
    }
    events.push({ type: "deactivate" }, { type: "captured", id: "s4" });
    const state = run(events);
    expect(state.parked).toEqual(["s4", "s3", "s2"]);
    expect(state.parked.length).toBe(TIER_BUDGETS.parked);
    expect(tiers(state)).toMatchObject({ s0: "picture", s1: "picture", s2: "parked", s3: "parked", s4: "parked" });
    expect(state.active).toBeUndefined();
  });

  it("deactivating keeps the live Screen's frame shown while it captures, and parks it when the capture lands or fails", () => {
    let state = run([board(2), { type: "activate", id: "s0" }, { type: "ready", id: "s0" }, { type: "deactivate" }]);
    expect(tiers(state).s0).toBe("demoting");
    expect(state.entries.get("s0")!.frame).toBe("demoting");
    expect(state.entries.get("s0")!.capture).toBe(true);
    expect(state.active).toBeUndefined();
    expect(state.parked).toEqual(["s0"]);
    state = reduceTiers(state, { type: "captured", id: "s0" });
    expect(tiers(state).s0).toBe("parked");
    expect(state.entries.get("s0")!.capture).toBe(false);
    expect(state.parked).toEqual(["s0"]);
    state = run([{ type: "activate", id: "s1" }, { type: "ready", id: "s1" }, { type: "deactivate" }, { type: "captureFailed", id: "s1" }], state);
    expect(tiers(state).s1).toBe("parked");
    expect(state.entries.get("s1")!.capture).toBe(false);
    expect(state.parked).toEqual(["s1", "s0"]);
  });

  it("brings a demoting Screen back live at once when it is selected again", () => {
    const state = run([board(2), { type: "activate", id: "s0" }, { type: "ready", id: "s0" }, { type: "deactivate" }, { type: "activate", id: "s0" }]);
    expect(tiers(state).s0).toBe("live");
    expect(state.entries.get("s0")!.capture).toBe(false);
    expect(reduceTiers(state, { type: "captured", id: "s0" }).entries.get("s0")!.frame).toBe("live");
  });

  it("keeps a demoting Screen large on screen shown until the copy of its new picture is built", () => {
    let state = run([view(screen("a", { width: 400 })), { type: "pageBuilt", id: "a" }, { type: "activate", id: "a" }, { type: "ready", id: "a" }, { type: "deactivate" }, { type: "picture", id: "a" }]);
    expect(state.entries.get("a")!.page).toBe("loading");
    state = reduceTiers(state, { type: "pageBuilt", id: "a" });
    expect(tiers(state).a).toBe("demoting");
    state = run([{ type: "picture", id: "a" }, { type: "captured", id: "a" }], state);
    expect(tiers(state).a).toBe("demoting");
    expect(state.entries.get("a")!.capture).toBe(false);
    state = reduceTiers(state, { type: "pageBuilt", id: "a" });
    expect(tiers(state).a).toBe("parked");
    state = run([{ type: "activate", id: "a" }, { type: "deactivate" }, { type: "picture", id: "a" }, { type: "captured", id: "a" }, { type: "captureFailed", id: "a" }], state);
    expect(tiers(state).a).toBe("parked");
  });

  it("ignores ready from a Screen that is not warming as the active one", () => {
    const state = run([board(2), { type: "ready", id: "s0" }]);
    expect(tiers(state).s0).toBe("picture");
  });

  it("goes live for an agent's edit only when no Screen is active", () => {
    let state = run([board(3), { type: "edited", id: "s2" }]);
    expect(tiers(state).s2).toBe("warming");
    state = run([{ type: "ready", id: "s2" }, { type: "edited", id: "s1" }], state);
    expect(tiers(state)).toMatchObject({ s1: "picture", s2: "live" });
  });

  it("drops a frame that failed to load", () => {
    const state = run([board(2), { type: "activate", id: "s0" }, { type: "loadFailed", id: "s0" }]);
    expect(tiers(state).s0).toBe("picture");
    expect(state.active).toBeUndefined();
  });

  it("counts a demoting Screen against the parked budget, so no more than three frames wait behind the live one", () => {
    const events: TierEvent[] = [board(6)];
    for (const id of ["s0", "s1", "s2", "s3", "s4"]) events.push({ type: "activate", id }, { type: "ready", id });
    const state = run(events);
    expect(state.parked).toEqual(["s3", "s2", "s1"]);
    expect(tiers(state)).toMatchObject({ s0: "picture", s1: "demoting", s2: "demoting", s3: "demoting", s4: "live" });
  });

  it("lets a demoting Screen finish its capture when the tab is hidden", () => {
    const state = run([board(2), { type: "activate", id: "s0" }, { type: "ready", id: "s0" }, { type: "deactivate" }, { type: "hidden", hidden: true }]);
    expect(tiers(state).s0).toBe("demoting");
    expect(tiers(reduceTiers(state, { type: "captured", id: "s0" })).s0).toBe("parked");
  });

  it("drops every parked frame when the tab is hidden", () => {
    const state = run([board(3), { type: "activate", id: "s0" }, { type: "ready", id: "s0" }, { type: "activate", id: "s1" }, { type: "captured", id: "s0" }, { type: "ready", id: "s1" }, { type: "hidden", hidden: true }]);
    expect(state.parked).toEqual([]);
    expect(tiers(state)).toMatchObject({ s0: "picture", s1: "live" });
  });

  it("queues page copies for near Screens large on screen, nearest first, four loading at once", () => {
    const wide = view(...Array.from({ length: 6 }, (_, index) => screen(`s${index}`, { width: 400, distance: 6 - index })));
    let state = run([wide]);
    const loading = [...state.entries].filter(([, entry]) => entry.page === "loading").map(([id]) => id);
    expect(loading.sort()).toEqual(["s2", "s3", "s4", "s5"]);
    expect(state.entries.get("s1")!.page).toBe("queued");
    state = reduceTiers(state, { type: "pageBuilt", id: "s5" });
    expect(tiers(state).s5).toBe("snapshot");
    expect(state.entries.get("s1")!.page).toBe("loading");
    expect(state.entries.get("s0")!.page).toBe("queued");
  });

  it("queues no page copy for a Screen with no picture, so it never holds a load", () => {
    const wide = view(...Array.from({ length: 6 }, (_, index) => screen(`s${index}`, { width: 400, distance: index, pictured: index >= 4 })));
    let state = run([wide]);
    expect(Object.fromEntries([...state.entries].map(([id, entry]) => [id, entry.page]))).toEqual({ s0: "none", s1: "none", s2: "none", s3: "none", s4: "loading", s5: "loading" });
    state = reduceTiers(state, { type: "picture", id: "s0" });
    expect(state.entries.get("s0")!.page).toBe("none");
    state = run([view(...Array.from({ length: 6 }, (_, index) => screen(`s${index}`, { width: 400, distance: index, pictured: index === 0 || index >= 4 })))], state);
    expect(state.entries.get("s0")!.page).toBe("loading");
  });

  it("drops a page copy when its Screen leaves the view or becomes small, and never retries a missing one", () => {
    let state = run([view(screen("a", { width: 400 }), screen("b", { width: 400 })), { type: "pageBuilt", id: "a" }, { type: "pageMissing", id: "b" }]);
    expect(tiers(state)).toEqual({ a: "snapshot", b: "picture" });
    state = run([view(screen("a", { width: 400, near: false }), screen("b", { width: 400 }))], state);
    expect(state.entries.get("a")!.page).toBe("none");
    expect(state.entries.get("b")!.page).toBe("missing");
    state = run([view(screen("a", { width: 100 }), screen("b", { width: 400 }))], state);
    expect(state.entries.get("a")!.page).toBe("none");
    state = reduceTiers(state, { type: "picture", id: "b" });
    expect(state.entries.get("b")!.page).toBe("loading");
  });

  it("holds level changes while the camera moves and applies the last view once it stops", () => {
    let state = run([view(screen("a", { width: 100 })), { type: "camera", moving: true }, view(screen("a", { width: 30 })), view(screen("a", { width: 400 }))]);
    expect(state.entries.get("a")!.level).toBe("small");
    expect(state.entries.get("a")!.page).toBe("none");
    state = reduceTiers(state, { type: "camera", moving: false });
    expect(state.entries.get("a")!.level).toBe("page");
    expect(state.entries.get("a")!.page).toBe("loading");
  });

  it("activates while the camera moves, since the person asked for it", () => {
    const state = run([board(2), { type: "camera", moving: true }, { type: "activate", id: "s1" }]);
    expect(tiers(state).s1).toBe("warming");
  });

  it("forgets Screens missing from the view, live or parked", () => {
    let state = run([board(3), { type: "activate", id: "s0" }, { type: "ready", id: "s0" }, { type: "activate", id: "s1" }]);
    state = reduceTiers(state, view(screen("s2")));
    expect([...state.entries.keys()]).toEqual(["s2"]);
    expect(state.parked).toEqual([]);
    expect(state.active).toBeUndefined();
  });

  it("keeps an entry's identity when nothing about it changed", () => {
    const before = run([board(3)]);
    const after = run([{ type: "activate", id: "s1" }, board(3)], before);
    expect(after.entries.get("s0")).toBe(before.entries.get("s0"));
    expect(after.entries.get("s2")).toBe(before.entries.get("s2"));
    expect(after.entries.get("s1")).not.toBe(before.entries.get("s1"));
    expect(reduceTiers(after, { type: "ready", id: "s0" })).toBe(after);
  });

  it("activates a Screen it has not seen in a view yet", () => {
    const state = run([{ type: "activate", id: "new" }]);
    expect(tiers(state).new).toBe("warming");
  });
  it("holds the editor tab's Screen live until the tab closes, whatever the selection does", () => {
    let state = run([board(3), { type: "activate", id: "s0" }, { type: "ready", id: "s0" }, { type: "hold", id: "s1" }, { type: "captured", id: "s0" }]);
    expect(tiers(state)).toMatchObject({ s0: "parked", s1: "warming" });
    state = run([{ type: "ready", id: "s1" }, { type: "deactivate" }, { type: "activate", id: "s2" }], state);
    expect(tiers(state)).toMatchObject({ s1: "live", s2: "picture" });
    state = run([{ type: "hold", id: undefined }, { type: "deactivate" }, { type: "captured", id: "s1" }], state);
    expect(tiers(state)).toMatchObject({ s0: "parked", s1: "parked", s2: "picture" });
    expect(state.held).toBeUndefined();
  });

  it("brings a parked Screen back live at once when its editor tab opens", () => {
    const state = run([board(2), { type: "activate", id: "s0" }, { type: "ready", id: "s0" }, { type: "deactivate" }, { type: "hold", id: "s0" }]);
    expect(tiers(state).s0).toBe("live");
    expect(state.parked).toEqual([]);
  });

  it("lets go of a held Screen that leaves the view", () => {
    const state = run([board(2), { type: "hold", id: "s0" }, view(screen("s1")), { type: "activate", id: "s1" }]);
    expect(state.held).toBeUndefined();
    expect(tiers(state).s1).toBe("warming");
  });
});
