import { authorLabel, participants, relativeTime, replyCountLabel, type CommentAuthor, type CommentMessage, type CommentThread } from "@unframed/domain";
import { AtSign, Check, CircleCheck, Ellipsis, MessageCircle, User, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "~/lib/utils";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "~/components/ui/empty";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Separator } from "~/components/ui/separator";
import { Textarea } from "~/components/ui/textarea";
import { ConfirmDialog } from "../agent/ConfirmDialog.tsx";
import { ProviderLogo } from "../agent/composer/pickers.tsx";
import { composerGlassClass } from "../chrome/composerSurface.ts";
import { listboxPopupClass } from "../chrome/listbox.ts";
import { MessageAction, SendArrow } from "../chrome/MessageAction.tsx";
import { Tip } from "../chrome/ui.tsx";

export const useNow = (every = 30_000): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(timer);
  }, [every]);
  return now;
};

export const Avatar = ({ author, size = 20, muted = false, framed = true }: { readonly author: CommentAuthor; readonly size?: number; readonly muted?: boolean; readonly framed?: boolean }) => (
  <span
    data-comment-avatar={author.kind === "person" ? "person" : author.provider}
    aria-label={authorLabel(author)}
    role="img"
    style={{ width: size, height: size }}
    className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-(--comment-avatar-surface) text-(--comment-avatar-foreground)", framed && "ring-1 ring-(--comment-avatar-ring) ring-inset", muted && "text-(--comment-avatar-foreground-disabled) opacity-64")}
  >
    {author.kind === "person" ? (
      <User aria-hidden className="text-(--comment-avatar-icon)" style={{ width: size * 0.6, height: size * 0.6 }} />
    ) : author.provider === "outside" ? (
      <span aria-hidden className="text-xs font-medium leading-none">
        {author.name.charAt(0).toUpperCase()}
      </span>
    ) : (
      <span aria-hidden className="inline-flex">
        <ProviderLogo provider={author.provider} />
      </span>
    )}
  </span>
);

const MENTION = /(^|[^\w@])(@(?:claude|codex))\b/gi;

export const MentionText = ({ text }: { readonly text: string }) => {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(MENTION)) {
    const start = match.index! + match[1]!.length;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <span key={start} data-comment-mention="" className="font-medium text-(--comment-mention)">
        {match[2]}
      </span>,
    );
    last = start + match[2]!.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
};

const Byline = ({ author, at, now, muted = false }: { readonly author: CommentAuthor; readonly at: number; readonly now: number; readonly muted?: boolean }) => (
  <div className="flex min-w-0 items-center gap-2">
    <Avatar author={author} muted={muted} />
    <span className="truncate text-xs font-medium text-(--comment-author)">{authorLabel(author)}</span>
    <span className="shrink-0 text-xs text-(--comment-meta)">{relativeTime(at, now)}</span>
  </div>
);

