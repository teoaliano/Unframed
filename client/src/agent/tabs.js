// The panel's tab strip: which chats show for a selection, what a tab reads, and what
// one of a chat's tags is called. Pure, pinned in tabs.test.js. Design:
// docs/superpowers/specs/2026-09-06-chats-and-tags-design.md.
//
// A chat is tagged by the artifacts it has touched, and the selection filters the strip
// against those tags. Two things follow that used not to be true, and both matter:
//
//   - A chat whose artifacts have all been DELETED still shows. It used to be hidden,
//     because it was bound to one node and a thread about a node that is gone looked
//     like clutter. But a tag is a pointer, not a dependency: the conversation happened,
//     it may be the only record of why, and deleting a file must not delete it. Its
//     chips grey out instead (`stale`).
//   - Any-of, not all-of. Selecting two motions shows the chats about either, because
//     the question the strip answers is "what has been said about these". The composer's
//     continue rule is the strict one (all-of, server-side findChatFor) -- a different
//     question, deliberately answered differently.
import { isArtifact } from '../graph/resolve.js';

export function visibleThreads(threads, selectedIds, nodes) {
  const artifacts = nodes.filter((n) => selectedIds.includes(n.id) && isArtifact(n)).map((n) => n.id);
  if (!artifacts.length) return threads;
  return threads.filter((t) => (t.tags ?? []).some((id) => artifacts.includes(id)));
}

// The active tab must be visible, so the composer always sends to what is highlighted:
// the previous one when it survived the re-filter, else the newest visible (the list is
// newest first), else none -- and none means the next send starts a chat.
export function nextActive(activeId, visible) {
  if (activeId && visible.some((t) => t.id === activeId)) return activeId;
  return visible[0]?.id ?? null;
}

// What one of a chat's tags is called, and whether it still points at anything. `stale`
// is the whole reason this returns an object: a chip for a deleted artifact is shown,
// greyed, with no Locate -- there is nowhere to locate it to.
export function tagLabel(id, nodes) {
  const n = nodes.find((x) => x.id === id);
  if (!n) return { id, label: id, stale: true };
  return { id, label: n.data?.title || n.data?.fileName?.replace(/\.html?$/i, '') || n.id, stale: false };
}

const PREVIEW = 32;

// What a tab reads, in the order the person's own words come first: the name they typed,
// else the name the agent wrote after the first turn, else the opening words of the
// first message, else "Chat" for one nobody has said anything in yet.
//
// `title` holds both names and `titledBy` says which, so this does not have to care --
// which is the point of the split: a tab must not go blank because the agent's name
// arrived while the person was typing their own.
export function tabLabel(thread) {
  const named = (thread.title ?? '').trim();
  if (named) return named;
  const preview = (thread.preview ?? '').trim();
  if (!preview) return 'Chat';
  return preview.length > PREVIEW ? `${preview.slice(0, PREVIEW).trimEnd()}…` : preview;
}

// The chat the composer would CONTINUE for a selection, or null when it should start
// one. The mirror of the server's `findChatFor` (server/threads.js), and deliberately a
// different rule from the strip's above: all-of, not any-of. Continuing a chat about A
// for a message about A and B would carry over an answer that never saw B, so that case
// starts a fresh chat instead. With nothing selected it is the newest idle UNTAGGED
// chat -- a general conversation, not whichever artifact chat happens to be newest.
//
// It exists on the client as well as the server because the composer has to SAY which
// it will be ("continues *Title fixes*" / "new chat") before you type, and asking the
// server on every keystroke to render a label would be a request per character.
export function continuableChat(threads, artifactIds = []) {
  const idle = threads.filter((t) => t.status !== 'running');
  if (!artifactIds.length) return idle.find((t) => !(t.tags ?? []).length) ?? null;
  return idle.find((t) => artifactIds.every((id) => (t.tags ?? []).includes(id))) ?? null;
}
