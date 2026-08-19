import { useState, useEffect } from 'react';
import { Handle, Position, useReactFlow, useNodes, useEdges } from '@xyflow/react';
import { Card } from '@astryxdesign/core/Card';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { Thumbnail } from '@astryxdesign/core/Thumbnail';
import { Icon } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/Stack';
import { useToast } from '@astryxdesign/core/Toast';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import NodeHeader from './NodeHeader.jsx';
import RunsControl, { clampRuns } from './RunsControl.jsx';
import StatusLine from './StatusLine.jsx';
import FreePreviewDialog, { droppedImagesNote } from './FreePreviewDialog.jsx';
import { useModels, useModelParams, freeSpot } from './output/core.js';
import { resetModelParams } from './output/defaults.js';
import { ModelPicker, ParamControls, CostFoot } from './output/controls.jsx';
import { buildRequest, splitSections, findFreeSource, freeSourceText, freeBatch, bucketSources, isTextOutput } from '../graph/resolve.js';
import { generate, runText, getProject, SESSION_ID } from '../api.js';
// Arrow leaving a frame: "send this out onto the canvas". From lucide-react, like
// every other icon here, so it shares the set's grid and stroke.
import { ExternalLink as AddToCanvasIcon } from 'lucide-react';

// One string for both places freeBatch can come back with no runs at all: onGenerate's
// direct-fire throw and onConfirmPreview's fallback error.
const NO_SECTIONS_ERROR = 'That list has no sections to run.';

// The truncation half of a batch's shape notes, for the node's OWN footer line. Worded
// differently from the dialog's "N more sections beyond the cap" on purpose: that one sits
// beside a visible run count and this one does not.
function truncationNote(runCount, truncated) {
  return truncated ? `list had ${runCount + truncated} items, running the first ${runCount}` : null;
}

// The other half: sections that were nothing but an `images:` line, dropped by freeBatch
// before they could bill for a generation of the shared context alone.
function emptyNote(empty) {
  return empty ? `skipped ${empty} section${empty === 1 ? '' : 's'} with no prompt text` : null;
}