export const PinBody = ({
  author,
  selected = false,
  pending = false,
  unread = false,
  resolved = false,
}: {
  readonly author?: CommentAuthor;
  readonly selected?: boolean;
  readonly pending?: boolean;
  readonly unread?: boolean;
  readonly resolved?: boolean;
}) => (
  <span
    data-comment-pin-body=""
    className={cn(
      "relative box-border flex size-8 items-center justify-center rounded-full rounded-bl-none border shadow-md/5",
      pending ? "border-(--comment-pin-border-active) bg-(--comment-pin-surface-active)" : "border-(--comment-pin-border) bg-(--comment-pin-surface)",
      selected && "outline-2 outline-offset-1 outline-(--comment-pin-ring-selected)",
    )}
  >
    {!pending && author !== undefined && <Avatar author={author} size={24} muted={resolved} framed={false} />}
    {unread && !pending && <span data-comment-unread="" className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-(--comment-pin-indicator) ring-2 ring-(--comment-pin-indicator-border)" />}
  </span>
);

export const PreviewCard = ({ thread, now, resolved = false }: { readonly thread: CommentThread; readonly now: number; readonly resolved?: boolean }) => {
  const first = thread.messages[0]!;
  const replies = replyCountLabel(thread);
  return (
    <div data-comment-preview="" className={cn(listboxPopupClass, "flex w-64 flex-col gap-1 rounded-lg rounded-bl-none border p-2.5")}>
      <Byline author={first.author} at={first.createdAt} now={now} muted={resolved} />
      <p className="m-0 line-clamp-2 ps-7 text-sm leading-relaxed break-words">
        <MentionText text={first.text} />
      </p>
      {replies !== null && <span className="ps-7 text-xs text-(--comment-meta)">{replies}</span>}
    </div>
  );
};

const COMPOSER_CLASS = `${composerGlassClass} relative isolate flex w-full flex-col text-sm leading-relaxed text-(--composer-foreground) gap-1.5 rounded-2xl px-3 pt-2.5 pb-2 after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-(--composer-border)`;

export const Composer = ({
  placeholder,
  onSubmit,
  onCancel,
  autoFocus = false,
  initial = "",
  variant,
  submitLabel,
}: {
  readonly placeholder: string;
  readonly onSubmit: (text: string) => void;
  readonly onCancel?: () => void;
  readonly autoFocus?: boolean;
  readonly initial?: string;
  readonly variant: "card" | "reply" | "edit";
  readonly submitLabel?: string;
}) => {
  const [text, setText] = useState(initial);
  const area = useRef<HTMLTextAreaElement>(null);
  const empty = text.trim() === "";

  useEffect(() => {
    if (!autoFocus) return;
    const element = area.current;
    if (element === null) return;
    element.focus({ preventScroll: true });
    element.setSelectionRange(element.value.length, element.value.length);
  }, [autoFocus]);

  const submit = () => {
    if (empty) return;
    onSubmit(text.trim());
    if (variant !== "edit") setText("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel?.();
    }
  };

  const mention = () => {
    const element = area.current;
    if (element === null) return;
    const start = element.selectionStart;
    const before = text.slice(0, start);
    const insert = before === "" || /\s$/.test(before) ? "@" : " @";
    setText(before + insert + text.slice(element.selectionEnd));
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + insert.length, start + insert.length);
    });
  };

  return (
    <div data-comment-composer={variant} className={cn(COMPOSER_CLASS, variant === "card" && "shadow-(--shadow-app-floating)")}>
      <Textarea
        unstyled
        ref={area}
        data-comment-input=""
        aria-label={placeholder}
        value={text}
        rows={1}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        style={{ minHeight: variant === "reply" ? 24 : 44, padding: 0, resize: "none" }}
      />
      <div className="flex items-center gap-1">
        <Tip label="Mention Claude or Codex" side="top">
          <Button variant="ghost-muted" size="icon-xs" aria-label="Mention an agent" onClick={mention}>
            <AtSign aria-hidden />
          </Button>
        </Tip>
        <span className="flex-1" />
        {variant === "edit" ? (
          <>
            <Button variant="ghost" size="xs" onClick={onCancel}>
              Cancel
            </Button>
            <Button size="xs" onClick={submit} disabled={empty}>
              {submitLabel ?? "Save"}
            </Button>
          </>
        ) : (
          <MessageAction tone="send" aria-label="Post" data-comment-send="" disabled={empty} onClick={submit} className="size-7">
            <SendArrow />
          </MessageAction>
        )}
      </div>
    </div>
  );
};

const MessageView = ({
  message,
  now,
  onEdit,
  onDelete,
  muted,
}: {
  readonly message: CommentMessage;
  readonly now: number;
  readonly onEdit?: ((text: string) => void) | undefined;
  readonly onDelete?: (() => void) | undefined;
  readonly muted: boolean;
}) => {
  const [editing, setEditing] = useState(false);
  const own = message.author.kind === "person" && (onEdit !== undefined || onDelete !== undefined);
  return (
    <article data-comment-message={message.id} className="group/message relative flex flex-col gap-1">
      <div className="pe-7">
        <Byline author={message.author} at={message.createdAt} now={now} muted={muted} />
      </div>
      {editing ? (
        <div className="ps-7">
          <Composer
            variant="edit"
            placeholder="Edit comment"
            initial={message.text}
            autoFocus
            onCancel={() => setEditing(false)}
            onSubmit={(text) => {
              onEdit?.(text);
              setEditing(false);
            }}
          />
        </div>
      ) : (
        <p className={cn("m-0 ps-7 text-sm leading-relaxed break-words whitespace-pre-wrap", muted && "text-(--comment-foreground-disabled)")}>
          <MentionText text={message.text} />
          {message.editedAt !== null && <span className="text-xs text-(--comment-meta)"> (edited)</span>}
        </p>
      )}
      {own && !editing && (
        <Menu>
          <span className="absolute -top-1 right-0 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100 pointer-coarse:opacity-100">
            <MenuTrigger aria-label="Comment actions" data-comment-message-menu="" render={<Button variant="ghost-muted" size="icon-xs" />}>
              <Ellipsis aria-hidden />
            </MenuTrigger>
          </span>
          <MenuPopup align="end">
            {onEdit && <MenuItem onClick={() => setEditing(true)}>Edit…</MenuItem>}
            {onDelete && (
              <MenuItem variant="destructive" onClick={onDelete}>
                Delete comment
              </MenuItem>
            )}
          </MenuPopup>
        </Menu>
      )}
    </article>
  );
};

