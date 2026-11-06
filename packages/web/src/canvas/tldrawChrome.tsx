/**
 * tldraw's UI as Unframed shows it: Lucide icons, the parts spec 02 hides, and the Design
 * panel in place of tldraw's style panel. The canvas and the design-system catalogue both
 * mount tldraw with these, so the catalogue shows exactly what the canvas does.
 */
import { getAssetUrlsByImport } from "@tldraw/assets/imports.vite";
import type { TLComponents, TldrawOptions } from "tldraw";
import "tldraw/tldraw.css";
import { BottomToolbar } from "../chrome/BottomToolbar.tsx";
import { DesignPanel } from "./DesignPanel.tsx";
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
  StylePanel: DesignPanel,
  // One bottom bar: quick actions, tools and Unframed's own buttons (spec 02).
  Toolbar: BottomToolbar,
};
