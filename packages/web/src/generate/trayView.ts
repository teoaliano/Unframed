import type { Medium, ModelEntry } from "@unframed/contracts";
import { atom, type Atom, type Editor } from "tldraw";
import type { TrayProps } from "./mediumRegistry.ts";

/** What the open Generate tray holds, for what the canvas draws from it: the role badges (spec 04's input modes). */
export interface TrayView {
  readonly medium: Medium;
  readonly props: TrayProps;
  readonly entry: ModelEntry | undefined;
}

const views = new WeakMap<Editor, Atom<TrayView | undefined>>();

/** The open tray's values for one canvas, `undefined` while no Generate tray is open. */
export const trayView = (editor: Editor): Atom<TrayView | undefined> => {
  let view = views.get(editor);
  if (!view) {
    view = atom<TrayView | undefined>("tray view", undefined);
    views.set(editor, view);
  }
  return view;
};
