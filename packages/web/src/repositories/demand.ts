import type { ScreenShapeProps } from "@unframed/contracts";
import { computed, react, type Editor } from "tldraw";
import type { EngineConnection } from "../rpc/engine.ts";
import { pictureKeyOf } from "./ScreenPicture.tsx";
import { repositoryState } from "./store.ts";
import { tiersOf } from "./tiers.ts";

const WINDOW_CLIENT = `window-${Math.random().toString(36).slice(2, 10)}`;
const SEND_AFTER_MS = 250;
const RESEND_EVERY_MS = 10_000;

const installDemand = (engine: EngineConnection, project: string, client: string, wanted: () => string): (() => void) => {
  const state = repositoryState(project);
  let sent = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const send = (key: string) => {
    if (!state.repository.get()) return;
    sent = key;
    void engine.call("instances.demand", { project, client, ids: key === "" ? [] : key.split(" ") }).catch(() => undefined);
  };
  const stop = react("send screen demand", () => {
    const key = wanted();
    clearTimeout(timer);
    if (key === sent) return;
    timer = setTimeout(() => send(key), SEND_AFTER_MS);
  });
  const heartbeat = setInterval(() => {
    if (sent !== "") send(sent);
  }, RESEND_EVERY_MS);
  const onHide = () => send("");
  window.addEventListener("pagehide", onHide);
  return () => {
    stop();
    clearTimeout(timer);
    clearInterval(heartbeat);
    window.removeEventListener("pagehide", onHide);
    if (sent !== "") send("");
  };
};

export const installScreenDemand = (editor: Editor, engine: EngineConnection, project: string): (() => void) => {
  const state = repositoryState(project);
  const wanted = computed("demanded instances", () => {
    if (!state.repository.get()) return "";
    const selected = new Set<string>(editor.getSelectedShapeIds());
    const snapshots = state.snapshots.get();
    const { entries } = tiersOf(editor).get();
    const ids = new Set<string>();
    for (const shape of editor.getCurrentPageShapes()) {
      if (shape.type !== "screen") continue;
      const props = shape.props as ScreenShapeProps;
      const entry = entries.get(shape.id);
      const framed = entry !== undefined && entry.frame !== "none";
      const unpictured = entry?.near === true && pictureKeyOf(props) === undefined && !snapshots.has(shape.id);
      if (selected.has(shape.id) || framed || unpictured) ids.add(props.instance);
    }
    return [...ids].sort().join(" ");
  });
  return installDemand(engine, project, WINDOW_CLIENT, () => wanted.get());
};

export const installEditorDemand = (engine: EngineConnection, project: string, instance: () => string | undefined): (() => void) =>
  installDemand(engine, project, `${WINDOW_CLIENT}-editor`, () => (repositoryState(project).repository.get() ? (instance() ?? "") : ""));
