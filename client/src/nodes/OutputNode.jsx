import { useState, useEffect } from 'react';
import { Handle, Position, useReactFlow } from '@xyflow/react';
import { Card } from '@astryxdesign/core/Card';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { Selector } from '@astryxdesign/core/Selector';
import { Thumbnail } from '@astryxdesign/core/Thumbnail';
import { TextInput } from '@astryxdesign/core/TextInput';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import NodeHeader from './NodeHeader.jsx';
import { buildRequest } from '../graph/resolve.js';
import { generate, listModels } from '../api.js';

const RESOLUTIONS = ['512', '1K', '2K', '4K'];
const QUALITIES = ['auto', 'low', 'medium', 'high'];
const RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'];

const MAX_RUNS = 10;
// Typed input is clamped rather than rejected: 15 becomes 10, 0 or empty becomes 1.
const clampRuns = (v) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_RUNS, Math.max(1, n));
};

export default function OutputNode({ id, data }) {
  const { getNodes, getEdges, updateNodeData, getNode, addNodes } = useReactFlow();
  const [status, setStatus] = useState('idle'); // idle | running | done | error | partial
  const [results, setResults] = useState([]); // [{ image, cost, savedPath }]
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(1);
  const [error, setError] = useState(null);
  const [models, setModels] = useState([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [runsDraft, setRunsDraft] = useState(null); // null = show the stored value

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

  // Drop a finished image onto the canvas as an image node so it can be wired back in
  // as input for the next generation. It goes to the right of the output node,
  // top-aligned; repeat results step down instead of stacking invisibly.
  function placeResult(resp) {
    const self = getNode(id);
    const pos = self?.position ?? { x: 0, y: 0 };
    const width = self?.measured?.width ?? 300;
    const spot = { x: pos.x + width + 40, y: pos.y };
    while (getNodes().some((n) => Math.hypot(n.position.x - spot.x, n.position.y - spot.y) < 24)) {
      spot.y += 48;
    }
    addNodes({
      id: `gen-${Date.now()}-${Math.round(spot.y)}`,
      type: 'image',
      dragHandle: '.xnode-head',
      position: spot,
      data: { fileName: resp.savedPath?.split('/').pop() || 'generated', dataUrl: resp.image },
    });
  }

  async function onGenerate() {
    setStatus('running');
    setError(null);
    setResults([]);
    setDone(0);
    try {
      const { prompt, input_references } = buildRequest(getNodes(), getEdges(), id);
      if (!prompt.trim()) {
        throw new Error('Nothing connected. Wire a prompt node into this output node.');
      }

      // Free mode arrives in the next task; until then it means a single run.
      const prompts = [prompt];
      setTotal(prompts.length);

      // One id per Generate click, so a batch's sidecars can be summed later.
      const batchId = `b-${Date.now()}`;
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
            setResults((r) => [...r, resp]);
            placeResult(resp);
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

        <HStack gap={2} align="end">
          <TextInput
            label="Runs"
            size="sm"
            value={freeRuns ? '' : (runsDraft ?? String(runs))}
            isDisabled={freeRuns}
            disabledMessage="Free mode decides the number from the flow"
            onChange={(v) => {
              // TextInput has no onBlur, so a local draft holds exactly what was
              // typed (including "" or "0" mid-edit) for display, while node data
              // always stores a clamped number — Task 4 reads data.runs directly
              // and needs a number, not a string that merely looks numeric.
              const digits = v.replace(/[^\d]/g, '').slice(0, 2);
              setRunsDraft(digits);
              updateNodeData(id, { runs: clampRuns(digits) });
            }}
          />
          <Button
            label="Free"
            size="sm"
            variant={freeRuns ? 'primary' : 'ghost'}
            tooltip="Free: the number of runs comes from the flow — a connected Text node lists what to generate, and each item becomes one image."
            onClick={() => updateNodeData(id, { freeRuns: !freeRuns })}
          />
        </HStack>

        <Button
          label={
            status === 'running'
              ? `Generating ${done} / ${total}…`
              : runs > 1 && !freeRuns
                ? `Generate ${runs} ×`
                : 'Generate'
          }
          variant="primary"
          isLoading={status === 'running'}
          onClick={onGenerate}
        />

        {(status === 'error' || status === 'partial') && (
          <Text type="supporting" color={status === 'partial' ? 'warning' : 'error'}>{error}</Text>
        )}

        {results.length > 0 && (
          <VStack gap={1}>
            {results.map((r, i) => (
              <Thumbnail
                key={r.savedPath || i}
                className="xnode-thumb"
                src={r.image}
                alt={`generated result ${i + 1}`}
                label={`result ${i + 1}`}
              />
            ))}
            {results.some((r) => r.cost != null) && (
              <Text type="supporting" color="accent" hasTabularNumbers>
                ${results.reduce((sum, r) => sum + (Number(r.cost) || 0), 0).toFixed(4)}
                {results.length > 1 ? ` · ${results.length} images` : ''}
              </Text>
            )}
          </VStack>
        )}
      </VStack>
    </Card>
  );
}
