import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useNodesState,
  useEdgesState,
  useStoreApi,
  useStore,
  useReactFlow,
} from '@xyflow/react';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { ContextMenu, ContextMenuItem } from '@astryxdesign/core/ContextMenu';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Text } from '@astryxdesign/core/Text';
import { Link } from '@astryxdesign/core/Link';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { HStack, VStack, StackItem } from '@astryxdesign/core/Stack';
import { Selector } from '@astryxdesign/core/Selector';
import { Banner } from '@astryxdesign/core/Banner';
import { Divider } from '@astryxdesign/core/Divider';
import { useToast } from '@astryxdesign/core/Toast';
import {
  Plus,
  Minus,
  MousePointer2,
  Hand,
  Maximize,
  Library,
  KeyRound,
  Settings,
  Folder,
  Sparkles,
} from 'lucide-react';
import Logo from './Logo.jsx';
import CanvasBackground from './CanvasBackground.jsx';
import PromptNode from './nodes/PromptNode.jsx';
import ImageNode from './nodes/ImageNode.jsx';
import VideoNode, { MAX_VIDEO_BYTES } from './nodes/VideoNode.jsx';
import ImageOutputNode from './nodes/ImageOutputNode.jsx';
import VideoOutputNode from './nodes/VideoOutputNode.jsx';
import TextOutputNode from './nodes/TextOutputNode.jsx';
import PageNode from './nodes/PageNode.jsx';
import {
  withDrag,
  nextId,
  bumpCounter,
  slug,
  NEW_NODE,
  initialNodes,
  initialEdges,
  clearDragging,
} from './graph/starter.js';
import ProjectMenu from './ProjectMenu.jsx';
import IgnoredEdge from './nodes/IgnoredEdge.jsx';
import { PromptIcon, ImageIcon, VideoIcon, TextIcon, PageIcon } from './nodes/nodeIcons.jsx';
import { bucketSources, isOutput, isArtifact, isReferenceable, hasMedia } from './graph/resolve.js';
import { mediaSrc } from './nodes/ImageNode.jsx';
import { canSource, canTarget, selectedIds, connections, dropInternal } from './graph/bulkWire.js';
import { keepLiveRunMarkers } from './graph/runMarkers.js';
import { hitEdges, samplePaths } from './graph/edgeHits.js';
import { expiryNote } from './keyExpiry.js';
import LibraryDialog from './library/LibraryDialog.jsx';
import { instantiateFragment, centerOffset } from './library/insert.js';
import { selectionFragment, presetFromSelection } from './library/save.js';
import { useDocument } from './graph/useDocument.js';
import { ProjectContext } from './graph/project.js';
import AgentPanel from './agent/AgentPanel.jsx';
import SelectionToolbar from './toolbar/SelectionToolbar.jsx';
import AnchoredReply from './toolbar/AnchoredReply.jsx';
import { messageTarget, addToTarget } from './toolbar/target.js';
import { sendNodeCommand } from './nodes/nodeCommands.js';
import {
  listProjects,
  createThread,
  listThreads,
  sendThreadMessage,
  interruptThread,
  subscribeThreadEvents,
  nextUndo,
  undoProject,
  previewUrl,
  copyFile,
  renameProject,
  deleteProject,
  listPresets,
  savePresets,
  getHealth,
  saveConfig,
  clearKey,
  startOauth,
  cancelOauth,
  oauthPending,
  oauthStatus,
  pickFolder,
  listModels,
  revealFiles,
  listProviders,
} from './api.js';

const nodeTypes = {
  prompt: PromptNode,
  image: ImageNode,
  video: VideoNode,
  imageOutput: ImageOutputNode,
  videoOutput: VideoOutputNode,
  textOutput: TextOutputNode,
  page: PageNode,
};

const edgeTypes = { ignored: IgnoredEdge };

// Icons come from lucide-react — the same pack @astryxdesign/theme-neutral
// registers behind the design system's semantic names, so `icon="info"` and these
// share one grid and one stroke weight. Hand-drawn paths did not: they ranged from
// a 14- to a 22-unit extent inside the same 24 box, which is why some read a size
// bigger than their neighbours.
const PlusIcon = Plus;
const MinusIcon = Minus;
const SelectIcon = MousePointer2;
const HandIcon = Hand;
const FitIcon = Maximize;
const LibraryIcon = Library;
const KeyIcon = KeyRound;
const SettingsIcon = Settings;
const FolderIcon = Folder;

// Which project you were last in. Without this, every reload opened whichever
// project sorted first — and since a reload can be involuntary (the dev server
// restarting, an HMR update that cannot patch), work generated afterwards was
// written into a project you were not looking at.
const ACTIVE_PROJECT_KEY = 'unframed:active-project';

const HELP_TEXT =
  'Reference a prompt or text node with @id. Connect images to number them, then type “image 1”.';

// React Flow drags a node only from this handle, so the inputs inside stay usable.
// A node's tab and its line below are part of the node, so they scale with the canvas
// like everything else in it — no counter-scaling, no chrome that holds 11px while the
// node it names becomes a thumbnail. The cost is that they stop being READABLE well
// before they stop being drawn: at 0.35x an 11px tab is under 4px. So they hide, and
// the threshold is really "the zoom at which this type still resolves".
//
//   below 0.5   hidden
//   0.5 - 0.75  hidden at rest, shown while the pointer is on the node
//   0.75 and up always shown
//
// One attribute on the flow element drives all of it in CSS (styles.css), rather than
// each node subscribing to the zoom: 40 nodes re-rendering on every wheel tick is a
// cost paid continuously for a signal that only changes twice across the whole range.
//
// The numbers came from drawing rather than from use — see the redesign spec's "Left
// open" — so they are expected to move once this has been lived with.
function ChromeZoom() {
  const zoom = useStore((s) => s.transform[2]);
  const ref = useRef(null);
  const level = zoom < 0.5 ? 'off' : zoom < 0.75 ? 'hover' : 'on';
  useEffect(() => {
    ref.current?.closest('.react-flow')?.setAttribute('data-chrome', level);
  }, [level]);
  // Anchors to the flow element without a document-wide query, and takes no space.
  return <span ref={ref} hidden />;
}

function Canvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const { screenToFlowPosition, zoomIn, zoomOut, fitView, getNodes, deleteElements } = useReactFlow();
  const toast = useToast();
  // Shared by every saveProject call site (the debounced autosave below, and
  // the immediate save `confirmName` fires right after creating a project):
  // the same failure -- a full disk, a permissions change, the local server
  // having gone away -- can hit either one, sometimes both within the same
  // second. One uniqueID so a second failure updates the existing toast
  // instead of stacking a new one on top of it every 500ms.
  const reportSaveFailure = useCallback(
    (err) => {
      // err.message already opens with its own "Could not save the project:"
      // (the server's wrap, server/index.js) or "Could not save the project
      // (500)" (api.js's fallback when the body isn't JSON) -- prefixing
      // another "Could not save" here is what doubled the sentence in the
      // in-app check. A raw network failure (the server not running at all,
      // so the PUT never reaches it) has no such prefix, and reads fine
      // without one too.
      toast({
        body: `${err.message}. Is the local server running?`,
        uniqueID: 'autosave-failed',
        type: 'error',
      });
    },
    [toast],
  );
  const [tool, setTool] = useState('select'); // 'select' | 'pan'

  // A press on empty canvas must not take anything away while a multi-selection
  // key is held: you missed a node, you don't lose the group you were building.
  // React Flow has no prop for it and resets from two directions -- a press that
  // never moves is routed by the pane's own onPointerUp into
  // resetSelectedElements(), and a press that moves rebuilds the selection from
  // the rectangle's contents -- but both arrive here as `select: false` changes,
  // so remembering what was selected when the press landed covers both.
  //
  // Those changes are re-SELECTED rather than dropped. The box path calls
  // getSelectionChanges(nodeLookup, ids, true), and that `true` writes
  // selected=false into React Flow's own node lookup as well as emitting the
  // change; a dropped change leaves the `nodes` prop untouched, so nothing ever
  // contradicts the lookup and the node renders unselected. Re-selecting produces
  // a new nodes array, which syncs the lookup back.
  //
  // The key is read from React Flow's `multiSelectionActive`, not the event's
  // modifier bits: it follows multiSelectionKeyCode below instead of restating it,
  // and it is the truthful one -- that state comes from keydown, and a pointer
  // event's modifier bits are not always set on a drag.
  //
  // Latched at pointerdown so releasing the key mid-drag doesn't turn an additive
  // box back into a replacing one. The pane check mirrors React Flow's own
  // (`event.target === container.current`), the exact condition under which either
  // reset can fire, so a press on a NODE is untouched and modifier+click still
  // deselects it.
  // Spec: docs/superpowers/specs/2026-08-18-shift-pane-selection-design.md
  const keepSelected = useRef(null);
  const store = useStoreApi();
  useEffect(() => {
    const down = (e) => {
      keepSelected.current =
        e.target?.classList?.contains('react-flow__pane') &&
        store.getState().multiSelectionActive
          ? new Set(getNodes().filter((n) => n.selected).map((n) => n.id))
          : null;
    };
    // Bubble, not capture: React Flow's handler runs on the pane and has to have
    // fired its changes before the latch is dropped.
    const up = () => {
      keepSelected.current = null;
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up);
    };
  }, [getNodes, store]);

  // A drag's END is what clears React Flow's `dragging` flag, and the end needs a
  // mouseup on this window -- d3-drag listens for nothing else. Switch macOS spaces or
  // apps mid-drag and the mouseup lands somewhere else, so the flag stays true on a node
  // nobody is dragging any more, and `getNodesInside()` -- the only geometry test a box
  // selection runs -- ends with `if (isVisible || node.dragging)`. That one node is then
  // inside every rectangle you draw, anywhere on the canvas, until you drag it again.
  // It looks exactly like a coordinate bug -- the canvas on screen not being the one the
  // selection reads -- and is not one: every other node's hits and misses stay exact.
  //
  // pointercancel and blur are the two events that mean "that gesture is over without a
  // mouseup": the OS taking a gesture over fires the first, focus leaving the window the
  // second. The sweep is a no-op on every ordinary click -- clearDragging returns the
  // same array when there is nothing stuck -- so nothing here touches the happy path.
  // graph/starter.js owns the other half of the same flag, the one that reaches disk.
  useEffect(() => {
    const sweep = () => setNodes(clearDragging);
    window.addEventListener('pointercancel', sweep);
    window.addEventListener('blur', sweep);
    return () => {
      window.removeEventListener('pointercancel', sweep);
      window.removeEventListener('blur', sweep);
    };
  }, [setNodes]);
  const handleNodesChange = useCallback(
    (changes) => {
      const kept = keepSelected.current;
      onNodesChange(
        kept
          ? changes.map((c) =>
              c.type === 'select' && !c.selected && kept.has(c.id) ? { ...c, selected: true } : c,
            )
          : changes,
      );
    },
    [onNodesChange],
  );
  // Last pointer position over the canvas, so pasted nodes land where you're looking.
  const pointer = useRef({ x: 200, y: 200 });
  const canvasRef = useRef(null);

  const [projects, setProjects] = useState(['default']);
  const [project, setCurrent] = useState('default');
  // In-app dialogs (native prompt/confirm get silently suppressed in some browsers).
  // nameDlg drives both "rename" and "create" via one name-entry dialog.
  const [nameDlg, setNameDlg] = useState(null); // { mode:'rename'|'create', name, value, error } | null
  const [deleting, setDeleting] = useState(null); // project name | null
  // Second stage of the delete confirmation, reached only when the server
  // refuses because the project has renders in flight. A separate state (and a
  // separate dialog below) rather than reshaping `deleting`: the first dialog
  // may close itself when its action fires, and a single dialog trying to stay
  // open to escalate would be fighting that.
  const [deleteRenders, setDeleteRenders] = useState(null); // { name, count } | null
  const [libraryOpen, setLibraryOpen] = useState(false);
  // Presets you saved, alongside the bundled ones. Display only — every write
  // re-reads the file first, so this copy going stale can never cost you a preset.
  const [userPresets, setUserPresets] = useState([]);
  const [savePresetDlg, setSavePresetDlg] = useState(null); // { fragment, name, summary, error } | null
  const [deletingPreset, setDeletingPreset] = useState(null); // preset | null
  // Settings dialog. cfg mirrors what the server has on disk; cfgDlg is the open
  // dialog's draft, so nothing is applied until Save.
  const [cfg, setCfg] = useState({
    hasKey: true,
    keyHint: '',
    imageModel: '',
    textModel: '',
    videoModel: '',
    outputDir: '',
    claudePath: '',
    codexPath: '',
    claudeConfigDir: '',
  });
  // The local agent CLIs: what GET /api/providers last said, fetched when the settings
  // dialog or the agent panel opens, never on a timer (detection spawns the CLIs).
  const [providers, setProviders] = useState(null);
  const [providersChecking, setProvidersChecking] = useState(false);
  const checkProviders = useCallback(async (refresh = false) => {
    setProvidersChecking(true);
    try {
      const p = await listProviders(refresh);
      if (p) setProviders(p);
    } finally {
      setProvidersChecking(false);
    }
  }, []);
  const [agentOpen, setAgentOpen] = useState(false);
  // Which thread the panel opens on: the anchored reply's "Open thread" sets it.
  const [agentThread, setAgentThread] = useState(null);
  const openAgent = (threadId = null) => {
    setAgentThread(threadId);
    setAgentOpen(true);
    if (!providers) checkProviders();
  };
  // The artifact the panel's active thread is about (slice 3): ringed on the canvas, and
  // the toolbar's Agent button becomes "Add to <it>" when the selection has no artifact.
  const [agentFocus, setAgentFocus] = useState(null);
  const onAgentFocus = useCallback((id) => setAgentFocus(id), []);
  // Bumped when the toolbar's composer creates a thread, so the panel's strip re-reads.
  const [threadsBump, setThreadsBump] = useState(0);
  const focusNode = agentOpen && agentFocus ? nodes.find((n) => n.id === agentFocus) : null;
  const focusId = focusNode?.id ?? null;
  // The ring is a class on the React Flow wrapper, which `className` on the node reaches;
  // memoised so a render without a focus change hands React Flow the same array.
  const flowNodes = useMemo(() => (focusId ? nodes.map((n) => (n.id === focusId ? { ...n, className: `${n.className ? `${n.className} ` : ''}agent-focus` } : n)) : nodes), [nodes, focusId]);
  // Deleting a page whose agent is mid-turn asks first (slice-3 design, section 4); every
  // other delete is the ordinary undoable op. `deleteBusy` holds what was asked about.
  const [deleteBusy, setDeleteBusy] = useState(null); // { nodes, edges, threads } | null
  const deleteCleared = useRef(false);
  const onBeforeDelete = useCallback(
    async ({ nodes: dn, edges: de }) => {
      if (deleteCleared.current) {
        deleteCleared.current = false;
        return true;
      }
      const pages = dn.filter(isArtifact);
      if (!pages.length) return true;
      const lists = await Promise.all(pages.map((n) => listThreads(project, { artifactId: n.id })));
      const running = lists.flat().filter((t) => t.status === 'running');
      if (!running.length) return true;
      setDeleteBusy({ nodes: dn, edges: de, threads: running });
      return false;
    },
    [project],
  );
  async function confirmDeleteBusy() {
    const d = deleteBusy;
    setDeleteBusy(null);
    if (!d) return;
    await Promise.all(d.threads.map((t) => interruptThread(project, t.id)));
    deleteCleared.current = true;
    deleteElements({ nodes: d.nodes, edges: d.edges });
  }

  // ---- the selection toolbar and its composer (toolbar/SelectionToolbar.jsx) ----
  // `composer` is null (the toolbar shows tools) or the message's shape from
  // toolbar/target.js. Two canvas gestures change it -- clicking another node adds it to
  // "with", clicking empty canvas collapses it -- which is why it lives here and not in
  // the component. `reply` is the agent's answer anchored on the node it worked on.
  const [composer, setComposer] = useState(null);
  const [reply, setReply] = useState(null);
  const replyClose = useRef(null); // the reply's event subscription
  const [panning, setPanning] = useState(false);
  const [boxSelecting, setBoxSelecting] = useState(false);
  const readyProvider = ['claude', 'codex'].map((k) => providers?.[k]).find((p) => p?.status === 'ready') ?? null;
  const providerMessage = providers
    ? 'No Claude or Codex signed in on this Mac. Open the Agent panel to see what was checked.'
    : 'Checking for Claude and Codex…';

  const openComposer = useCallback(() => {
    // With the panel open on an artifact thread and no artifact selected, the message is
    // "Add to <that artifact>" (target.js); a selected artifact still wins.
    setComposer(messageTarget(nodes.filter((n) => n.selected), focusId));
    // The composer is the first place many people meet the agent, so the check the panel
    // would have run happens here too.
    if (!providers) checkProviders();
  }, [nodes, focusId, providers, checkProviders]);
  const closeComposer = useCallback(() => setComposer(null), []);

  // Clicking another node while the composer is open adds it rather than replacing the
  // selection: React Flow has already selected the clicked node alone by the time this
  // runs, so the whole set the composer names is re-selected.
  const onNodeClick = useCallback(
    (e, node) => {
      if (!composer) return;
      const next = addToTarget(composer, node);
      setComposer(next);
      const ids = new Set([...next.with, ...(next.target !== 'new' && next.target !== 'ask' ? [next.target] : [])]);
      setNodes((ns) => ns.map((n) => (n.selected === ids.has(n.id) ? n : { ...n, selected: ids.has(n.id) })));
    },
    [composer, setNodes],
  );
  const onPaneClick = useCallback(() => {
    if (composer) setComposer(null);
  }, [composer]);

  // A selection that goes away takes the composer with it; a different selection (not
  // just none, and not the node the reply is about) dismisses the reply.
  const selectionKey = nodes.filter((n) => n.selected).map((n) => n.id).sort().join(',');
  useEffect(() => {
    if (composer && !selectionKey) setComposer(null);
    if (reply && selectionKey && selectionKey !== reply.selectionKey && selectionKey !== reply.nodeId) dismissReply();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  function dismissReply() {
    replyClose.current?.();
    replyClose.current = null;
    setReply(null);
  }

  // The thread a composer message goes to: about the target artifact (reused when one
  // exists and is idle), a fresh one for a new asset, the board's own when the agent has
  // to ask which artifact is meant.
  async function composerThread(c) {
    const provider = readyProvider.kind;
    // A thread made here is one the panel's strip has not seen; the bump makes it re-read.
    const fresh = (opts) => createThread(project, { provider, ...opts }).then((t) => (setThreadsBump((b) => b + 1), t));
    if (c.target === 'ask') {
      const list = await listThreads(project);
      return list.find((t) => t.kind === 'canvas' && t.status !== 'running') ?? fresh({});
    }
    if (c.target === 'new') return fresh({ kind: 'artifact' });
    const list = await listThreads(project, { artifactId: c.target });
    return list.find((t) => t.status !== 'running') ?? fresh({ kind: 'artifact', artifactId: c.target });
  }

  async function sendComposer(text) {
    const c = composer;
    if (!c || !readyProvider) return;
    const selection = nodes.filter((n) => n.selected).map((n) => n.id);
    dismissReply();
    setComposer(null);
    let thread;
    try {
      thread = await composerThread(c);
    } catch (err) {
      toast({ body: `Could not start the agent: ${err.message}`, uniqueID: 'composer-failed', type: 'error' });
      return;
    }
    const isNode = c.target !== 'new' && c.target !== 'ask';
    const initial = { threadId: thread.id, status: 'running', text: '', nodeId: isNode ? c.target : null, selection, selectionKey, activity: null };
    setReply(initial);
    let draft = '';
    replyClose.current?.();
    replyClose.current = subscribeThreadEvents(project, thread.id, 0, {
      onEvent: (e) => {
        switch (e.type) {
          case 'text_delta':
            draft += e.text;
            setReply((r) => (r && r.threadId === thread.id ? { ...r, text: draft, activity: null } : r));
            break;
          case 'tool_use':
            setReply((r) => (r && r.threadId === thread.id ? { ...r, activity: e.name?.includes('page') ? 'Writing the page…' : e.name?.includes('write') ? 'Changing the canvas…' : 'Reading the canvas…' } : r));
            break;
          case 'ops_applied':
            setReply((r) =>
              r && r.threadId === thread.id
                ? { ...r, version: e.version, summary: e.summary, nodeId: e.page?.created ? e.page.nodeId : r.nodeId, canUndo: true }
                : r,
            );
            break;
          case 'result':
            setReply((r) => (r && r.threadId === thread.id ? { ...r, status: e.ok ? 'idle' : 'failed', text: e.text || r.text, activity: null } : r));
            break;
          case 'error':
            setReply((r) => (r && r.threadId === thread.id ? { ...r, status: 'failed', text: e.message, activity: null } : r));
            break;
          default:
            break;
        }
      },
    });
    try {
      await sendThreadMessage(project, thread.id, { text, selection, ...(isNode || c.target === 'new' ? { target: c.target, with: c.with } : {}) });
    } catch (err) {
      setReply((r) => (r && r.threadId === thread.id ? { ...r, status: 'failed', text: err.message } : r));
    }
  }

  // Undo is offered only while the agent's batch is what Cmd-Z would revert next; asked
  // again after the canvas settles, since any later edit takes that place.
  useEffect(() => {
    if (!reply || reply.version == null || reply.status === 'running' || reply.undone) return undefined;
    const t = setTimeout(() => {
      nextUndo(project).then((next) => {
        setReply((r) => (r && r.version === reply.version ? { ...r, canUndo: next?.version === r.version } : r));
      });
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reply?.version, reply?.status, reply?.undone, nodes, edges, project]);

  async function undoReply() {
    try {
      await doc.flush();
      await undoProject(project);
      setReply((r) => (r ? { ...r, undone: true, canUndo: false } : r));
    } catch (err) {
      toast({ body: `Could not undo: ${err.message}`, uniqueID: 'undo-failed', type: 'error' });
    }
  }

  const openPage = (nodeId) => {
    const n = nodes.find((x) => x.id === nodeId);
    if (n?.data?.file && cfg.previewPort) window.open(previewUrl(cfg.previewPort, project, n.data.file), '_blank', 'noopener,noreferrer');
  };
  const [cfgDlg, setCfgDlg] = useState(null); // { key, imageModel, …, error, saving, saved } | null
  // Outside cfgDlg, for the same class of reason `connecting` is: the draft is
  // rebuilt on every keystroke and every save, and three render branches read
  // this -- the reveal button, the key section, and Save. Riding along in that
  // object meant Save's visibility was derived from state that churned, and the
  // two conditions getting out of step is what stranded Save once and made the
  // paste fallback vanish once. Reset by openSettings, so revealing the field
  // does not persist into the next time the dialog is opened.
  const [showPaste, setShowPaste] = useState(false);
  // Not part of cfgDlg: the dialog is closable mid-flow, and the callback still
  // lands on the server, so this poll must outlive the dialog's own state.
  const [connecting, setConnecting] = useState(null); // { since, url, wasKeyless } | null
  // What GET /api/oauth/status last answered, or null if it hasn't been asked
  // (or the ask failed).
  const [orStatus, setOrStatus] = useState(null);
  // Which key-info request is the current one; see openSettings.
  const orStatusRun = useRef(0);
  // A Cancel's DELETE and the next Connect's POST are independent requests with no
  // ordering guarantee between them, so a Cancel served second wipes the attempt
  // the new Connect just created — and the tab that opened is then dead on arrival
  // while the poll waits on a nonce the server has forgotten. Connect waits for a
  // cancel still in flight instead of racing it.
  const cancelling = useRef(Promise.resolve());
  // Read inside the poll's interval callback (which fires long after the render
  // that scheduled it) to decide whether the dialog is open right now, without
  // making cfgDlg a dependency of that effect — that would restart the
  // interval on every keystroke in the dialog. Assigned from an effect, not the
  // render body, so a render that gets discarded before committing can't leave
  // this pointing at state that was never actually shown.
  const cfgDlgRef = useRef(null);
  useEffect(() => {
    cfgDlgRef.current = cfgDlg;
  });
  // The three model catalogues, for the pickers. { image: [...], text: [...], video: [...] }
  const [catalogues, setCatalogues] = useState({});
  // The server owns the graph; this is the tab's replica (graph/useDocument.js). It
  // replaced the debounced whole-graph autosave, the in-memory undo stack and the
  // `ready` gate that kept the first render from overwriting a saved project.
  const doc = useDocument({ nodes, edges, setNodes, setEdges, onError: reportSaveFailure });
  // Set once any project has been activated. The initial load is async, so a switch
  // made while it is still in flight would otherwise be silently overwritten when it
  // lands — you would be looking at one project while writes went to another.
  const activated = useRef(false);

  // Bumped only when a DIFFERENT graph is actually loaded (switchProject, openFresh)
  // — never by renaming the project you're already in. Node ids come from one
  // counter shared across every project, and React Flow keys node components by id,
  // so a switch can hand the same component instance a different project's node,
  // carrying status/error/result with it (see the <ReactFlow key={canvasGeneration}>
  // below). It would be simpler to key on `project` itself, but `project` also
  // changes when you rename the ACTIVE project (confirmName -> activate(s)) even
  // though the graph is untouched — and remounting there is worse than a cosmetic
  // jolt: a still-pending video job's poll loop (VideoOutputNode's runJob) would
  // find a FRESH component instance whose own startedJobIds is empty, so its resume
  // effect would start a SECOND loop for the very same job id the first loop is
  // still polling. stillOurs() can't catch that, because both loops would agree on
  // the job id — nothing about a rename changes it. A dedicated counter keeps
  // "remount everything" scoped to genuine switches.
  const [canvasGeneration, setCanvasGeneration] = useState(0);

  // The one place a project becomes the active one: React state (what you see, and
  // what the nodes read through ProjectContext to tag their requests) and the
  // remembered name (where the next reload lands). There used to be a third copy in
  // api.js, and the three drifted, which is how a video was written into a project
  // the toolbar was not showing. Which document the tab is subscribed to is not a
  // fourth copy: useDocument's open() is only ever called right next to this.
  const activate = useCallback((name) => {
    activated.current = true;
    setCurrent(name);
    localStorage.setItem(ACTIVE_PROJECT_KEY, name);
  }, []);
  // The live value for code that resumes after an await (graph/project.js).
  const projectRef = useRef(project);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);
  const projectValue = useMemo(() => ({ name: project, ref: projectRef, previewPort: cfg.previewPort || 0 }), [project, cfg.previewPort]);

  useEffect(() => {
    (async () => {
      // One retry: the usual cause of a failure here is the dev server restarting,
      // which takes under a second.
      let list = await listProjects();
      if (list === null) {
        await new Promise((r) => setTimeout(r, 1000));
        list = await listProjects();
      }
      if (list === null) {
        // Do NOT fall through to a default: inventing a project here is what wrote
        // generations into a folder nobody chose. ready stays false, so autosave
        // cannot overwrite a real project with the starter graph either.
        toast({
          body: 'Could not reach the local server. Reload once it is back up.',
          uniqueID: 'projects-unreachable',
          isAutoHide: false,
        });
        return;
      }

      // Reopen where you left off; fall back to the first project only when the
      // remembered one is gone (deleted, renamed, or a fresh clone).
      const remembered = localStorage.getItem(ACTIVE_PROJECT_KEY);
      const current = remembered && list.includes(remembered) ? remembered : list[0] || 'default';
      // The list always applies; the rest must not, if a switch beat us here.
      setProjects(list.length ? list : [current]);
      if (activated.current) return;
      activate(current);
      try {
        // A fresh install has no project at all: create the first one from the starter
        // graph, so the canvas demonstrates an @reference rather than opening blank.
        if (list.length) await doc.open(current);
        else await doc.create(current, { nodes: initialNodes, edges: initialEdges });
      } catch (err) {
        toast({ body: `Could not open “${current}”: ${err.message}`, uniqueID: 'project-open-failed', type: 'error' });
      }
    })();
  }, [doc, activate, toast]);

  // Saving and undo/redo both live in useDocument now: every settled change becomes
  // ops the server journals, and Cmd-Z walks that journal server-side, so one timeline
  // covers this tab, other tabs and the agent, and survives a reload.

  // Ask the server what it has. With no key, open the dialog straight away:
  // nothing on the canvas can produce an image yet, so setup is the only useful
  // first action. cfg starts optimistic (hasKey: true) so the dialog doesn't flash
  // for everyone else while this request is in flight.
  useEffect(() => {
    getHealth()
      .then((h) => {
        setCfg((c) => ({ ...c, ...h, hasKey: Boolean(h.hasKey), keyHint: h.keyHint || '' }));
        if (!h.hasKey) setCfgDlg({ key: '' });
      })
      .catch(() => {});
  }, []);

  // Polls while a connection is pending. Depends on `connecting`, which lives
  // outside `cfgDlg` (see its declaration above) — so closing the dialog
  // cannot cancel this: the callback still lands on the server, and this is
  // what notices.
  //
  // Ten minutes: that is how long OpenRouter's code is valid, and giving up sooner
  // reports failure on a flow that is still perfectly completable.
  useEffect(() => {
    const pending = connecting;
    if (!pending) return;
    // clearInterval on cleanup can't cancel a request already in flight, so a
    // resolution can still land after Cancel or the timeout has fired for this
    // same attempt — `live` is what stops it from acting on it anyway.
    let live = true;
    // Where a terminal outcome goes. The dialog is closable mid-flow, so the inline
    // banner reaches nobody when it is shut, and a toast is the only thing that does.
    const report = (msg) => {
      if (cfgDlgRef.current) setCfgDlg((d) => (d ? { ...d, error: msg } : d));
      else toast({ body: msg, uniqueID: 'oauth-failed' });
    };
    const id = setInterval(async () => {
      const elapsed = Date.now() - pending.since;
      // The server's own account of how the attempt ended. `null` is a dropped
      // request, not an answer, so it falls through to the next tick.
      const outcome = await oauthPending();
      if (!live) return;

      if (outcome?.state === 'failed') {
        setConnecting(null);
        report(outcome.reason || 'Connecting failed. Try again.');
        return;
      }

      // The server has no record of any attempt at all. Cancelled from a second
      // window, superseded by one, or the engine restarted — `node --watch` does
      // that on any file save in development, and the store is in memory by design.
      // None of those can ever complete, so this is terminal. Falling through to
      // the next tick, as it used to, left the dialog saying "Waiting for OpenRouter
      // in your browser" for the full ten minutes about an attempt the server had
      // already told it did not exist.
      if (outcome?.state === 'none') {
        setConnecting(null);
        report('That connection was lost before it finished. Try connecting again.');
        return;
      }

      if (outcome?.state === 'done') {
        // BOTH requests before setConnecting(null), and together, since neither
        // needs the other's answer.
        //
        // The order is the whole point. setConnecting(null) changes this effect's
        // own dependency, so React tears the effect down and the cleanup below sets
        // `live = false` — within a frame, while a request is still out on the
        // network. Anything awaited after that resolves into a `!live` check that is
        // already false, so the entire tail of this branch was dead code: no toast,
        // no free-tier warning, and a dialog that never closed. `live` exists to
        // ignore a resolution after a real Cancel, and the branch was tripping it on
        // itself. Everything below this await is synchronous, so it cannot happen
        // again.
        const [h, status] = await Promise.all([getHealth().catch(() => null), oauthStatus()]);
        if (!live) return;
        setConnecting(null);
        // Only the settings `cfg` carries, not the whole health payload: that
        // also holds `ok` and the legacy `model` alias, and spreading them in
        // leaves cfg with members nothing declares and nothing reads.
        const { ok, model, ...settings } = h || {};
        // Trust the server when it answered. The old code forced `hasKey: true`
        // here, on the theory that a failed health request must not undo a finished
        // connection -- but a failed request yields h === null and an empty
        // `settings`, so there was nothing to force. The hardcode only ever bit the
        // case it was not meant to: a health request that SUCCEEDED and correctly
        // said "no key" -- a Remove key in the gap between the poll reading 'done'
        // and this merge -- which it then overwrote back to "a key is saved". Only
        // when h is null (the request itself failed) do we default true, since the
        // server did just report the connection done.
        setCfg((c) => ({ ...c, ...settings, hasKey: h?.hasKey ?? true, keyHint: h?.keyHint ?? c.keyHint }));
        // Not left to the next openSettings(): on a first connect this is the ONLY
        // chance to warn that no credit has been bought, which is the entire reason
        // the route reports is_free_tier.
        setOrStatus(status);
        toast({ body: 'Connected to OpenRouter.', uniqueID: 'oauth-connected' });
        // Onboarding closes, for the same reason saveSettings closes: the rest of
        // the form was hidden while there was no key. Unless there is something to
        // say -- then the dialog stays, because a toast cannot carry the link to buy
        // credit.
        if (pending.wasKeyless && !status?.isFreeTier) return setCfgDlg(null);
        // The keyless dialog is opened directly (see the initial load), not through
        // openSettings, so nothing has fetched the catalogues. Without this the
        // three pickers sit on "Loading models…" for as long as the dialog is open.
        if (pending.wasKeyless) loadCatalogues();
        // A reconnect keeps whatever the user had typed into the models and folder
        // fields. Clearing the draft here is what the old unconditional close did
        // by accident, and the Save button was deliberately left live during a
        // connect precisely so those edits had a way out.
        setCfgDlg((d) => (d ? { ...d, key: '', error: undefined } : d));
        return;
      }
      // A backstop now rather than the mechanism: the server fails its own attempt
      // on the same ten-minute clock, so this only fires if the poll itself has
      // been failing — which is why it does not depend on having heard anything.
      if (elapsed > 10 * 60 * 1000) {
        setConnecting(null);
        report('Nothing came back from OpenRouter. Try connecting again.');
        return;
      }
    }, 1500);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [connecting, toast]);

  // Cached in api.js, so calling this twice costs nothing. Extracted because the
  // poll above needs it too: a first connect that keeps the dialog open would
  // otherwise leave the model pickers reading "Loading models…" forever, since
  // nothing else ever fetches them.
  function loadCatalogues() {
    if (catalogues.image) return;
    ['image', 'text', 'video'].forEach((type) =>
      listModels(type).then((d) => setCatalogues((c) => ({ ...c, [type]: d.models || [] }))),
    );
  }

  // Open with the saved values as the draft, so the pickers show what is in use.
  function openSettings() {
    setShowPaste(false);
    setCfgDlg({
      key: '',
      imageModel: cfg.imageModel,
      textModel: cfg.textModel,
      videoModel: cfg.videoModel,
      outputDir: cfg.outputDir,
      claudePath: cfg.claudePath ?? '',
      codexPath: cfg.codexPath ?? '',
      claudeConfigDir: cfg.claudeConfigDir ?? '',
    });
    loadCatalogues();
    checkProviders();
    // On open, not on a timer: inference responses carry no quota information, so
    // asking is the only way to know, and nothing outside this dialog needs it.
    setOrStatus(null);
    // Guarded like useModels in nodes/output/core.js: open, close, reopen quickly
    // and two of these are in flight, and the older one resolving last would
    // overwrite the newer answer.
    if (cfg.hasKey) {
      const mine = ++orStatusRun.current;
      oauthStatus().then((d) => {
        if (orStatusRun.current === mine) setOrStatus(d);
      });
    }
  }

  async function saveSettings() {
    const d = cfgDlg;
    // Only what actually changed, so saving the key doesn't rewrite four model
    // lines and an empty key field doesn't wipe the saved key.
    const fields = {};
    if (d.key?.trim()) fields.key = d.key.trim();
    for (const f of ['imageModel', 'textModel', 'videoModel', 'outputDir']) {
      if (d[f] && d[f] !== cfg[f]) fields[f] = d[f];
    }
    // The provider settings may be cleared: an empty string is a real value here (back
    // to PATH, back to the default config dir), so it is sent when it changed.
    for (const f of ['claudePath', 'codexPath', 'claudeConfigDir']) {
      if ((d[f] ?? '') !== (cfg[f] ?? '')) fields[f] = d[f] ?? '';
    }
    if (!Object.keys(fields).length) return setCfgDlg(null);

    // Read BEFORE the save: `cfg.hasKey` is about to flip, and this decides
    // whether the dialog was the key-only onboarding one.
    const wasKeyless = !cfg.hasKey;

    setCfgDlg((s) => ({ ...s, saving: true, error: undefined }));
    try {
      const r = await saveConfig(fields);
      setCfg((c) => ({ ...c, ...r }));
      // A changed binary or config dir means what was detected no longer applies.
      if (fields.claudePath !== undefined || fields.codexPath !== undefined || fields.claudeConfigDir !== undefined) checkProviders();
      // Saving a key settles which credential the app uses, so PUT /api/config
      // cancels any attempt still in flight server-side. Stop the poll here too, or
      // its next tick reads the now-empty store as 'none' -- which is terminal since
      // finding 08 -- and reports "That connection was lost" about a key that in
      // fact just saved. Only when a key was sent: a model or folder save must leave
      // a connect in flight running.
      if (fields.key) setConnecting(null);
      // Onboarding ends by closing. The rest of the form -- the model pickers and
      // the output folder -- was hidden while there was no key, and their
      // catalogues are only fetched by openSettings(), so leaving the dialog open
      // here would show a form that is still stuck on "Loading models…". Closing
      // makes the next open go through openSettings() and arrive populated.
      //
      // The toast is the whole confirmation in this path: the success banner below
      // lives inside the dialog, so closing takes it with it and the save would
      // otherwise land in silence. Toast has no success type, only info and error,
      // so this is a plain auto-hiding info one rather than a themed green.
      if (wasKeyless) {
        toast({ body: 'Key saved. Unframed is ready to generate.', uniqueID: 'key-saved' });
        return setCfgDlg(null);
      }
      // A new key was just saved over the old one, but the dialog stays open --
      // the status fetched at open time now describes a key that's gone.
      if (fields.key) setOrStatus(null);
      setCfgDlg((s) => ({ ...s, key: '', saving: false, saved: true }));
    } catch (err) {
      setCfgDlg((s) => ({ ...s, saving: false, error: err.message }));
    }
  }

  // Opens OpenRouter in the user's real browser: a plain _blank navigation, which
  // the packaged shell turns into shell.openExternal via setWindowOpenHandler and
  // a clone treats as an ordinary tab. One code path for both. 'noopener' is kept
  // for the security posture of handing a URL to another origin, even though —
  // on both paths — it also means the return value can never tell a blocked
  // popup from an opened one; the link is always shown as a fallback because of
  // that, not because either path is detected.
  async function connectOpenRouter() {
    // key: '' drops any draft in the field this hides. Pasting a key during a
    // pending connect is allowed again now that the poll asks the server how the
    // attempt ended instead of inferring it from a changed key hint -- which a
    // pasted key also changed, so the flow used to report someone else's paste as
    // its own success.
    setCfgDlg((d) => ({ ...d, key: '', error: undefined, saved: false }));
    // Opened BEFORE the await, while the click's user activation is still live.
    // Chrome's activation survives a fast fetch, which is why opening it after
    // worked in testing, but Safari and Firefox are stricter about a popup opened
    // outside the gesture's own task and block it silently -- leaving the user
    // reading "waiting for OpenRouter in your browser" with no browser tab.
    //
    // Without 'noopener', because that makes window.open return null and there
    // would be nothing to navigate. about:blank is same-origin until it is
    // navigated, so the opener can be severed here instead, which is what
    // 'noopener' would have bought.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try {
      // Before starting, so a Cancel still in flight cannot arrive after this
      // attempt is created and wipe it. cancelOauth swallows its own failures, so
      // this never rejects.
      await cancelling.current;
      const url = await startOauth();
      // Still null when popups are blocked outright, which is why the link in the
      // waiting state is permanent rather than a reaction to a failed open.
      if (tab) tab.location = url;
      // wasKeyless captured now, not read off `cfg` later, since cfg.hasKey flips
      // the moment the connection lands and this decides whether the dialog was
      // the key-only onboarding one.
      setConnecting({ since: Date.now(), url, wasKeyless: !cfg.hasKey });
    } catch (err) {
      if (tab) tab.close();
      setCfgDlg((d) => ({ ...d, error: err.message }));
    }
  }

  function cancelConnect() {
    // The DELETE can remove a key server-side -- if the callback had already
    // committed one, Cancel undoes it (see the route). So resync cfg from health
    // once it lands, or the dialog would go on claiming a key is saved that Cancel
    // just removed. cancelOauth swallows its own failure, so this never rejects,
    // and cancelling.current is what a fast re-Connect waits on before starting.
    cancelling.current = cancelOauth().then(() =>
      getHealth()
        .then((h) => setCfg((c) => ({ ...c, hasKey: Boolean(h.hasKey), keyHint: h.keyHint || '' })))
        .catch(() => {}),
    );
    setConnecting(null);
  }

  // The picker runs on the server, which is this machine — a browser can't hand
  // back a real path. Cancelling returns '' and changes nothing.
  async function browseFolder() {
    try {
      const p = await pickFolder();
      if (p) setCfgDlg((s) => ({ ...s, outputDir: p, error: undefined, saved: false }));
    } catch (err) {
      setCfgDlg((s) => ({ ...s, error: err.message }));
    }
  }

  // Two clicks to remove: the key isn't recoverable from here, so a stray click
  // shouldn't send you back to openrouter.ai for a new one.
  async function removeKey() {
    if (!cfgDlg.confirmRemove) {
      setCfgDlg((d) => ({ ...d, confirmRemove: true, error: undefined, saved: false }));
      return;
    }
    setCfgDlg((d) => ({ ...d, saving: true }));
    try {
      const r = await clearKey();
      setCfg((c) => ({ ...c, ...r }));
      // The key just described by orStatus is gone; null falls back to the
      // honest "not asked" copy instead of reporting a deleted key's spend.
      setOrStatus(null);
      // The key is gone either way -- removed stays true even when the cleanup
      // below failed. renderCleanupError, when present, reuses the banner slot
      // below (shared with save results) rather than implying the removal itself
      // didn't happen; its wording already says the key was removed.
      setCfgDlg((d) => ({
        ...d,
        key: '',
        saving: false,
        confirmRemove: false,
        removed: true,
        error: r.renderCleanupError,
      }));
    } catch (err) {
      setCfgDlg((d) => ({ ...d, saving: false, confirmRemove: false, error: err.message }));
    }
  }

  async function switchProject(name) {
    if (name === project) return;
    // Any edit still inside the settle window belongs to the project we are leaving.
    await doc.flush();
    activate(name);
    // A genuinely different graph is about to land — remount every node component
    // rather than reuse instances by id. See the comment on canvasGeneration.
    setCanvasGeneration((n) => n + 1);
    try {
      await doc.open(name);
    } catch (err) {
      toast({ body: `Could not open “${name}”: ${err.message}`, uniqueID: 'project-open-failed', type: 'error' });
    }
  }

  // A new project: created on the server with the starter graph, so it exists on disk
  // (survives reload, can be renamed) from the first moment rather than after the
  // first edit.
  async function openFresh(name) {
    await doc.flush();
    activate(name);
    // Same reasoning as switchProject: a fresh starter graph is still a different
    // graph than whatever was on screen before.
    setCanvasGeneration((n) => n + 1);
    try {
      await doc.create(name, { nodes: initialNodes, edges: initialEdges });
    } catch (err) {
      reportSaveFailure(err);
    }
  }

  function newProject() {
    setNameDlg({ mode: 'create', name: '', value: '' });
  }

  async function confirmName() {
    const { mode, name, value } = nameDlg;
    const s = slug(value);
    if (!s) {
      setNameDlg((d) => ({ ...d, error: 'Enter a project name.' }));
      return;
    }
    if (mode === 'create') {
      if (projects.includes(s)) {
        setNameDlg((d) => ({ ...d, error: `A project named “${s}” already exists.` }));
        return;
      }
      setProjects((ps) => [...ps, s]);
      // Not awaited -- the dialog closes regardless; openFresh reports its own failure.
      openFresh(s);
      setNameDlg(null);
      return;
    }
    // rename
    if (s === name) {
      setNameDlg(null);
      return;
    }
    try {
      await renameProject(name, s);
    } catch (err) {
      setNameDlg((d) => ({ ...d, error: err.message }));
      return;
    }
    setProjects((ps) => ps.map((p) => (p === name ? s : p)));
    if (project === name) {
      activate(s);
    }
    setNameDlg(null);
  }

  // Shared tail: the project is gone on the server, so bring the UI in line.
  function projectDeleted(name) {
    const rest = projects.filter((p) => p !== name);
    setProjects(rest.length ? rest : ['default']);
    if (project === name) {
      if (rest.length) switchProject(rest[0]);
      else openFresh('default');
    }
  }

  async function confirmDelete() {
    const name = deleting;
    setDeleting(null);
    try {
      await deleteProject(name);
    } catch (err) {
      // A refusal is not a failure: the server is telling us what this delete
      // would abandon so the user can decide. Anything else is a real error,
      // and must NOT remove the project from the list -- doing that regardless
      // of outcome is what made a failed delete look successful.
      if (err.pendingRenders > 0) {
        setDeleteRenders({ name, count: err.pendingRenders });
        return;
      }
      toast({ body: err.message, uniqueID: `delete-project-${name}` });
      return;
    }
    projectDeleted(name);
  }

  async function confirmDeleteWithRenders() {
    const { name } = deleteRenders;
    setDeleteRenders(null);
    try {
      await deleteProject(name, { confirmRenders: true });
    } catch (err) {
      toast({ body: err.message, uniqueID: `delete-project-${name}` });
      return;
    }
    projectDeleted(name);
  }

  // Which handle the current drag came off, so onConnect can tell a drag that
  // STARTED on a selected node (fan the whole group out) from one that merely
  // landed on one (a single edge, as always). onConnect alone cannot: it reports
  // a settled source and target, and either end may be the one you dragged from.
  const connectFrom = useRef(null);

  const onConnect = useCallback(
    (conn) => {
      // Text nodes have both handles, so without this a node could wire into
      // itself and silently self-amplify its own prompt on every run.
      if (conn.source === conn.target) return;
      setEdges((eds) => {
        const from = connectFrom.current;
        const group = from && nodes.find((n) => n.id === from.nodeId)?.selected
          ? // Dragged off a source handle: every selected node that HAS a source
            // handle wires into wherever you dropped. Off a target handle, the
            // reverse. The origin is in the selection by definition of the branch,
            // so it needs no special case.
            from.handleType === 'source'
            ? connections({ edges: eds, sources: selectedIds(nodes, canSource), targets: [conn.target] })
            : connections({ edges: eds, sources: [conn.source], targets: selectedIds(nodes, canTarget) })
          : [conn];
        return group.reduce((es, c) => addEdge(c, es), eds);
      });
    },
    [setEdges, nodes],
  );

  // Cleared on end rather than only on start: a drag released over empty canvas
  // never reaches onConnect, and a stale origin would fan out the NEXT drag.
  const onConnectStart = useCallback((_, params) => { connectFrom.current = params; }, []);
  const onConnectEnd = useCallback(() => { connectFrom.current = null; }, []);

  // Where the selection rectangle started, in flow coordinates. Read off React Flow's
  // own store rather than the pointer event: by the time a drag is recognised as a
  // selection the pointer has already travelled past the origin, and the store holds
  // the exact starting point. (`store` is the one declared above for the selection latch.)
  const lassoFrom = useRef(null);
  const onSelectionStart = useCallback(() => {
    setBoxSelecting(true);
    const rect = store.getState().userSelectionRect;
    lassoFrom.current = rect ? { x: rect.startX, y: rect.startY } : null;
  }, [store]);

  // React Flow selects an edge whenever one of its nodes lands in the box, and it has
  // already done so by the time this runs -- so marking hits here ADDS the connectors
  // the box crossed in empty canvas, rather than replacing anything.
  const onSelectionEnd = useCallback(
    (e) => {
      setBoxSelecting(false);
      const from = lassoFrom.current;
      lassoFrom.current = null;
      if (!from) return;
      const to = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const rect = {
        x: Math.min(from.x, to.x),
        y: Math.min(from.y, to.y),
        width: Math.abs(to.x - from.x),
        height: Math.abs(to.y - from.y),
      };
      const hits = hitEdges(rect, samplePaths());
      if (!hits.size) return;
      setEdges((es) => es.map((edge) => (hits.has(edge.id) ? { ...edge, selected: true } : edge)));
    },
    [screenToFlowPosition, setEdges],
  );

  // The two bulk items in the right-click menu. Both read the selection straight
  // from `nodes`, so they work on whatever the right-click left selected.
  const connectSelection = useCallback(() => {
    setEdges((eds) => {
      const fresh = connections({
        edges: eds,
        sources: selectedIds(nodes, canSource),
        targets: selectedIds(nodes, canTarget),
      });
      return fresh.reduce((es, c) => addEdge(c, es), eds);
    });
  }, [setEdges, nodes]);

  const disconnectSelection = useCallback(() => {
    setEdges((eds) => dropInternal(eds, nodes.filter((n) => n.selected).map((n) => n.id)));
  }, [setEdges, nodes]);

  const addNode = useCallback(
    (type, data, screenPos) => {
      // Minted out here, not inside the updater: React runs updaters twice under
      // StrictMode, which would burn an id every time.
      const id = nextId();
      setNodes((ns) => {
        // No explicit point (toolbar button) -> center of what you're looking at.
        const r = canvasRef.current.getBoundingClientRect();
        const position = screenToFlowPosition(
          screenPos || { x: r.x + r.width / 2, y: r.y + r.height / 2 },
        );
        if (!screenPos) {
          // ponytail: nodes are ~240x150, so shift by half to centre the node
          // itself rather than its top-left corner. Close enough at any zoom.
          position.x -= 120;
          position.y -= 75;
        }
        return [...ns, withDrag({ id, type, position, data })];
      });
      return id;
    },
    [setNodes, screenToFlowPosition],
  );

  const addPrompt = () => addNode('prompt', NEW_NODE.prompt);
  const addImage = () => addNode('image', NEW_NODE.image);
  const addOutput = () => addNode('imageOutput', NEW_NODE.imageOutput);
  const addText = () => addNode('textOutput', NEW_NODE.textOutput);

  // Where the last right-click landed, so the context menu's items can drop their
  // node on that spot. The menu component reports the click by opening, not by
  // handing the event to each item, so the point is caught on the way past.
  const menuPoint = useRef(null);

  // One definition, two menus: the toolbar's + button and the canvas context menu
  // offer the same nodes in the same order. `at` is undefined for the toolbar,
  // which then falls back to the centre of the view.
  const addMenuItems = (at) => [
    {
      type: 'section',
      title: 'Inputs',
      items: [
        { label: 'Prompt', icon: PromptIcon, onClick: () => addNode('prompt', NEW_NODE.prompt, at?.()) },
        { label: 'Image', icon: ImageIcon, onClick: () => addNode('image', NEW_NODE.image, at?.()) },
        { label: 'Video', icon: VideoIcon, onClick: () => addNode('video', NEW_NODE.video, at?.()) },
      ],
    },
    {
      // Image and Video appear in both sections on purpose: one is a picture you
      // supply, one is a picture you generate. The section header says which, and on
      // the canvas an output's header is accent-coloured where an input's is not.
      type: 'section',
      title: 'Outputs',
      items: [
        { label: 'Image', icon: ImageIcon, onClick: () => addNode('imageOutput', NEW_NODE.imageOutput, at?.()) },
        { label: 'Video', icon: VideoIcon, onClick: () => addNode('videoOutput', NEW_NODE.videoOutput, at?.()) },
        { label: 'Text', icon: TextIcon, onClick: () => addNode('textOutput', NEW_NODE.textOutput, at?.()) },
      ],
    },
    {
      // The third family: things on the board that reference the others by file.
      type: 'section',
      title: 'Artifacts',
      items: [{ label: 'Page', icon: PageIcon, onClick: () => addNode('page', NEW_NODE.page, at?.()) }],
    },
  ];

  // Drop a preset onto the canvas: fresh ids, rewritten references, bounding box
  // centred on the current view. Inserted nodes are plain copies — nothing links
  // back to the preset, so editing them is just editing nodes.
  function insertPreset(preset) {
    const { nodes: fresh, edges: freshEdges } = instantiateFragment(preset.fragment, nextId);
    const r = canvasRef.current.getBoundingClientRect();
    const centre = screenToFlowPosition({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    const { dx, dy } = centerOffset(preset.fragment, centre);
    setNodes((ns) => [
      ...ns,
      ...fresh.map((n) => withDrag({ ...n, position: { x: n.position.x + dx, y: n.position.y + dy } })),
    ]);
    setEdges((es) => [...es, ...freshEdges]);
    setLibraryOpen(false);
  }

  // Re-read on open rather than once at boot: it costs one request on a click, and
  // it means a preset saved in another window (or hand-edited into presets.json)
  // shows up without a reload.
  function openLibrary() {
    setLibraryOpen(true);
    listPresets().then(setUserPresets).catch(() => {});
  }

  // Right-click -> Add to library. The fragment is snapshotted here, at the click,
  // so editing the canvas while the dialog is open cannot change what gets saved.
  function openSavePreset() {
    const fragment = selectionFragment(nodes, edges, menuCtx?.id);
    if (!fragment) return;
    setSavePresetDlg({ fragment, name: '', summary: '' });
  }

  // Read-modify-write, both here and on delete: the PUT replaces the whole file, so
  // appending to the copy in React state would erase anything saved since it loaded.
  async function confirmSavePreset() {
    const dlg = savePresetDlg;
    if (!dlg.name.trim()) return setSavePresetDlg({ ...dlg, error: 'Give it a name.' });
    const preset = presetFromSelection(dlg.fragment, dlg);
    try {
      const next = [preset, ...(await listPresets())];
      await savePresets(next);
      setUserPresets(next);
      setSavePresetDlg(null);
      toast({ body: `Saved “${preset.name}” to your library.` });
    } catch {
      setSavePresetDlg({ ...dlg, error: 'Could not save. Is the local server running?' });
    }
  }

  async function confirmDeletePreset() {
    const doomed = deletingPreset;
    setDeletingPreset(null);
    try {
      const next = (await listPresets()).filter((p) => p.id !== doomed.id);
      await savePresets(next);
      setUserPresets(next);
    } catch {
      toast({ body: 'Could not delete that preset. Is the local server running?' });
    }
  }

  // What the last right-click landed on, captured before the menu opens so the
  // menu can be about the thing under the cursor: a node gets node actions, the
  // empty canvas gets the add sections. flushSync because the native menu opens
  // in the same event dispatch — a normally-batched setState would still be
  // pending, and the menu would render for the PREVIOUS right-click.
  const [menuCtx, setMenuCtx] = useState(null); // { id, type, hasImage, fileName } | null

  // The graph's own clipboard, for whole nodes. Separate from the system one: the
  // OS clipboard cannot hold a subgraph, and the system-paste path (images, text)
  // already has its own handler. A ref, not state — nothing renders from it.
  const nodeClipboard = useRef(null); // { nodes, edges } | null
  // Written to the system clipboard on node-copy, so ⌘V can tell "paste my
  // nodes" from "paste this screenshot" by whichever was copied last.
  const NODE_CLIP_MARK = 'unframed:nodes';

  // A node's picture as a PNG blob: Chrome's clipboard accepts no other image
  // type, and uploads can be JPEG.
  async function pngBlob(dataUrl) {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return new Promise((r) => c.toBlob(r, 'image/png'));
  }

  function copySelection() {
    // Same selection rule as saving to the library, including the fallback to the
    // right-clicked node — without it, Copy from a menu opened on an unselected
    // node did nothing at all.
    const fragment = selectionFragment(nodes, edges, menuCtx?.id);
    if (!fragment) return;
    nodeClipboard.current = fragment;
    const chosen = fragment.nodes;
    // One clipboard item, two faces. The text face is the routing marker that
    // makes our own ⌘V paste nodes; the image face is the picture itself when
    // exactly one image node is copied, so the same Copy pastes into Figma or
    // anywhere else as a real PNG. Promise values keep the write inside the
    // user gesture while the re-encode runs.
    const faces = { 'text/plain': new Blob([NODE_CLIP_MARK], { type: 'text/plain' }) };
    const pics = chosen.filter((n) => n.type === 'image' && hasMedia(n));
    if (pics.length === 1) faces['image/png'] = pngBlob(mediaSrc(pics[0].data, project));
    navigator.clipboard?.write([new ClipboardItem(faces)]).catch(() => {});
  }

  // "@100" onto the clipboard, ready to paste into a prompt. This used to be a click
  // on the node's own header, which is also its drag handle — so reaching for a drag
  // or a selection copied instead, and the one strip a node must keep grabbable was
  // carrying a button (see NodeHeader.jsx). The clipboard write is reported rather
  // than swallowed: a menu item that quietly does nothing is indistinguishable from
  // one that worked, and the header at least used to say "copied!".
  function copyReference(id) {
    const written = navigator.clipboard?.writeText(`@${id}`);
    if (!written) return;
    written.catch(() =>
      toast({ body: `Could not copy @${id} to the clipboard.`, uniqueID: 'copy-ref-failed', type: 'error' }),
    );
  }

  // Where a node's pictures actually live, in the order the node shows them. Neither
  // kind carries bytes any more: an input node names a file in the project folder, an
  // output node holds `/api/file/...` pointers, and an <img> loads either just the same,
  // which is what makes one copy path serve both.
  function picturesOf(node) {
    if (node?.type === 'image') return hasMedia(node) ? [mediaSrc(node.data, project)] : [];
    if (node?.type !== 'imageOutput') return [];
    return [...(node.data?.results || [])]
      .sort((a, b) => a.runIndex - b.runIndex)
      .map((r) => r.url)
      .filter(Boolean);
  }

  // The picture itself onto the clipboard, so it pastes into Figma or a chat as a real
  // image rather than as a node. PNG because Chrome's clipboard accepts no other image
  // type, and a source can be a JPEG upload — pngBlob re-encodes. The blob is handed
  // over as a PROMISE, not awaited first: the write has to be issued inside the click
  // that asked for it or the browser rejects it as a write without a user gesture, and
  // the re-encode is async. Same trick as copySelection above.
  function copyAsImage(src) {
    const written = navigator.clipboard?.write([new ClipboardItem({ 'image/png': pngBlob(src) })]);
    if (!written) return;
    written.catch(() =>
      toast({ body: 'Could not copy that image to the clipboard.', uniqueID: 'copy-image-failed', type: 'error' }),
    );
  }

  function cutSelection() {
    copySelection();
    // What copy actually took, so cut removes exactly that — including the case
    // where the fallback stood in for an empty selection.
    const ids = new Set((nodeClipboard.current?.nodes || []).map((n) => n.id));
    if (!ids.size) return;
    setNodes((ns) => ns.filter((n) => !ids.has(n.id)));
    setEdges((es) => es.filter((e) => !ids.has(e.source) && !ids.has(e.target)));
  }

  // Same machinery as inserting a preset: fresh ids, @token rewrite, centred on
  // the right-click point — so pasted prompts keep referencing their co-pasted
  // neighbours instead of the originals.
  async function pasteNodeClipboard(at) {
    const clip = nodeClipboard.current;
    if (!clip?.nodes.length) return;
    const { nodes: fresh, edges: freshEdges } = instantiateFragment(clip, nextId);
    // A pasted page gets its own copy of the file: two nodes on one file would mean an
    // edit through either moves both, and a copy is the unit of working in parallel
    // (slice-3 design, section 4). A failed copy pastes an empty page rather than nothing.
    await Promise.all(
      fresh.filter((n) => isArtifact(n) && n.data?.file).map(async (n) => {
        try {
          n.data = { ...n.data, file: await copyFile(project, n.data.file) };
        } catch (err) {
          n.data = { ...n.data, file: null };
          toast({ body: `Could not copy the page's file: ${err.message}`, uniqueID: 'copy-failed', type: 'error' });
        }
      }),
    );
    const centre = screenToFlowPosition(at ?? menuPoint.current ?? { x: 300, y: 300 });
    const { dx, dy } = centerOffset(clip, centre);
    setNodes((ns) => [
      ...ns,
      ...fresh.map((n) => withDrag({ ...n, position: { x: n.position.x + dx, y: n.position.y + dy } })),
    ]);
    setEdges((es) => [...es, ...freshEdges]);
  }

  // ⌘C/⌘X on a node selection, matching the hints the context menu shows. Inside
  // a text field the browser's own copy wins, same rule as undo; with nothing
  // selected the event passes through untouched so copying from anywhere else on
  // the page keeps working.
  useEffect(() => {
    function onKeyDown(e) {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key !== 'c' && key !== 'x') return;
      const el = e.target;
      const typing =
        el instanceof HTMLElement &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing) return;
      if (!nodes.some((n) => n.selected)) return;
      if (key === 'c') copySelection();
      else cutSelection();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // What the right-click menu offers depends on what was under the cursor: a node
  // gets edit actions (plus a reveal action when it has a picture), empty canvas
  // gets edit actions and the add-node sections. Rendered through the compound
  // menuContent API rather than the items array: items are keyed by their label
  // string, so the shortcut hints (JSX labels) collapsed onto one key — and only
  // ContextMenuItem carries endContent.
  function contextMenuContent() {
    const hasSelection = nodes.some((n) => n.selected) || menuCtx != null;
    const mod = navigator.platform?.startsWith('Mac') ? '⌘' : 'Ctrl+';
    const kbd = (k) => <span className="cm-shortcut">{mod}{k}</span>;
    const sections = [];

    // Built as a list rather than pushed as a section outright: an input node offers
    // reveal AND copy, a generated one only copy, and neither should leave an empty
    // "Image" heading behind when it has no picture yet.
    const imageItems = [];

    if (menuCtx?.type === 'image' && menuCtx.hasImage) {
      const picked = nodes.filter((n) => n.selected && n.type === 'image' && n.data?.fileName);
      const names = picked.length ? picked.map((n) => n.data.fileName) : [menuCtx.fileName];
      const many = names.length > 1 ? ` (${names.length})` : '';
      const reveal = navigator.platform?.startsWith('Mac')
        ? `Reveal in Finder${many}`
        : navigator.platform?.startsWith('Win')
          ? `Show in Explorer${many}`
          : `Show in file manager${many}`;
      imageItems.push({
        label: reveal,
        // Caught, not swallowed. The catch itself has to stay -- an unhandled
        // rejection in the browser is a console line and nothing more, which
        // is the same silence -- but throwing the message away made a failed
        // reveal look exactly like a successful one: nothing happens either
        // way. That is how a reveal that opened no window at all went four
        // days unreported (2026-08-13 to 08-17). One stable uniqueID, the
        // same reason reportSaveFailure above has one, so clicking a reveal
        // that keeps failing updates one toast instead of stacking per click.
        onClick: () =>
          revealFiles(names, project).catch((err) =>
            toast({
              body: `Could not show ${names.length > 1 ? `those ${names.length} files` : 'that file'}: ${err.message}`,
              uniqueID: 'reveal-failed',
              type: 'error',
            }),
          ),
      });
    }

    // One item per picture, so a batch of results is not silently reduced to its
    // first — the clipboard holds one image, and picking WHICH is the user's call,
    // not ours. A lone picture needs no number.
    const pictures = picturesOf(menuCtx ? nodes.find((n) => n.id === menuCtx.id) : null);
    imageItems.push(
      ...pictures.map((src, i) => ({
        label: pictures.length > 1 ? `Copy image ${i + 1} of ${pictures.length}` : 'Copy as image',
        onClick: () => copyAsImage(src),
      })),
    );

    if (imageItems.length) sections.push({ title: 'Image', items: imageItems });

    // Only the two types an @ref can resolve to — the same predicate the @ menu in
    // PromptNode offers candidates from, so what you can copy and what you can insert
    // cannot drift apart. Keyed off the right-clicked node rather than the selection:
    // a reference names ONE node, and a group of them has no single answer.
    if (menuCtx && isReferenceable(menuCtx)) {
      sections.push({
        title: 'Reference',
        items: [{ label: `Copy @${menuCtx.id}`, onClick: () => copyReference(menuCtx.id) }],
      });
    }

    // Judged by whether the action would actually DO anything, not merely by
    // whether something is selected: "Connect all" on a group that is already
    // fully wired, or on three prompts with no output among them, would be a
    // click that changes nothing and explains nothing.
    const selected = nodes.filter((n) => n.selected);
    const wouldConnect = connections({
      edges,
      sources: selectedIds(nodes, canSource),
      targets: selectedIds(nodes, canTarget),
    }).length;
    const wouldDisconnect = edges.length - dropInternal(edges, selected.map((n) => n.id)).length;

    sections.push({
      title: 'Edit',
      items: [
        { label: 'Cut', endContent: kbd('X'), isDisabled: !hasSelection, onClick: cutSelection },
        { label: 'Copy', endContent: kbd('C'), isDisabled: !hasSelection, onClick: copySelection },
        { label: 'Paste', endContent: kbd('V'), isDisabled: !nodeClipboard.current, onClick: () => pasteNodeClipboard() },
        { label: 'Connect all', isDisabled: !wouldConnect, onClick: connectSelection },
        { label: 'Disconnect all', isDisabled: !wouldDisconnect, onClick: disconnectSelection },
      ],
    });

    sections.push({
      title: 'Library',
      items: [
        // No ellipsis, even though this opens a dialog: "Add project" in the
        // project menu does the same and has none, and one convention beats two.
        { label: 'Add to library', icon: LibraryIcon, isDisabled: !hasSelection, onClick: openSavePreset },
      ],
    });

    if (!menuCtx) sections.push(...addMenuItems(() => menuPoint.current).map((s) => ({ title: s.title, items: s.items })));

    // An unavailable action is dropped, not greyed: what this menu can offer
    // depends so heavily on what is under the cursor that most of it was greyed
    // most of the time, which reads as a broken menu rather than a contextual
    // one. A section whose every item went goes with them, or it leaves a
    // heading standing over nothing.
    return sections
      .map((sec) => ({ ...sec, items: sec.items.filter((it) => !it.isDisabled) }))
      .filter((sec) => sec.items.length)
      .map((sec) => (
        <div key={sec.title}>
          <Text type="supporting" color="secondary" as="div" className="cm-section">{sec.title}</Text>
          {sec.items.map((it) => (
            <ContextMenuItem
              key={it.label}
              label={it.label}
              icon={it.icon}
              endContent={it.endContent}
              onClick={it.onClick}
            />
          ))}
        </div>
      ));
  }

  // Double-click on empty canvas: the most common node, ready to type into. Only
  // on the pane itself — double-clicking inside a node is how you select a word.
  function onCanvasDoubleClick(e) {
    if (!e.target.classList?.contains('react-flow__pane')) return;
    focusField(addNode('prompt', { text: '' }, { x: e.clientX, y: e.clientY }));
  }

  // React Flow keeps a freshly added node hidden until it has measured it, and
  // focus() does nothing inside a hidden subtree — so the first attempt lands on
  // an element that cannot take it. Retry briefly, stopping the moment it sticks.
  const focusField = useCallback((id, tries = 12) => {
    const field = canvasRef.current?.querySelector(`.react-flow__node[data-id="${id}"] textarea`);
    field?.focus();
    if (field && document.activeElement === field) return;
    if (tries > 0) setTimeout(() => focusField(id, tries - 1), 40);
  }, []);

  // Drag image/video files from Finder/Explorer onto the canvas -> reference nodes
  // at the drop point (offset a little when dropping several at once). Oversized
  // videos are skipped silently here — the node's own picker explains the cap, and
  // a drop has nowhere sane to surface an error.
  function onDrop(e) {
    const isHtml = (f) => f.type === 'text/html' || /\.html?$/i.test(f.name || '');
    const files = [...(e.dataTransfer?.files || [])].filter(
      (f) =>
        f.type.startsWith('image/') ||
        (f.type.startsWith('video/') && f.size <= MAX_VIDEO_BYTES) ||
        isHtml(f),
    );
    if (!files.length) return;
    e.preventDefault();
    const at = { x: e.clientX, y: e.clientY };
    files.forEach((file, i) => {
      // Bytes to the project folder first, then a node that names the file
      // (server/media.js); the drop point is captured now because the event is gone
      // by the time the upload answers.
      uploadFile(project, file)
        .then((saved) =>
          addNode(
            isHtml(file) ? 'page' : file.type.startsWith('video/') ? 'video' : 'image',
            isHtml(file)
              ? { fileName: file.name, file: saved.file, title: file.name.replace(/\.html?$/i, '') }
              : { fileName: saved.fileName || file.name, file: saved.file },
            { x: at.x + i * 24, y: at.y + i * 24 },
          ),
        )
        .catch((err) => toast({ body: `Could not add ${file.name}: ${err.message}`, uniqueID: 'upload-failed', type: 'error' }));
    });
  }

  // Paste anywhere on the canvas: an image becomes a reference node, text becomes
  // a prompt node. Skipped when a text field is focused so paste works normally.
  useEffect(() => {
    function onPaste(e) {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;

      // Nodes copied more recently than anything else: the marker is still on
      // the system clipboard, so this paste is ours.
      if (e.clipboardData?.getData('text') === NODE_CLIP_MARK && nodeClipboard.current) {
        e.preventDefault();
        pasteNodeClipboard(pointer.current);
        return;
      }

      const media = [...(e.clipboardData?.items || [])].find(
        (it) => it.type.startsWith('image/') || it.type.startsWith('video/'),
      );
      if (media) {
        e.preventDefault();
        const kind = media.type.startsWith('video/') ? 'video' : 'image';
        const file = media.getAsFile();
        if (!file || (kind === 'video' && file.size > MAX_VIDEO_BYTES)) return;
        const at = pointer.current;
        // A pasted screenshot has no name; give the file one so the folder reads.
        const named = file.name ? file : new File([file], `pasted-${kind}.${(file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: file.type });
        uploadFile(project, named)
          .then((saved) => {
            const fileName = saved.fileName || named.name;
            // Read the live nodes through getNodes() rather than from inside a
            // setNodes updater. This used to decide inside the updater and call
            // addNode -- itself a setNodes -- from in there, then return `ns`
            // unchanged. React bails out when an updater returns the same
            // reference, and the nested update queued during that bailed-out pass
            // went with it, so pasting an image did nothing. Only in a PRODUCTION
            // build: StrictMode runs updaters twice in dev, and the second run
            // queued the update again somewhere it survived, which is why `npm run
            // dev` looked fine while the packaged app did not. An updater must be
            // pure; this one now is.
            const chosen = getNodes().filter((n) => n.selected && n.type === kind);

            // A selected node of the same kind claims the paste: fill it instead of
            // spawning a new node, so "select the empty reference, hit paste" just
            // works.
            if (!chosen.length) {
              addNode(kind, { fileName, file: saved.file }, at);
              return;
            }
            const hit = new Set(chosen.map((n) => n.id));
            setNodes((ns) =>
              ns.map((n) =>
                hit.has(n.id)
                  ? { ...n, data: { ...n.data, fileName, file: saved.file, dataUrl: undefined, aspect: null } }
                  : n,
              ),
            );
          })
          .catch((err) => toast({ body: `Could not paste ${named.name}: ${err.message}`, uniqueID: 'upload-failed', type: 'error' }));
        return;
      }

      const text = e.clipboardData?.getData('text');
      if (text && text.trim()) {
        e.preventDefault();
        addNode('prompt', { text: text.trim() }, pointer.current);
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addNode, setNodes, getNodes]);

  // Derived at render, never stored: which edges are ignored depends on the target's
  // mode AND the selected model, so writing it onto the edges would persist a fact
  // that goes stale the moment either changes -- into graph.json, where it would be
  // read back as truth.
  const displayEdges = useMemo(() => {
    const ignored = new Set();
    for (const node of nodes) {
      if (!isOutput(node)) continue;
      const { excess } = bucketSources(nodes, edges, node.id);
      if (!excess.length) continue;
      for (const e of edges) {
        if (e.target === node.id && excess.includes(e.source)) ignored.add(e.id);
      }
    }
    return ignored.size ? edges.map((e) => (ignored.has(e.id) ? { ...e, type: 'ignored' } : e)) : edges;
  }, [nodes, edges]);

  return (
    <div
      className="app"
      onMouseMove={(e) => {
        pointer.current = { x: e.clientX, y: e.clientY };
      }}
    >
      {/* No topbar — two cards floating over the canvas corners, Figma-style. */}
      <div className="toolbar-card toolbar-card-left">
        <Logo size={28} />
        <ProjectMenu
          projects={projects}
          current={project}
          onSwitch={switchProject}
          onRename={(p) => setNameDlg({ mode: 'rename', name: p, value: p })}
          onDelete={(p) => setDeleting(p)}
          onAdd={newProject}
        />
      </div>
      <div className="toolbar-card toolbar-card-right">
        {/* The agent: a right-hand panel with the project's Canvas thread (agent/AgentPanel.jsx). */}
        <IconButton
          variant={agentOpen ? 'secondary' : 'ghost'}
          size="sm"
          label="Agent"
          tooltip="Agent: ask about the board"
          icon={<Icon icon={Sparkles} />}
          onClick={() => (agentOpen ? setAgentOpen(false) : openAgent())}
        />
        {/* A Canvas / Generation mode switch lands here — see status.md. */}
        <IconButton
          variant={cfg.hasKey ? 'ghost' : 'primary'}
          size="sm"
          label={cfg.hasKey ? 'Settings' : 'Add your API key'}
          tooltip={
            cfg.hasKey
              ? `Settings: key${cfg.keyHint ? ` …${cfg.keyHint}` : ''}, default models, output folder`
              : 'No OpenRouter key yet. Click to add one'
          }
          icon={<Icon icon={cfg.hasKey ? SettingsIcon : KeyIcon} />}
          onClick={openSettings}
        />
        {/* Will open the onboarding when it exists (status.md); the tooltip is the
            interim help. */}
        <IconButton
          variant="ghost"
          size="sm"
          label="Help"
          tooltip={HELP_TEXT}
          icon={<Icon icon="info" />}
        />
      </div>

      <ContextMenu menuContent={contextMenuContent()} menuWidth={188} size="sm">
      <div
        className="canvas"
        ref={canvasRef}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        onDoubleClick={onCanvasDoubleClick}
        // Caught on the way to the menu, which opens itself without telling its
        // items where the click was.
        onContextMenuCapture={(e) => {
          menuPoint.current = { x: e.clientX, y: e.clientY };
          const el = e.target.closest?.('.react-flow__node');
          const node = el ? nodes.find((n) => n.id === el.dataset.id) : null;
          // Right-clicking an unselected node selects it (alone), like any file
          // manager; right-clicking inside an existing selection keeps the group.
          if (node && !node.selected) {
            setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === node.id })));
          }
          flushSync(() =>
            setMenuCtx(
              node
                ? { id: node.id, type: node.type, hasImage: Boolean(node.data?.file || node.data?.dataUrl), fileName: node.data?.fileName }
                : null,
            ),
          );
        }}
      >
        <ProjectContext.Provider value={projectValue}>
        <ReactFlow
          // Keyed by canvasGeneration so a genuine project switch remounts every
          // node component. Node ids come from one counter shared across projects,
          // and React Flow keys node components by id, so without this the SAME
          // component instance is reused for a different project's node — carrying
          // status, error and the last clip (or, for image/text outputs, status,
          // results and error) with it. Not keyed by `project` itself: renaming the
          // active project changes `project` too, and remounting on a mere rename
          // while a video job is mid-poll would start a second poll loop for that
          // same job (see canvasGeneration's own comment above).
          key={canvasGeneration}
          nodes={flowNodes}
          edges={displayEdges}
          onNodesChange={handleNodesChange}
          onBeforeDelete={onBeforeDelete}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          // Shift joins Meta/Control as a multi-select modifier -- React Flow's
          // default pair is the OS one, but Shift is what every canvas tool uses.
          // React Flow itself consults it on CLICK only -- a selection box is built
          // from the rectangle's contents alone, and a press on empty canvas resets
          // regardless. `keepSelected` above is what makes both of those honour
          // whatever this names.
          multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
          // Shift is the multi-select key above, so it must NOT also be React Flow's
          // box-select key -- and 'Shift' is what that prop defaults to. When both
          // claimed it, the pane's capture-phase pointerdown listener treated every
          // shift+press as the start of a selection rectangle and killed the event
          // with stopPropagation + preventDefault before it reached the node. No
          // mousedown was produced at all, so the handler that actually selects a
          // node never ran and shift+click did nothing whatsoever. The click still
          // fired, which is why a header would flash "copied!" while the node stayed
          // unselected -- the one visible symptom that said the event was arriving
          // and the selection was being cancelled, not missed.
          // null, not another key: box-select already has selectionOnDrag below, so
          // nothing is lost. Verified with client/src/debug/trace.js.
          selectionKeyCode={null}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          minZoom={0.1}
          maxZoom={4}
          defaultEdgeOptions={{ animated: true }}
          proOptions={{ hideAttribution: true }}
          className={tool === 'pan' ? 'tool-pan' : undefined}
          // Figma-style navigation: two-finger scroll / wheel pans (shift+wheel goes
          // sideways), pinch zooms, Cmd/Ctrl+wheel zooms, space or middle-drag pans.
          // The last two are React Flow defaults (panActivationKeyCode='Space',
          // zoomActivationKeyCode=Meta on mac) so they aren't spelled out here.
          panOnScroll
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
          // select tool: drag empty canvas draws a selection box, pan with the middle
          // mouse. pan tool: drag anywhere pans, like a hand tool.
          panOnDrag={tool === 'pan' ? true : [1]}
          selectionOnDrag={tool === 'select'}
          // A node need only TOUCH the selection box, not sit entirely inside it.
          selectionMode="partial"
          onMoveStart={() => setPanning(true)}
          onMoveEnd={() => setPanning(false)}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onSelectionStart={onSelectionStart}
          onSelectionEnd={onSelectionEnd}
          // How far from a handle a release still connects, in flow pixels. React
          // Flow's default of 20 is about the size of the handle itself, which is why
          // connecting felt like it wanted a bull's-eye. The radius also applies over
          // empty canvas, so this is set where a deliberate miss still reads as a miss
          // rather than as large as it could be.
          connectionRadius={70}
        >
          <ChromeZoom />
          <CanvasBackground />
        </ReactFlow>
        </ProjectContext.Provider>
        {/* The floating toolbar over a selection, its composer, and the agent's anchored
            reply (toolbar/). Hidden while the selection is being dragged, box-selected or
            the canvas panned; back where the selection now is afterwards. */}
        <SelectionToolbar
          nodes={nodes}
          hidden={panning || boxSelecting || nodes.some((n) => n.dragging)}
          canvasEl={canvasRef.current}
          composer={composer}
          onOpenComposer={openComposer}
          onCloseComposer={closeComposer}
          provider={readyProvider}
          providerMessage={providerMessage}
          addTo={focusNode && !nodes.some((n) => n.selected && isArtifact(n)) ? focusNode.data?.title || focusNode.data?.fileName?.replace(/\.html?$/i, '') || 'artifact' : null}
          busy={reply?.status === 'running'}
          onSend={sendComposer}
          onStop={() => reply?.threadId && interruptThread(project, reply.threadId)}
          onRun={(id) => sendNodeCommand(id, 'run')}
          onOpenPage={openPage}
        />
        <AnchoredReply
          reply={reply}
          nodes={nodes}
          canvasEl={canvasRef.current}
          onDismiss={dismissReply}
          onUndo={undoReply}
          onOpenThread={(id) => openAgent(id)}
          onOpenPage={openPage}
        />
        {agentOpen && (
          <AgentPanel
            project={project}
            nodes={nodes}
            providers={providers}
            checking={providersChecking}
            onCheckProviders={() => checkProviders(true)}
            onClose={() => setAgentOpen(false)}
            initialThreadId={agentThread}
            refreshKey={threadsBump}
            onFocus={onAgentFocus}
          />
        )}

        <div className="tools">
          <IconButton
            variant={tool === 'select' ? 'primary' : 'ghost'}
            size="sm"
            label="Select"
            tooltip="Select: drag to box-select nodes"
            icon={<Icon icon={SelectIcon} />}
            onClick={() => setTool('select')}
          />
          <IconButton
            variant={tool === 'pan' ? 'primary' : 'ghost'}
            size="sm"
            label="Pan"
            tooltip="Pan: drag to move the canvas"
            icon={<Icon icon={HandIcon} />}
            onClick={() => setTool('pan')}
          />
          <div className="tools-sep" />
          <IconButton variant="ghost" size="sm" label="Zoom in" icon={<Icon icon={PlusIcon} />} onClick={() => zoomIn()} />
          <IconButton variant="ghost" size="sm" label="Zoom out" icon={<Icon icon={MinusIcon} />} onClick={() => zoomOut()} />
          <IconButton variant="ghost" size="sm" label="Fit view" icon={<Icon icon={FitIcon} />} onClick={() => fitView()} />
        </div>

        <div className="fab-library">
          <IconButton
            variant="secondary"
            size="lg"
            label="Library"
            tooltip="Ready-made flows and styles"
            icon={<Icon icon={LibraryIcon} />}
            onClick={openLibrary}
          />
        </div>
        <div className="fab">
          <DropdownMenu
            hasChevron={false}
            placement="start"
            className="add-node-menu"
            menuWidth={152}
            items={addMenuItems()}
            button={{
              label: 'Add node',
              isIconOnly: true,
              icon: <Icon icon={PlusIcon} />,
              variant: 'primary',
              size: 'lg',
            }}
          />
        </div>
      </div>
      </ContextMenu>

      <LibraryDialog
        isOpen={libraryOpen}
        onOpenChange={setLibraryOpen}
        userPresets={userPresets}
        onAdd={insertPreset}
        onDelete={setDeletingPreset}
      />

      <Dialog
        isOpen={!!savePresetDlg}
        onOpenChange={(open) => !open && setSavePresetDlg(null)}
        purpose="form"
        width={360}
      >
        <DialogHeader
          title="Add to library"
          subtitle={
            savePresetDlg
              ? `${savePresetDlg.fragment.nodes.length} node${savePresetDlg.fragment.nodes.length > 1 ? 's' : ''}, saved as you have them now.`
              : undefined
          }
        />
        <VStack gap={3} padding={4}>
          <TextInput
            label="Name"
            hasAutoFocus
            placeholder="e.g. Portrait retouch"
            value={savePresetDlg?.name ?? ''}
            status={savePresetDlg?.error ? { type: 'error', message: savePresetDlg.error } : undefined}
            onChange={(v) => setSavePresetDlg((d) => ({ ...d, name: v, error: undefined }))}
          />
          <TextInput
            label="Description"
            placeholder="What it does, in a line"
            value={savePresetDlg?.summary ?? ''}
            onChange={(v) => setSavePresetDlg((d) => ({ ...d, summary: v }))}
          />
          <HStack gap={2} justify="end">
            <Button label="Cancel" variant="ghost" onClick={() => setSavePresetDlg(null)} />
            <Button label="Save" variant="primary" onClick={confirmSavePreset} />
          </HStack>
        </VStack>
      </Dialog>

      <AlertDialog
        isOpen={!!deletingPreset}
        onOpenChange={(open) => !open && setDeletingPreset(null)}
        title="Delete preset?"
        description={`This removes “${deletingPreset?.name}” from your library. Nodes already on the canvas are untouched. This can't be undone.`}
        actionLabel="Delete preset"
        onAction={confirmDeletePreset}
      />

      <Dialog
        isOpen={!!cfgDlg}
        onOpenChange={(open) => !open && setCfgDlg(null)}
        purpose="form"
        width={480}
      >
        <DialogHeader
          title={cfg.hasKey ? 'Settings' : 'Connect OpenRouter to start'}
        />
        {/* Two regions, not one: the form scrolls, the buttons do not. Dialog caps
            itself at 75vh and its wrapper hides the overflow, so on a short window
            (a small laptop, or the app resized) everything past the cap was simply
            cut off -- with Save among the casualties, leaving no way to finish.
            minHeight 0 is what actually lets the scroller shrink: a flex item's
            default min-height is auto, which refuses to go below its content and
            hands the overflow back to the clipped parent. */}
        <VStack gap={3} padding={4} style={{ minHeight: 0 }}>
          <VStack gap={3} style={{ overflowY: 'auto', minHeight: 0 }}>
          {!cfg.hasKey && !connecting && (
            <VStack gap={2}>
              <Text type="supporting" as="p">
                Unframed has no image model of its own. It sends your prompts to{' '}
                <Link href="https://openrouter.ai" isExternalLink>
                  OpenRouter
                </Link>
                , which runs the model and bills your OpenRouter account per image (a few cents for
                most models). Connecting takes you there to approve Unframed; the key it gives back
                is saved on this machine and used only by your local server.
              </Text>
              <Button label="Connect OpenRouter" variant="primary" onClick={connectOpenRouter} />
            </VStack>
          )}
          {connecting && (
            <VStack gap={2}>
              <Text type="supporting" as="p">
                Waiting for OpenRouter in your browser…
              </Text>
              {/* A real link, not the URL in a read-only field. Popups can be
                  blocked outright, and this is the whole recovery path when they
                  are — a 200-character URL to select by hand out of a one-line
                  input was the worst possible thing to offer there. Permanent
                  rather than a reaction to a failed open, because whether the tab
                  opened cannot be detected (see connectOpenRouter). */}
              <Text type="supporting" as="p">
                Didn't open?{' '}
                <Link href={connecting.url} isExternalLink>
                  Approve Unframed at OpenRouter
                </Link>
                .
              </Text>
              <Button label="Cancel" variant="ghost" onClick={cancelConnect} />
            </VStack>
          )}
          {!cfg.hasKey && !showPaste && (
            <Button
              label="or paste a key instead"
              variant="ghost"
              onClick={() => setShowPaste(true)}
            />
          )}
          {/* Three sections, one heading style each, dividers between. The field
              labels themselves are hidden where the heading already names the
              field, but stay in the DOM for screen readers.
              
              Visible during a pending connect, which it was not: the spec's own
              failure table promises the paste fallback for "browser never opens",
              and that is the one case where it used to disappear. It was hidden
              because saving a pasted key changed keyHint, which the poll read as
              the browser approval landing; the poll asks the server now, so the
              two paths no longer collide. Saving here cancels a pending attempt
              server-side, so an approval that lands afterwards is refused rather
              than quietly replacing the key you typed -- the same reasoning, and
              the same one-line cancel, that Remove key already had. */}
          {(cfg.hasKey || showPaste) && (
          <VStack gap={2}>
            {/* Named for the account once there is one: with a key saved this
                section is about the connection, and the key is one field in it. */}
            <Text type="label">{cfg.hasKey ? 'OpenRouter' : 'API key'}</Text>
            {/* Remove sits next to the field it acts on, like Browse… does for the
                folder below. */}
            <HStack gap={2} align="center">
              {/* size="fill" so the field takes the row and the button keeps its
                  natural width — inside an HStack an input sizes to content. */}
              <StackItem size="fill">
              <TextInput
                label="API key"
                isLabelHidden
                type="password"
                hasAutoFocus
                placeholder="sk-or-v1-…"
                value={cfgDlg?.key ?? ''}
                // Only key-specific states live on this field; a save result can come
                // from any of the settings below, so it gets its own line by the buttons.
                status={
                  cfgDlg?.removed
                    ? { type: 'warning', message: 'Key removed. Generate is disabled until you add one.' }
                    : cfgDlg?.confirmRemove
                      ? {
                          type: 'warning',
                          message:
                            'This deletes the key from .env. You will need to paste it again, or make a new one at openrouter.ai/keys.',
                        }
                      : undefined
                }
                onChange={(v) =>
                  setCfgDlg((d) => ({
                    ...d,
                    key: v,
                    error: undefined,
                    saved: false,
                    removed: false,
                    confirmRemove: false,
                  }))
                }
              />
              </StackItem>
              {cfg.hasKey && (
                <Button
                  label={cfgDlg?.confirmRemove ? 'Yes, remove it' : 'Remove key'}
                  variant={cfgDlg?.confirmRemove ? 'destructive' : 'ghost'}
                  isDisabled={cfgDlg?.saving}
                  onClick={removeKey}
                />
              )}
            </HStack>
            {orStatus?.revoked ? (
              // Hidden while a reconnect is already live -- its own waiting block
              // above already covers this, and a second click here would call
              // startOauth() again and clear the pending attempt out from under
              // an approval that's already on its way back.
              !connecting && (
                <VStack gap={2}>
                  <Text type="supporting" as="p">
                    This key no longer works at OpenRouter — it may have been deleted or disabled
                    there.
                  </Text>
                  <Button label="Reconnect OpenRouter" variant="primary" onClick={connectOpenRouter} />
                </VStack>
              )
            ) : orStatus?.hasKey ? (
              <VStack gap={2}>
                {/* Free tier and spend are mutually exclusive, not stacked: with
                    no credit bought, what the key has spent against its cap is
                    noise in front of the one thing that has to happen next. The
                    key's own NAME is in neither branch because it is not
                    reachable -- see the route's comment in server/index.js. */}
                {orStatus.isFreeTier ? (
                  <Text type="supporting" as="p">
                    You have not bought any credit yet, so generating will fail. Add some under{' '}
                    <Link href="https://openrouter.ai/credits" isExternalLink>
                      Credits
                    </Link>
                    .
                  </Text>
                ) : (
                  <Text type="supporting" as="p">
                    {`Connected to OpenRouter. $${orStatus.usage.toFixed(2)} spent with this key`}
                    {orStatus.limit != null
                      ? `, of a $${orStatus.limit.toFixed(2)} cap${
                          orStatus.limitRemaining != null
                            ? ` — $${orStatus.limitRemaining.toFixed(2)} still available`
                            : ''
                        }`
                      : ''}
                    .
                  </Text>
                )}
                {expiryNote(orStatus.expiresAt) && (
                  <Text type="supporting" as="p">
                    {expiryNote(orStatus.expiresAt)}
                  </Text>
                )}
              </VStack>
            ) : (
              <Text type="supporting" as="p">
                {cfg.hasKey ? (
                  `A key is already saved${cfg.keyHint ? ` (…${cfg.keyHint})` : ''}. Entering a new one replaces it.`
                ) : (
                  // Whoever is reading this is whoever Connect did not work for, so
                  // the manual route has to be complete on its own: where the key
                  // comes from, not just what it looks like.
                  <>
                    Make a key at{' '}
                    <Link href="https://openrouter.ai/keys" isExternalLink>
                      openrouter.ai/keys
                    </Link>{' '}
                    and paste it here. It starts with sk-or-.
                  </>
                )}
              </Text>
            )}
          </VStack>
          )}

          {/* Everything below needs a key to be worth showing. The catalogues are
              fetched from OpenRouter WITH the key, so before there is one the three
              pickers can only say "Loading models…" forever — and the folder field
              is a detail nobody setting up for the first time is here for. Saving
              the first key closes the dialog (saveSettings), so the full form is one
              reopen away rather than hidden for good. */}
          {cfg.hasKey && (
          <>
          <Divider />

          {/* Defaults, not locks: every node keeps its own model picker, and these
              are what a fresh one starts on. */}
          <VStack gap={2}>
            <Text type="label">Default models</Text>
            {[
              { field: 'imageModel', type: 'image', label: 'Image' },
              { field: 'textModel', type: 'text', label: 'Text' },
              { field: 'videoModel', type: 'video', label: 'Video' },
            ].map(({ field, type, label }) => (
              <Selector
                key={field}
                label={label}
                hasSearch
                options={(catalogues[type] || [{ id: cfgDlg?.[field] }])
                  .filter((m) => m.id)
                  .map((m) => ({ value: m.id, label: m.id }))}
                value={cfgDlg?.[field] ?? ''}
                placeholder={catalogues[type] ? 'Pick a model' : 'Loading models…'}
                onChange={(v) =>
                  setCfgDlg((d) => ({ ...d, [field]: v, error: undefined, saved: false }))
                }
              />
            ))}
          </VStack>

          <Divider />

          <VStack gap={2}>
            <Text type="label">Output folder</Text>
            <HStack gap={2} align="center">
              <StackItem size="fill">
              <TextInput
                label="Output folder"
                isLabelHidden
                placeholder="./output"
                value={cfgDlg?.outputDir ?? ''}
                onChange={(v) =>
                  setCfgDlg((d) => ({ ...d, outputDir: v, error: undefined, saved: false }))
                }
              />
              </StackItem>
              <Button
                label="Browse…"
                variant="secondary"
                icon={<Icon icon={FolderIcon} />}
                onClick={browseFolder}
              />
            </HStack>
          </VStack>

          <Divider />

          {/* The local agent CLIs. Detection is the server's (GET /api/providers); this
              only shows what it found and lets a binary be pointed at when PATH does
              not find it. A run route never takes a path -- only this setting does. */}
          <VStack gap={2}>
            <HStack gap={2} align="center">
              <Text type="label">Local agents</Text>
              <StackItem size="fill" />
              <Button
                label="Check again"
                variant="ghost"
                size="sm"
                isLoading={providersChecking}
                onClick={() => checkProviders(true)}
              />
            </HStack>
            <Text type="supporting">
              Claude Code or Codex installed and signed in on this Mac lets the agent run on your own plan. Nothing here is sent to OpenRouter.
            </Text>
            {[
              { kind: 'claude', field: 'claudePath', label: 'Claude', placeholder: 'claude (found on PATH)' },
              { kind: 'codex', field: 'codexPath', label: 'Codex', placeholder: 'codex (found on PATH)' },
            ].map(({ kind, field, label, placeholder }) => {
              const p = providers?.[kind];
              const tone = p?.status === 'ready' ? 'ok' : p ? 'warn' : 'unknown';
              return (
                <VStack key={kind} gap={1}>
                  <HStack gap={2} align="center" wrap>
                    <span className={`provider-dot provider-dot-${tone}`} />
                    <Text weight="medium">{label}</Text>
                    <Text type="supporting">
                      {!p
                        ? providersChecking
                          ? 'checking…'
                          : 'not checked yet'
                        : p.status === 'ready'
                          ? `ready${p.version ? ` · ${p.version}` : ''}${p.auth?.plan ? ` · ${p.auth.plan}` : ''}${p.auth?.email ? ` · ${p.auth.email}` : ''}`
                          : p.message}
                    </Text>
                    {p?.install && p.status === 'not_installed' && (
                      <Link href={p.install} target="_blank" rel="noreferrer">
                        How to install
                      </Link>
                    )}
                  </HStack>
                  <TextInput
                    label={`${label} command or path`}
                    isLabelHidden
                    placeholder={placeholder}
                    value={cfgDlg?.[field] ?? ''}
                    onChange={(v) => setCfgDlg((d) => ({ ...d, [field]: v, error: undefined, saved: false }))}
                  />
                </VStack>
              );
            })}
            <TextInput
              label="Claude config folder (optional)"
              placeholder="Leave empty for the default ~/.claude"
              value={cfgDlg?.claudeConfigDir ?? ''}
              onChange={(v) => setCfgDlg((d) => ({ ...d, claudeConfigDir: v, error: undefined, saved: false }))}
            />
          </VStack>
          </>
          )}
          </VStack>

          {(cfgDlg?.error || cfgDlg?.saved) && (
            <Banner
              status={cfgDlg.error ? 'error' : 'success'}
              title={cfgDlg.error || 'Saved to .env'}
              description={cfgDlg.error ? undefined : 'Applied right away, no restart needed.'}
            />
          )}

          <HStack gap={2} justify="end">
            <Button label="Close" variant="ghost" onClick={() => setCfgDlg(null)} />
            {/* Nothing to save until something saveable is on screen. Keyless,
                that is the key field alone, and it isn't shown until an existing
                key or "or paste a key instead" reveals it. With a key, Default
                models and Output folder stay rendered and editable through a
                reconnect, so Save has to stay too; gating it on !connecting left
                those edits with no way out. */}
            {(cfg.hasKey || showPaste) && (
              <Button
                label="Save"
                variant="primary"
                isDisabled={cfgDlg?.saving}
                isLoading={cfgDlg?.saving}
                onClick={saveSettings}
              />
            )}
          </HStack>
        </VStack>
      </Dialog>

      <Dialog
        isOpen={!!nameDlg}
        onOpenChange={(open) => !open && setNameDlg(null)}
        purpose="form"
        width={360}
      >
        <DialogHeader title={nameDlg?.mode === 'create' ? 'New project' : 'Rename project'} />
        <VStack gap={3} padding={4}>
          <TextInput
            label="Project name"
            hasAutoFocus
            placeholder="e.g. product-shots"
            value={nameDlg?.value ?? ''}
            status={nameDlg?.error ? { type: 'error', message: nameDlg.error } : undefined}
            onChange={(v) => setNameDlg((d) => ({ ...d, value: v, error: undefined }))}
            // Enter submits, the way a one-field dialog is expected to. Nothing
            // else here does: the dialog is not a <form>, so the button was the
            // only way through. Routed to confirmName rather than to the button
            // so both paths hit the same validation -- an empty or duplicate name
            // still stops with its message instead of closing on the keystroke.
            onEnter={confirmName}
          />
          <HStack gap={2} justify="end">
            <Button label="Cancel" variant="ghost" onClick={() => setNameDlg(null)} />
            <Button
              label={nameDlg?.mode === 'create' ? 'Create' : 'Rename'}
              variant="primary"
              onClick={confirmName}
            />
          </HStack>
        </VStack>
      </Dialog>

      <AlertDialog
        isOpen={!!deleteBusy}
        onOpenChange={(open) => !open && setDeleteBusy(null)}
        title="The agent is working on this page"
        description={`${deleteBusy?.threads.length === 1 ? 'A thread is' : `${deleteBusy?.threads.length ?? 0} threads are`} mid-turn on ${deleteBusy?.nodes.filter(isArtifact).length === 1 ? 'this page' : 'these pages'}. Deleting stops the turn. The delete itself can be undone; the interrupted turn cannot be resumed.`}
        actionLabel="Stop and delete"
        onAction={confirmDeleteBusy}
      />

      <AlertDialog
        isOpen={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete project?"
        description={`This permanently removes “${deleting}” and its generated images. This can't be undone.`}
        actionLabel="Delete project"
        onAction={confirmDelete}
      />

      <AlertDialog
        isOpen={!!deleteRenders}
        onOpenChange={(open) => !open && setDeleteRenders(null)}
        title="Stop renders and delete?"
        description={`This stops tracking ${deleteRenders?.count} video render${deleteRenders?.count === 1 ? '' : 's'}. They may still complete upstream, but their results will not be saved here.`}
        actionLabel="Stop renders and delete"
        onAction={confirmDeleteWithRenders}
      />
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}


