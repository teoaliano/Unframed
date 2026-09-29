/**
 * The one bar at the bottom of the canvas (spec 02): tldraw's quick actions and action menu,
 * tldraw's tools, then whatever Unframed registers at its end (the Library and Add). It
 * replaces tldraw's toolbar, which stacks its quick actions in a second small bar above.
 */
import { useRef } from "react";
import { DefaultToolbarContent, OverflowingToolbar, TldrawUiOrientationProvider, TldrawUiToolbar, useEditor, useReadonly, useTldrawUiComponents } from "tldraw";
import { useWheelToCanvas } from "../canvas/wheelToCanvas.ts";
import { useSlots } from "./slots.ts";

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
            {/* tldraw shows one tool past maxItems: 7 ends the bar at Media, so the shapes open from the chevron. */}
            {/* oxlint-disable-next-line shadcn/no-unknown-classes -- tldraw measures the room for its tools on this parent. */}
            <OverflowingToolbar orientation="horizontal" sizingParentClassName="tlui-main-toolbar" minItems={4} maxItems={7} minSizePx={310} maxSizePx={470}>
              <DefaultToolbarContent />
            </OverflowingToolbar>
            {End && <End />}
          </div>
        </div>
      </div>
    </TldrawUiOrientationProvider>
  );
};
