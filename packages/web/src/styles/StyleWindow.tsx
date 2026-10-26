import { UnframedError, type StyleRole, type StyleShapeProps } from "@unframed/contracts";
import { splitFrontMatter, styleRoleOf } from "@unframed/domain";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import { EditorContent, useEditor as useTiptap } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { ChevronRight, Pencil } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { useEditor, useValue, type TLShape, type TLShapeId } from "tldraw";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Spinner } from "~/components/ui/spinner";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { ChatMarkdown } from "../agent/transcript/ChatMarkdown.tsx";
import { fileUrl } from "../canvas/assetStore.ts";
import { useCanvasProject, useEngine } from "../context.ts";

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

/** The front matter's YAML without its `---` lines. */
const yamlOf = (frontMatter: string): string =>
  frontMatter
    .replace(/^---[ \t]*\r?\n/, "")
    .replace(/\r?\n---[ \t]*(\r?\n)?$/, "")
    .trimEnd();

/** The read view: the document rendered, then its front matter folded under Details, wrapped to the window. */
const ReadView = ({ markdown }: { readonly markdown: string }) => {
  const { frontMatter, body } = splitFrontMatter(markdown);
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-4" data-testid="style-read">
      <ChatMarkdown text={body} />
      {frontMatter !== "" && (
        <div className="border-t pt-3">
          <Collapsible open={open} onOpenChange={setOpen} data-testid="style-details">
            <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
              <ChevronRight aria-hidden className={open ? "size-3.5 rotate-90 transition-transform duration-200 motion-reduce:transition-none" : "size-3.5 transition-transform duration-200 motion-reduce:transition-none"} />
              Details
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <pre className="m-0 mt-2 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-muted-foreground select-text" data-testid="style-front-matter">
                {yamlOf(frontMatter)}
              </pre>
            </CollapsiblePanel>
          </Collapsible>
        </div>
      )}
    </div>
  );
};

/** The body editor: Tiptap with its markdown extension and tables, so a DESIGN.md's tables survive a save. */
const BodyEditor = ({ body, reader }: { readonly body: string; readonly reader: RefObject<(() => string) | undefined> }) => {
  const tiptap = useTiptap({
    extensions: [StarterKit, TableKit, Markdown],
    content: body,
    contentType: "markdown",
    autofocus: "start",
    editorProps: { attributes: { class: "chat-markdown min-h-[320px] text-sm leading-relaxed text-foreground outline-none", "aria-label": "Style document", "data-testid": "style-editor" } },
  });
  useEffect(() => {
    reader.current = tiptap ? () => tiptap.getMarkdown() : undefined;
    return () => {
      reader.current = undefined;
    };
  }, [tiptap, reader]);
  return <EditorContent editor={tiptap} />;
};

/**
 * The markdown window: a style document rendered to read, and an edit mode that saves a new
 * version file and points the shape at it as the person's own change, so tldraw's undo
 * brings the old version back. Keys typed here never reach the canvas; Escape closes.
 */
export const StyleWindow = ({ shapeId, onClose }: { readonly shapeId: TLShapeId; readonly onClose: () => void }) => {
  const editor = useEditor();
  const engine = useEngine();
  const project = useCanvasProject();
  const shape = useValue("style shape", () => editor.getShape(shapeId) as TLShape<"style"> | undefined, [editor, shapeId]);
  const props = shape?.props as StyleShapeProps | undefined;
  const file = props?.file ?? "";
  const role = styleRoleOf(props);
  const title = props?.title.trim() || (role === "document" ? "Document" : "Style");
  const [text, setText] = useState<{ readonly file: string; readonly markdown: string }>();
  const [problem, setProblem] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const reader = useRef<(() => string) | undefined>(undefined);

  useEffect(() => {
    if (file === "") return;
    let live = true;
    fetch(fileUrl(project, file))
      .then(async (response) => {
        if (!response.ok) throw new Error(`the file answered ${response.status}`);
        const markdown = await response.text();
        if (live) setText({ file, markdown });
      })
      .catch((error: unknown) => live && setProblem(`Could not read ${file}: ${messageOf(error)}`));
    return () => {
      live = false;
    };
  }, [project, file]);

  // The shape left the canvas (deleted, or undone away): the window has nothing to show.
  useEffect(() => {
    if (!shape) onClose();
  }, [shape, onClose]);

  const save = async () => {
    const read = reader.current;
    if (!text || !read || !shape) return;
    const { frontMatter, body } = splitFrontMatter(text.markdown);
    const edited = read();
    // An unchanged body keeps its own bytes: the editor's markdown is not always the person's.
    if (edited.trim() === body.trim()) {
      setEditing(false);
      return;
    }
    const markdown = `${frontMatter}${frontMatter !== "" && !edited.startsWith("\n") ? "\n" : ""}${edited.endsWith("\n") ? edited : `${edited}\n`}`;
    setSaving(true);
    setProblem(undefined);
    try {
      const saved = await engine.call("style.write", { project, markdown, title, shapeId, of: text.file });
      editor.markHistoryStoppingPoint("edit style");
      editor.updateShape({ id: shapeId, type: "style", props: { file: saved.file, swatches: [...saved.swatches], excerpt: saved.excerpt } } as TLShape);
      setText({ file: saved.file, markdown });
      setEditing(false);
    } catch (error) {
      setProblem(`Could not save the style: ${messageOf(error)}`);
    } finally {
      setSaving(false);
    }
  };

  // A role is a canvas change, not a new version: one undo step on the canvas flips it back.
  const changeRole = (next: StyleRole) => {
    if (next === role || !shape) return;
    editor.markHistoryStoppingPoint("style role");
    editor.updateShape({ id: shapeId, type: "style", props: { role: next } } as TLShape);
  };

  // The canvas listens for its shortcuts on the document: keys typed in the window stop here,
  // so the window closes itself on Escape.
  const keep = (event: KeyboardEvent) => {
    event.stopPropagation();
    editor.markEventAsHandled(event);
    if (event.type === "keydown" && event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup data-testid="style-window" className="max-h-[min(860px,calc(100vh-48px))] max-w-[760px]" onKeyDown={keep} onKeyUp={keep}>
        <DialogHeader>
          <div className="flex min-w-0 items-center gap-3 pe-8">
            <DialogTitle className="min-w-0 flex-1">{title}</DialogTitle>
            <ToggleGroup
              aria-label="Use as"
              className="shrink-0"
              variant="segmented"
              value={[role]}
              onValueChange={(value) => {
                const next = value[0];
                if (next === "style" || next === "document") changeRole(next);
              }}
              data-testid="style-role"
            >
              <Toggle value="style">Style</Toggle>
              <Toggle value="document">Document</Toggle>
            </ToggleGroup>
          </div>
          <DialogDescription>{editing ? "Editing saves a new version; undo on the canvas brings the old one back." : file === "" ? "No document yet." : file}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {problem !== undefined && <Alert variant="error">{problem}</Alert>}
          {file !== "" && text === undefined && problem === undefined && <Spinner size="sm" aria-label="Loading" />}
          {text !== undefined &&
            (editing ? (
              <BodyEditor body={splitFrontMatter(text.markdown).body} reader={reader} />
            ) : (
              <ReadView markdown={text.markdown} />
            ))}
        </DialogPanel>
        <DialogFooter>
          {editing ? (
            <>
              <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={() => void save()} disabled={saving}>
                Save
              </Button>
            </>
          ) : (
            <>
              <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
              <Button onClick={() => setEditing(true)} disabled={text === undefined}>
                <Pencil aria-hidden />
                Edit
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
