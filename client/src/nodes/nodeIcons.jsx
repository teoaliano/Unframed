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
export const OutputIcon = svg(<path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5z" />);
export const TextIcon = svg(<><path d="M4 7V5h16v2M12 5v14M9 19h6" /></>);

export const NODE_ICONS = {
  prompt: PromptIcon,
  image: ImageIcon,
  output: OutputIcon,
  text: TextIcon,
};
