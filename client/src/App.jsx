import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  addEdge,
  useNodesState,
  useEdgesState,
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
} from 'lucide-react';
import Logo from './Logo.jsx';
import PromptNode from './nodes/PromptNode.jsx';
import ImageNode from './nodes/ImageNode.jsx';
import VideoNode, { MAX_VIDEO_BYTES } from './nodes/VideoNode.jsx';
import OutputNode from './nodes/OutputNode.jsx';
import TextNode from './nodes/TextNode.jsx';
import ProjectMenu from './ProjectMenu.jsx';
import { PromptIcon, ImageIcon, VideoIcon, OutputIcon, TextIcon } from './nodes/nodeIcons.jsx';
import LibraryDialog from './library/LibraryDialog.jsx';
import { instantiateFragment, centerOffset } from './library/insert.js';
import {
  setProject,
  listProjects,
  loadProject,
  saveProject,
  renameProject,
  deleteProject,
  getHealth,
  saveConfig,
  clearKey,
  pickFolder,
  listModels,
  revealFiles,
} from './api.js';

const nodeTypes = { prompt: PromptNode, image: ImageNode, video: VideoNode, output: OutputNode, text: TextNode };

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

// Dated, not a boolean: the nudge should come back tomorrow, not never again.
const UPDATE_NUDGE_KEY = 'unframed:update-nudge';
const UPDATE_COMMAND = 'git pull && npm run install:all';

const HELP_TEXT =
  'Reference a prompt or text node with @id. Connect images to number them, then type “image 1”.';

// React Flow drags a node only from this handle, so the inputs inside stay usable.
// nowheel = "the wheel belongs to whatever is under the cursor, not the canvas".
// Prompts need it for long text. Output nodes need it too: the model Selector renders
// its scrollable list *inside* the node, so without nowheel React Flow swallows the
// wheel and pans instead of scrolling the list. Reference nodes hold nothing
// scrollable, so they keep scroll-to-pan.
const DRAG = '.xnode-head';
// Both keys are derived, so they go after the spread — a className saved into an
// older graph must not stick around and shadow the current rule.
const withDrag = (n) => ({
  ...n,
  dragHandle: DRAG,
  className: n.type === 'image' ? undefined : 'nowheel',
});

let counter = 100;
const nextId = () => String(counter++);
// ponytail: keep counter-issued ids from colliding with ids in a loaded graph,
// since ids are now reference keys.
const bumpCounter = (nodes) => {
  counter = Math.max(counter, ...nodes.map((n) => parseInt(n.id, 10)).filter(Number.isFinite)) + 1;
};

// Same rule as the server's slugify, so the name the client tracks matches the
// folder the server writes. ponytail: kept in sync by hand; two call sites.
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40);

// A small starter graph that demonstrates the @id reference: the scene prompt
// embeds the subject prompt. The ids come from the same counter every other node
// draws from, so a starter node looks like one you added yourself — hand-written
// ids like "p-scene" implied a naming scheme the app doesn't actually have.
const SCENE_ID = nextId();
const SUBJECT_ID = nextId();
const OUTPUT_ID = nextId();

const initialNodes = [
  {
    id: SCENE_ID,
    type: 'prompt',
    position: { x: 40, y: 60 },
    data: { text: `A @${SUBJECT_ID} on a windswept cliff at golden hour, cinematic, 35mm` },
  },
  {
    id: SUBJECT_ID,
    type: 'prompt',
    position: { x: 40, y: 320 },
    data: { text: 'lone red fox' },
  },
  {
    id: OUTPUT_ID,
    type: 'output',
    position: { x: 460, y: 120 },
    data: { resolution: '1K', quality: 'low', aspect_ratio: '1:1', runs: 1 },
  },
].map(withDrag);

const initialEdges = [{ id: `e-${SCENE_ID}`, source: SCENE_ID, target: OUTPUT_ID }];

function Canvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const { screenToFlowPosition, zoomIn, zoomOut, fitView } = useReactFlow();
  const toast = useToast();
  const [tool, setTool] = useState('select'); // 'select' | 'pan'
  // Last pointer position over the canvas, so pasted nodes land where you're looking.
  const pointer = useRef({ x: 200, y: 200 });
  const canvasRef = useRef(null);

  const [projects, setProjects] = useState(['default']);
  const [project, setCurrent] = useState('default');
  // In-app dialogs (native prompt/confirm get silently suppressed in some browsers).
  // nameDlg drives both "rename" and "create" via one name-entry dialog.
  const [nameDlg, setNameDlg] = useState(null); // { mode:'rename'|'create', name, value, error } | null
  const [deleting, setDeleting] = useState(null); // project name | null
  const [libraryOpen, setLibraryOpen] = useState(false);
  // Settings dialog. cfg mirrors what the server has on disk; cfgDlg is the open
  // dialog's draft, so nothing is applied until Save.
  const [cfg, setCfg] = useState({ hasKey: true, keyHint: '', imageModel: '', textModel: '', videoModel: '', outputDir: '' });
  const [cfgDlg, setCfgDlg] = useState(null); // { key, imageModel, …, error, saving, saved } | null
  // The three model catalogues, for the pickers. { image: [...], text: [...], video: [...] }
  const [catalogues, setCatalogues] = useState({});
  // Gate auto-save until the initial load finishes, so we don't overwrite a saved
  // project with the starter graph on first render.
  const ready = useRef(false);

  useEffect(() => {
    (async () => {
      const list = await listProjects();
      const current = list[0] || 'default';
      const g = await loadProject(current);
      if (g?.nodes) {
        setNodes(g.nodes.map(withDrag));
        setEdges(g.edges || []);
        bumpCounter(g.nodes);
      }
      setProjects(list.length ? list : [current]);
      setCurrent(current);
      setProject(current);
      ready.current = true;
    })();
  }, [setNodes, setEdges]);

  useEffect(() => {
    if (!ready.current) return;
    const t = setTimeout(() => saveProject(project, { nodes, edges }), 500);
    return () => clearTimeout(t);
  }, [nodes, edges, project]);

  // ---- undo / redo ----
  // A stack of settled graph states with a cursor, rather than one entry per
  // change: a drag emits a state per pixel and typing one per keystroke, so
  // recording every change would make undo a frame-by-frame rewind. The 400ms
  // pause is the unit of work — one drag, one word, one delete.
  //
  // Entries hold the arrays as they are, no deep copy: React Flow replaces them
  // on every change instead of mutating, and a project's nodes can carry megabytes
  // of base64 image data that would be ruinous to clone (or to compare with
  // JSON.stringify) several times a minute.
  const history = useRef({ stack: [], at: -1 });
  const restoring = useRef(false);

  useEffect(() => {
    if (!ready.current) return;
    const t = setTimeout(() => {
      // An undo/redo applied its own state; recording it would bury the entry we
      // just moved off, and the next undo would land back where we started.
      if (restoring.current) {
        restoring.current = false;
        return;
      }
      const h = history.current;
      const current = h.stack[h.at];
      if (current && current.nodes === nodes && current.edges === edges) return;
      h.stack = h.stack.slice(0, h.at + 1);
      h.stack.push({ nodes, edges });
      // Far more than anyone reaches for, and cheap: entries share the node
      // objects they point at.
      if (h.stack.length > 100) h.stack.shift();
      h.at = h.stack.length - 1;
    }, 400);
    return () => clearTimeout(t);
  }, [nodes, edges]);

  // Switching projects starts a new timeline: undoing across a switch would paste
  // one project's graph into another.
  useEffect(() => {
    history.current = { stack: [], at: -1 };
  }, [project]);

  useEffect(() => {
    function onKeyDown(e) {
      const undo = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z';
      const redoY = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y';
      if (!undo && !redoY) return;
      // Inside a text field the browser's own undo is the right one: it steps
      // through what you typed, and stealing it would rewind the whole canvas
      // mid-sentence.
      const el = e.target;
      const typing =
        el instanceof HTMLElement &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing) return;

      const h = history.current;
      const forward = redoY || e.shiftKey;
      const to = forward ? h.at + 1 : h.at - 1;
      if (to < 0 || to >= h.stack.length) return;
      e.preventDefault();
      h.at = to;
      restoring.current = true;
      setNodes(h.stack[to].nodes);
      setEdges(h.stack[to].edges);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setNodes, setEdges]);

  // This runs from a clone, so nothing tells you a fix landed upstream. A nudge,
  // not a version check: once a day rather than every load, since a dev session
  // reloads this page constantly and a toast on each one is just noise.
  // ponytail: no `git fetch` behind it — add one server-side if "you are N commits
  // behind" turns out to be worth the network call on every boot.
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem(UPDATE_NUDGE_KEY) === today) return;
    localStorage.setItem(UPDATE_NUDGE_KEY, today);
    toast({
      // The button sits in the body, under the text, rather than in endContent —
      // that slot only renders trailing, beside the message.
      body: (
        <VStack gap={1.5} align="start">
          <VStack gap={0.5}>
            <Text type="label">Update Unframed</Text>
            <Text type="supporting">Run {UPDATE_COMMAND} to pick up fixes.</Text>
          </VStack>
          <Button
            label="Copy command"
            variant="secondary"
            size="sm"
            onClick={() => {
              navigator.clipboard?.writeText(UPDATE_COMMAND);
              toast({ body: 'Copied. Paste it in a terminal at the repo root.', uniqueID: 'update-nudge' });
            }}
          />
        </VStack>
      ),
      uniqueID: 'update-nudge',
      // Longer than the 5s default: this lands while the canvas is still drawing,
      // and a reminder nobody reads is not a reminder.
      autoHideDuration: 10000,
    });
  }, [toast]);

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

  // Open with the saved values as the draft, so the pickers show what is in use.
  function openSettings() {
    setCfgDlg({
      key: '',
      imageModel: cfg.imageModel,
      textModel: cfg.textModel,
      videoModel: cfg.videoModel,
      outputDir: cfg.outputDir,
    });
    // The catalogues are cached in api.js, so reopening the dialog costs nothing.
    if (!catalogues.image) {
      ['image', 'text', 'video'].forEach((type) =>
        listModels(type).then((d) => setCatalogues((c) => ({ ...c, [type]: d.models || [] }))),
      );
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
    if (!Object.keys(fields).length) return setCfgDlg(null);

    setCfgDlg((s) => ({ ...s, saving: true, error: undefined }));
    try {
      const r = await saveConfig(fields);
      setCfg((c) => ({ ...c, ...r }));
      setCfgDlg((s) => ({ ...s, key: '', saving: false, saved: true }));
    } catch (err) {
      setCfgDlg((s) => ({ ...s, saving: false, error: err.message }));
    }
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
      setCfgDlg((d) => ({ ...d, key: '', saving: false, confirmRemove: false, removed: true }));
    } catch (err) {
      setCfgDlg((d) => ({ ...d, saving: false, confirmRemove: false, error: err.message }));
    }
  }

  async function switchProject(name) {
    if (name === project) return;
    ready.current = false;
    const g = await loadProject(name);
    const loaded = g?.nodes || initialNodes;
    setNodes(loaded.map(withDrag));
    setEdges(g?.nodes ? g.edges || [] : initialEdges);
    bumpCounter(loaded);
    setCurrent(name);
    setProject(name);
    // A timeout, not requestAnimationFrame: rAF never fires in a hidden tab, so a
    // switch made while backgrounded left autosave off for the rest of the session
    // and silently dropped every edit after it.
    setTimeout(() => {
      ready.current = true;
    }, 0);
  }

  // Switch to a fresh in-memory project seeded with the starter graph. It only
  // gets a folder on disk once something is edited (auto-save).
  function openFresh(name) {
    ready.current = false;
    setNodes(initialNodes);
    setEdges(initialEdges);
    setCurrent(name);
    setProject(name);
    // A timeout, not requestAnimationFrame: rAF never fires in a hidden tab, so a
    // switch made while backgrounded left autosave off for the rest of the session
    // and silently dropped every edit after it.
    setTimeout(() => {
      ready.current = true;
    }, 0);
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
      openFresh(s);
      // Persist immediately so the project exists on disk (survives reload, can be
      // renamed right away) instead of only after the first edit.
      saveProject(s, { nodes: initialNodes, edges: initialEdges });
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
      setCurrent(s);
      setProject(s);
    }
    setNameDlg(null);
  }

  async function confirmDelete() {
    const name = deleting;
    await deleteProject(name);
    const rest = projects.filter((p) => p !== name);
    setProjects(rest.length ? rest : ['default']);
    if (project === name) {
      if (rest.length) switchProject(rest[0]);
      else openFresh('default');
    }
    setDeleting(null);
  }

  const onConnect = useCallback(
    (conn) => {
      // Text nodes have both handles, so without this a node could wire into
      // itself and silently self-amplify its own prompt on every run.
      if (conn.source === conn.target) return;
      setEdges((eds) => addEdge(conn, eds));
    },
    [setEdges],
  );

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

  const addPrompt = () => addNode('prompt', { text: '' });
  const addImage = () => addNode('image', { fileName: '', dataUrl: '' });
  const addOutput = () => addNode('output', { resolution: '1K', quality: 'low', aspect_ratio: '1:1' });
  const addText = () => addNode('text', { text: '', result: '' });

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
        { label: 'Prompt', icon: PromptIcon, onClick: () => addNode('prompt', { text: '' }, at?.()) },
        { label: 'Image', icon: ImageIcon, onClick: () => addNode('image', { fileName: '', dataUrl: '' }, at?.()) },
        { label: 'Video', icon: VideoIcon, onClick: () => addNode('video', { fileName: '', dataUrl: '' }, at?.()) },
      ],
    },
    {
      type: 'section',
      title: 'Outputs',
      items: [
        {
          label: 'Output',
          icon: OutputIcon,
          onClick: () => addNode('output', { resolution: '1K', quality: 'low', aspect_ratio: '1:1' }, at?.()),
        },
        { label: 'Text', icon: TextIcon, onClick: () => addNode('text', { text: '', result: '' }, at?.()) },
      ],
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
    const chosen = nodes.filter((n) => n.selected);
    if (!chosen.length) return;
    const ids = new Set(chosen.map((n) => n.id));
    nodeClipboard.current = {
      nodes: chosen.map((n) => ({ ...n, selected: undefined })),
      // Only edges fully inside the selection: half an edge is not a thing.
      edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
    };
    // One clipboard item, two faces. The text face is the routing marker that
    // makes our own ⌘V paste nodes; the image face is the picture itself when
    // exactly one image node is copied, so the same Copy pastes into Figma or
    // anywhere else as a real PNG. Promise values keep the write inside the
    // user gesture while the re-encode runs.
    const faces = { 'text/plain': new Blob([NODE_CLIP_MARK], { type: 'text/plain' }) };
    const pics = chosen.filter((n) => n.type === 'image' && n.data?.dataUrl);
    if (pics.length === 1) faces['image/png'] = pngBlob(pics[0].data.dataUrl);
    navigator.clipboard?.write([new ClipboardItem(faces)]).catch(() => {});
  }

  function cutSelection() {
    copySelection();
    const ids = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
    if (!ids.size) return;
    setNodes((ns) => ns.filter((n) => !ids.has(n.id)));
    setEdges((es) => es.filter((e) => !ids.has(e.source) && !ids.has(e.target)));
  }

  // Same machinery as inserting a preset: fresh ids, @token rewrite, centred on
  // the right-click point — so pasted prompts keep referencing their co-pasted
  // neighbours instead of the originals.
  function pasteNodeClipboard(at) {
    const clip = nodeClipboard.current;
    if (!clip?.nodes.length) return;
    const { nodes: fresh, edges: freshEdges } = instantiateFragment(clip, nextId);
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

    if (menuCtx?.type === 'image' && menuCtx.hasImage) {
      const picked = nodes.filter((n) => n.selected && n.type === 'image' && n.data?.fileName);
      const names = picked.length ? picked.map((n) => n.data.fileName) : [menuCtx.fileName];
      const many = names.length > 1 ? ` (${names.length})` : '';
      const reveal = navigator.platform?.startsWith('Mac')
        ? `Reveal in Finder${many}`
        : navigator.platform?.startsWith('Win')
          ? `Show in Explorer${many}`
          : `Show in file manager${many}`;
      sections.push({
        title: 'Image',
        items: [{ label: reveal, onClick: () => revealFiles(names).catch(() => {}) }],
      });
    }

    sections.push({
      title: 'Edit',
      items: [
        { label: 'Cut', endContent: kbd('X'), isDisabled: !hasSelection, onClick: cutSelection },
        { label: 'Copy', endContent: kbd('C'), isDisabled: !hasSelection, onClick: copySelection },
        { label: 'Paste', endContent: kbd('V'), isDisabled: !nodeClipboard.current, onClick: () => pasteNodeClipboard() },
      ],
    });

    if (!menuCtx) sections.push(...addMenuItems(() => menuPoint.current).map((s) => ({ title: s.title, items: s.items })));

    return sections.map((sec) => (
      <div key={sec.title}>
        <Text type="supporting" color="secondary" as="div" className="cm-section">{sec.title}</Text>
        {sec.items.map((it) => (
          <ContextMenuItem
            key={it.label}
            label={it.label}
            icon={it.icon}
            endContent={it.endContent}
            isDisabled={it.isDisabled}
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
    const files = [...(e.dataTransfer?.files || [])].filter(
      (f) =>
        f.type.startsWith('image/') ||
        (f.type.startsWith('video/') && f.size <= MAX_VIDEO_BYTES),
    );
    if (!files.length) return;
    e.preventDefault();
    files.forEach((file, i) => {
      const reader = new FileReader();
      reader.onload = () =>
        addNode(
          file.type.startsWith('video/') ? 'video' : 'image',
          { fileName: file.name, dataUrl: reader.result },
          { x: e.clientX + i * 24, y: e.clientY + i * 24 },
        );
      reader.readAsDataURL(file);
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
        if (kind === 'video' && file && file.size > MAX_VIDEO_BYTES) return;
        const reader = new FileReader();
        reader.onload = () =>
          setNodes((ns) => {
            // A selected node of the same kind claims the paste: fill it instead of
            // spawning a new node, so "select the empty reference, hit paste" just
            // works.
            const chosen = ns.filter((n) => n.selected && n.type === kind);
            if (!chosen.length) {
              addNode(kind, { fileName: file?.name || `pasted-${kind}`, dataUrl: reader.result }, pointer.current);
              return ns;
            }
            const hit = new Set(chosen.map((n) => n.id));
            return ns.map((n) =>
              hit.has(n.id)
                ? { ...n, data: { ...n.data, fileName: file?.name || `pasted-${kind}`, dataUrl: reader.result, aspect: null } }
                : n,
            );
          });
        reader.readAsDataURL(file);
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
  }, [addNode, setNodes]);

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
        {/* A Canvas / Generation mode switch lands here — see status.md. */}
        <IconButton
          variant={cfg.hasKey ? 'ghost' : 'primary'}
          size="sm"
          label={cfg.hasKey ? 'Settings' : 'Add your API key'}
          tooltip={
            cfg.hasKey
              ? `Settings — key${cfg.keyHint ? ` …${cfg.keyHint}` : ''}, default models, output folder`
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
                ? { id: node.id, type: node.type, hasImage: Boolean(node.data?.dataUrl), fileName: node.data?.fileName }
                : null,
            ),
          );
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.3}
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
        >
          <Background gap={26} size={1} color="var(--color-border)" />
        </ReactFlow>

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
            onClick={() => setLibraryOpen(true)}
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

      <LibraryDialog isOpen={libraryOpen} onOpenChange={setLibraryOpen} onAdd={insertPreset} />

      <Dialog
        isOpen={!!cfgDlg}
        onOpenChange={(open) => !open && setCfgDlg(null)}
        purpose="form"
        width={480}
      >
        <DialogHeader
          title={cfg.hasKey ? 'Settings' : 'Add your OpenRouter key to start'}
        />
        <VStack gap={3} padding={4}>
          {!cfg.hasKey && (
            <VStack gap={2}>
              <Text type="supporting" as="p">
                Unframed has no image model of its own. It sends your prompts to{' '}
                <Link href="https://openrouter.ai" isExternalLink>
                  OpenRouter
                </Link>
                , which runs the model and bills your account per image (a few cents for most
                models). It needs your own key to do that.
              </Text>
              <Text type="supporting" as="p">
                To get one: sign in at{' '}
                <Link href="https://openrouter.ai/keys" isExternalLink>
                  openrouter.ai/keys
                </Link>
                , press <strong>Create key</strong>, and copy it. Add a few dollars of credit under{' '}
                <Link href="https://openrouter.ai/credits" isExternalLink>
                  Credits
                </Link>{' '}
                or generating will fail with "insufficient credits".
              </Text>
              <Text type="supporting" as="p">
                The key is saved to a <code>.env</code> file on this machine, is used only by your
                local server to call OpenRouter, and is never sent anywhere else.
              </Text>
            </VStack>
          )}
          {/* Three sections, one heading style each, dividers between. The field
              labels themselves are hidden where the heading already names the
              field, but stay in the DOM for screen readers. */}
          <VStack gap={2}>
            <Text type="label">API key</Text>
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
            <Text type="supporting" as="p">
              {cfg.hasKey
                ? `A key is already saved${cfg.keyHint ? ` (…${cfg.keyHint})` : ''}. Entering a new one replaces it.`
                : 'Paste it here. It starts with sk-or-'}
            </Text>
          </VStack>

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

          {(cfgDlg?.error || cfgDlg?.saved) && (
            <Banner
              status={cfgDlg.error ? 'error' : 'success'}
              title={cfgDlg.error || 'Saved to .env'}
              description={cfgDlg.error ? undefined : 'Applied right away — no restart needed.'}
            />
          )}

          <HStack gap={2} justify="end">
            <Button label="Close" variant="ghost" onClick={() => setCfgDlg(null)} />
            <Button
              label="Save"
              variant="primary"
              isDisabled={cfgDlg?.saving}
              isLoading={cfgDlg?.saving}
              onClick={saveSettings}
            />
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
        isOpen={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete project?"
        description={`This permanently removes “${deleting}” and its generated images. This can't be undone.`}
        actionLabel="Delete project"
        onAction={confirmDelete}
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


