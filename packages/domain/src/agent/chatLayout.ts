import { readPanelPrefs, type PanelLimits, type PanelPrefs } from "../artifacts/parametersPanel.ts";

export type ChatLayout = "panel" | "composer" | "window";

export const CHAT_LAYOUTS: ReadonlyArray<ChatLayout> = ["panel", "composer", "window"];

export const chatLayoutOf = (value: unknown): ChatLayout => (value === "composer" || value === "window" ? value : "panel");

export type ChatContainer = "rail" | "sheet" | "window" | "composer";

export const chatContainer = (layout: ChatLayout, narrow: boolean): ChatContainer => {
  if (layout === "composer") return "composer";
  if (narrow) return "sheet";
  return layout === "window" ? "window" : "rail";
};

export const CHAT_WINDOW_LIMITS: PanelLimits = { w: 400, minW: 320, maxW: 720, minH: 320 };

export const CHAT_WINDOW_HEIGHT = 560;

export const readChatWindow = (value: unknown): PanelPrefs => {
  const { dockW: _dockW, ...read } = readPanelPrefs(value);
  return { w: CHAT_WINDOW_LIMITS.w, h: CHAT_WINDOW_HEIGHT, ...read, mode: "float" };
};
