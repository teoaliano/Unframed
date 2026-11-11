import type { ArtifactKind } from "@unframed/domain";
import { AppWindow, Clapperboard, Component, type LucideIcon } from "lucide-react";

export const KIND_LOOK: Readonly<Record<ArtifactKind, { readonly word: string; readonly Icon: LucideIcon }>> = {
  page: { word: "Page", Icon: AppWindow },
  motion: { word: "Motion", Icon: Clapperboard },
  component: { word: "Component", Icon: Component },
};
