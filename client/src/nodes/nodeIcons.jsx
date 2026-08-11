// One icon per node type, keyed by the type id. Shared by the add menu and every
// node header, so a node looks the same wherever you meet it: the thing you picked
// from the menu is the thing now sitting on the canvas.
//
// All icons come from lucide-react, the same pack @astryxdesign/theme-neutral
// registers for the design system's own semantic icons (`icon="info"` and friends).
// One pack means one grid, one stroke weight, one optical size — which hand-drawn
// paths never quite matched.
import { AlignLeft, Image, Sparkle, Type, PanelTop, Workflow, SquarePlay } from 'lucide-react';

export const PromptIcon = AlignLeft;
export const ImageIcon = Image;
export const OutputIcon = Sparkle;
export const TextIcon = Type;

// Not node types — the output node's Video tab, and the Library's chips.
export const BlockIcon = PanelTop;
export const FlowIcon = Workflow;
export const VideoIcon = SquarePlay;

export const NODE_ICONS = {
  prompt: PromptIcon,
  image: ImageIcon,
  video: VideoIcon,
  output: OutputIcon,
  text: TextIcon,
};
