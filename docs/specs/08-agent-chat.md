# 08 · Agent chat

Depends on: 01, 02, 03, 04, 05, 06, 07

## Problem Statement

Spec 07 gives the engine chats that run on Claude or Codex, read and change the canvas, ask for permission and survive restarts. None of that is usable until a person can see it: start a chat about what they selected, watch the agent work, answer its approvals and questions, read its replies, see what each turn touched and take a turn back.

The old app had a chat rail with tabs filtered by the selection, a composer with model, reasoning and mode pickers, and a recap of the artifacts a chat touched. The rewrite keeps all of it and replaces the composer, the transcript, the work log, the approval panel and the plan flow with t3code's versions, because t3code's are better and its engine is what spec 07 rebuilt. It also adds t3code's thread search and its per-turn diffs (for page and motion files). t3code's preview tools, which let the agent look at what it made, need spec 09's preview origin and are built there.

## Solution

A rail on the right of the canvas holds the project's chats as tabs, filtered by the selected artifacts. Under the tabs, a t3code transcript: markdown replies, streamed as they arrive, tool calls folded into work groups, sub-agent rows, the pending approval and question panels, proposed plan cards, and a recap card per turn listing what it touched with Open, Locate and Revert this turn. Below it, the shared composer of spec 03 in its Agent tray, built 1:1 on t3code's composer: a Tiptap editor, the selection as context chips, attachments, slash commands, the model, traits and runtime mode pickers, the plan toggle, the context window meter, queued messages, the prompt stash, ArrowUp history and Edit from here.

The selection toolbar's Agent button opens the same composer on the selection and says whether the message continues an earlier chat or starts a new one. The editor of spec 09 embeds the same rail as its left column.

The engine side of this spec is small: thread search and per-turn diffs of page and motion files.

## User Stories

The rail

1. As a person, I want an Agent button in the top-right chrome that opens a chat rail on the right, so that the conversation sits beside the canvas instead of over it.
2. As a person, I want the rail to slide in and out, and only fade when I have asked for reduced motion, so that it reads as one surface arriving and leaving without making anyone queasy.
3. As a person, I want the top-right chrome to step aside while the rail is open, so that one corner never holds two sets of controls.
4. As a person, I want closing the rail mid-turn to change nothing, so that the turn finishes and is there when I reopen it.
5. As a person, I want to start a new chat, delete the current one after a confirmation, and close the rail from its header, so that the rail's own controls are always in one place.
6. As a person, I want deleting a chat to leave its canvas changes in place, so that removing a conversation never removes work.
7. As a person using the artifact editor, I want the same rail embedded as the editor's left column, without a close button or Locate, so that one chat UI serves both places.

Tabs and search

8. As a person, I want one tab per chat, three inline and the rest under More, so that a narrow rail never scrolls its tabs out of reach.
9. As a person, I want a live dot on a chat whose turn is running, so that I can see which chats are busy.
10. As a person, I want to double-click a tab to rename it, Enter or clicking away to commit and Escape to abandon, so that renaming is quick and safe to start by accident.
11. As a person, I want a tab to read my name, else the agent's name, else the opening words, else "Chat", so that every tab says something.
12. As a person, I want the tabs filtered to the chats tagged with any selected artifact, and all chats when none is selected, so that selecting an artifact shows what was said about it.
13. As a person, I want the active tab always to be one I can see, so that the composer always sends to what is highlighted.
14. As a person, I want to search chats by what was said in them, so that I can find an old conversation without scrolling tabs.

No provider

15. As a person with no provider ready, I want the rail to show each provider's status, how to install it and a Check again button, so that I know what to do and nothing is sent anywhere until then.

The Agent tray