// Makes an image. Its sibling makes a video, and the two used to be one node with a
// tab: the medium picked the catalogue, the controls and the order of magnitude of
// the bill, which is too much to hide behind a segmented control.
export default function ImageOutputNode({ id, data }) {
  const { getNodes, getEdges, updateNodeData, getNode, addNodes } = useReactFlow();
  const toast = useToast();
  const [status, setStatus] = useState('idle'); // idle | running | done | error | partial
  // [{ image, cost, savedPath, url, runIndex }] — the CURRENT batch's bytes, the
  // only place a freshly returned base64 lives. Deliberately NOT seeded from
  // data.results: a lazy useState initialiser runs exactly once per component
  // instance, and React Flow reuses an instance (rather than mounting a fresh one)
  // whenever a node with this same id is already on the canvas — which is every
  // page load, since the starter graph's own imageOutput node shares the loaded
  // project's id space. Seeding here silently never fired for that path; see
  // `shown` below for what actually drives the display.
  const [results, setResults] = useState([]);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(null); // null while the run count isn't known yet
  const [repairCost, setRepairCost] = useState(0); // Free mode's re-split call, if any
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  // Which result is currently being fetched-and-inlined for "add to canvas" — see
  // addToCanvas below. Keyed by runIndex so several thumbnails' buttons can carry
  // their own loading state instead of one flag freezing the whole strip.
  const [addingKeys, setAddingKeys] = useState(() => new Set());
  // A built-but-unsent batch, waiting on the preview dialog. Component state, not node
  // data: it is transient, and autosaving a prompt blob into graph.json on every edit is
  // exactly what the results pointer exists to avoid. Losing it on unmount costs nothing
  // but the text call already made.
  const [staged, setStaged] = useState(null);
  const liveNodes = useNodes();
  const liveEdges = useEdges();

  // A marker left by a closed or reloaded tab can never be resumed — a batch is a
  // set of single requests, and the server has already written whatever it wrote
  // by the time anyone reopens this node. Runs once per mount, which now covers a
  // genuine project switch too (App.jsx remounts every node on one — see
  // canvasGeneration): a marker stamped by THIS session must survive that switch
  // unchanged (it may still be genuinely in flight), so only a marker whose
  // session does not match gets cleared here. Same self-healing shape as
  // migrateNodes and VideoOutputNode's inputMode heal.
  useEffect(() => {
    if (data.running && data.running.session !== SESSION_ID) {
      updateNodeData(id, { running: undefined });
    }
    // Deliberately mount-only ([]): re-running this whenever `data` changes would
    // race onGenerate's own marker, clearing a session-matched one the instant it
    // sets it.
  }, []);

  const { models, defaultModel } = useModels('image');
  // Fall back to the server's configured model until the user picks one, so this
  // keeps tracking OPENROUTER_IMAGE_MODEL unless explicitly overridden.
  const model = data.model || defaultModel;
  const freeRuns = Boolean(data.freeRuns);
  const runs = clampRuns(data.runs ?? 1);

  const entry = models.find((m) => m.id === model);
  const params = useModelParams(entry, 'image');
  const { resolutionTiers, ratios, qualities, backgrounds, supported } = params;

  // A just-finished result already carries its bytes; a reopened one (seeded from
  // data.results after a reload or a project switch) only has a file url and needs
  // fetching — same reasoning as VideoOutputNode.addVideoToCanvas: a reference has
  // to travel to OpenRouter, which cannot reach this machine, so it must be inlined.
  async function toDataUrl(result) {
    if (result.image) return result.image;
    const res = await fetch(result.url);
    if (!res.ok) throw new Error(`could not read the saved file (${res.status})`);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('could not read the file'));
      reader.readAsDataURL(blob);
    });
  }

  // Put a generated image on the canvas as an image node, so it can be wired back
  // in as a reference for the next generation. Results no longer land here on their
  // own: a ten-run batch used to bury the canvas in nodes nobody asked for, so this
  // is now driven by the add buttons on the results below.
  async function addToCanvas(result, index, base) {
    setAddingKeys((s) => new Set(s).add(result.runIndex));
    try {
      const dataUrl = await toDataUrl(result);
      addNodes({
        id: `gen-${Date.now()}-${index}`,
        type: 'image',
        position: { x: base.x, y: base.y + 48 * index },
        data: {
          fileName: (result.savedPath || result.url)?.split('/').pop() || 'generated',
          dataUrl,
        },
      });
    } catch (err) {
      toast({ body: `Could not add the image: ${err.message}`, uniqueID: `add-image-${id}-${result.runIndex}` });
    } finally {
      setAddingKeys((s) => {
        const next = new Set(s);
        next.delete(result.runIndex);
        return next;
      });
    }
  }

  // Empty the node's result strip. Only this node's display: the files and their
  // sidecars are already on disk, and anything added to the canvas stays there.
  // Persisted results are cleared too (results: undefined, dropped by JSON.stringify
  // the same way VideoOutputNode drops a forgotten job) — otherwise a cleared node
  // would repopulate the next time it reloads.
  function clearResults() {
    setResults([]);
    setRepairCost(0);
    setNote(null);
    setError(null);
    setDone(0);
    setTotal(null);
    setStatus('idle');
    updateNodeData(id, { results: undefined });
  }

  // Render-time twin of findFreeSource(): getNodes()/getEdges() are stable function
  // references, so React has no way to know an edge changed and won't re-render this
  // warning on its own. useNodes()/useEdges() subscribe to canvas state, so the hint
  // appears and disappears live as wiring changes.
  const liveFreeSource = findFreeSource(liveNodes, liveEdges, id);

  const wiredVideos = liveEdges
    .filter((e) => e.target === id)
    .filter((e) => liveNodes.some((n) => n.id === e.source && n.type === 'video' && n.data?.dataUrl))
    .length;

  // The paid half of a run, split out so the preview gate can sit between building a
  // batch and sending it -- and so confirming a preview reuses this exact code rather
  // than a second copy that drifts. The caller sets `status`, the `running` marker and
  // the cleared results; fire() owns the requests, the settlement, and clearing the marker.
  async function fire(batch, batchId) {
    // Captured before anything is awaited, same reasoning as onGenerate's copy: a write
    // after an await reaches whichever project is CURRENTLY loaded, never this one.
    const startedIn = getProject();
    try {
      setTotal(batch.length);
      const settled = await Promise.allSettled(
        batch.map((run, i) =>
          generate({
            prompt: run.prompt,
            input_references: run.input_references,
            model,
            resolution: supported(resolutionTiers, data.resolution),
            quality: supported(qualities, data.quality),
            aspect_ratio: supported(ratios, data.aspect_ratio),
            background: supported(backgrounds, data.background),
            batchId,
            runIndex: i + 1,
            runCount: batch.length,
          }).then((resp) => {
            // Every request in a batch resolves independently, so the project can
            // change between one landing and the next — this is not a
            // once-per-batch check. Skipping here skips ALL of a stale write: the
            // local strip and the persisted pointer both, not just the last one.
            // The image this response carries is real and already billed, but
            // attributing it to whatever node now sits at this id would be
            // attributing it to the wrong project's node — see the task's own
            // account of why this guard exists.
            if (getProject() !== startedIn) return resp;
            setDone((d) => d + 1);
            // runIndex travels with the result so thumbnails, canvas placement, and
            // labels all agree on run order regardless of completion order.
            const withIndex = { ...resp, runIndex: i };
            setResults((r) => [...r, withIndex]);
            // Persist a pointer alongside it, never the bytes: `image` is a base64
            // data URL, and inlining that into node data means it gets rewritten
            // into graph.json on every keystroke (CLAUDE.md). Every result in the
            // batch is persisted as it lands, not just the last, and as a functional
            // update rather than a captured `data` — several runs in this batch can
            // resolve in the same tick, and each must append to what the LAST one
            // just wrote, not to the data this closure was created with.
            updateNodeData(id, (node) => ({
              results: [
                ...(node.data.results || []),
                { url: withIndex.url, savedPath: withIndex.savedPath, cost: withIndex.cost, runIndex: withIndex.runIndex },
              ],
            }));
            return resp;
          }),
        ),
      );

      if (getProject() !== startedIn) {
        // The switch outlasted the whole batch, not just one result in it —
        // every individual write above already skipped itself. Nothing left here
        // is this project's to touch; only clear the marker, so whatever node
        // now sits at this id is not left carrying a run that is not its own.
        updateNodeData(id, { running: undefined });
        return;
      }

      const failures = settled.filter((s) => s.status === 'rejected').map((s) => s.reason?.message || 'failed');
      const ok = settled.length - failures.length;
      if (failures.length) {
        setError(`${ok} of ${settled.length} succeeded. ${[...new Set(failures)].join('; ')}`);
        setStatus(ok ? 'partial' : 'error');
      } else {
        setStatus('done');
      }
      updateNodeData(id, { running: undefined });
    } catch (err) {
      if (getProject() !== startedIn) {
        updateNodeData(id, { running: undefined });
        return;
      }
      setError(err.message);
      setStatus('error');
      updateNodeData(id, { running: undefined });
    }
  }

  // The dialog's live rows and its confirm both go through freeBatch, so what is shown
  // and what is sent cannot diverge. Errors are returned rather than thrown: a circular
  // @reference typed mid-edit must grey the button out, not blank the dialog.
  function derivePreview(text) {
    const source = findFreeSource(getNodes(), getEdges(), id);
    if (!source) {
      return { runs: [], truncated: 0, empty: 0, shared: '', error: 'The list source is no longer wired in.' };
    }
    try {
      return { ...freeBatch(getNodes(), getEdges(), id, source.id, text), error: null };
    } catch (err) {
      return { runs: [], truncated: 0, empty: 0, shared: '', error: err.message };
    }
  }

  async function onConfirmPreview(text) {
    const { runs: built, truncated, empty, error: bad } = derivePreview(text);
    if (bad || !built.length) {
      setError(bad || NO_SECTIONS_ERROR);
      setStatus('error');
      setStaged(null);
      return;
    }
    // Reuses the staged batchId, so the repair call's text sidecar and these images stay
    // summable as one batch -- the reason a batch has an id at all.
    const batchId = staged.batchId;
    // Recomputed from the text as CONFIRMED, not from anything staged earlier: the
    // textarea may have changed since Generate first built a batch, and a directive
    // fixed (or broken) by that edit must be reflected here, not report on a batch that
    // was never actually sent. `staged.notes` itself is safe to reuse as-is -- it only
    // ever holds the repair call's own notes, which already happened and which editing
    // this text cannot undo.
    const shapeNotes = [
      truncationNote(built.length + empty, truncated),
      emptyNote(empty),
      droppedImagesNote(built),
    ].filter(Boolean);
    const allNotes = [...staged.notes, ...shapeNotes];
    setNote(allNotes.length ? allNotes.join(' · ') : null);
    setStaged(null);
    setStatus('running');
    setError(null);
    setResults([]);
    updateNodeData(id, {
      results: undefined,
      running: { startedAt: Date.now(), session: SESSION_ID },
    });
    setDone(0);
    // fire() handles its own failures; this is the backstop, because a throw escaping here
    // would leave `running` set with nothing in flight and Generate disabled until remount.
    const startedIn = getProject();
    try {
      await fire(built, batchId);
    } catch (err) {
      if (getProject() === startedIn) {
        setError(err.message);
        setStatus('error');
      }
      updateNodeData(id, { running: undefined });
    }
  }

  async function onGenerate() {
    setStatus('running');
    setError(null);
    // A pending preview must not disturb a batch already on screen and already paid
    // for: Cancel has to leave it exactly as it was -- the local strip, the persisted
    // pointer, AND the note describing it, none of which this click has earned the
    // right to touch yet. onConfirmPreview is where all three get cleared (and re-set)
    // once a run actually starts -- see there. The `running` marker below still lands
    // immediately either way, so Generate stays disabled through the repair call.
    const previewing = freeRuns && data.previewPrompt;
    if (!previewing) setResults([]);
    // Captured before anything is awaited: every guard below compares against
    // this, not against a ref or a token held by this component instance. A
    // rename (not a genuine switch) reuses this very instance, and even when a
    // switch DOES remount it, updateNodeData still reaches into whichever
    // project is CURRENTLY loaded — never the one this closure started in — so a
    // write after an await needs its own check regardless of what remounted.
    const startedIn = getProject();
    // A fresh run's persisted pointer starts empty too, same reasoning as
    // clearResults: a run interrupted before its first result lands must not leave
    // the PREVIOUS batch's images to reappear on the next reload of a blank node.
    // `running` is set in the same call: local `status` alone is wiped by a
    // genuine switch's remount, so without a persisted marker a switch-and-back
    // would show an enabled Generate button for a batch still in flight — a
    // second click would be a second paid run. Stamped with SESSION_ID so a
    // marker outliving this tab (a reload, or a close) reads as abandoned on
    // mount instead of disabling the button forever — see the mount effect
    // above. Boolean-ish fact plus its provenance, not a progress log: done/total
    // stay local only, same as before.
    updateNodeData(id, {
      // Skipped when a preview is pending, for the same reason `setResults` above is --
      // the marker still has to land immediately, but there is no run yet whose pointer
      // this should blank.
      ...(previewing ? {} : { results: undefined }),
      running: { startedAt: Date.now(), session: SESSION_ID },
    });
    setDone(0);
    if (!previewing) setNote(null);
    setRepairCost(0);
    // Unknown until the run count is worked out below (which, in Free mode, needs
    // an await) — showing the previous batch's total in the meantime would read as
    // "Generating 0 / <stale total>…".
    setTotal(null);
    try {
      const { prompt, input_references } = buildRequest(getNodes(), getEdges(), id);
      if (!prompt.trim()) {
        throw new Error('Nothing connected. Wire a prompt node into this image node.');
      }

      // One id per Generate click, so a batch's sidecars — including a Free repair
      // call's text sidecar — can be summed later by one field.
      const batchId = `b-${Date.now()}`;

      let batch;
      let listText = '';
      // The repair CALL's own notes: history that already happened, so this is the only
      // kind of note that travels into `staged`.
      const stepNotes = [];
      // The batch's SHAPE -- truncation, skipped sections, dropped-image directives --
      // which an edit in the preview dialog CAN change, so onConfirmPreview recomputes its
      // own from the text actually confirmed instead of reusing this. Filled here only for
      // the direct-fire path, where nothing can edit `built` before `fire`.
      let shapeNotes = [];
      if (freeRuns) {
        const source = findFreeSource(getNodes(), getEdges(), id);
        if (!source) {
          throw new Error('Free needs a prompt or text node wired in. It lists what to generate.');
        }
        // A prompt node's @ids are expanded here, before splitting -- see freeSourceText.
        listText = freeSourceText(source, getNodes()).trim();
        if (!listText) {
          throw new Error(
            isTextOutput(source)
              ? 'The text node has no result yet. Run it first.'
              : 'The prompt node is empty. It lists what to generate.',
          );
        }

        if (splitSections(listText).blocks.length < 2) {
          // The model ignored the format. One repair call, using its own model.
          //
          // The instruction has to say what a section is FOR, not just how to
          // punctuate one. Asked merely to "split into sections", models copy the
          // whole text N times: a real batch came back as three identical prompts,
          // each still reading "3 versions of ...", so every image rendered three
          // subjects and the run cost triple for one result. Two of the clauses below
          // do the real work — each section must be a whole prompt for one image, and
          // a text that isn't a list must come back untouched rather than being
          // chopped into fragments that each bill as a generation.

          // The count is known here and nowhere else: the model cannot see the canvas, so
          // "images 1 to 8" has to be stated or it invents numbers. Zero wired images
          // means the directive clauses are noise, so they are left out entirely.
          const imageCount = bucketSources(getNodes(), getEdges(), id)
            .references.filter((n) => n.type === 'image').length;
          const ask = [
            'You rewrite a rough description into image prompts, one per image, separated by lines containing only ---.',
            '',
            'Each section must read as a complete prompt on its own: repeat the shared subject and style rather than referring back to another section.',
            'If the text asks for several versions or variations of one subject, write that many sections, each describing a different specific variation, and drop the count itself ("3 versions of a fox" becomes three sections, each describing one fox).',
            'Never emit the same section twice.',
            'If the text describes a single image with no variations implied, return it unchanged.',
            'No preamble, no numbering, no commentary. Output the sections and nothing else.',
          ];
          if (imageCount > 0) {
            ask.push(
              '',
              `${imageCount} reference image${imageCount > 1 ? 's are' : ' is'} attached, numbered 1 to ${imageCount}.`,
              'A section that needs only some of them opens with a line reading "images: " followed by their numbers, for example "images: 1, 4". Omit that line when the section should receive all of them.',
              // The rule the old wording could not carry. Asked to "renumber", the model
              // echoed the source's own "image 3" into a run holding two attachments,
              // where that number named nothing. Brackets are a token it cannot copy by
              // reflex, and the example restarts them per section, which is the whole point.
              'Never write "image 3" inside a section. Refer to an image by its POSITION in that section\'s own images: line, in square brackets. [1] is the first number you listed, [2] the second. The brackets restart at [1] in every section.',
              '',
              'Example. Three images are attached and the description reads:',
              '  "Use image 1 as a style reference. Apply it to image 2 and to image 3, as two separate images."',
              'You output exactly:',
              '  images: 1, 2',
              '  Apply the visual style of [1] to the subject and composition of [2].',
              '  ---',
              '  images: 1, 3',
              '  Apply the visual style of [1] to the subject and composition of [2].',
            );
          }
          const repaired = await runText({
            // Rules in the system role, material in the user turn. They used to be one
            // string with a blank line between them, which is how a description reading
            // "apply that style to image 3" got obeyed as an instruction instead of
            // rewritten as data -- see the system handling in server/index.js.
            system: ask.join('\n'),
            prompt: `Text to rewrite:\n\n${listText}`,
            model: isTextOutput(source) ? source.data.model || undefined : undefined,
            batchId,
          });
          setRepairCost(Number(repaired.cost) || 0);
          const again = splitSections(repaired.text);
          if (again.blocks.length > 1) {
            listText = repaired.text;
            stepNotes.push(`re-split into ${again.blocks.length} sections`);
          } else {
            // The repaired text is dropped here -- including any `images:` directive that
            // paid-for call just produced -- because using it would import the model's own
            // phrasing into what is now a single-image prompt.
            stepNotes.push('no sections found, running as a single generation');
          }
        }

        const built = freeBatch(getNodes(), getEdges(), id, source.id, listText);
        // Nothing but separators, or nothing but `images:` lines, leaves zero runs. Saying
        // so beats the old fall-back-to-one-run, which spent money on the shared context
        // alone.
        if (!built.runs.length) throw new Error(NO_SECTIONS_ERROR);
        batch = built.runs;
        if (previewing) {
          // Stage before touching anything else: the marker and the spinner both have
          // to come back off, or Generate freezes behind its own disabled guard with
          // nothing in flight. Only `stepNotes` is staged (see its own comment) --
          // `shapeNotes` stays [] here on purpose, since this batch is not the one
          // that will actually be sent; onConfirmPreview computes its own once the
          // user says which text that is.
          setStaged({ listText, notes: stepNotes, batchId });
          setStatus('idle');
          updateNodeData(id, { running: undefined });
          return;
        }
        // No preview pending, so nothing can edit `built` before it reaches `fire` --
        // safe to compute its shape notes once, same as `stepNotes` above.
        shapeNotes = [
          truncationNote(built.runs.length + built.empty, built.truncated),
          emptyNote(built.empty),
          droppedImagesNote(built.runs),
        ].filter(Boolean);
      } else {
        batch = Array.from({ length: runs }, () => ({ prompt, input_references }));
      }
      const allNotes = [...stepNotes, ...shapeNotes];
      setNote(allNotes.length ? allNotes.join(' · ') : null);
      await fire(batch, batchId);
    } catch (err) {
      if (getProject() !== startedIn) {
        updateNodeData(id, { running: undefined });
        return;
      }
      setError(err.message);
      setStatus('error');
      updateNodeData(id, { running: undefined });
    }
  }

  // What the strip actually displays: the in-flight/just-finished batch if there is
  // one, else whatever pointer survived in node data (a reopened node that never
  // ran a batch in THIS component instance — see the comment on `results` above).
  // Derived on every render rather than seeded once, so it stays correct across
  // the reused-instance page-load case that a lazy initialiser missed entirely.
  const shown = results.length ? results : (data.results ?? []);

  const spent = shown.reduce((sum, r) => sum + (Number(r.cost) || 0), 0) + repairCost;
  const hasSpend = shown.some((r) => r.cost != null) || repairCost > 0;
  const hasStrip = shown.length > 0 || repairCost > 0;

  // True whenever a batch is in flight, whether or not THIS instance is the one
  // that started it: local `status` alone is wiped the moment a genuine project
  // switch remounts the node (App.jsx's canvasGeneration), so a marker persisted
  // in data is what lets the button keep reading "Generating…" across that gap.
  // Read from data rather than a ref for the same reason `startedIn` above is —
  // a rename reuses this very component instance for what could, after enough
  // switching, be sitting on a different project's node of this id.
  const isRunning = status === 'running' || Boolean(data.running);

  return (
    <Card width={300} padding={0}>
      <Handle type="target" position={Position.Left} />
      <NodeHeader kind="imageOutput" title="image" family="output" />

      {/* nodrag on the whole body, not per control: Astryx portals a Selector's
          popup UP to this stack, so no wrapper around the control can ever contain
          it, and an open model list would otherwise drag the node. Everything in
          here is a control anyway -- these nodes drag by their header, footer and
          card edge. See the 2026-08-18 canvas-interaction spec. */}
      <VStack gap={3} padding={3}>
        <ModelPicker
          models={models}
          value={model}
          kind="image"
          onChange={(v) => updateNodeData(id, { model: v, ...resetModelParams('imageOutput') })}
        />

        <ParamControls params={params} data={data} onChange={(u) => updateNodeData(id, u)} />

        <VStack gap={1}>
          {/* type="label" is what the selects above render for Size and Quality,
              so the four labels stay one size instead of Runs sitting a step down. */}
          <Text type="label" as="label" color="secondary">Runs</Text>
          <RunsControl
            runs={runs}
            freeRuns={freeRuns}
            onRunsChange={(n) => updateNodeData(id, { runs: n })}
            onModeChange={(free) => updateNodeData(id, { freeRuns: free })}
          />
          {freeRuns && (
            <CheckboxInput
              label="View final prompt"
              value={Boolean(data.previewPrompt)}
              onChange={(on) => updateNodeData(id, { previewPrompt: on })}
            />
          )}
        </VStack>

        <Button
          className="nodrag"
          label={
            isRunning
              ? // total/done are local-only (never persisted — see data.running's
                // own comment), so a node showing a marker from BEFORE its last
                // remount has no progress count to report, only that something
                // is running.
                status === 'running' && total
                ? `Generating ${done} / ${total}…`
                : 'Generating…'
              : runs > 1 && !freeRuns
                ? `Generate ${runs}×`
                : 'Generate'
          }
          variant="primary"
          isLoading={isRunning}
          // A batch in flight disables Generate outright — a second click would be
          // a second paid run for the one this node is already tracking. Free with
          // nothing wired in has no list to work from either; the hint below
          // already says what to wire, so an error saying the same thing would
          // just be the hint again in red.
          isDisabled={isRunning || (freeRuns && !liveFreeSource)}
          onClick={onGenerate}
        />

        {wiredVideos > 0 && (
          <StatusLine type="warning">
            {wiredVideos === 1 ? 'A video is' : `${wiredVideos} videos are`} wired in, but
            image models do not take video input. It will be sent and probably ignored.
          </StatusLine>
        )}

        {freeRuns && !liveFreeSource && (
          <StatusLine type="info">
            Wire a prompt or text node in. Each item turns into one generation
            <br />
            — a &quot;---&quot; separated list, or prose a text model can split.
          </StatusLine>
        )}

        {/* The message already carries the outcome ("2 of 3 succeeded. …"), so the
            icon only has to say which kind of outcome it is. */}
        {(status === 'error' || status === 'partial') && (
          <StatusLine type={status === 'partial' ? 'warning' : 'error'}>{error}</StatusLine>
        )}

        {note && (
          <StatusLine type="info">{note}</StatusLine>
        )}

        {hasStrip && (
          <VStack gap={1}>
            {[...shown]
              .sort((a, b) => a.runIndex - b.runIndex)
              .map((r) => (
                <span className="xnode-result" key={r.runIndex}>
                  <Thumbnail
                    className="xnode-thumb"
                    // A just-finished run still has the bytes it fetched; a
                    // reopened node (after a project switch or reload) only has
                    // the pointer that survived — see `shown` above.
                    src={r.image ?? r.url}
                    alt={`generated result ${r.runIndex + 1}`}
                  />
                  <span className="xnode-result-add nodrag">
                    <Button
                      label={`Add result ${r.runIndex + 1} to the canvas`}
                      tooltip="Add to canvas as an image node"
                      isIconOnly
                      icon={<Icon icon={AddToCanvasIcon} size="xsm" />}
                      size="sm"
                      isLoading={addingKeys.has(r.runIndex)}
                      onClick={() => addToCanvas(r, 0, freeSpot(getNode, getNodes, id))}
                    />
                  </span>
                </span>
              ))}
            {shown.length > 1 && (
              <Button
                className="nodrag"
                label="Add all to canvas"
                icon={<AddToCanvasIcon />}
                variant="secondary"
                size="sm"
                isLoading={addingKeys.size > 0}
                // One scan, then an index offset per image: freeSpot() reads
                // getNodes(), which will not show the nodes added a line earlier in
                // this same tick, so scanning per image would stack them. Sequential
                // (not Promise.all) since each add reads/writes the same addingKeys
                // state and there is no reason several fetches need to race.
                onClick={async () => {
                  const base = freeSpot(getNode, getNodes, id);
                  const ordered = [...shown].sort((a, b) => a.runIndex - b.runIndex);
                  for (let i = 0; i < ordered.length; i++) {
                    await addToCanvas(ordered[i], i, base);
                  }
                }}
              />
            )}
          </VStack>
        )}
      </VStack>

      {/* What the run cost sits in a footer rather than in the body's flow: it
          reports on the node as a whole. Clear belongs here too — it acts on the
          whole strip, not on the last image above it. */}
      <CostFoot
        cost={hasSpend ? spent : null}
        after={
          hasStrip ? (
            <>
              {hasSpend && shown.length > 1 && (
                <Text type="supporting" color="secondary">{shown.length} images</Text>
              )}
              <span className="xnode-foot-end">
                <Button
                  className="nodrag"
                  label="Clear"
                  variant="ghost"
                  size="sm"
                  tooltip="Remove these results from the node. Files already written to disk stay, and images added to the canvas stay."
                  onClick={clearResults}
                />
              </span>
            </>
          ) : null
        }
      />

      {/* Keyed by batchId so a second staging mounts a FRESH dialog: its textarea seeds
          from staged.listText once, and React Flow's habit of reusing an instance for a
          node id is exactly how a stale draft would survive into the next preview. */}
      {staged && (
        <FreePreviewDialog
          key={staged.batchId}
          staged={staged}
          derive={derivePreview}
          onCancel={() => setStaged(null)}
          onConfirm={onConfirmPreview}
        />
      )}
    </Card>
  );
}
