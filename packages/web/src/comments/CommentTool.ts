import { regionAnchor, type Point } from "@unframed/domain";
import { StateNode, type TLPointerEventInfo } from "tldraw";
import { COMMENT_TOOL, commentsUi } from "./state.ts";

const REGION_MIN = 8;

export class CommentTool extends StateNode {
  static override id = COMMENT_TOOL;

  private start: Point | null = null;

  override onEnter() {
    this.editor.selectNone();
    this.editor.setCursor({ type: "default", rotation: 0 });
    this.editor.getContainer().setAttribute("data-unframed-commenting", "");
  }

  override onExit() {
    this.start = null;
    const ui = commentsUi(this.editor);
    ui.region.set(null);
    ui.close();
    this.editor.getContainer().removeAttribute("data-unframed-commenting");
  }

  override onPointerDown(info: TLPointerEventInfo) {
    if (info.button !== 0) return;
    const point = this.editor.inputs.getCurrentPagePoint();
    this.start = { x: point.x, y: point.y };
  }

  override onPointerMove() {
    if (this.start === null || !this.editor.inputs.getIsDragging()) return;
    const point = this.editor.inputs.getCurrentPagePoint();
    commentsUi(this.editor).region.set({ start: this.start, end: { x: point.x, y: point.y } });
  }

  override onPointerUp() {
    const start = this.start;
    this.start = null;
    if (start === null) return;
    const ui = commentsUi(this.editor);
    const region = ui.region.get();
    ui.region.set(null);
    const zoom = this.editor.getZoomLevel();
    if (region !== null && Math.abs(region.end.x - region.start.x) * zoom >= REGION_MIN && Math.abs(region.end.y - region.start.y) * zoom >= REGION_MIN) {
      ui.open.set({ kind: "draft", anchor: regionAnchor(region.start, region.end) });
      return;
    }
    if (ui.open.get() !== null) {
      ui.close();
      return;
    }
    ui.open.set({ kind: "draft", anchor: ui.anchorFor(start) });
  }

  override onCancel() {
    const ui = commentsUi(this.editor);
    if (this.start !== null) {
      this.start = null;
      ui.region.set(null);
      return;
    }
    if (ui.open.get() !== null) {
      ui.close();
      return;
    }
    this.editor.setCurrentTool("select");
  }

  override onInterrupt() {
    this.start = null;
    commentsUi(this.editor).region.set(null);
  }
}
