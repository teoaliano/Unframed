import { commentBody, commentThreads, type CommentAuthor, type CommentRecordLike } from "@unframed/domain";
import { ClusterBubble, NewThreadComposer, PinBody, PreviewCard, SidebarRow, ThreadPopover, type ThreadActions } from "~/comments/parts.tsx";
import { Demos, Row, Section } from "../frame.tsx";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const HOUR = 3_600_000;

const claude: CommentAuthor = { kind: "agent", chatId: "demo", name: "Claude", provider: "claude" };
const codex: CommentAuthor = { kind: "agent", chatId: "demo-codex", name: "Codex", provider: "codex" };
const you: CommentAuthor = { kind: "person" };

const records: CommentRecordLike[] = [
  { id: "comment-thread:a", typeName: "comment-thread", pageId: "page:page", anchor: { type: "point", x: 0, y: 0 }, createdBy: "person", createdAt: NOW - 6 * HOUR, resolved: null, isDeleted: false, meta: { number: 4 } },
  { id: "comment:a1", typeName: "comment", threadId: "comment-thread:a", authorId: "person", createdAt: NOW - 6 * HOUR, editedAt: null, body: commentBody("I love where this is headed, but the spacing feels loose. @Claude can you tighten the rhythm?"), meta: {} },
  { id: "comment:a2", typeName: "comment", threadId: "comment-thread:a", authorId: "chat:demo", createdAt: NOW - 2 * HOUR, editedAt: null, body: commentBody("Tightened the gaps to 16 px and aligned the captions."), meta: { author: { name: "Claude", provider: "claude" } } },
  { id: "comment-thread:b", typeName: "comment-thread", pageId: "page:page", anchor: { type: "point", x: 0, y: 0 }, createdBy: "chat:demo-codex", createdAt: NOW - 30 * 60_000, resolved: { at: NOW, by: "person" }, isDeleted: false, meta: { number: 5 } },
  { id: "comment:b1", typeName: "comment", threadId: "comment-thread:b", authorId: "chat:demo-codex", createdAt: NOW - 30 * 60_000, editedAt: null, body: commentBody("The hero image is 2x the size it needs to be."), meta: { author: { name: "Codex", provider: "codex" } } },
];

const [open, resolved] = commentThreads(records);

const noop = () => undefined;
const actions: ThreadActions = { onClose: noop, onResolve: noop, onReply: noop, onMarkUnread: noop, onDeleteThread: noop, onEdit: noop, onDeleteComment: noop };

export default function CommentsDemo() {
  return (
    <Demos>
      <Section title="Pins">
        <Row label="read, selected, unread, pending, resolved">
          <div className="flex items-end gap-4 p-2">
            <PinBody author={you} />
            <PinBody author={claude} selected />
            <PinBody author={codex} unread />
            <PinBody pending />
            <PinBody author={claude} resolved />
          </div>
        </Row>
        <Row label="cluster, then hovered">
          <div className="flex items-center gap-4 p-2">
            <ClusterBubble authors={[you, claude]} count={3} hovered={false} />
            <ClusterBubble authors={[you, claude, codex]} count={3} hovered />
          </div>
        </Row>
        <Row label="hover preview">
          <div className="p-2">
            <PreviewCard thread={open!} now={NOW} />
          </div>
        </Row>
      </Section>
      <Section title="Writing">
        <Row label="new comment">
          <div className="p-2">
            <NewThreadComposer onSubmit={noop} onCancel={noop} />
          </div>
        </Row>
        <Row label="thread">
          <div className="p-2">
            <ThreadPopover thread={open!} now={NOW} actions={actions} />
          </div>
        </Row>
      </Section>
      <Section title="Comments panel">
        <Row label="unread, selected, resolved">
          <div className="flex w-80 flex-col gap-0.5 border bg-background p-2">
            <SidebarRow thread={open!} now={NOW} unread selected={false} onOpen={noop} onResolve={noop} onToggleRead={noop} onDelete={noop} />
            <SidebarRow thread={open!} now={NOW} unread={false} selected onOpen={noop} onResolve={noop} onToggleRead={noop} onDelete={noop} />
            <SidebarRow thread={resolved!} now={NOW} unread={false} selected={false} onOpen={noop} onResolve={noop} onToggleRead={noop} onDelete={noop} />
          </div>
        </Row>
      </Section>
    </Demos>
  );
}
