import { authorLabel, participants, relativeTime, replyCountLabel, type CommentAuthor, type CommentMessage, type CommentThread } from "@unframed/domain";
import { ArrowUp, AtSign, Check, CircleCheck, Ellipsis, User, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import claudeLogo from "../../../../assets/brand/provider-logos/claude.svg?url";
import codexLogo from "../../../../assets/brand/provider-logos/codex.svg?url";

const LOGOS: Record<string, string> = { claude: claudeLogo, codex: codexLogo };

const AGENT_FILL: Record<string, string> = { claude: "bg-agent-claude text-comment-foreground", codex: "bg-agent-codex text-agent-codex-foreground" };

export const useNow = (every = 30_000): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(timer);
  }, [every]);
  return now;
};

export const Avatar = ({ author, size = 24, muted = false }: { readonly author: CommentAuthor; readonly size?: number; readonly muted?: boolean }) => {
  const style = { width: size, height: size };
  if (author.kind === "person") {
    return (
      <span data-comment-avatar="person" aria-label="You" role="img" style={style} className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-comment-avatar text-comment-avatar-foreground", muted && "opacity-50")}>
        <User aria-hidden style={{ width: size * 0.58, height: size * 0.58 }} strokeWidth={2.25} />
      </span>
    );
  }
  const logo = LOGOS[author.provider];
  return (
    <span
      data-comment-avatar={author.provider}
      aria-label={author.name}
      role="img"
      style={style}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full", logo === undefined ? "bg-comment text-comment-foreground" : AGENT_FILL[author.provider], muted && "bg-comment-avatar text-comment-avatar-foreground")}
    >
      {logo === undefined ? (
        <span className="font-semibold leading-none" style={{ fontSize: size * 0.46 }}>
          {author.name.charAt(0).toUpperCase()}
        </span>
      ) : (
        <span className="block bg-current" style={{ width: size * 0.58, height: size * 0.58, mask: `url("${logo}") center / contain no-repeat`, WebkitMask: `url("${logo}") center / contain no-repeat` }} />
      )}
    </span>
  );
};

const MENTION = /(^|[^\w@])(@(?:claude|codex))\b/gi;

export const MentionText = ({ text }: { readonly text: string }) => {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(MENTION)) {
    const start = match.index! + match[1]!.length;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <span key={start} data-comment-mention="" className="font-medium text-comment">
        {match[2]}
      </span>,
    );
    last = start + match[2]!.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
};

export const PIN_SHADOW = "shadow-[0_1px_3px_rgb(0_0_0/0.15),0_0_0.5px_rgb(0_0_0/0.18)]";

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
      "relative box-border flex size-8 items-center justify-center rounded-[16px] rounded-bl-none",
      PIN_SHADOW,
      pending ? "bg-comment" : "bg-comment-pin",
      selected && "ring-2 ring-comment",
    )}
  >
    {!pending && author !== undefined && <Avatar author={author} muted={resolved} />}
    {unread && !pending && <span data-comment-unread="" className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-comment-pin bg-comment box-content" />}
  </span>
);

export const PreviewCard = ({ thread, now, resolved = false }: { readonly thread: CommentThread; readonly now: number; readonly resolved?: boolean }) => {
  const first = thread.messages[0]!;
  const replies = replyCountLabel(thread);
  return (
    <div data-comment-preview="" className={cn("box-border flex w-60 flex-col gap-1 rounded-[16px] rounded-bl-none bg-popover p-1 pe-3 text-popover-foreground", PIN_SHADOW)}>
      <div className="flex min-w-0 items-center gap-2">
        <Avatar author={first.author} muted={resolved} />
        <span className="truncate text-[13px] font-semibold leading-5">{authorLabel(first.author)}</span>
        <span className="shrink-0 text-[11px] leading-5 text-muted-foreground">{relativeTime(first.createdAt, now)}</span>
      </div>
      <p className="m-0 line-clamp-2 ps-8 pb-1 text-[13px] leading-5 break-words">
        <MentionText text={first.text} />
      </p>
      {replies !== null && <span className="ps-8 pb-1 text-[11px] leading-4 text-muted-foreground">{replies}</span>}
    </div>
  );
};

