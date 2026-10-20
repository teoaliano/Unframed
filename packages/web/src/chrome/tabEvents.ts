/** Dispatched on `window` to open the All projects list (spec 17): Cmd+T, and the start state's button. */
export const OPEN_PROJECT_LIST = "unframed:open-project-list";

/** Dispatched on `window` by a tab's right-click menu: Rename or Delete for the named project (the project menu runs them). */
export const PROJECT_ACTION = "unframed:project-action";

export interface ProjectActionDetail {
  readonly action: "rename" | "delete";
  readonly name: string;
}
