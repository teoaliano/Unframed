import { useSync } from "@tldraw/sync";
import { canvasSchema } from "@unframed/contracts";
import { UPLOAD_BODY_LIMIT } from "@unframed/domain";
import { installSelectionReporter } from "./selectionReport.ts";
import { useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { Tldraw, type Editor, type TLComponents } from "tldraw";
import "./canvas.css";
import "../generate/imageMedium.ts";
import "../generate/videoMedium.ts";
import "../generate/textMedium.ts";
import "../generate/audioMedium.tsx";
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
import { SETTLE_BEFORE_SWITCH_MS, type ProjectActivation } from "../project/activation.ts";
import { showError } from "../toasts.tsx";
import { createAssetStore, Previews } from "./assetStore.ts";
import { clipboardOptions, installExternalContent, type ContentContext } from "./externalContent.ts";
import { ContextMenu } from "./ContextMenu.tsx";
import { InFront } from "./InFront.tsx";
import { overrides } from "./overrides.ts";
import { installRefMinting, RefMinter } from "./refs.ts";
import { installRename } from "./rename.ts";
import { watchRunProgress } from "../generate/recipeRuns.ts";
import { ComponentShapeUtil, MotionShapeUtil, PageShapeUtil } from "./shapes/artifact.tsx";
import { AudioShapeUtil } from "./shapes/audio.tsx";
import { NodeShapeUtil } from "../nodes/NodeShapeUtil.tsx";
import { WireShapeUtil } from "../nodes/WireShapeUtil.tsx";
import { installNodeSideEffects } from "../nodes/sideEffects.ts";
import { installWireCopies } from "../nodes/copies.ts";
import { watchMotionRenders, watchNodeCatalogues } from "../nodes/facts.ts";
import { bindNodeCatalogues } from "../nodes/operations.ts";
import { watchChainReports } from "../nodes/reports.ts";
import { GroupShapeUtil } from "./shapes/group.tsx";
import { ImageMediaUtil, VideoMediaUtil } from "./shapes/media.tsx";
import { PromptShapeUtil } from "./shapes/prompt.tsx";
import { SyncSocket } from "./syncSocket.ts";
import { recalledCamera, rememberCamera } from "../project/tabMemory.ts";
import { TLDRAW_ASSET_URLS, TLDRAW_CHROME, TLDRAW_OPTIONS } from "./tldrawChrome.tsx";


const SHAPE_UTILS = [PromptShapeUtil, ImageMediaUtil, VideoMediaUtil, AudioShapeUtil, GroupShapeUtil, PageShapeUtil, MotionShapeUtil, ComponentShapeUtil, NodeShapeUtil, WireShapeUtil];

const COMPONENTS: TLComponents = {
  ...TLDRAW_CHROME,
  InFrontOfTheCanvas: InFront,
  OnTheCanvas: RoleBadges,
  Background: DotGrid,
  ContextMenu,
};

const syncUrl = (project: string, sessionId: string): string => {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}/sync/${encodeURIComponent(project)}?sessionId=${encodeURIComponent(sessionId)}`;
};

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

export const CanvasHost = ({ project, activation }: { readonly project: string; readonly activation: ProjectActivation }) => {
  const licenseKey = useContext(LicenseKeyContext);
  const engine = useEngine();
  const content = useRef<ContentContext | undefined>(undefined);
  const options = useMemo(() => ({ ...TLDRAW_OPTIONS, ...clipboardOptions({ project, context: () => content.current }) }), [project]);
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
  useEffect(() => watchChainReports(engine, project), [engine, project]);

  useEffect(() => {
    activation.setBeforeSwitch(() => socket.current?.settled(SETTLE_BEFORE_SWITCH_MS) ?? Promise.resolve());
    return () => {
      activation.setBeforeSwitch(undefined);
      connectionMonitor.setSync("up");
      previews.dispose();
    };
  }, [activation, previews]);

  const onMount = useCallback((editor: Editor) => {
    editor.user.updateUserPreferences({ locale: "en" });
    const minter = new RefMinter(editor);
    const stopMinting = installRefMinting(editor, minter);
    const stopLabelLevel = installLabelLevel(editor);
    const stopLabelActivity = installLabelActivity(editor);
    const stopCopyStripping = installCopyStripping(editor);
    const stopRenderPolls = installRenderPolls(editor, engine, project);
    const stopRename = installRename(editor);
    const stopRunProgress = watchRunProgress(editor, engine, project);
    const stopSelection = installSelectionReporter(editor, engine, project);
    const stopNodes = installNodeSideEffects(editor);
    const stopWireCopies = installWireCopies(editor);
    const stopRenders = watchMotionRenders(editor, engine, project);
    bindNodeCatalogues(editor);
    const stopCatalogues = watchNodeCatalogues(editor, engine);
    content.current = { project, engine, minter };
    installExternalContent(editor, content.current);
    const camera = recalledCamera(project);
    if (camera) editor.setCamera(camera, { animation: { duration: 0 } });
    else fitToShapes(editor);
    return () => {
      rememberCamera(project, editor.getCamera());
      stopMinting();
      stopLabelLevel();
      stopLabelActivity();
      stopCopyStripping();
      stopRenderPolls();
      stopRename();
      stopRunProgress();
      stopSelection();
      stopNodes();
      stopWireCopies();
      stopRenders();
      stopCatalogues();
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
        assetUrls={TLDRAW_ASSET_URLS}
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