const SendButton = ({ disabled, onClick }: { readonly disabled: boolean; readonly onClick: () => void }) => (
  <Button variant="comment" size="icon-xs" aria-label="Post" data-comment-send="" disabled={disabled} onClick={onClick}>
    <ArrowUp aria-hidden strokeWidth={2.25} />
  </Button>
);

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
  const expanded = !empty || variant === "edit";

  useLayoutEffect(() => {
    const element = area.current;
    if (element === null) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 240)}px`;
  }, [text, expanded]);

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
    const next = before + insert + text.slice(element.selectionEnd);
    setText(next);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + insert.length, start + insert.length);
    });
  };

  const field = (
    <textarea
      ref={area}
      data-comment-input=""
      aria-label={placeholder}
      value={text}
      rows={1}
      placeholder={placeholder}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={onKeyDown}
      className={cn(
        "block w-full resize-none border-0 bg-transparent p-0 text-[13px] leading-5 text-popover-foreground outline-none placeholder:text-muted-foreground",
        expanded ? "min-h-10" : "min-h-5",
      )}
    />
  );

  return (
    <div data-comment-composer={variant} data-expanded={expanded ? "" : undefined} className={cn("box-border flex w-full flex-col rounded-xl", variant === "card" ? "bg-popover" : "bg-comment-field")}>
      <div className={cn("flex min-h-10 items-center gap-2", expanded ? "px-3 pt-2.5 pb-2" : "ps-3 pe-2")}>
        <div className={cn("min-w-0 flex-1", !expanded && "py-2.5")}>{field}</div>
        {!expanded && <SendButton disabled onClick={submit} />}
      </div>
      {expanded && (
        <>
          <div className="h-px bg-border" />
          <div className="flex h-10 items-center gap-1 ps-2 pe-2">
            <Button variant="ghost-muted" size="icon-xs" aria-label="Mention an agent" title="Mention an agent" onClick={mention}>
              <AtSign aria-hidden />
            </Button>
            <span className="flex-1" />
            {variant === "edit" ? (
              <>
                <Button variant="ghost" size="xs" onClick={onCancel}>
                  Cancel
                </Button>
                <Button variant="comment" size="xs" onClick={submit} disabled={empty}>
                  {submitLabel ?? "Save"}
                </Button>
              </>
            ) : (
              <SendButton disabled={empty} onClick={submit} />
            )}
          </div>
        </>
      )}
    </div>
  );
};

const IconButton = ({ label, children, onClick, active = false }: { readonly label: string; readonly children: ReactNode; readonly onClick?: () => void; readonly active?: boolean }) => (
  <Button variant="ghost" size="icon-xs" aria-label={label} title={label} onClick={onClick} aria-pressed={active}>
    {children}
  </Button>
);

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
    <div data-comment-message={message.id} className="group/message relative flex flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2 pe-7">
        <Avatar author={message.author} muted={muted} />
        <span className="truncate text-[13px] font-semibold leading-5">{authorLabel(message.author)}</span>
        <span className="shrink-0 text-[13px] leading-5 text-muted-foreground">{relativeTime(message.createdAt, now)}</span>
      </div>
      {editing ? (
        <div className="ps-8">
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
        <p className="m-0 ps-8 text-[13px] leading-5 break-words whitespace-pre-wrap">
          <MentionText text={message.text} />
          {message.editedAt !== null && <span className="text-muted-foreground"> (edited)</span>}
        </p>
      )}
      {own && !editing && (
        <Menu>
          <span className="absolute top-0 right-0 opacity-0 group-hover/message:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100">
            <MenuTrigger aria-label="Comment actions" data-comment-message-menu="" render={<Button variant="ghost-muted" size="icon-xs" />}>
              <Ellipsis aria-hidden />
            </MenuTrigger>
          </span>
          <MenuPopup align="end" className="w-36 min-w-0">
            {onEdit && <MenuItem onClick={() => setEditing(true)}>Edit…</MenuItem>}
            {onDelete && (
              <MenuItem variant="destructive" onClick={onDelete}>
                Delete comment
              </MenuItem>
            )}
          </MenuPopup>
        </Menu>
      )}
    </div>
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

export const POPOVER_SHADOW = "shadow-[0_0_0.5px_rgb(0_0_0/0.15),0_2px_5px_rgb(0_0_0/0.15),0_10px_16px_rgb(0_0_0/0.12)] dark:shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_2px_5px_rgb(0_0_0/0.4),0_10px_16px_rgb(0_0_0/0.35)]";

export const ThreadPopover = ({ thread, now, actions, autoFocus = false }: { readonly thread: CommentThread; readonly now: number; readonly actions: ThreadActions; readonly autoFocus?: boolean }) => {
  const [confirming, setConfirming] = useState(false);
  const resolved = thread.resolved !== null;
  const list = useRef<HTMLDivElement>(null);
  const count = thread.messages.length;
  useLayoutEffect(() => {
    const element = list.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [count]);
  return (
    <div data-comment-thread={thread.id} role="dialog" aria-label={`Comment #${thread.number}`} className={cn("box-border flex max-h-[min(560px,calc(100vh-120px))] w-[356px] flex-col rounded-[13px] bg-popover font-sans text-popover-foreground", POPOVER_SHADOW)}>
      <div className="flex h-10 shrink-0 items-center gap-1 border-b ps-4 pe-2">
        <span className="flex-1 text-[13px] font-semibold">Comment</span>
        <Menu>
          <MenuTrigger aria-label="More" title="More" data-comment-thread-menu="" render={<Button variant="ghost" size="icon-xs" />}>
            <Ellipsis aria-hidden />
          </MenuTrigger>
          <MenuPopup align="end" className="w-44 min-w-0">
            <MenuItem onClick={actions.onMarkUnread}>Mark as unread</MenuItem>
            <MenuSeparator />
            <MenuItem variant="destructive" onClick={() => setConfirming(true)}>
              Delete thread…
            </MenuItem>
          </MenuPopup>
        </Menu>
        <IconButton label={resolved ? "Reopen" : "Resolve"} active={resolved} onClick={() => actions.onResolve(!resolved)}>
          {resolved ? <CircleCheck aria-hidden className="size-4 fill-comment text-popover" /> : <CircleCheck aria-hidden className="size-4" />}
        </IconButton>
        <IconButton label="Close" onClick={actions.onClose}>
          <X aria-hidden className="size-4" />
        </IconButton>
      </div>
      {confirming && (
        <div data-comment-confirm="" className="flex shrink-0 items-center gap-2 border-b bg-muted px-4 py-2.5 text-[12px]">
          <span className="flex-1">Delete this thread and its replies?</span>
          <Button variant="ghost" size="xs" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button variant="destructive" size="xs" onClick={actions.onDeleteThread}>
            Delete
          </Button>
        </div>
      )}
      <div ref={list} className="flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pt-3 pb-1">
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
      <div className="flex shrink-0 items-start gap-2 px-4 pt-3 pb-4">
        <span className="pt-2">
          <Avatar author={{ kind: "person" }} />
        </span>
        <div className="min-w-0 flex-1">
          <Composer variant="reply" placeholder="Reply" autoFocus={autoFocus} onSubmit={actions.onReply} onCancel={actions.onClose} />
        </div>
      </div>
    </div>
  );
};

