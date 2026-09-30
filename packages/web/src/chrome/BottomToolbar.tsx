/**
 * The one bar at the bottom of the canvas (spec 02): tldraw's quick actions and action menu,
 * tldraw's tools, then whatever Unframed registers at its end (the Library and Add). It
 * replaces tldraw's toolbar, which stacks its quick actions in a second small bar above.
 */
import { useRef } from "react";
import {
  ArrowDownToolbarItem,
  ArrowLeftToolbarItem,
  ArrowRightToolbarItem,
  ArrowToolbarItem,
  ArrowUpToolbarItem,
  CheckBoxToolbarItem,
  CloudToolbarItem,
  DiamondToolbarItem,
  DrawToolbarItem,
  EllipseToolbarItem,
  EraserToolbarItem,
  FrameToolbarItem,
  HandToolbarItem,
  HeartToolbarItem,
  HexagonToolbarItem,
  HighlightToolbarItem,
  LaserToolbarItem,
  LineToolbarItem,
  NoteToolbarItem,
  OvalToolbarItem,
  OverflowingToolbar,
  RectangleToolbarItem,
  RhombusToolbarItem,
  SelectToolbarItem,
  StarToolbarItem,
  TextToolbarItem,
  TldrawUiOrientationProvider,
  TldrawUiToolbar,
  TriangleToolbarItem,
  XBoxToolbarItem,
  useEditor,
  useReadonly,
  useTldrawUiComponents,
} from "tldraw";
import { useWheelToCanvas } from "../canvas/wheelToCanvas.ts";
import { useSlots } from "./slots.ts";

/**
 * tldraw's tools in Unframed's order: the six in the bar, then the arrow and every shape
 * under the overflow chevron. No Media tool: Image and Video from Add bring files in.
 */
const ToolbarContent = () => (
  <>
    <SelectToolbarItem />
    <HandToolbarItem />
    <DrawToolbarItem />
    <EraserToolbarItem />
    <TextToolbarItem />
    <NoteToolbarItem />
    <ArrowToolbarItem />
    <RectangleToolbarItem />
    <EllipseToolbarItem />
    <TriangleToolbarItem />
    <DiamondToolbarItem />
    <HexagonToolbarItem />
    <OvalToolbarItem />
    <RhombusToolbarItem />
    <StarToolbarItem />
    <CloudToolbarItem />
    <HeartToolbarItem />
    <XBoxToolbarItem />
    <CheckBoxToolbarItem />
    <ArrowLeftToolbarItem />
    <ArrowUpToolbarItem />
    <ArrowDownToolbarItem />
    <ArrowRightToolbarItem />
    <LineToolbarItem />
    <HighlightToolbarItem />
    <LaserToolbarItem />
    <FrameToolbarItem />
  </>
);

export const BottomToolbar = () => {
  const editor = useEditor();
  const readonly = useReadonly();
  const { QuickActions, ActionsMenu } = useTldrawUiComponents();
  const { toolbarEnd: End } = useSlots();
  const root = useRef<HTMLDivElement>(null);
  useWheelToCanvas(editor, root);
  return (
    <TldrawUiOrientationProvider orientation="horizontal" tooltipSide="top">
      {/* oxlint-disable-next-line shadcn/no-unknown-classes -- tldraw sizes its tools and places the bar by these class names. */}
      <div className="tlui-main-toolbar tlui-main-toolbar--horizontal">
        {/* oxlint-disable-next-line shadcn/no-unknown-classes -- tldraw's bottom-centre placement. */}
        <div className="tlui-main-toolbar__inner">
          <div ref={root} data-unframed-toolbar="" data-testid="bottom-toolbar">
            {!readonly && (QuickActions || ActionsMenu) && (
              <TldrawUiToolbar orientation="horizontal" label="Actions" data-unframed-toolbar-group="">
                {QuickActions && <QuickActions />}
                {ActionsMenu && <ActionsMenu />}
              </TldrawUiToolbar>
            )}
            {/* tldraw shows one tool past maxItems: 5 ends the bar at Note, so the arrow and shapes open from the chevron. */}
            {/* oxlint-disable-next-line shadcn/no-unknown-classes -- tldraw measures the room for its tools on this parent. */}
            <OverflowingToolbar orientation="horizontal" sizingParentClassName="tlui-main-toolbar" minItems={4} maxItems={5} minSizePx={310} maxSizePx={470}>
              <ToolbarContent />
            </OverflowingToolbar>
            {End && <End />}
          </div>
        </div>
      </div>
    </TldrawUiOrientationProvider>
  );
};
