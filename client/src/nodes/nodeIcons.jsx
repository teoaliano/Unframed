// One icon per node type, keyed by the type id. Shared by the add menu and every
// node header, so a node looks the same wherever you meet it: the thing you picked
// from the menu is the thing now sitting on the canvas.
//
// All icons come from lucide-react, the same pack @astryxdesign/theme-neutral
// registers for the design system's own semantic icons (`icon="info"` and friends).
// One pack means one grid, one stroke weight, one optical size — which hand-drawn
// paths never quite matched.
import { AlignLeft, Image, Type, PanelTop, Workflow, SquarePlay, AppWindow, Group, Clapperboard } from 'lucide-react';

export const PromptIcon = AlignLeft;
export const ImageIcon = Image;
export const TextIcon = Type;
export const GroupIcon = Group;
// The page asset: a window, because that is what it is -- a web page on the board.
export const PageIcon = AppWindow;
// The motion asset: a clapperboard -- a video that is made, not one that was shot.
export const MotionIcon = Clapperboard;

// Not node types — the Library's chips.
export const BlockIcon = PanelTop;
export const FlowIcon = Workflow;
export const VideoIcon = SquarePlay;

// An output node wears the icon of the MEDIUM it makes, the same one its input
// counterpart wears — an image is an image whichever family it is in, and after the
// split the medium is the node's identity rather than a tab inside it. What separates
// the two families is the accent colour NodeHeader gives an output, the handle side,
// and bodies that look nothing alike: an image input is a thumbnail, an image output
// is a model picker and a Generate button.
export const NODE_ICONS = {
  prompt: PromptIcon,
  group: GroupIcon,
  image: ImageIcon,
  video: VideoIcon,
  imageOutput: ImageIcon,
  videoOutput: VideoIcon,
  textOutput: TextIcon,
  page: PageIcon,
  motion: MotionIcon,
};
