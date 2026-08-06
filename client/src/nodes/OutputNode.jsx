import { useState, useEffect } from 'react';
import { Handle, Position, useReactFlow, useNodes, useEdges } from '@xyflow/react';
import { Card } from '@astryxdesign/core/Card';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { Selector } from '@astryxdesign/core/Selector';
import { Thumbnail } from '@astryxdesign/core/Thumbnail';
import { IconButton } from '@astryxdesign/core/IconButton';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import NodeHeader from './NodeHeader.jsx';
import RunsControl, { clampRuns } from './RunsControl.jsx';
import { buildRequest, splitSections, findWiredTextNode, freeRunPrompts } from '../graph/resolve.js';
import { generate, runText, listModels } from '../api.js';

// Arrow leaving a frame: "send this out onto the canvas".
const AddToCanvasIcon = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />
  </svg>
);

const RESOLUTIONS = ['512', '1K', '2K', '4K'];
const QUALITIES = ['auto', 'low', 'medium', 'high'];
const RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'];

export default function OutputNode({ id, data }) {
  const { getNodes, getEdges, updateNodeData, getNode, addNodes } = useReactFlow();
  const [status, setStatus] = useState('idle'); // idle | running | done | error | partial
  const [results, setResults] = useState([]); // [{ image, cost, savedPath, runIndex }]
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(null); // null while the run count isn't known yet
  const [repairCost, setRepairCost] = useState(0); // Free mode's re-split call, if any
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [models, setModels] = useState([]);
  const [defaultModel, setDefaultModel] = useState('');
  const liveNodes = useNodes();
  const liveEdges = useEdges();

  useEffect(() => {
    listModels().then((d) => {
      setModels(d.models || []);
      setDefaultModel(d.default || '');
    });
  }, []);

  // Fall back to the server's configured model until the user picks one, so this
  // keeps tracking OPENROUTER_MODEL unless explicitly overridden.
  const model = data.model || defaultModel;
  const freeRuns = Boolean(data.freeRuns);
  const runs = clampRuns(data.runs ?? 1);

  // A free spot to the right of the output node, stepped down past whatever is
  // already there. Scanned once per add so a batch added together cannot land its
  // images on top of each other: addNodes is async to getNodes(), so N scans in one
  // tick would each read a snapshot without the others' nodes. Callers scan once
  // and offset by index instead.
  function freeSpot() {
    const self = getNode(id);
    const pos = self?.position ?? { x: 0, y: 0 };
    const width = self?.measured?.width ?? 300;
    const spot = { x: pos.x + width + 40, y: pos.y };
    while (getNodes().some((n) => Math.hypot(n.position.x - spot.x, n.position.y - spot.y) < 24)) {
      spot.y += 48;
    }
    return spot;
  }

  // Put a generated image on the canvas as an image node, so it can be wired back
  // in as a reference for the next generation. Results no longer land here on their
  // own: a ten-run batch used to bury the canvas in nodes nobody asked for, so this
  // is now driven by the add buttons on the results below.
  function addToCanvas(result, index, base) {
    addNodes({
      id: `gen-${Date.now()}-${index}`,
      type: 'image',
      dragHandle: '.xnode-head',
      position: { x: base.x, y: base.y + 48 * index },
      data: {
        fileName: result.savedPath?.split('/').pop() || 'generated',
        dataUrl: result.image,
      },
    });
  }

  // Empty the node's result strip. Only this node's display: the files and their
  // sidecars are already on disk, and anything added to the canvas stays there.
  function clearResults() {
    setResults([]);
    setRepairCost(0);
    setNote(null);
    setError(null);
    setDone(0);
    setTotal(null);
    setStatus('idle');
  }

  // Render-time twin of findWiredTextNode() below: getNodes()/getEdges() are stable
  // function references, so React has no way to know an edge changed and won't
  // re-render this warning on its own. useNodes()/useEdges() subscribe to canvas
  // state, so the warning appears and disappears live as wiring changes.
  const liveWiredTextNode = findWiredTextNode(liveNodes, liveEdges, id);

  async function onGenerate() {
    setStatus('running');
    setError(null);
    setResults([]);
    setDone(0);
    setNote(null);
    setRepairCost(0);
    // Unknown until the run count is worked out below (which, in Free mode, needs
    // an await) — showing the previous batch's total in the meantime would read as
    // "Generating 0 / <stale total>…".
    setTotal(null);
    try {
      const { prompt, input_references } = buildRequest(getNodes(), getEdges(), id);
      if (!prompt.trim()) {
        throw new Error('Nothing connected. Wire a prompt node into this output node.');
      }

      // One id per Generate click, so a batch's sidecars — including a Free repair
      // call's text sidecar — can be summed later by one field.
      const batchId = `b-${Date.now()}`;

      let prompts;
      const notes = [];
      if (freeRuns) {
        const textNode = findWiredTextNode(getNodes(), getEdges(), id);
        if (!textNode) {
          throw new Error('Free needs a text node wired in. It lists what to generate.');
        }
        if (!textNode.data?.result?.trim()) {
          throw new Error('The text node has no result yet. Run it first.');
        }

        let { blocks, truncated } = splitSections(textNode.data.result);
        if (blocks.length < 2) {
          // The model ignored the format. One repair call, using its own model.
          //
          // The instruction has to say what a section is FOR, not just how to
          // punctuate one. Asked merely to "split into sections", models copy the
          // whole text N times: a real batch came back as three identical prompts,
          // each still reading "3 versions of ...", so every image rendered three
          // subjects and the run cost triple for one result. Two clauses earn their
          // place here — each section is a whole prompt for one image, and a text
          // that isn't a list comes back untouched rather than being chopped into
          // fragments that each bill as a generation.
          const repaired = await runText({
            prompt: [
              'Rewrite the text below as image prompts, one per image, separated by lines containing only ---.',
              '',
              'Each section must read as a complete prompt on its own: repeat the shared subject and style rather than referring back to another section.',
              'If the text asks for several versions or variations of one subject, write that many sections, each describing a different specific variation, and drop the count itself ("3 versions of a fox" becomes three sections, each describing one fox).',
              'Never emit the same section twice.',
              'If the text describes a single image with no variations implied, return it unchanged.',
              'No preamble, no numbering, no commentary.',
              '',
              textNode.data.result,
            ].join('\n'),
            model: textNode.data.model || undefined,
            batchId,
          });
          setRepairCost(Number(repaired.cost) || 0);
          const again = splitSections(repaired.text);
          if (again.blocks.length > 1) {
            blocks = again.blocks;
            truncated = again.truncated;
            notes.push(`re-split into ${blocks.length} sections`);
          } else {
            notes.push('no sections found, running as a single generation');
          }
        }

        if (blocks.length === 0) {
          // Nothing survived splitting or repair. Fall back to the whole result as
          // one block so the "single generation" note above stays true instead of
          // reporting success after zero runs.
          const fallback = textNode.data.result.trim();
          if (!fallback) throw new Error('The text node has no result yet. Run it first.');
          blocks = [fallback];
        }
        if (truncated) notes.push(`list had ${blocks.length + truncated} items, running the first ${blocks.length}`);

        prompts = freeRunPrompts(getNodes(), getEdges(), id, textNode.id, blocks);
      } else {
        prompts = Array.from({ length: runs }, () => prompt);
      }
      setNote(notes.length ? notes.join(' · ') : null);
      setTotal(prompts.length);

      const settled = await Promise.allSettled(
        prompts.map((p, i) =>
          generate({
            prompt: p,
            input_references,
            model,
            resolution: data.resolution,
            quality: data.quality,
            aspect_ratio: data.aspect_ratio,
            batchId,
            runIndex: i + 1,
            runCount: prompts.length,
          }).then((resp) => {
            setDone((d) => d + 1);
            // runIndex travels with the result so thumbnails, canvas placement, and
            // labels all agree on run order regardless of completion order.
            setResults((r) => [...r, { ...resp, runIndex: i }]);
            return resp;
          }),
        ),
      );

      const failures = settled.filter((s) => s.status === 'rejected').map((s) => s.reason?.message || 'failed');
      const ok = settled.length - failures.length;
      if (failures.length) {
        setError(
          `${ok} of ${settled.length} succeeded. ${[...new Set(failures)].join('; ')}`,
        );
        setStatus(ok ? 'partial' : 'error');
      } else {
        setStatus('done');
      }
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }

  return (
    <Card width={300} padding={0}>
      <Handle type="target" position={Position.Left} />
      <NodeHeader kind="output" family="output" />

      <VStack gap={3} padding={3}>
        <Selector
          label="Model"
          size="sm"
          hasSearch
          // Labelled by slug, not OpenRouter's display name: the slug is what you
          // put in OPENROUTER_MODEL, and it keeps every row in one format.
          options={models.map((m) => ({ value: m.id, label: m.id }))}
          value={model}
          placeholder="Loading models…"
          onChange={(v) => updateNodeData(id, { model: v })}
        />
        <HStack gap={2}>
          <Selector
            label="Size"
            size="sm"
            options={RESOLUTIONS}
            value={data.resolution}
            onChange={(v) => updateNodeData(id, { resolution: v })}
          />
          <Selector
            label="Quality"
            size="sm"
            options={QUALITIES}
            value={data.quality}
            onChange={(v) => updateNodeData(id, { quality: v })}
          />
          <Selector
            label="Ratio"
            size="sm"
            options={RATIOS}
            value={data.aspect_ratio}
            onChange={(v) => updateNodeData(id, { aspect_ratio: v })}
          />
        </HStack>

        <VStack gap={1}>
          {/* type="label" is what the Selectors above render for Size and Quality,
              so the four labels stay one size instead of Runs sitting a step down. */}
          <Text type="label" as="label" color="secondary">Runs</Text>
          <RunsControl
            runs={runs}
            freeRuns={freeRuns}
            onRunsChange={(n) => updateNodeData(id, { runs: n })}
            onModeChange={(free) => updateNodeData(id, { freeRuns: free })}
          />
        </VStack>

        <Button
          label={
            status === 'running'
              ? total
                ? `Generating ${done} / ${total}…`
                : 'Generating…'
              : runs > 1 && !freeRuns
                ? `Generate ${runs}×`
                : 'Generate'
          }
          variant="primary"
          isLoading={status === 'running'}
          // Free with nothing wired in has no list to work from, so there is
          // nothing to generate. Disabled rather than clickable-then-failing: the
          // hint below already says what to wire, and an error saying the same
          // thing would just be the hint again in red.
          isDisabled={freeRuns && !liveWiredTextNode}
          onClick={onGenerate}
        />

        {freeRuns && !liveWiredTextNode && (
          <HStack gap={1} align="start">
            <Icon icon="info" size="sm" color="secondary" />
            <Text type="supporting">
              {'Wire a text node with a "---" separated list'}
              <br />
              Each item turns into one generation.
            </Text>
          </HStack>
        )}

        {(status === 'error' || status === 'partial') && (
          <HStack gap={2} align="center">
            <StatusDot
              variant={status === 'partial' ? 'warning' : 'error'}
              label={status === 'partial' ? 'Partial success' : 'Generation failed'}
            />
            <Text type="supporting">{error}</Text>
          </HStack>
        )}

        {note && (
          <Text type="supporting" color="secondary">{note}</Text>
        )}

        {(results.length > 0 || repairCost > 0) && (
          <VStack gap={1}>
            {[...results]
              .sort((a, b) => a.runIndex - b.runIndex)
              .map((r) => (
                <span className="xnode-result" key={r.runIndex}>
                  <Thumbnail
                    className="xnode-thumb"
                    src={r.image}
                    alt={`generated result ${r.runIndex + 1}`}
                    label={`result ${r.runIndex + 1}`}
                  />
                  <span className="xnode-result-add">
                    <IconButton
                      label={`Add result ${r.runIndex + 1} to the canvas`}
                      tooltip="Add to canvas as an image node"
                      icon={<AddToCanvasIcon />}
                      size="sm"
                      onClick={() => addToCanvas(r, 0, freeSpot())}
                    />
                  </span>
                </span>
              ))}
            {results.length > 1 && (
              <Button
                label="Add all to canvas"
                icon={<AddToCanvasIcon />}
                variant="secondary"
                size="sm"
                // One scan, then an index offset per image: freeSpot() reads
                // getNodes(), which will not show the nodes added a line earlier in
                // this same tick, so scanning per image would stack them.
                onClick={() => {
                  const base = freeSpot();
                  [...results]
                    .sort((a, b) => a.runIndex - b.runIndex)
                    .forEach((r, i) => addToCanvas(r, i, base));
                }}
              />
            )}
          </VStack>
        )}
      </VStack>

      {/* What the run cost sits in a footer rather than in the body's flow: it
          reports on the node as a whole, so it reads better banded off against the
          same rule as the title than stacked under the last result. Clear belongs
          here too — it acts on the whole strip, not on the last image above it. */}
      {(results.length > 0 || repairCost > 0) && (
        <div className="xnode-foot">
          {(results.some((r) => r.cost != null) || repairCost > 0) && (
            <>
              <Text type="supporting" color="accent" hasTabularNumbers>
                ${(results.reduce((sum, r) => sum + (Number(r.cost) || 0), 0) + repairCost).toFixed(4)}
              </Text>
              {results.length > 1 && (
                <Text type="supporting" color="secondary">{results.length} images</Text>
              )}
            </>
          )}
          <span className="xnode-foot-end">
            <Button
              label="Clear"
              variant="ghost"
              size="sm"
              tooltip="Remove these results from the node. Files already written to disk stay, and images added to the canvas stay."
              onClick={clearResults}
            />
          </span>
        </div>
      )}
    </Card>
  );
}
