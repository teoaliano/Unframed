import type { EditorKind } from "@unframed/domain";
import { AppWindow, Clapperboard, Component, MonitorSmartphone, type LucideIcon } from "lucide-react";

export const KIND_LOOK: Readonly<Record<EditorKind, { readonly word: string; readonly Icon: LucideIcon }>> = {
  page: { word: "Page", Icon: AppWindow },
  motion: { word: "Motion", Icon: Clapperboard },
  component: { word: "Component", Icon: Component },
  screen: { word: "Screen", Icon: MonitorSmartphone },
};