export interface ThreadActions {
  readonly onClose: () => void;
  readonly onResolve: (resolved: boolean) => void;
  readonly onReply: (text: string) => void;
  readonly onMarkUnread: () => void;
  readonly onDeleteThread: () => void;
  readonly onEdit: (commentId: string, text: string) => void;
  readonly onDeleteComment: (commentId: string) => void;
}

export const FLOATING_CARD_CLASS = "dropdown-glass rounded-xl border border-(--comment-card-border) bg-(--comment-card-surface) font-sans text-(--comment-card-foreground) shadow-(--shadow-app-dropdown)";

export const ThreadPopover = ({ thread, now, actions, autoFocus = false }: { readonly thread: CommentThread; readonly now: number; readonly actions: ThreadActions; readonly autoFocus?: boolean }) => {
  const [confirming, setConfirming] = useState(false);
  const resolved = thread.resolved !== null;
  const list = useRef<HTMLDivElement>(null);
  const count = thread.messages.length;
  useEffect(() => {
    const element = list.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [count]);
  return (
    <div data-comment-thread={thread.id} role="dialog" aria-label={`Comment #${thread.number}`} className={cn(FLOATING_CARD_CLASS, "box-border flex max-h-[min(var(--comment-card-height),calc(100vh-var(--comment-card-offset)))] w-80 flex-col")}>
      <header className="flex h-11 shrink-0 items-center gap-1 border-b pr-1.5 pl-3">
        <MessageCircle aria-hidden className="size-4 shrink-0 text-(--comment-card-icon)" />
        <h2 className="m-0 ml-1 flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium">
          Comment
          <span className="text-(--comment-card-meta) tabular-nums">#{thread.number}</span>
          {resolved && (
            <Badge variant="success" size="sm">
              Resolved
            </Badge>
          )}
        </h2>
        <Tip label={resolved ? "Reopen" : "Resolve"}>
          <Button variant="ghost" size="icon-sm" aria-label={resolved ? "Reopen" : "Resolve"} aria-pressed={resolved} onClick={() => actions.onResolve(!resolved)}>
            {resolved ? <Check aria-hidden className="text-(--comment-card-resolved-icon)" /> : <CircleCheck aria-hidden />}
          </Button>
        </Tip>
        <Menu>
          <Tip label="More">
            <MenuTrigger aria-label="More" data-comment-thread-menu="" render={<Button variant="ghost" size="icon-sm" />}>
              <Ellipsis aria-hidden />
            </MenuTrigger>
          </Tip>
          <MenuPopup align="end">
            <MenuItem onClick={actions.onMarkUnread}>Mark as unread</MenuItem>
            <MenuSeparator />
            <MenuItem variant="destructive" onClick={() => setConfirming(true)}>
              Delete thread…
            </MenuItem>
          </MenuPopup>
        </Menu>
        <Separator orientation="vertical" className="mx-1 h-4" />
        <Tip label="Close">
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={actions.onClose}>
            <X aria-hidden />
          </Button>
        </Tip>
      </header>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete comment #${thread.number}?`}
        description="The thread and all its replies are removed for good."
        actions={[{ label: "Delete", destructive: true, onClick: actions.onDeleteThread }]}
      />
      <div ref={list} className="flex min-h-0 flex-col gap-3.5 overflow-y-auto px-3 pt-3 pb-1">
        {thread.messages.map((message) => (
          <MessageView
            key={message.id}
            message={message}
            now={now}
            muted={resolved}
            onEdit={message.author.kind === "person" ? (text) => actions.onEdit(message.id, text) : undefined}
            onDelete={message.author.kind === "person" ? () => actions.onDeleteComment(message.id) : undefined}
          />
        ))}
      </div>
      <div className="shrink-0 p-2.5">
        <Composer variant="reply" placeholder="Reply" autoFocus={autoFocus} onSubmit={actions.onReply} onCancel={actions.onClose} />
      </div>
    </div>
  );
};

export const NewThreadComposer = ({ onSubmit, onCancel }: { readonly onSubmit: (text: string) => void; readonly onCancel: () => void }) => (
  <div data-comment-new="" className="box-border w-80 font-sans">
    <Composer variant="card" placeholder="Add a comment, @ to ask Claude or Codex" autoFocus onSubmit={onSubmit} onCancel={onCancel} />
  </div>
);

export const SidebarRow = ({
  thread,
  now,
  unread,
  selected,
  onOpen,
  onResolve,
  onToggleRead,
  onDelete,
}: {
  readonly thread: CommentThread;
  readonly now: number;
  readonly unread: boolean;
  readonly selected: boolean;
  readonly onOpen: () => void;
  readonly onResolve: (resolved: boolean) => void;
  readonly onToggleRead: () => void;
  readonly onDelete: () => void;
}) => {
  const first = thread.messages[0]!;
  const resolved = thread.resolved !== null;
  const replies = replyCountLabel(thread);
  return (
    <div
      role="button"
      tabIndex={0}
      data-comment-row={thread.id}
      data-selected={selected ? "" : undefined}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className="group/row relative flex cursor-pointer flex-col gap-1.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-(--comment-list-row-surface-hover) focus-visible:ring-2 focus-visible:ring-(--comment-list-row-ring-focus) data-selected:bg-(--comment-list-row-surface-selected)"
    >
      <div className="flex h-6 items-center gap-1.5">
        <div className="flex -space-x-1">
          {participants(thread).slice(0, 4).map((author) => (
            <span key={author.kind === "person" ? "person" : author.chatId} className="rounded-full ring-2 ring-(--comment-list-row-avatar-ring)">
              <Avatar author={author} muted={resolved} />
            </span>
          ))}
        </div>
        <Badge variant="outline" size="sm">
          #{thread.number}
        </Badge>
        {resolved && (
          <Badge variant="success" size="sm">
            Resolved
          </Badge>
        )}
        <span className="flex-1" />
        <div
          className={cn("flex items-center opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100 pointer-coarse:opacity-100", selected && "opacity-100")}
          onClick={(event) => event.stopPropagation()}
        >
          <Menu>
            <MenuTrigger aria-label="Thread actions" render={<Button variant="ghost-muted" size="icon-xs" />}>
              <Ellipsis aria-hidden />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={onToggleRead}>{unread ? "Mark as read" : "Mark as unread"}</MenuItem>
              <MenuSeparator />
              <MenuItem variant="destructive" onClick={onDelete}>
                Delete thread
              </MenuItem>
            </MenuPopup>
          </Menu>
          <Tip label={resolved ? "Reopen" : "Resolve"}>
            <Button variant="ghost-muted" size="icon-xs" aria-label={resolved ? "Reopen" : "Resolve"} onClick={() => onResolve(!resolved)}>
              {resolved ? <Check aria-hidden /> : <CircleCheck aria-hidden />}
            </Button>
          </Tip>
        </div>
        {unread && <span data-comment-unread="" aria-label="Unread" role="img" className="size-2 shrink-0 rounded-full bg-(--comment-list-row-indicator)" />}
      </div>
      <div className="flex min-w-0 items-baseline gap-1.5 text-xs">
        <span className="truncate font-medium text-(--comment-author)">{authorLabel(first.author)}</span>
        <span className="shrink-0 text-(--comment-meta)">{relativeTime(first.createdAt, now)}</span>
      </div>
      <p className={cn("m-0 line-clamp-3 text-sm leading-relaxed break-words", resolved ? "text-(--comment-foreground-disabled)" : "text-(--comment-foreground)")}>
        <MentionText text={first.text} />
      </p>
      {replies !== null && <span className="text-xs text-(--comment-meta)">{replies}</span>}
    </div>
  );
};

export const CommentsEmpty = ({ filtered }: { readonly filtered: boolean }) => (
  <Empty size="compact">
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <MessageCircle aria-hidden />
      </EmptyMedia>
      <EmptyTitle>{filtered ? "No comments match" : "No comments yet"}</EmptyTitle>
      <EmptyDescription>{filtered ? "Try other words, or show resolved comments." : "Click the canvas to leave one. Mention @Claude or @Codex to ask an agent."}</EmptyDescription>
    </EmptyHeader>
  </Empty>
);

export const ClusterBubble = ({ authors, count, hovered }: { readonly authors: ReadonlyArray<CommentAuthor>; readonly count: number; readonly hovered: boolean }) => (
  <span
    data-comment-cluster-body=""
    className={cn(
      "box-border flex items-center justify-center rounded-full border border-(--comment-cluster-border) bg-(--comment-cluster-surface) text-xs font-medium text-(--comment-cluster-foreground) tabular-nums shadow-md/5 transition-[width,height] duration-150 ease-out motion-reduce:transition-none",
      hovered ? "h-9 min-w-9 px-1.5" : "size-8",
    )}
  >
    {hovered ? (
      <span className="flex -space-x-1.5">
        {authors.slice(0, 3).map((author, index) => (
          <span key={index} className="rounded-full ring-2 ring-(--comment-cluster-avatar-ring)">
            <Avatar author={author} size={24} />
          </span>
        ))}
      </span>
    ) : (
      count
    )}
  </span>
);
