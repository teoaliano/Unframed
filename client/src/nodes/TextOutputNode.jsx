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
import { runText, getProject } from '../api.js';

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
    // Captured out here, not inside the try: both exits compare against it, and a
    // catch cannot see a const declared in the block it is catching for.
    const startedIn = getProject();
    try {
      const { prompt, input_references } = buildRequest(getNodes(), getEdges(), id);
      // The node's own textarea is the last part, after everything wired in.
      const own = (data.text || '').trim();
      const full = [prompt, own].filter(Boolean).join('\n\n');
      if (!full.trim()) {
        throw new Error('Nothing to run. Wire a prompt node in, or type one below.');
      }
      const resp = await runText({ prompt: full, input_references, model });
      // A run outlives a project switch, and node ids come from one counter shared by
      // every project, so by now this same component can be showing a DIFFERENT
      // project's node with the same id. Writing then would overwrite that node's
      // saved answer — and data.result is what @id resolves to, so every downstream
      // prompt over there would quietly build from text that was never meant for it.
      // The local status still clears, or the node reads "Running" forever.
      if (getProject() !== startedIn) {
        setStatus('idle');
        return;
      }
      updateNodeData(id, { result: resp.text, cost: resp.cost });
      setStatus('idle');
    } catch (err) {
      // Same reasoning as the success path: an error belonging to a run started
      // somewhere else must not surface on whatever node is showing now.
      if (getProject() !== startedIn) {
        setStatus('idle');
        return;
      }
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
