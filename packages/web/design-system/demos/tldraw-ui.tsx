/**
 * A small live tldraw editor with Unframed's tldraw setup, so its UI shows as the canvas
 * shows it. The context menu here is tldraw's default: Unframed's own needs the app's engine.
 * Below it, the tldraw classes and variables theme/tldraw.css sets, read from that file.
 */
import { Tldraw, toRichText, type Editor } from "tldraw";
import { Badge } from "~/components/ui/badge";
import adapter from "~/theme/tldraw.css?raw";
import { TLDRAW_ASSET_URLS, TLDRAW_CHROME, TLDRAW_OPTIONS } from "~/canvas/tldrawChrome.tsx";
import { Demos, Section } from "../frame.tsx";

const classes = [...new Set([...adapter.matchAll(/\.(tlui?-[\w-]+)/g)].map((match) => match[1]!))].sort();
const variables = [...new Set([...adapter.matchAll(/(--tl-[\w-]+)\s*:/g)].map((match) => match[1]!))].sort();

const seed = (editor: Editor) => {
  editor.createShapes([
    { type: "geo", x: 80, y: 80, props: { w: 160, h: 100, geo: "rectangle" } },
    { type: "geo", x: 300, y: 80, props: { w: 120, h: 100, geo: "ellipse", color: "blue", fill: "semi" } },
    { type: "text", x: 80, y: 240, props: { richText: toRichText("A prompt is tldraw text") } },
    { type: "arrow", x: 250, y: 130, props: { start: { x: 0, y: 0 }, end: { x: 50, y: 0 } } },
  ]);
  // A selection with styles, so the style panel shows as it does on the canvas.
  editor.select(editor.getCurrentPageShapes()[1]!.id);
  editor.zoomToFit({ animation: { duration: 0 } });
};

export default function TldrawUi() {
  return (
    <Demos>
      <Section title="Live editor">
        <p className="m-0 text-muted-foreground text-xs">
          Right-click for tldraw's default context menu. Pick a tool to see the style panel follow the selection or the tool.
        </p>
        <div className="relative h-[34rem] overflow-hidden rounded-lg border">
          <Tldraw assetUrls={TLDRAW_ASSET_URLS} options={TLDRAW_OPTIONS} components={TLDRAW_CHROME} colorScheme="system" onMount={seed} />
        </div>
      </Section>
      <Section title={`Classes theme/tldraw.css restyles (${classes.length})`}>
        <div className="flex flex-wrap gap-1.5">
          {classes.map((name) => (
            <Badge key={name} variant="outline">
              <span className="font-mono">.{name}</span>
            </Badge>
          ))}
        </div>
      </Section>
      <Section title={`Variables theme/tldraw.css maps onto the kit (${variables.length})`}>
        <div className="flex flex-wrap gap-1.5">
          {variables.map((name) => (
            <Badge key={name} variant="secondary">
              <span className="font-mono">{name}</span>
            </Badge>
          ))}
        </div>
      </Section>
    </Demos>
  );
}
