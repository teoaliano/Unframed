import { UnframedError, type StyleShapeProps } from "@unframed/contracts";
import { splitFrontMatter } from "@unframed/domain";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import { EditorContent, useEditor as useTiptap } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Pencil } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { useEditor, useValue, type TLShape, type TLShapeId } from "tldraw";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Spinner } from "~/components/ui/spinner";
import { ChatMarkdown } from "../agent/transcript/ChatMarkdown.tsx";
import { fileUrl } from "../canvas/assetStore.ts";
import { useCanvasProject, useEngine } from "../context.ts";

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

/** The read view's text: front matter shown as the YAML it is, then the document. */
const readable = (markdown: string): string => {
  const { frontMatter, body } = splitFrontMatter(markdown);
  return frontMatter === "" ? markdown : `\`\`\`yaml\n${frontMatter.trim()}\n\`\`\`\n\n${body}`;
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
  const title = props?.title.trim() || "Style";
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
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{editing ? "Editing saves a new version; undo on the canvas brings the old one back." : file === "" ? "No document yet." : file}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {problem !== undefined && <Alert variant="error">{problem}</Alert>}
          {file !== "" && text === undefined && problem === undefined && <Spinner size="sm" aria-label="Loading" />}
          {text !== undefined &&
            (editing ? (
              <BodyEditor body={splitFrontMatter(text.markdown).body} reader={reader} />
            ) : (
              <div data-testid="style-read">
                <ChatMarkdown text={readable(text.markdown)} />
              </div>
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
