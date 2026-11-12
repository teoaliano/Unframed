import { ARTIFACT_ITEMS, inputItems, type AddAction, type Features } from "@unframed/domain";
import { AlignLeft, AppWindow, AudioLines, Clapperboard, Group, Image, SquarePlay, Workflow, type LucideIcon } from "lucide-react";

/** The add menu's sections, shared by the add button and the canvas context menu. */
export const addSections = (features: Features) =>
  [
    { heading: "Inputs", items: inputItems(features) },
    { heading: "Artifacts", items: ARTIFACT_ITEMS },
  ] as const;

export const ADD_ICONS: Record<AddAction, LucideIcon> = {
  "add-prompt": AlignLeft,
  "add-image": Image,
  "add-video": SquarePlay,
  "add-audio": AudioLines,
  "add-group": Group,
  "add-node": Workflow,
  "add-page": AppWindow,
  "add-motion": Clapperboard,
};
