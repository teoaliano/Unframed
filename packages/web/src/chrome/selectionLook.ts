import {
  SelectionForegroundOverlayUtil,
  ShapeIndicatorOverlayUtil,
  strokeShapeIndicators,
  type Box,
  type Editor,
  type TLSelectionForegroundOverlay,
  type TLShapeIndicatorOverlay,
} from "tldraw";

const LINE = 1.5;
const RADIUS = 4;
const GRIP = 7;

interface Colors {
  readonly strokeColor: string;
  readonly bgColor: string;
}

const cache = new Map<string, Colors>();

/** The accent and card tokens as the canvas 2D context needs them, read once per colour mode. */
const tokenColors = (editor: Editor): Colors => {
  const mode = editor.getColorMode();
  let colors = cache.get(mode);
  if (!colors) {
    const style = getComputedStyle(editor.getContainer());
    colors = { strokeColor: style.getPropertyValue("--unframed-accent").trim(), bgColor: style.getPropertyValue("--unframed-card").trim() };
    if (colors.strokeColor !== "") cache.set(mode, colors);
  }
  return colors;
};

/** The facts tldraw's selection foreground works out for itself: when to show the box and which grips. */
interface SelectionState {
  bounds: Box;
  zoom: number;
  rotation: number;
  width: number;
  height: number;
  expandOffsetX: number;
  expandOffsetY: number;
  shouldDisplayBox: boolean;
  showResizeHandles: boolean;
  hideAlternateCornerHandles: boolean;
  showOnlyOneHandle: boolean;
}

interface ForegroundInternals {
  _computeSelectionState(): SelectionState | null;
  _renderCropHandles(ctx: CanvasRenderingContext2D, state: SelectionState, colors: Colors): void;
  _renderMobileRotateHandle(ctx: CanvasRenderingContext2D, state: SelectionState, colors: Colors): void;
  _renderTextResizeHandles(ctx: CanvasRenderingContext2D, state: SelectionState, colors: Colors): void;
}

/**
 * The selection from the design: a 1.5 px accent line with 4 px corners around the
 * selection, and four 7 by 7 square grips with a card fill. tldraw decides what shows and
 * where the handles are hit; this only paints. Edges paint nothing, as in tldraw.
 */
export class SelectionLook extends SelectionForegroundOverlayUtil {
  override render(ctx: CanvasRenderingContext2D, _overlays: TLSelectionForegroundOverlay[]): void {
    const internals = this as unknown as ForegroundInternals;
    const state = internals._computeSelectionState();
    if (!state) return;
    const colors = tokenColors(this.editor);
    const { zoom, width, height } = state;

    ctx.save();
    ctx.translate(state.bounds.x, state.bounds.y);
    ctx.rotate(state.rotation);
    ctx.translate(state.expandOffsetX, state.expandOffsetY);
    ctx.lineWidth = LINE / zoom;
    ctx.strokeStyle = colors.strokeColor;

    if (state.shouldDisplayBox) {
      ctx.beginPath();
      ctx.roundRect(0, 0, width, height, Math.min(RADIUS / zoom, width / 2, height / 2));
      ctx.stroke();
    }

    if (state.showResizeHandles) {
      const size = GRIP / zoom;
      ctx.fillStyle = colors.bgColor;
      const grip = (x: number, y: number, hidden: boolean) => {
        if (hidden) return;
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
        ctx.strokeRect(x - size / 2, y - size / 2, size, size);
      };
      grip(0, 0, false);
      grip(width, 0, state.hideAlternateCornerHandles);
      grip(width, height, state.showOnlyOneHandle);
      grip(0, height, state.hideAlternateCornerHandles);
    }

    internals._renderCropHandles(ctx, state, colors);
    internals._renderMobileRotateHandle(ctx, state, colors);
    internals._renderTextResizeHandles(ctx, state, colors);
    ctx.restore();
  }
}

/** Outlines for selected and hinted shapes only, in the accent: nothing changes on hover alone. */
export class SelectedOutlines extends ShapeIndicatorOverlayUtil {
  override getOverlays(): TLShapeIndicatorOverlay[] {
    const selected = new Set(this.editor.getSelectedShapeIds());
    return super.getOverlays().map((overlay) => ({
      ...overlay,
      props: { ...overlay.props, idsToDisplay: overlay.props.idsToDisplay.filter((id) => selected.has(id)) },
    }));
  }

  override render(ctx: CanvasRenderingContext2D, overlays: TLShapeIndicatorOverlay[]): void {
    const overlay = overlays[0];
    if (!overlay) return;
    const zoom = this.editor.getZoomLevel();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = tokenColors(this.editor).strokeColor;
    ctx.lineWidth = this.options.lineWidth / zoom;
    strokeShapeIndicators(this.editor, ctx, overlay.props.idsToDisplay);
    if (overlay.props.hintingShapeIds.length > 0) {
      ctx.lineWidth = this.options.hintedLineWidth / zoom;
      strokeShapeIndicators(this.editor, ctx, overlay.props.hintingShapeIds);
    }
  }
}

export const OVERLAY_UTILS = [SelectionLook, SelectedOutlines];
