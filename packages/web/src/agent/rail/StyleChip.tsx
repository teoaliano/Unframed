import type { Chat } from "@unframed/contracts";
import { Palette, Unlink } from "lucide-react";
import { useMaybeEditor, useValue, type TLShapeId } from "tldraw";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Tip } from "../../chrome/ui.tsx";
import { showUndo } from "../../toasts.tsx";
import type { ChatClient } from "../store.ts";

/**
 * The style the active chat follows, as a chip under its tab with Detach. A toast says what
 * was detached and offers Undo, which attaches it again. Nothing shows when the chat has no
 * style.
 */
export const StyleChip = ({ client, chat }: { readonly client: ChatClient; readonly chat: Chat | undefined }) => {
  const editor = useMaybeEditor();
  const styleId = chat?.style ?? null;
  const label = useValue(
    "chat style",
    () => {
      if (styleId === null) return undefined;
      const shape = editor?.getShape(styleId as TLShapeId);
      const title = shape?.type === "style" ? String((shape.props as { title?: unknown }).title ?? "").trim() : "";
      return title === "" ? "Style" : title;
    },
    [editor, styleId],
  );
  if (!chat || styleId === null || label === undefined) return null;
  const report = (error: unknown) => client.reportError(error);
  const detach = () =>
    client.dispatch({ type: "thread.style.remove", threadId: chat.id, styleId }).then(
      () => showUndo(`Detached the style ${label}`, () => client.dispatch({ type: "thread.style.set", threadId: chat.id, styleId }).catch(report)),
      report,
    );
  return (
    <div className="flex shrink-0 items-center gap-1 border-b px-2.5 py-1.5" data-testid="chat-style">
      <span className="text-xs text-muted-foreground">Style</span>
      <Badge variant="outline" size="lg" className="max-w-full" data-chip="style">
        <Palette aria-hidden />
        <span className="min-w-0 truncate" data-testid="chat-style-label">
          {label}
        </span>
        <Tip label="Detach this style from the chat">
          <Button variant="ghost-muted" size="icon-tiny" aria-label={`Detach ${label}`} onClick={() => void detach()}>
            <Unlink aria-hidden />
          </Button>
        </Tip>
      </Badge>
    </div>
  );
};
