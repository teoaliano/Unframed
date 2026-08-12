import { useState } from 'react';
import { Handle, Position, useReactFlow } from '@xyflow/react';
import { Card } from '@astryxdesign/core/Card';
import { Button } from '@astryxdesign/core/Button';
import { TextArea } from '@astryxdesign/core/TextArea';
import { VStack } from '@astryxdesign/core/Stack';
import NodeHeader from './NodeHeader.jsx';
import StatusLine from './StatusLine.jsx';
import { useModels, freeSpot } from './output/core.js';
import { ModelPicker, CostFoot } from './output/controls.jsx';
import { buildRequest } from '../graph/resolve.js';
import { runText } from '../api.js';

// An output node that emits text instead of an image. It consumes edges exactly like
// the image output node — same buildRequest — and its answer lives in data.result so
// prompts downstream can pull it in with @id.
export default function TextOutputNode({ id, data }) {
  const { getNodes, getEdges, updateNodeData, getNode, addNodes } = useReactFlow();
  const [status, setStatus] = useState('idle'); // idle | running | error
  const [error, setError] = useState(null);
  const { models, defaultModel } = useModels('text');

  const model = data.model || defaultModel;

  async function onRun() {
    setStatus('running');
    setError(null);
    try {
      const { prompt, input_references } = buildRequest(getNodes(), getEdges(), id);
      // The node's own textarea is the last part, after everything wired in.
      const own = (data.text || '').trim();
      const full = [prompt, own].filter(Boolean).join('\n\n');
      if (!full.trim()) {
        throw new Error('Nothing to run. Wire a prompt node in, or type one below.');
      }
      const resp = await runText({ prompt: full, input_references, model });
      updateNodeData(id, { result: resp.text, cost: resp.cost });
      setStatus('idle');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }

  // Copy, not move: the result stays on this node so anything referencing it by
  // @id keeps resolving, and the new node is a plain prompt you can edit without
  // re-running the model.
  function addResultAsPrompt() {
    const spot = freeSpot(getNode, getNodes, id);
    addNodes({
      id: `p-${Date.now()}`,
      type: 'prompt',
      dragHandle: '.xnode-head',
      className: 'nowheel',
      position: spot,
      data: { text: data.result },
    });
  }

  return (
    <Card width="fit-content" padding={0} className="xnode-text">
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <NodeHeader kind="textOutput" title="text" family="output" copyId={id} />

      <VStack gap={3} padding={3}>
        <ModelPicker
          models={models}
          value={model}
          kind="text"
          onChange={(v) => updateNodeData(id, { model: v })}
        />

        <TextArea
          className="xnode-text-field"
          label="Instructions"
          rows={3}
          hasSpellCheck={false}
          placeholder="Optional: added after anything wired in"
          value={data.text || ''}
          onChange={(v) => updateNodeData(id, { text: v })}
        />

        <Button
          label={status === 'running' ? 'Running…' : 'Run'}
          variant="primary"
          isLoading={status === 'running'}
          onClick={onRun}
        />

        {status === 'error' && <StatusLine type="error">{error}</StatusLine>}

        {data.result && (
          <VStack gap={1}>
            <TextArea
              className="xnode-text-field xnode-text-result"
              label="Result"
              rows={6}
              hasSpellCheck={false}
              value={data.result}
              onChange={(v) => updateNodeData(id, { result: v })}
            />
            <Button
              label="Add as prompt node"
              variant="secondary"
              size="sm"
              tooltip="Copy this result onto the canvas as a prompt node"
              onClick={addResultAsPrompt}
            />
          </VStack>
        )}
      </VStack>

      <CostFoot cost={data.cost ?? null} />
    </Card>
  );
}
