// One icon per node type, keyed by the type id. Shared by the add menu and every
// node header, so a node looks the same wherever you meet it: the thing you picked
// from the menu is the thing now sitting on the canvas.
const svg = (path) => (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    {path}
  </svg>
);

export const PromptIcon = svg(<path d="M4 6h16M4 12h16M4 18h10" />);
export const ImageIcon = svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="M21 16l-5-5-8 8" /></>);
// Four-point star, drawn from the centre out so its bounding box is 4..20 on both
// axes. The previous path spanned y 3..17, putting its centre at 10 in a 24 box:
// two units high, which reads as "not quite centred" next to any other icon. It
// was also 14 wide against 16 for the others, so it looked a size down.
export const OutputIcon = svg(<path d="M12 4l2.2 5.8 5.8 2.2-5.8 2.2-2.2 5.8-2.2-5.8-5.8-2.2 5.8-2.2z" />);
export const TextIcon = svg(<><path d="M4 7V5h16v2M12 5v14M9 19h6" /></>);

// Not node types — the output node's Video tab, and the Library's chips.
export const FlowIcon = svg(<><rect x="3" y="3" width="7" height="6" rx="1.5" /><rect x="14" y="15" width="7" height="6" rx="1.5" /><path d="M6.5 9v4a2 2 0 002 2H14" /></>);
export const VideoIcon = svg(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9.5l5 2.5-5 2.5z" /></>);

export const NODE_ICONS = {
  prompt: PromptIcon,
  image: ImageIcon,
  output: OutputIcon,
  text: TextIcon,
};
