import { ARTIFACT_ITEMS, INPUT_ITEMS, type AddAction } from "@unframed/domain";
import { AlignLeft, AppWindow, Clapperboard, Group, Image, SquarePlay, type LucideIcon } from "lucide-react";

/** The add menu's sections, shared by the add button and the canvas context menu. */
export const ADD_SECTIONS = [
  { heading: "Inputs", items: INPUT_ITEMS },
  { heading: "Artifacts", items: ARTIFACT_ITEMS },
] as const;

export const ADD_ICONS: Record<AddAction, LucideIcon> = {
  "add-prompt": AlignLeft,
  "add-image": Image,
  "add-video": SquarePlay,
  "add-group": Group,
  "add-page": AppWindow,
  "add-motion": Clapperboard,
};
