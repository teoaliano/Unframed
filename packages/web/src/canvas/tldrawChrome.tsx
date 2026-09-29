/**
 * tldraw's UI as Unframed shows it: Lucide icons, the parts spec 02 hides, and the style
 * panel only when it has something to set. The canvas and the design-system catalogue both
 * mount tldraw with these, so the catalogue shows exactly what the canvas does.
 */
import { getAssetUrlsByImport } from "@tldraw/assets/imports.vite";
import { DefaultStylePanel, useEditor, useValue, type TLComponents, type TldrawOptions, type TLUiStylePanelProps } from "tldraw";
import "tldraw/tldraw.css";
import { lucideIconUrls } from "./icons.tsx";

const tldrawAssets = getAssetUrlsByImport();
export const TLDRAW_ASSET_URLS = { ...tldrawAssets, icons: { ...tldrawAssets.icons, ...lucideIconUrls() } };

export const TLDRAW_OPTIONS: Partial<TldrawOptions> = {
  maxPages: 1,
  actionShortcutsLocation: "toolbar",
  // A resize pins a prompt from its first move of 2 px.
  dragDistanceSquared: 4,
  camera: {
    isLocked: false,
    panSpeed: 1,
    zoomSpeed: 1,
    zoomSteps: [0.1, 0.25, 0.5, 1, 2, 4],
    wheelBehavior: "pan",
  },
};

/**
 * tldraw's style panel, shown only when it has something to set: a drawing tool is on, or
 * the selection holds shapes with styles (prompts, drawings). Media, artifacts and groups have none.
 */
const StylePanel = (props: TLUiStylePanelProps) => {
  const editor = useEditor();
  const styled = useValue("styled selection or tool", () => editor.getSharedStyles().size > 0, [editor]);
  return styled ? <DefaultStylePanel {...props} /> : null;
};

/** tldraw's main, page, help and debug menus, its share panel and its media toolbars are hidden. */
export const TLDRAW_CHROME: TLComponents = {
  MainMenu: null,
  PageMenu: null,
  HelpMenu: null,
  DebugMenu: null,
  DebugPanel: null,
  SharePanel: null,
  // One toolbar per selection: Unframed's selection toolbar, never tldraw's media bars beside it.
  ImageToolbar: null,
  VideoToolbar: null,
  StylePanel,
};
