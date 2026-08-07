import { useCallback, useEffect, useRef, useState } from 'react';
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
import { ContextMenu } from '@astryxdesign/core/ContextMenu';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Text } from '@astryxdesign/core/Text';
import { Link } from '@astryxdesign/core/Link';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import Logo from './Logo.jsx';
import PromptNode from './nodes/PromptNode.jsx';
import ImageNode from './nodes/ImageNode.jsx';
import OutputNode from './nodes/OutputNode.jsx';
import TextNode from './nodes/TextNode.jsx';
import ProjectMenu from './ProjectMenu.jsx';
import { PromptIcon, ImageIcon, OutputIcon, TextIcon } from './nodes/nodeIcons.jsx';
import {
  setProject,
  listProjects,
  loadProject,
  saveProject,
  renameProject,
  deleteProject,
  getHealth,
  saveKey,
  clearKey,
} from './api.js';

const nodeTypes = { prompt: PromptNode, image: ImageNode, output: OutputNode, text: TextNode };

const svg = (path) => (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    {path}
  </svg>
);
const PlusIcon = svg(<path d="M12 5v14M5 12h14" />);
const MinusIcon = svg(<path d="M5 12h14" />);
const SelectIcon = svg(<path d="M4 3l7 17 2.5-7 7-2.5L4 3z" />);
const HandIcon = svg(
  <path d="M8 13V5.5a1.5 1.5 0 013 0V11m0-1V4.5a1.5 1.5 0 013 0V11m0-.5V6a1.5 1.5 0 013 0v7a6 6 0 01-6 6h-1a6 6 0 01-5.5-3.6L7 14c-.5-1-.2-1.8.6-2.2.7-.3 1.5 0 2 .7l-1.6-1.5" />,
);
const FitIcon = svg(<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />);
const KeyIcon = svg(<><circle cx="8" cy="15" r="4" /><path d="M10.8 12.2L20 3m-3 0 3 3m-5 2 2.5 2.5" /></>);

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
  // API key dialog. keyState mirrors the server: { hasKey, keyHint }.
  const [keyState, setKeyState] = useState({ hasKey: true, keyHint: '' });
  const [keyDlg, setKeyDlg] = useState(null); // { value, error, saving, saved } | null
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

  // Ask the server whether it has a key. With none, open the dialog straight away:
  // nothing on the canvas can produce an image yet, so setup is the only useful
  // first action. keyState starts optimistic so the dialog doesn't flash for
  // everyone else while this request is in flight.
  useEffect(() => {
    getHealth()
      .then((h) => {
        setKeyState({ hasKey: Boolean(h.hasKey), keyHint: h.keyHint || '' });
        if (!h.hasKey) setKeyDlg({ value: '' });
      })
      .catch(() => {});
  }, []);

  async function confirmKey() {
    const value = (keyDlg.value || '').trim();
    setKeyDlg((d) => ({ ...d, saving: true, error: undefined }));
    try {
      const r = await saveKey(value);
      setKeyState({ hasKey: true, keyHint: r.keyHint || '' });
      setKeyDlg({ value: '', saved: true });
    } catch (err) {
      setKeyDlg((d) => ({ ...d, saving: false, error: err.message }));
    }
  }

  // Two clicks to remove: the key isn't recoverable from here, so a stray click
  // shouldn't send you back to openrouter.ai for a new one.
  async function removeKey() {
    if (!keyDlg.confirmRemove) {
      setKeyDlg((d) => ({ ...d, confirmRemove: true, error: undefined, saved: false }));
      return;
    }
    setKeyDlg((d) => ({ ...d, saving: true }));
    try {
      await clearKey();
      setKeyState({ hasKey: false, keyHint: '' });
      setKeyDlg({ value: '', removed: true });
    } catch (err) {
      setKeyDlg((d) => ({ ...d, saving: false, confirmRemove: false, error: err.message }));
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

  // Drag image files from Finder/Explorer onto the canvas -> reference nodes at
  // the drop point (offset a little when dropping several at once).
  function onDrop(e) {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    files.forEach((file, i) => {
      const reader = new FileReader();
      reader.onload = () =>
        addNode(
          'image',
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

      const image = [...(e.clipboardData?.items || [])].find((it) =>
        it.type.startsWith('image/'),
      );
      if (image) {
        e.preventDefault();
        const file = image.getAsFile();
        const reader = new FileReader();
        reader.onload = () =>
          addNode('image', { fileName: file?.name || 'pasted-image', dataUrl: reader.result }, pointer.current);
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
  }, [addNode]);

  return (
    <div
      className="app"
      onMouseMove={(e) => {
        pointer.current = { x: e.clientX, y: e.clientY };
      }}
    >
      <header className="toolbar">
        <div className="toolbar-group">
          <Logo size={28} />
        </div>
        <div className="toolbar-group toolbar-center">
          <ProjectMenu
            projects={projects}
            current={project}
            onSwitch={switchProject}
            onRename={(p) => setNameDlg({ mode: 'rename', name: p, value: p })}
            onDelete={(p) => setDeleting(p)}
            onAdd={newProject}
          />
        </div>
        <div className="toolbar-group toolbar-right">
          <IconButton
            variant={keyState.hasKey ? 'ghost' : 'primary'}
            size="sm"
            label="API key"
            tooltip={
              keyState.hasKey
                ? `OpenRouter key set${keyState.keyHint ? ` (…${keyState.keyHint})` : ''}. Click to replace`
                : 'No OpenRouter key yet. Click to add one'
            }
            icon={<Icon icon={KeyIcon} />}
            onClick={() => setKeyDlg({ value: '' })}
          />
          <IconButton
            variant="ghost"
            size="sm"
            label="Help"
            tooltip={HELP_TEXT}
            icon={<Icon icon="info" />}
          />
        </div>
      </header>

      <ContextMenu items={addMenuItems(() => menuPoint.current)} menuWidth={152}>
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

      <Dialog
        isOpen={!!keyDlg}
        onOpenChange={(open) => !open && setKeyDlg(null)}
        purpose="form"
        width={420}
      >
        <DialogHeader
          title={keyState.hasKey ? 'OpenRouter API key' : 'Add your OpenRouter key to start'}
        />
        <VStack gap={3} padding={4}>
          {!keyState.hasKey && (
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
          <TextInput
            label="API key"
            type="password"
            hasAutoFocus
            placeholder="sk-or-v1-…"
            description={
              keyState.hasKey
                ? `A key is already saved${keyState.keyHint ? ` (…${keyState.keyHint})` : ''}. Entering a new one replaces it.`
                : 'Paste it here. It starts with sk-or-'
            }
            value={keyDlg?.value ?? ''}
            status={
              keyDlg?.error
                ? { type: 'error', message: keyDlg.error }
                : keyDlg?.saved
                  ? { type: 'success', message: 'Key saved. Generate is ready to use.' }
                  : keyDlg?.removed
                    ? { type: 'warning', message: 'Key removed. Generate is disabled until you add one.' }
                    : keyDlg?.confirmRemove
                      ? {
                          type: 'warning',
                          message:
                            'This deletes the key from .env. You will need to paste it again, or make a new one at openrouter.ai/keys.',
                        }
                      : undefined
            }
            onChange={(v) =>
              setKeyDlg((d) => ({
                ...d,
                value: v,
                error: undefined,
                saved: false,
                removed: false,
                confirmRemove: false,
              }))
            }
          />
          <HStack gap={2} justify={keyState.hasKey ? 'between' : 'end'}>
            {keyState.hasKey && (
              <Button
                label={keyDlg?.confirmRemove ? 'Yes, remove it' : 'Remove key'}
                variant={keyDlg?.confirmRemove ? 'destructive' : 'ghost'}
                isDisabled={keyDlg?.saving}
                onClick={removeKey}
              />
            )}
            <HStack gap={2} justify="end">
              <Button label="Close" variant="ghost" onClick={() => setKeyDlg(null)} />
              <Button
                label="Save key"
                variant="primary"
                isDisabled={!keyDlg?.value?.trim() || keyDlg?.saving}
                isLoading={keyDlg?.saving}
                onClick={confirmKey}
              />
            </HStack>
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


