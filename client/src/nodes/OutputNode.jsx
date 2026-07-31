import { useState, useEffect } from 'react';
import { Handle, Position, useReactFlow } from '@xyflow/react';
import { Card } from '@astryxdesign/core/Card';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { Selector } from '@astryxdesign/core/Selector';
import { Thumbnail } from '@astryxdesign/core/Thumbnail';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import NodeHeader from './NodeHeader.jsx';
import { buildRequest } from '../graph/resolve.js';
import { generate, listModels } from '../api.js';

const RESOLUTIONS = ['512', '1K', '2K', '4K'];
const QUALITIES = ['auto', 'low', 'medium', 'high'];
const RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'];

export default function OutputNode({ id, data }) {
  const { getNodes, getEdges, updateNodeData, getNode, addNodes } = useReactFlow();
  const [status, setStatus] = useState('idle'); // idle | running | done | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [cost, setCost] = useState(null);
  const [models, setModels] = useState([]);
  const [defaultModel, setDefaultModel] = useState('');

  useEffect(() => {
    listModels().then((d) => {
      setModels(d.models || []);
      setDefaultModel(d.default || '');
    });
  }, []);

  // Fall back to the server's configured model until the user picks one, so this
  // keeps tracking OPENROUTER_MODEL unless explicitly overridden.
  const model = data.model || defaultModel;

  async function onGenerate() {
    setStatus('running');
    setError(null);
    try {
      const { prompt, input_references } = buildRequest(getNodes(), getEdges(), id);
      if (!prompt.trim()) {
        throw new Error('Nothing connected. Wire a prompt node into this output node.');
      }
      const resp = await generate({
        prompt,
        input_references,
        model,
        resolution: data.resolution,
        quality: data.quality,
        aspect_ratio: data.aspect_ratio,
      });
      setResult(resp.image);
      setCost(resp.cost);
      setStatus('done');

      // Drop the generated image onto the canvas as a reference node so it can be
      // wired back in as input for the next generation. It goes to the right of the
      // output node, top-aligned, clear of the result thumbnail below the button.
      const self = getNode(id);
      const pos = self?.position ?? { x: 0, y: 0 };
      const width = self?.measured?.width ?? 300;
      const spot = { x: pos.x + width + 40, y: pos.y };
      // Generating repeatedly would park every result on the same spot, hiding all
      // but the last, so step down past whatever is already there.
      while (getNodes().some((n) => Math.hypot(n.position.x - spot.x, n.position.y - spot.y) < 24)) {
        spot.y += 48;
      }
      addNodes({
        id: `gen-${Date.now()}`,
        type: 'image',
        dragHandle: '.xnode-head',
        position: spot,
        data: { fileName: resp.savedPath?.split('/').pop() || 'generated', dataUrl: resp.image },
      });
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }

  return (
    <Card width={300} padding={0}>
      <Handle type="target" position={Position.Left} />
      <NodeHeader kind="output" />

      <VStack gap={3} padding={3}>
        <Selector
          label="Model"
          size="sm"
          hasSearch
          options={models.map((m) => ({ value: m.id, label: m.name }))}
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

        <Button
          label={status === 'running' ? 'Generating…' : 'Generate'}
          variant="primary"
          isLoading={status === 'running'}
          onClick={onGenerate}
        />

        {status === 'error' && (
          <Text type="supporting" color="error">{error}</Text>
        )}

        {result && (
          <VStack gap={1}>
            <Thumbnail className="xnode-thumb" src={result} alt="generated result" label="result" />
            {cost != null && (
              <Text type="supporting" color="accent" hasTabularNumbers>
                ${Number(cost).toFixed(4)}
              </Text>
            )}
          </VStack>
        )}
      </VStack>
    </Card>
  );
}
