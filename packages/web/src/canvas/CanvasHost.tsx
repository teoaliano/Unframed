import { getAssetUrlsByImport } from "@tldraw/assets/imports.vite";
import { useSync } from "@tldraw/sync";
import { canvasSchema } from "@unframed/contracts";
import { UPLOAD_BODY_LIMIT } from "@unframed/domain";
import { useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { Tldraw, type Editor, type TLComponents, type TldrawOptions } from "tldraw";
import "tldraw/tldraw.css";
import "./canvas.css";
import "../generate/generate.css";
import "../generate/imageMedium.ts";
import "../generate/videoMedium.ts";
import "../generate/textMedium.ts";
import { DotGrid } from "../chrome/DotGrid.tsx";
import { installLabelActivity, installLabelLevel } from "../chrome/labelLevel.ts";
import { OVERLAY_UTILS } from "../chrome/selectionLook.ts";
import { connectionMonitor } from "../connection/monitor.ts";
import { CanvasProjectContext, useEngine } from "../context.ts";
import { installCopyStripping } from "../generate/copies.ts";
import { RoleBadges } from "../generate/overlays.tsx";
import { installRenderPolls } from "../generate/renderPolls.ts";
import { watchRunReports } from "../generate/runReports.ts";
import { LicenseKeyContext } from "../license.ts";
import type { ProjectActivation } from "../project/activation.ts";
import { showError } from "../toasts.tsx";
import { createAssetStore, Previews } from "./assetStore.ts";
import { clipboardOptions, installExternalContent, type ContentContext } from "./externalContent.ts";
import { ContextMenu } from "./ContextMenu.tsx";
import { InFront } from "./InFront.tsx";
import { overrides } from "./overrides.ts";
import { installRefMinting, RefMinter } from "./refs.ts";
import { MotionShapeUtil, PageShapeUtil } from "./shapes/artifact.tsx";
import { GroupShapeUtil } from "./shapes/group.tsx";
import { ImageMediaUtil, VideoMediaUtil } from "./shapes/media.tsx";
import { PromptShapeUtil } from "./shapes/prompt.tsx";
import { SyncSocket } from "./syncSocket.ts";

const assetUrls = getAssetUrlsByImport();

/** How long a project switch waits for the room to acknowledge this tab's pending edits. */
const SETTLE_BEFORE_SWITCH_MS = 2000;

const OPTIONS: Partial<TldrawOptions> = {
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

const SHAPE_UTILS = [PromptShapeUtil, ImageMediaUtil, VideoMediaUtil, GroupShapeUtil, PageShapeUtil, MotionShapeUtil];

/** tldraw's main, page, help and debug menus and its share panel are hidden; the dot grid is the background. */
const COMPONENTS: TLComponents = {
  MainMenu: null,
  PageMenu: null,
  HelpMenu: null,
  DebugMenu: null,
  DebugPanel: null,
  SharePanel: null,
  InFrontOfTheCanvas: InFront,
  OnTheCanvas: RoleBadges,
  Background: DotGrid,
  ContextMenu,
};

const syncUrl = (project: string, sessionId: string): string => {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}/sync/${encodeURIComponent(project)}?sessionId=${encodeURIComponent(sessionId)}`;
};

/** Opening a project fits the view to its shapes, never closer than 100 %. */
const fitToShapes = (editor: Editor) => {
  editor.zoomToFit({ animation: { duration: 0 } });
  if (editor.getZoomLevel() > 1) {
    const bounds = editor.getCurrentPageBounds();
    if (bounds) editor.centerOnPoint(bounds.center, { animation: { duration: 0 } });
    editor.resetZoom(editor.getViewportScreenCenter(), { animation: { duration: 0 } });
  }
};

const REFUSALS: Record<string, string> = {
  "unknown project": "There is no project with that name.",
};

/**
 * Mounts tldraw for the active project: the sync client, the connection monitor's view of
 * the sync socket, the camera limits and the asset store. Callers never see tldraw's
 * configuration.
 */
export const CanvasHost = ({ project, activation }: { readonly project: string; readonly activation: ProjectActivation }) => {
  const licenseKey = useContext(LicenseKeyContext);
  const engine = useEngine();
  const content = useRef<ContentContext | undefined>(undefined);
  const options = useMemo(() => ({ ...OPTIONS, ...clipboardOptions({ project, context: () => content.current }) }), [project]);
  const socket = useRef<SyncSocket | undefined>(undefined);
  const previews = useMemo(() => new Previews(project), [project]);
  const assets = useMemo(() => createAssetStore(project, previews), [project, previews]);

  const connect = useCallback(
    ({ sessionId }: { sessionId: string }) => {
      const next = new SyncSocket(syncUrl(project, sessionId), {
        onHealth: (health) => connectionMonitor.setSync(health),
        onRefused: (reason) => showError(`Could not open “${project}”: ${REFUSALS[reason] ?? reason}`),
      });
      socket.current = next;
      return next;
    },
    [project],
  );

  const store = useSync({ connect, assets, schema: canvasSchema() });

  useEffect(() => watchRunReports(engine, project), [engine, project]);

  useEffect(() => {
    activation.setBeforeSwitch(() => socket.current?.settled(SETTLE_BEFORE_SWITCH_MS) ?? Promise.resolve());
    return () => {
      activation.setBeforeSwitch(undefined);
      connectionMonitor.setSync("up");
      previews.dispose();
    };
  }, [activation, previews]);

  const onMount = useCallback((editor: Editor) => {
    const minter = new RefMinter(editor);
    const stopMinting = installRefMinting(editor, minter);
    const stopLabelLevel = installLabelLevel(editor);
    const stopLabelActivity = installLabelActivity(editor);
    const stopCopyStripping = installCopyStripping(editor);
    const stopRenderPolls = installRenderPolls(editor, engine, project);
    content.current = { project, engine, minter };
    installExternalContent(editor, content.current);
    fitToShapes(editor);
    return () => {
      stopMinting();
      stopLabelLevel();
      stopLabelActivity();
      stopCopyStripping();
      stopRenderPolls();
      content.current = undefined;
    };
  }, [project, engine]);

  if (store.status === "error") return <div className="absolute inset-0" data-canvas-refused={project} />;

  return (
    <div className="absolute inset-0" data-canvas-project={project}>
      <CanvasProjectContext.Provider value={project}>
      <Tldraw
        store={store}
        options={options}
        colorScheme="system"
        assetUrls={assetUrls}
        maxAssetSize={UPLOAD_BODY_LIMIT}
        maxImageDimension={Number.POSITIVE_INFINITY}
        onMount={onMount}
        shapeUtils={SHAPE_UTILS}
        overlayUtils={OVERLAY_UTILS}
        overrides={overrides}
        components={COMPONENTS}
        {...(licenseKey ? { licenseKey } : {})}
      />
      </CanvasProjectContext.Provider>
    </div>
  );
};