export const NewThreadComposer = ({ onSubmit, onCancel }: { readonly onSubmit: (text: string) => void; readonly onCancel: () => void }) => (
  <div data-comment-new="" className={cn("box-border w-[292px] rounded-xl bg-popover font-sans", POPOVER_SHADOW)}>
    <Composer variant="card" placeholder="Add a comment" autoFocus onSubmit={onSubmit} onCancel={onCancel} />
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
      className={cn(
        "group/row relative flex cursor-pointer flex-col gap-1 rounded-lg p-3 text-left font-sans outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-comment",
        selected && "bg-comment-surface hover:bg-comment-surface",
      )}
    >
      <div className="flex h-6 items-center gap-1">
        <div className="flex flex-1 items-center gap-1">
          {participants(thread).slice(0, 4).map((author) => (
            <Avatar key={author.kind === "person" ? "person" : author.chatId} author={author} muted={resolved} />
          ))}
        </div>
        <div className={cn("flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100", selected && "opacity-100")} onClick={(event) => event.stopPropagation()}>
          <Menu>
            <MenuTrigger aria-label="Thread actions" render={<Button variant="ghost" size="icon-xs" />}>
              <Ellipsis aria-hidden />
            </MenuTrigger>
            <MenuPopup align="end" className="w-40 min-w-0">
              <MenuItem onClick={onToggleRead}>{unread ? "Mark as read" : "Mark as unread"}</MenuItem>
              <MenuSeparator />
              <MenuItem variant="destructive" onClick={onDelete}>
                Delete thread
              </MenuItem>
            </MenuPopup>
          </Menu>
          <Button variant="ghost" size="icon-xs" aria-label={resolved ? "Reopen" : "Resolve"} title={resolved ? "Reopen" : "Resolve"} onClick={() => onResolve(!resolved)}>
            {resolved ? <Check aria-hidden className="text-comment" /> : <CircleCheck aria-hidden />}
          </Button>
        </div>
        {unread && <span data-comment-unread="" className="ms-1 size-2 shrink-0 rounded-full bg-comment" />}
      </div>
      <span className="text-[11px] leading-4 text-muted-foreground">#{thread.number}{resolved ? " · Resolved" : ""}</span>
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span className="truncate text-[13px] font-semibold leading-5 text-foreground">{authorLabel(first.author)}</span>
        <span className="shrink-0 text-[11px] leading-5 text-muted-foreground">{relativeTime(first.createdAt, now)}</span>
      </div>
      <p className={cn("m-0 line-clamp-3 text-[13px] leading-5 break-words", resolved ? "text-muted-foreground" : "text-foreground")}>
        <MentionText text={first.text} />
      </p>
      {replies !== null && <span className="text-[12px] font-medium leading-4 text-comment">{replies}</span>}
    </div>
  );
};

export const ClusterBubble = ({ authors, count, hovered }: { readonly authors: ReadonlyArray<CommentAuthor>; readonly count: number; readonly hovered: boolean }) => (
  <span
    data-comment-cluster-body=""
    className={cn(
      "box-border flex items-center justify-center rounded-full bg-comment-pin text-[13px] font-semibold text-comment-pin-foreground transition-[width,height] duration-150 ease-out",
      PIN_SHADOW,
      hovered ? "h-10 min-w-10 px-1.5" : "size-8",
    )}
  >
    {hovered ? (
      <span className="flex -space-x-2">
        {authors.slice(0, 3).map((author, index) => (
          <span key={index} className="rounded-full ring-2 ring-comment-pin">
            <Avatar author={author} />
          </span>
        ))}
      </span>
    ) : (
      count
    )}
  </span>
);
