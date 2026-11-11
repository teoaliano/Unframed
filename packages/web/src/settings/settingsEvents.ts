export type SettingsSection = "generation" | "agents" | "connections" | "ipad" | "general";

export const OPEN_SETTINGS = "unframed:open-settings";

export interface OpenSettingsDetail {
  readonly section?: SettingsSection | undefined;
}

export const openSettings = (section?: SettingsSection): void => {
  window.dispatchEvent(new CustomEvent<OpenSettingsDetail>(OPEN_SETTINGS, { detail: { section } }));
};