16. As a person, I want the Agent tray on the same composer I use to Generate, so that there is one place to type.
17. As a person, I want what I have selected to enter the composer as chips, so that I can see and edit what the message comes with.
18. As a person, I want to remove a chip without changing my selection on the canvas, so that I can trim the context of one message.
19. As a person, I want Enter to send and Shift+Enter or Option+Enter to break the line, so that the composer works like every chat.
20. As a person, I want to attach files by button, drag or paste, with the limits said in words when I go over, so that handing over a file is obvious.
21. As a person, I want a long paste turned into a file attachment, so that a pasted log does not swamp the message.
22. As a person, I want slash commands (`/model`, `/plan`, `/default`, and the provider's own commands and skills), so that I can drive the chat from the keyboard.
23. As a person, I want a model picker with Claude and Codex tabs, a Legacy section and each provider's logo, so that choosing a model is one popup.
24. As a person, I want a traits picker offering the effort levels, thinking and fast mode the chosen model allows, so that I only see what applies.
25. As a person, I want a runtime mode picker with the four modes and what each does, usable mid-turn, so that I can tighten a chat while it works.
26. As a person, I want a plan toggle, so that I can ask for a plan first.
27. As a person, I want a context window meter, so that I know how full the conversation is.
28. As a person, I want to type the next message while a turn runs, and choose whether it waits for the turn (Queue) or steers the running one (Steer), so that I never have to wait to say something.
29. As a person, I want to stash a draft and bring it back, so that I can set a thought aside.
30. As a person, I want ArrowUp in an empty composer to bring back my earlier messages, so that repeating myself is one key.
31. As a person, I want "Edit from here" on one of my messages to rewind the chat to before it and put its text back in the composer, so that I can take a conversation a different way.

The transcript

32. As a person, I want the agent's replies rendered as markdown with tables, task lists and code blocks with a copy button, so that structured answers read well.
33. As a person, I want my own messages shown exactly as I typed them, so that my asterisks and hashes are not eaten.
34. As a person, I want HTML in a reply shown as text, never run, so that a model's markup cannot act inside Unframed.
35. As a person, I want links in replies to open in a new tab, so that following one never replaces the canvas.
36. As a person, I want a reply to stream as it is written, formatted as it arrives, so that I see progress.
37. As a person, I want the agent's tool calls grouped into a work log with a label and a state each, so that I can see what it did without a wall of JSON.
38. As a person, I want sub-agent work shown as its own rows, so that parallel work reads as parallel.
39. As a person, I want an activity line saying what the agent is doing, with an elapsed clock after ten seconds, so that a long turn does not look stuck.
40. As a person, I want a pending approval shown above the composer with the tool, its full target and accept once, accept for session, decline and cancel, so that I decide with everything in view.
41. As a person, I want a request whose command was clipped to say how many characters I was not shown, so that I never approve what I could not read.
42. As a person, I want the agent's questions shown as a panel I can answer by option or in my own words, so that the agent can ask instead of guessing.
43. As a person in plan mode, I want the proposed plan shown as a card with a way to implement it, so that a plan turns into work with one click.
44. As a person, I want a recap card after each turn listing the files and artifacts it touched, with Open, Locate and Revert this turn, so that I can reach or undo what a turn did.
45. As a person, I want a deleted artifact struck through in the recap, so that a stale row does not look clickable.
46. As a person, I want a revert that skipped shapes to say which, so that I know what stayed.
47. As a person, I want failures, retries and usage limits shown as plain lines in the transcript, so that I know what happened and what to do.
48. As a person, I want every artifact the active chat has touched marked on the canvas, so that I can see what this conversation is about.
49. As a person, I want to see what changed in a page or motion file during a turn as a diff, and across the whole chat, so that I can review the agent's edits.

The selection toolbar

50. As a person, I want an Agent button on the selection toolbar that opens the composer's Agent tray on the selection, so that asking about what I pointed at is one click.
51. As a person, I want the composer to say whether the message continues an earlier chat or starts a new one, and let me switch, so that I know where the reply will land.
52. As a person, I want a message about several artifacts to continue only a chat that has seen all of them, so that an answer is never built without half the subject.
53. As a person, I want clicking another shape while the composer is open to add it to the message, and clicking empty canvas to close the composer, so that I can gather context by pointing.
54. As a person, I want Send to open the rail on the chat before the message goes out, so that the reply streams where I am already looking.
55. As a person, I want one selected artifact treated as what the message is about, none to mean something new should be made, and several to be decided from my sentence with the agent asking only when it truly cannot tell, so that I never pick a mode.

## Implementation Decisions

### Modules

| Module | Where | Interface | Depth |
| --- | --- | --- | --- |
| Chat rail | web | `<AgentRail project embedded? filterTo? onLocate onOpenEditor>` | deep: tabs, transcript, panels and the composer behind one component |
| Chat client state | web (t3code's `client-runtime` shape) | subscribes to `subscribeShell` and `subscribeThread`, exposes the read model and a `dispatch` | deep: reconnect, replay by sequence, optimistic user messages |
| Rail rules | domain | `visibleChats(chats, selectedArtifactIds)`, `nextActive(activeId, visible)`, `tabLabel(chat)`, `continuableChat(chats, artifactIds)`, `recapRows(activities, turnChanges, shapes)` | pure |
| Work log derivation | domain (t3code's `deriveWorkLogEntries`) | `workLog(activities) -> entries` | pure |
| Composer, Agent tray | web | spec 03's composer with `tray="agent"` | deep, t3code's |
| Composer rules | domain | `pasteBecomesFile(text)`, `pastedFileName(existing)`, `searchSlashCommands(query, items)`, `contextMeter(usage)` | pure |
| Queue and stash | web | per-chat queue (in memory, lost harmlessly on reload since queued messages are not yet sent), per-project stash (spec 01's preferences store) | small |
| Thread search | engine | `orchestration.searchThreads` | small |
| Artifact diffs | engine | `orchestration.getTurnDiff`, `orchestration.getFullThreadDiff` | small, reads spec 07's turn changes |

### The rail

- The top-right chrome's **Agent** button (sparkles icon) opens the rail. The rail is 380 px wide, docked to the right edge from the top down to just above tldraw's watermark band (which stays uncovered), over the canvas, on solid `--background` (spec 12: on glass it crossed spec 02's pan budget) with the kit's left border and a rounded bottom-left corner. While it is open the top-right chrome card (`.unframed-chrome-right`, spec 02) fades to 0 opacity and drifts 8 px right (160 ms opacity, 200 ms transform) and is made `inert`.
- **Narrow windows.** At 980 px wide or less (t3code's breakpoint for its right panel) the rail does not dock: it opens as the kit Sheet from the right, `min(88vw, 24rem)` wide, over the Sheet's backdrop, with the same header, tabs, transcript and tray. The top-right card stays where it is. Close, Escape (when no menu of the rail's own takes it) and a click on the backdrop close it; Locate and Open close it before they act on the canvas.
- **Motion.** Opening slides the rail in from `translateX(100%)` with `opacity 0` to rest: `transform 260ms` on t3code's `--ease-drawer` curve (`cubic-bezier(0.32, 0.72, 0, 1)`) and `opacity 200ms ease-out`. Closing reverses it faster: `transform 200ms` on the same curve and `opacity 160ms ease-out`. It is a CSS transition, not keyframes, so reopening mid-exit reverses from where it is; the enter uses `@starting-style`. Under `prefers-reduced-motion: reduce` there is no transform, only `opacity 160ms ease-out`. The rail stays mounted through its exit and unmounts on its own `transitionend` (transform or opacity, on the rail element itself), with a 600 ms timer as the guarantee, since a hidden tab fires no transition events.
- **Embedded mode.** The editor (spec 09) mounts the same rail as its left column: no transition, no Close, no Locate, and its tab strip filtered to the artifact being edited.
- **Header**: a sparkles icon and the heading "Agent", then the kit's ghost icon Buttons, Search chats (below) and three more: **New chat** (tooltip "New chat about the selected artifacts" when artifacts are selected, else "New chat"; disabled with no provider ready), **Delete chat** (tooltip "Delete this chat"; disabled with no chat or while it runs) and **Close** (not in embedded mode).
- **Delete** asks first, in the kit's alert dialog (spec 12): title "Delete this chat?", description "The conversation is removed for good. What the agent changed on the canvas stays.", action "Delete chat" (the destructive Button). It dispatches `thread.delete`; canvas changes and files stay.
- Closing the rail mid-turn changes nothing on the engine; reopening shows the turn where it is.

### Tabs

- One tab per visible chat, newest first, in t3code's panel tab look (spec 12; the old folder shape is gone): a 24 px kit ghost Button row, muted, the active one on the accent in the foreground colour. The first three are inline; the rest sit behind a **More** menu whose trigger names the active chat when it is one of them. A running chat shows a live dot (inline: after the label; in the menu: before it).
- **Label**: the chat's title (the person's or the agent's), else the first 32 characters of its first message plus an ellipsis when cut, else "Chat". The tooltip is the label, then " · " and the opening words, when they differ.
- **Rename**: double-click an inline tab to edit its name in place, in a compact kit field that grows with the text. Enter or blur commits, Escape abandons, an empty name clears it (`thread.meta.update {title: ""}`), so the tab falls back to its default and the agent may name it again. Renaming is allowed mid-turn. A chat in the More menu cannot be renamed there.
- **Filter**: with no artifact selected, every chat shows. With one or more artifacts selected, only chats whose tags include any of them. A chat whose tagged artifacts are all deleted still shows.
- **Active tab**: the one last chosen if it is still visible; else the newest visible one; else none. With none, the next message starts a chat.
- **Empty strip**: "No chats yet" with nothing selected; "Nothing said about these yet. Your first message starts a chat." with two or more artifacts selected; nothing with exactly one (the composer already asks for the first message).
- **Focus mark**: every artifact in the active chat's tags wears the focus mark on the canvas (spec 02's artifact label filled with the highlight colour, in the highlight foreground, with a live dot, in the kit's small badge shape). A tag whose shape is gone marks nothing.

### Thread search

Added from t3code. A search button in the rail header ("Search chats"), and Cmd+K (Ctrl+K elsewhere) while focus is in the rail, opens a field over the tab strip, placeholder "Search chats". From 2 characters (at most 200), after a 200 ms pause, it calls `orchestration.searchThreads {projectId, query, limit: 50}`. The engine matches, case-insensitively, the person's messages and each turn's final agent reply (never titles, reasoning or streaming text) in this project's chats that are not deleted, and returns one row per chat, `{threadId, source: "user" | "assistant", snippet, messageCreatedAt}`, the snippet at most 240 characters around the match, user matches first, then newest chat first. The limit is 1 to 50. The web also matches chat titles locally as a fallback. Each result shows the tab label, then "You:" or "Agent:" and the snippet with the match in bold. Choosing one makes it the active chat, even when the selection filter would hide it, until the selection next changes. Escape closes the search. No result: "No chats match."

### No provider ready

When neither provider is ready the transcript area shows the kit's empty state (spec 12), the provider lines in an alert frame:

- "No Claude or Codex found on this Mac." (on other platforms: "No Claude or Codex found on this computer.")
- "Install one and sign in, and the agent runs on your plan. Nothing is sent anywhere until then."
- One line per provider: its name in bold, then " · " and its status message, or " · checking…" while a check runs, or " · not checked yet". A `not_installed` provider adds a **How to install** link (its install page, new tab).
- A **Check again** button (refresh icon) that calls `providers.getStatuses {refresh: true}` and shows a busy state while it runs.

Send is disabled and the composer's placeholder reads "Connect Claude or Codex to start".

### The selection toolbar's Agent button

The selection toolbar (spec 03) ends with a filled **Agent** button (sparkles icon); its tooltip, when no provider is ready, is the provider message. Clicking it opens the composer (spec 03) in its Agent tray, anchored where the toolbar was, on the current selection:

- The selection enters as context chips (below).
- Under the chips, which chat this joins: "continues *<chat label>*" or "new chat", and a ghost button to switch: "New chat instead" or "Continue the earlier chat" (the latter only when a continuable chat exists).
- **Continuable chat**: the newest chat that is not running whose tags include **every** selected artifact. With no artifact selected, the newest non-running chat with no tags at all. This is all-of on purpose, unlike the strip's any-of: a chat that never saw B must not answer a message about A and B. The web computes this label itself from the chat list it already holds; the engine applies the same rule when the message arrives.
- While it is open, clicking another shape adds it to the message's context (idempotent, and the shape stays selected); clicking empty canvas closes the composer; Escape and Back ("Back to tools (Esc)") do the same.
- **Send** opens the rail on the target chat first, then sends, so the reply streams where the person is already looking. A new chat is created tagged with the selected artifacts.
- The composer's footer reads "<provider name> · not metered" beside Send.

### Recap card

After the last message of each turn that touched anything, a recap card on the card surface with the kit's border and radius:

- Header: a chevron, "<n> file" or "<n> files", and Hide/Show. Open by default.
- One row per artifact or project file the turn read or changed, in first-touch order: the shape kind's icon (an empty slot when there is none, so names line up), its label (title, else original file name without `.html`, else id), then **Open** (opens the editor; spec 09 registers the editor, and until it does the row shows Locate only) and **Locate on canvas** (crosshair icon; pans and zooms to the shape; absent in embedded mode). A row whose shape is gone is struck through, greyed, and reads "deleted" instead of the buttons.
- Reads and writes are not distinguished. `canvas_read` contributes nothing (it reads everything, every turn). The rows come from the turn's `page_*`/`motion_*` tool inputs, the shapes its `canvas_write` ops named, and its turn changes; they are derived from the activities, not stored separately.
- Footer: **Revert this turn**, shown when the turn has turn changes and is not running. After a revert the button becomes the text "Reverted", and when shapes were skipped a line follows: "Left <n> shape(s) alone because they changed since: <label> (by the person), <label> (by another chat)." With every shape skipped: "Nothing to revert: everything this turn changed has changed since."
- **View diff** on a row for a page or motion the turn rewrote (see diffs below).

### The Agent tray

The composer is one component (spec 03) with two trays. This spec builds its Agent tray, 1:1 on t3code's composer (`apps/web/src/components/chat/` and its composer editor), on the kit and tokens of spec 12: t3code's composer shell (the rounded glass box with the composer shadow), its round message-action Send and Stop, kit Badge chips, Popover and Select pickers with t3code's picker rows, and the kit menu look for the `@`, `/` and `$` menus. It shares the Generate composer's 420 px. Where a detail below is not stated, follow t3code.

**Editor.** Tiptap with StarterKit minus blockquote, bullet and ordered lists, code block, heading, horizontal rule, link, underline, dropcursor, gapcursor, trailing node and code, and with bold, italic and strike off, so typed markdown markers stay literal. Custom atom nodes for context chips, mentions and skills; ArrowLeft and ArrowRight step over a whole chip in one press. The draft's plain text is the source of truth.

- Enter sends; Shift+Enter and Option+Enter insert a line break; Enter never sends during IME composition.
- Placeholder, in order of precedence: "Resolve this approval request to continue" (an approval is pending); "Choose an option above" (a choice-only question is pending) or "Type your own answer, or leave this blank to use the selected option"; "Add feedback to refine the plan, or leave this blank to implement it" (a plan follow-up); "Connect Claude or Codex to start" (no provider ready); otherwise "Ask, or say what should change… @ to mention, / for commands".

**Context chips: the selection enters as chips.** When the Agent tray opens, and whenever the canvas selection changes while the draft is empty, the chip row above the editor holds one chip per selected shape: an artifact as its kind icon and label; everything else collapsed into one count chip ("3 inputs", or "1 image" when all the same kind). Each chip has a remove button; removing a chip trims the message's context and leaves the canvas selection alone. Once the person has typed, a selection change adds new shapes as chips and never removes chips on its own. The chips are the message's `context.selection`; spec 07 builds the "Selected:" preamble line from them. The row is absent when there are no chips, since nothing selected means the whole canvas.

**Mentions.** Typing `@` opens a menu of the project's shapes (prompts and groups by `@id`, artifacts and media by label) and project files. Choosing one inserts an inline chip, serialised in the text sent to the model as `[<Kind>: <label>; ref=<id>]`, and adds the shape to `context.selection`. Arrow keys move, Enter or Tab choose, Escape closes. Empty state: "No matching shapes or files."

**Attachments.** Paperclip button "Attach files"; drag onto the rail shows the overlay "Drop files to attach" and highlights the composer; paste of files attaches them. Images show as a 64 x 64 thumbnail shelf ("Preview <name>", "Remove <name>", upload progress "NN%", "Retry upload for <name>" on failure); other files as chips with name and size ("upload failed" on failure). Files upload as they are staged (spec 07's upload flow), so Send only carries ids. Before upload the browser converts HEIC and HEIF to JPEG (extension becomes `.jpg`; a source over 50 MiB or 64 megapixels fails as too large) and downscales an image over 10 MiB ("'<name>' is too large to attach, even after compression." when it cannot). Limit breaches show spec 07's messages in the rail's error line.

**Large paste.** A paste of 32 KiB or more (counted as characters or UTF-8 bytes), or one that would take the draft past 120,000 characters, becomes a text file attachment named `pasted-text.txt`, then `pasted-text-2.txt`, `pasted-text-3.txt`, typed `text/plain;charset=utf-8`. A toast says "Large paste attached as <name>" with "<size> · Use ⌘⇧V to keep a large paste inline." (Ctrl+Shift+V off Mac), and Cmd+Shift+V pastes inline. A pasted image always attaches; files pasted with text keep the text.

**Slash commands.** `/` at the start of the draft opens the command menu:

- Built-ins: `/model` "Switch response model for this chat" (opens the model picker), and, only while plan mode is on, `/plan` "Switch this chat into plan mode" and `/default` "Switch this chat back to normal build mode".
- Provider commands from the provider status (spec 07), shown as `/<name>` with their description, else their input hint, else "Run provider command". `/compact` only when it is the whole draft with no attachments.
- Skills, shown as `/skill:<name>` with their description, else "<scope> skill", and a source badge. Choosing one inserts `$<name> `. Typing `$` opens skills alone ("Run provider skill").
- Search strips the leading `/` and ranks exact, then prefix, then word-boundary (`-`, `_`, `/`), then substring, then fuzzy matches on the name, with description matches after; ties go built-ins, provider commands, skills. Arrow keys move, Enter or Tab choose (the first item when none is highlighted), Escape closes. Empty: "No matching command."; skills loading: "Searching skills..."; no skills: "No skills found. Try / to browse provider commands."

**Footer row**, left to right: attach, model picker, traits picker, runtime mode picker, plan toggle, context window meter, then Stop and Send.

**Model picker.** A trigger naming the current model (the provider logo beside it) opens a popover: provider tabs across the top (Claude, Codex, each with its logo; a tab whose provider is not ready shows its status message instead of rows), a search field "Search models...", one row per current model, then a collapsible "Legacy models" row ("<N> models", chevron rotating 90 degrees, open by default only when the current model is legacy), and "No models found" when a search matches nothing. Arrow keys and Enter select, Escape closes. Once the chat exists (spec 07 keeps a chat on the provider it started on) the other provider's tab is disabled with the tooltip "A chat stays on the provider it started on. Start a new chat to use <provider>." The model is disabled while a turn runs.

**Traits picker.** Shown only for the traits the chosen model declares, as radio groups: "Reasoning" with the model's effort levels (Claude: Low "Fastest; little reasoning", Medium "Balanced", High "More reasoning before acting", Extra high "Long reasoning; slower", Max "Everything the model has"; Codex: the levels its model list reports), the model's default marked with a "Default" badge; "Thinking" On/Off; "Fast mode" On/Off (Codex: its fast service tier). The trigger shows the chosen labels joined by " · ", fast mode as a bolt icon. Disabled while a turn runs. Changing the model resets traits the new model does not declare.

**Runtime mode picker.** A select labelled "Runtime mode" showing the icon and label of the chat's mode, its tooltip the mode's description. Not disabled while a turn runs (spec 07 applies it to the next tool call). Shortcut Cmd+Shift+A while the composer has focus.

| Mode | Label | Description | Icon |
| --- | --- | --- | --- |
| `approval-required` | Supervised | Ask before commands and file changes. | lock |
| `auto-accept-edits` | Auto-accept edits | Auto-approve edits, ask before other actions. | pen line |
| `auto` | Auto | Supported providers approve routine actions; others still ask. | sparkles |
| `full-access` | Full access | Allow commands and edits without prompts. | open lock |

Full access carries a "Default" badge in the list.

**Plan mode is off unless set**, as t3code ships it. The `agent.planMode` preference (spec 10's Plan mode (legacy) switch) turns it on. While it is off the tray shows no plan toggle, `/` offers no `/plan` or `/default`, Shift+Tab does nothing, a new chat starts in default mode, and a message into a chat left in plan mode first switches that chat to default mode. Turning it on shows the toggle at once, in the chat's own mode.

**Plan toggle** (plan mode on). The kit's Toggle reading "Plan" (ruler-pencil icon) in plan mode and "Build" (bot icon) otherwise, `aria-pressed` set in plan mode. Tooltip: "Plan mode. Click to return to normal build mode." or "Default mode. Click to enter plan mode." Shift+Tab in the composer toggles it.

**Context window meter.** A 20 px ring in a 28 px ghost button, filled to the share of the context used (from spec 07's token usage), in the highlight colour, turning to the error colour above 90%. Its label reads "Context window NN% used" (one decimal under 10%), or "Context window <N> tokens used" with no known maximum. Hovering for 150 ms opens a popover: "Context Window", "NN% · <used>/<max>" (tokens as `N`, `N.Nk`, `Nk`, `N.Nm`), a progress bar, "Total processed <N>", "Context compacts automatically when needed.", and a **Compact context** button that sends the provider's compaction (disabled with "Compaction is unavailable for this provider" when it has none).

**Send and Stop.** Send is disabled with no provider, or with an empty draft and no attachments. While a turn runs, Stop ("Stop generation") interrupts it, and Send becomes "Queue message".

**Queued messages.** A message sent while a turn runs is queued in the browser (not the engine) under the person's **Follow-up behavior** setting, Queue (the default) or Steer, stored as the `agent.followUp` preference in spec 01's preferences store (so it survives the packaged app's new origin on every launch); its control is in spec 10's settings dialog, and until spec 10 lands it is always Queue. Cmd+Enter does the opposite of the setting for one message.

- Queue: the message waits and is dispatched after the running turn's next completed tool call or when the turn ends, one per boundary, in order.
- Steer: the message is dispatched at once with `steer: true` and joins the running turn.
- A queued message shows in the transcript as t3code's queued row: a right-aligned message bubble with a dashed border and dimmed text, a clock icon and "Queued", its tooltip "Sends after the next tool call or when the turn ends" (or "Sends after the messages above it"), a **Send now** button (steers it in; Cmd+Shift+Enter for the oldest) and a remove button "Cancel and return to the composer". Stop returns every queued message to the composer.

**Prompt stash.** Cmd+S in the composer stashes the draft (text, chips and attachments) and clears it; up to 20 entries, the oldest dropped with the toast "Oldest stashed prompt discarded" / "The stash holds 20 prompts; the oldest was removed to make room." A "Stash" badge ("Stashed prompts: N. Open stash.") opens a menu of entries (a 90-character snippet and a relative time; arrow keys, Enter restores, Cmd+Backspace deletes "Delete stashed prompt", Escape closes); empty: "Nothing stashed yet. Press ⌘S with a prompt in the composer to stash it." With an empty composer Cmd+S restores the only entry or opens the menu. The stash is per project, stored as the `agent.stash.<project>` preference in spec 01's preferences store (text, chips and attachment ids; the attachments themselves stay in the data folder).

**History.** ArrowUp in an empty composer recalls this chat's earlier messages, newest first, text only; ArrowDown past the newest clears. While a recalled message is unedited the arrows only recall from its first or last line; editing it ends recall.

**Edit from here.** Under each of the person's messages, a ghost button with an undo icon, "Edit from here", disabled while a turn runs. It asks, in the kit's alert dialog: title "Edit from here?", body "Rewind chat to before this message. Your prompt and attachments return to the composer.", buttons "Cancel", "Revert canvas changes too" (destructive) and "Revert and keep changes". Either revert dispatches spec 07's `thread.checkpoint.revert` for the turns from that message on (with `restoreCanvas` true or false), then puts the message's text, chips and attachments back in the composer. When canvas changes were skipped, the rail's error line says which, as the recap card does.

### The transcript

**Messages.** The person's messages are shown in t3code's message bubble (right-aligned, on the message surface), exactly as typed (never parsed as markdown), with their attachment chips and a "· N selected" note when they carried context; over 600 characters or 8 lines they collapse with "Show full message" / "Show less". Author headings: "You" and the provider's name.

**Markdown.** The agent's text goes through react-markdown with `remark-gfm` and `remark-breaks`, and t3code's prose typography (`ChatMarkdown` and its `.chat-markdown` rules, on t3code's tokens since spec 12). Raw HTML is never parsed: no `rehype-raw` and no sanitiser, so markup in a reply shows as the text it is. This is the one deliberate difference from t3code, for the same reason pages have their own origin. Links open in a new tab with `noopener noreferrer`; `javascript:` URLs are dropped. Code blocks get t3code's code block frame and toolbar ("Wrap lines" / "Disable line wrap", "Copy code" turning "Copied" for 1.2 s, a language badge). Tables scroll in a wrapper and offer "Copy as Markdown" and "Copy as CSV". No syntax highlighter is loaded.

**Streaming.** A reply renders through the same component while it streams, so formatting appears as it arrives. An empty final reply reads "(empty response)". Reasoning shows as a "Thinking" row while live, then "Thought", collapsed.

**Work log.** t3code's work log, derived from the chat's activities and drawn as t3code's timeline rows (an icon slot, the muted label, a chevron that turns as the row opens, and the opened detail on the muted fill):

- Tool calls of one turn merge by tool call id into rows with a label, a tone (thinking, tool, info, error) and a lifecycle state (in progress, completed, failed, declined, stopped). A row with a command, detail, changed files or image expands with a chevron.
- Consecutive rows fold into a group whose summary counts actions: "Read N files", "Changed N files", "Ran N commands", "Searched the web N times", "Searched code N times", "Used N tools", joined into one sentence ("Read 2 files, ran 3 commands, and changed 1 file").
- Live labels: "Running <program>", "Ran <program>", "Failed <program>", "Declined <program>"; an edit reads its path, or "<path> +N more".
- Unframed's own tools (the artifact and preview tools arrive with spec 09; their labels are listed here so the work log has one table): `canvas_read` "Read the canvas", `canvas_write` "Changed the canvas (N changes)", `page_write` "Wrote page <title>", `page_read` "Read page <title>", `motion_write` "Wrote motion <title>", `motion_read` "Read motion <title>", preview tools "Looked at <title> in a browser". Their groups count as "Changed the canvas N times" and "Used the browser N times".
- A settled turn folds behind "Worked for <duration>" ("You stopped after <duration>" when interrupted), durations as `1.2s`, `12s`, `1m 5s`.
- **Sub-agents** fold into one row per spawn: "Kicked off N subagents" with a status ("N working", "N failed", "✓ completed"); expanding lists each with its state and duration.
- Error rows stand alone and are never grouped.

**Activity line.** While a turn runs and no text is streaming, one line under the transcript says what the agent is doing: the label for the running tool ("Reading the canvas…", "Changing the canvas…", "Writing the page…", "Reading the page…", "Writing the motion…", "Reading the motion…", "Reading a file…", "Writing a file…", "Editing a file…", "Running a command…", "Looking for files…", "Searching…", "Fetching a page…", "Searching the web…", "Working on a sub-task…", "Planning…", "Looking for a tool…", else "Working…"), else "Thinking…". It is not cleared when a tool returns, because the gap after a tool is where the model thinks. From 10 seconds into the turn it appends the elapsed time as ` m:ss`. The clock is its own component so its tick never re-renders the transcript.

**Pending approval panel**, above the composer (t3code's, spec 12: a glass banner tinted in the warning colour, its heading in the warning colour): a header by request type ("Command approval", "File read approval", "File change approval", "App access approval", "App permission approval"), "1/N" when several are pending, the tool name, and its target in monospace with whitespace preserved (so padding is visible), at most 5rem tall and scrolling. The target is clipped at 300 characters for display; when clipped, a line reads "and <N> more characters not shown. Decline unless you know what they are." Buttons: **Decline** (the kit's outline Button) and **Approve** (the default Button), and a "More approval options" menu (an outline icon Button) with **Always allow this session** and **Cancel**. They dispatch `accept`, `acceptForSession`, `decline`, `cancel`. The panel clears at once on a click; if the command is rejected it re-reads the chat and shows what is actually pending. The chat's tab shows the live dot while it waits.

**Pending question panel** (t3code's): a collapsible glass banner with the question's header, "i/N", and "Dismiss question without answering" (only for questions that do not block the turn); the question text, "Select one or more options." for multi-select, and t3code's option rows as kit ghost Buttons in the radio or checkbox role (the key, label and description, a check and the pressed fill on a chosen one; keys 1 to 9 when focus is outside a field; single-select advances after 200 ms). A free answer is typed in the composer itself. The send button, t3code's message-action pill, reads "Next question", "Submit answer" or "Submit answers", "Submitting..." while it goes, with "Previous".

**Proposed plan card** (t3code's): a "Plan" badge and the plan's first heading as its title, else "Proposed plan"; over 900 characters or 20 lines it previews 10 lines with "Expand plan" / "Collapse plan"; a "Plan actions" menu with "Copy to clipboard" ("Copied!") and "Download as markdown" (`<slug>.md`). Above the composer a glass banner reads "Plan ready" and the title, with **Implement** (t3code's split message-action pill) (and a menu "Implementation actions" with **Implement in a new chat**) when the draft is empty, or **Refine** when the person has typed. Implement switches the chat to default mode and sends the text in `assets/prompts/implement-plan.md` followed by the plan; a new chat for it is titled "Implement <title>" (or "Implement plan"). Refine sends the draft as feedback in plan mode.

**Failure, retry and limit lines.** A failed turn's reply already ends with its failure sentence (spec 07). The rail's error line shows only failures the transcript cannot (a session that never started, a lost connection), and is hidden when it repeats the last message. A retry reads "The API is busy (529), retrying in 2s. Attempt 1 of 3…" (status and wait omitted when unknown). A usage limit that was hit reads "You have hit a usage limit. It resets at <time>." (or "You have hit a usage limit."), where `<time>` is the activity's `resetsAt` (an ISO 8601 time, spec 07) shown in the person's locale as hour and minute; it clears when the next turn starts. A "close to the limit" warning shows nothing: Claude sends it on every turn once a plan's window is nearly used.

**Empty chat.** A chat with nothing in it shows one line at the foot of the transcript, as plain text: "Ask about what is on the canvas, or say what should change or be made. Whatever is selected comes with the message as context."

**Scrolling.** Sending anchors the new message near the top; the view follows live output while within 40 px of the end; otherwise a "Scroll to end" pill appears (t3code's: the kit's glass Button).

### Checkpoint diffs for page and motion files

t3code shows a turn's changes as a diff computed from checkpoints. Unframed's checkpoints are free: every page or motion write is a new file, and spec 07's turn changes record the file a shape named before and after each turn. So:

- `orchestration.getTurnDiff {projectId, threadId, fromTurnCount, toTurnCount, ignoreWhitespace?} -> {files: [{shapeId, label, kind, before: file | null, after: file | null, additions, deletions, patch, tooLarge?}]}`: one entry per page or motion written in turns `fromTurnCount + 1` to `toTurnCount`, `patch` a unified diff (3 lines of context) between the file the shape named before the first of those turns and after the last. A new artifact diffs against empty. One turn `n` is `{fromTurnCount: n - 1, toTurnCount: n}`.
- `orchestration.getFullThreadDiff {projectId, threadId, toTurnCount, ignoreWhitespace?}`: the same from the chat's start.
- `ignoreWhitespace` (the panel's "Hide whitespace changes") compares lines with every space taken out, as git's `-w` does.
- A file over 2 MiB answers "This file is too large to diff." in place of its patch, with `tooLarge: true` and no counts.

The diff panel is t3code's (spec 12: its diff panel shell on the background with the kit's border, a header row of kit controls, the segmented Stacked/Split toggle, t3code's diff colours for the counts and its injected diff CSS for the renderer): a scope menu ("Latest turn", "Turn N", "All turns"), a changed-files list down the side (one entry per artifact by label, with added and removed line counts), and the patch rendered with `@pierre/diffs` in a worker, with a Stacked/Split toggle (remembered as the `agent.diffLayout` preference), "Enable line wrapping" / "Disable line wrapping", "Show whitespace changes" / "Hide whitespace changes", and HTML highlighting. Empty states: "No completed turns yet." and "No page or motion changed in this selection." It opens from a recap row's **View diff** and from **View all changes** on the newest recap card, and closes on Escape or its close button. It opens beside the rail, on its left, as tall as the rail, and its renderer loads the first time it opens. Diffs are read-only: taking a change back is Revert, never a hunk-level edit.

## Testing Decisions

A good test does what a person does in the rail, the composer and the toolbar, and asserts on what is on screen and on what the engine then holds (the chat's projection, the canvas). It never inspects component state or the web's stores.

- **Browser seam** for nearly everything here: Playwright against the built web client served by an engine at the engine seam, with `UNFRAMED_TEST_AGENT_SCRIPT` pointing at the fixture folder, so every reply, tool call, approval, question, plan, failure and retry is deterministic. Provider readiness in the browser comes from fake `claude` and `codex` executables (spec 07), or from the scripted agent reporting itself ready. Motion is checked by asserting computed styles and transition end, with reduced motion emulated through Playwright. Timers (the elapsed clock, queue timing) use Playwright's clock.
- **Domain seam** for the pure rules: tab visibility (any-of), the active tab, tab labels, the continuable chat (all-of), recap rows, the work log derivation and its labels, the large-paste rule and file naming, slash command ranking, and the context meter's formatting.
- **Engine seam** for the two engine additions: thread search and artifact diffs.

Prior art: t3code's own web tests for the composer logic, the work log and the timeline (pure functions over activities), and the old app's rail rules tests (visible chats, active tab, tab label, continuable chat, recap rows).

The embedded rail is exercised by spec 09's editor tests, since the editor is what mounts it.

## Tasks

1. **Rail opens and closes.** The Agent button opens the rail with the slide, the top-right chrome fades out and becomes inert, Close reverses it, and the rail leaves the DOM after its exit. At 980 px or less it opens as the kit Sheet over a backdrop instead, and Close and Escape close it. Seam: browser.
2. **Reduced motion.** With reduced motion emulated the rail only fades, and still unmounts. Seam: browser.
3. **No provider ready.** With no ready provider the rail shows both statuses, a How to install link for a missing one, disables Send, and Check again re-checks. Seam: browser.
4. **First message starts a chat.** Typing and pressing Enter creates a chat, the person's message appears at once, the scripted reply streams in, and the tab gets its label. Shift+Enter inserts a line break instead. Seam: browser.
5. **Rail rules.** Visible chats (any-of), the active tab (kept, else newest visible, else none), tab labels (title, 32-character preview, "Chat") and the continuable chat (all-of; untagged when nothing is selected). Seam: domain.
6. **Tabs.** Three inline tabs and the rest under More, a live dot on a running chat, the tooltip. Seam: browser.
7. **Rename a tab.** Double-click edits in place; Enter and blur commit; Escape abandons; an empty name falls back to the default. Seam: browser.
8. **Selection filters the tabs.** Selecting an artifact shows only chats tagged with it; the empty-strip copy for no chats and for several artifacts; the active tab stays visible. Seam: browser.
9. **Delete a chat.** The confirmation, then the tab is gone and the canvas changes it made are still there. Seam: browser.
10. **Thread search, engine.** Matches in user messages and final replies only, one row per chat, user matches first, the snippet length, the 2 to 200 character bounds. Seam: engine.
11. **Thread search, rail.** Typing shows results with "You:" or "Agent:" prefixes and bold matches; choosing one makes it active even when the selection would hide it. Seam: browser.
12. **Selection as chips.** Opening the Agent tray with an artifact and two images selected shows one artifact chip and a "2 images" chip; removing a chip leaves the canvas selection intact; the sent message's context holds what the chips held. Seam: browser.
13. **Mentions.** `@` lists shapes and files; choosing one inserts a chip and adds it to the message's context. Seam: browser.
14. **Attachments.** Attach by button, by drag (the drop overlay) and by paste; thumbnails and file chips; a remove; over-limit files show the exact message. Seam: browser.
15. **Large paste rule.** 32 KiB by characters or UTF-8 bytes, and the `pasted-text-N.txt` naming. Seam: domain.
16. **Large paste in the composer.** A big paste becomes `pasted-text.txt` with the toast; Cmd+Shift+V pastes inline. Seam: browser.
17. **Slash command ranking.** Exact, prefix, word-boundary, substring and fuzzy order, and the tie order. Seam: domain.
18. **Slash menu.** `/model` opens the picker, `/plan` and `/default` switch the mode, a provider command inserts itself, a skill inserts `$<name>`; the empty-state copy. Seam: browser.
19. **Model picker.** Provider tabs with logos, search, the Legacy section, selecting a model updates the chat; after the first turn the other provider's tab is disabled with its tooltip; the picker is disabled mid-turn. Seam: browser.
20. **Traits picker.** Only the traits the model declares, the Default badge, the trigger label; changing the model drops traits it does not declare. Seam: browser.
21. **Runtime mode picker.** The four modes with labels, descriptions and icons, Full access marked Default on a new chat, and a change mid-turn is dispatched and shown. Seam: browser.
22. **Plan toggle.** Off unless `agent.planMode` is set: no toggle, no `/plan` or `/default`, no Shift+Tab, and a chat left in plan mode sends in default mode. On: Plan and Build labels, tooltips, Shift+Tab, and the chat's interaction mode follows. Seam: browser.
23. **Context meter.** The percentage formatting, the token formatting and the red threshold. Seam: domain.
24. **Context meter in the composer.** The ring reflects the scripted usage and the popover shows its lines and Compact context. Seam: browser.
25. **Queue.** A message sent while a scripted turn runs shows as Queued, is dispatched after the next tool call completes, and Cancel returns it to the composer; Stop returns all queued messages. Seam: browser.
26. **Steer.** With the setting on Steer (or Cmd+Enter under Queue) the message joins the running turn; Send now steers a queued one. Seam: browser.
27. **Prompt stash.** Cmd+S stashes and clears, the badge and menu restore and delete entries, the 21st entry drops the oldest with its toast. Seam: browser.
28. **History.** ArrowUp in an empty composer recalls earlier messages; ArrowDown past the newest clears. Seam: browser.
29. **Edit from here.** The dialog, then both choices: the chat rewinds to before the message, the text returns to the composer, and the canvas changes of the later turns are reverted only with "Revert canvas changes too". Seam: browser.
30. **Markdown.** The markdown fixture renders headings, a table (Copy as Markdown), a task list, a code block (Copy code, Copied), a quote and a link opening in a new tab; HTML in a reply shows as text; the person's own `**text**` stays literal. Seam: browser.
31. **Work log.** A turn with several tool calls folds into a group with the counted summary, rows show the documented labels and states, and a settled turn folds behind "Worked for". Seam: browser.
32. **Work log derivation.** Merging by tool call id, grouping, the summaries and the labels for Unframed's tools. Seam: domain.
33. **Sub-agents.** A scripted turn with tasks shows "Kicked off N subagents" and expands to their rows. Seam: browser.
34. **Activity line.** The label for the running tool, "Thinking…" otherwise, and the elapsed time appearing at 10 seconds. Seam: browser.
35. **Approval panel.** In Supervised, the permission fixture's command shows its header, tool and target; Approve lets the turn finish; Decline ends it with the refused text; Always allow this session skips the next ask; the placeholder reads "Resolve this approval request to continue". Seam: browser.
36. **Clipped target.** The padded fixture's command shows its first 300 characters and the "and N more characters not shown" line, with the padding visible. Seam: browser.
37. **Question panel.** A scripted question shows its options and header; choosing an option and submitting releases the turn. Seam: browser.
38. **Proposed plan.** In plan mode a scripted plan shows as a card with Expand, Copy and Download; the Plan ready banner's Implement sends the plan in default mode; Implement in a new chat opens a new chat titled "Implement <title>". Seam: browser.
39. **Recap rows.** Rows from artifact tool inputs, `canvas_write` targets and turn changes, first-touch order, `canvas_read` contributing nothing, deleted shapes marked stale. Seam: domain.
40. **Recap card.** After a scripted write the card lists the artifact with Open and Locate; deleting the artifact strikes it through as "deleted"; Hide and Show. Seam: browser.
41. **Revert this turn.** Revert restores the canvas and the card reads "Reverted"; after the person edits one of the shapes first, the card names it as left alone. Seam: browser.
42. **Failure, retry and limit lines.** The failure fixture shows the retry line during the turn and the failure sentence in the reply; a scripted limit shows its line; the error line does not repeat the reply. Seam: browser.
43. **Focus mark.** Every artifact tagged by the active chat wears the focus mark; switching tabs moves it. Seam: browser.
44. **Toolbar Agent button.** It opens the Agent tray on the selection with "continues <chat>" or "new chat" and the switch; clicking another shape adds a chip; clicking empty canvas closes it; Escape closes it. Seam: browser.
45. **Toolbar Send.** Send opens the rail on the right chat before the reply streams; a new chat is tagged with the selected artifacts. Seam: browser.
46. **Artifact diffs, engine.** For a turn whose scripted `canvas_write` `update` points a seeded page at a new file and a seeded motion at a new file (spec 09 builds the artifact write tools later; this task needs only files the test writes into the project folder), `getTurnDiff` returns both with correct counts and patches; `getFullThreadDiff` spans the chat; an oversized file answers the too-large sentence. Seam: engine.
47. **Diff panel.** View diff opens the panel on that artifact; the scope menu, Stacked/Split and the empty states. Seam: browser.

## Out of Scope

- t3code's terminal drawer, device tools, pull request chips (`#`) and linking, and remote environments (decision Q16).
- t3code's favourites in the model picker, the provider setup panels and the Usage dashboard.
- Hunk-level editing or reverting inside the diff panel.
- Rich-text formatting in the composer (the draft is plain text with chips).
- The editor itself (spec 09), which embeds this rail.

## Further Notes

- **Kept from the old app, unchanged:** the rail's size and motion; the header actions; tabs with three inline and More; double-click rename; the any-of filter and the all-of continue rule (they answer different questions and must not be merged); the no-provider state; the activity line and its labels; the recap card with Open, Locate and struck-through deleted rows; markdown with no raw HTML; the toolbar's continues/new chat line.
- **Changed:** the composer, transcript, work log, approval panel, question panel and plan flow are t3code's; the recap card is per turn rather than one per chat, because Revert this turn needs a home on each turn; Cmd-Z no longer undoes agent changes (decision Q23), so the delete confirmation no longer mentions it; UI copy that had em dashes now uses periods or commas ("Nothing said about these yet. Your first message starts a chat.", "The API is busy (529), retrying in 2s. Attempt 1 of 3…", the plan toggle tooltips).
- **The old targeting words.** The design board for the toolbar says one artifact selected is the target, none means a new artifact, several means it asks. That is now how the agent is told to read the selection (spec 07's system prompt), not a field in the message: there is no target and no mode picker, and "asks" means the agent asks in its reply only when the sentence is genuinely ambiguous.

### Assets this spec needs

- `assets/prompts/implement-plan.md`: t3code `apps/web/src/proposedPlan.ts`, the "PLEASE IMPLEMENT THIS PLAN:" prefix (MIT).
- `assets/brand/provider-logos/claude.svg` and `codex.svg`: the logo paths in old `client/src/agent/ModelPicker.jsx` (from t3code, MIT).
- `assets/fixtures/`: the fixtures of spec 07, including `question.json` (the agent asking the person), `plan.json`, `implement-plan.json`, `subagents.json`, `rate-limit.json`, `markdown.json` and `padded.json`, all in spec 07's script format.
