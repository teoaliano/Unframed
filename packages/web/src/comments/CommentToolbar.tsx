import { unreadCount } from "@unframed/domain";
import { TldrawUiMenuContextProvider, TldrawUiToolbar, ToolbarItem, useEditor, useValue } from "tldraw";
import { COMMENT_TOOL, commentsUi } from "./state.ts";

export const CommentToolbarGroup = () => {
  const editor = useEditor();
  const ui = commentsUi(editor);
  const unread = useValue("comments unread", () => unreadCount(ui.threads.get(), ui.seen.get()) > 0, [ui]);
  return (
    <TldrawUiToolbar orientation="horizontal" label="Comments" data-unframed-toolbar-group="">
      <TldrawUiMenuContextProvider type="toolbar" sourceId="toolbar">
        <span className="relative flex" data-comment-tool-button="" data-unread={unread ? "" : undefined}>
          <ToolbarItem tool={COMMENT_TOOL} />
          {unread && <span data-comment-tool-unread="" className="pointer-events-none absolute top-1.5 right-1.5 size-2 rounded-full bg-highlight ring-2 ring-popover" />}
        </span>
      </TldrawUiMenuContextProvider>
    </TldrawUiToolbar>
  );
};
