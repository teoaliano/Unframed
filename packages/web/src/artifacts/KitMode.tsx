import { SunMoon } from "lucide-react";
import { useValue } from "tldraw";
import { useCanvasDoc, type CanvasDoc } from "../canvas/doc.ts";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Tip } from "../chrome/ui.tsx";

const setShapeMode = (doc: CanvasDoc, shapeId: string, mode: string): void => {
  const kit = doc.kit();
  if (!doc.shape(shapeId) || !kit || !kit.modes.includes(mode)) return;
  doc.update(shapeId, { mode: mode === kit.modes[0] ? undefined : mode });
};

export const KitModePicker = ({ shapeId, variant }: { readonly shapeId: string; readonly variant: "header" | "toolbar" }) => {
  const doc = useCanvasDoc();
  const kit = useValue("project kit", () => doc.kit(), [doc]);
  const stored = useValue("artifact mode", () => (doc.shape(shapeId)?.props as { mode?: string } | undefined)?.mode, [doc, shapeId]);
  if (!kit || kit.modes.length < 2) return null;
  const current = stored !== undefined && kit.modes.includes(stored) ? stored : kit.modes[0]!;
  const trigger = (
    <SelectTrigger aria-label="Kit mode" size="sm" data-testid="kit-mode" className={variant === "header" ? "w-auto shrink-0 @max-[760px]/editor-header:min-w-0" : "w-auto shrink-0"}>
      <SunMoon aria-hidden />
      <span className={variant === "header" ? "@max-[760px]/editor-header:sr-only" : undefined}>
        <SelectValue>{current}</SelectValue>
      </span>
    </SelectTrigger>
  );
  return (
    <Select value={current} onValueChange={(value) => value && setShapeMode(doc, shapeId, value)}>
      {variant === "toolbar" ? <Tip label="Kit mode">{trigger}</Tip> : trigger}
      <SelectPopup alignItemWithTrigger={false}>
        {kit.modes.map((mode, index) => (
          <SelectItem key={mode} value={mode}>
            {index === 0 ? `${mode} (default)` : mode}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
};
