import { useState, useEffect } from 'react';
import { Handle, Position, useReactFlow } from '@xyflow/react';
import { Card } from '@astryxdesign/core/Card';
import { Button } from '@astryxdesign/core/Button';
import { TextArea } from '@astryxdesign/core/TextArea';
import { VStack } from '@astryxdesign/core/Stack';
import NodeHeader from './NodeHeader.jsx';
import StatusLine from './StatusLine.jsx';
import { useModels, freeSpot } from './output/core.js';
import { resetModelParams } from './output/defaults.js';
import { ModelPicker, CostFoot } from './output/controls.jsx';
import { buildRequest } from '../graph/resolve.js';
import { runText, getProject, SESSION_ID } from '../api.js';
import { useFieldResize } from './fieldResize.js';

// An output node that emits text instead of an image. It consumes edges exactly like
// the image output node — same buildRequest — and its answer lives in data.result so
// prompts downstream can pull it in with @id.
export default function TextOutputNode({ id, data }) {
  const { getNodes, getEdges, updateNodeData, getNode, addNodes } = useReactFlow();
  const [status, setStatus] = useState('idle'); // idle | running | error
  const [error, setError] = useState(null);
  const { models, defaultModel } = useModels('text');

  const model = data.model || defaultModel;

  // A marker left by a closed or reloaded tab can never be resumed — a text run is
  // one request, and the server has already produced whatever it produced by the
  // time anyone reopens this node. Runs once per mount, which now covers a genuine
  // project switch too (App.jsx remounts every node on one — see
  // canvasGeneration): a marker stamped by THIS session must survive that switch
  // unchanged (it may still be genuinely in flight), so only a marker whose
  // session does not match gets cleared here. Same self-healing shape as
  // migrateNodes and VideoOutputNode's inputMode heal.
  useEffect(() => {
    if (data.running && data.running.session !== SESSION_ID) {
      updateNodeData(id, { running: undefined });
    }
    // Deliberately mount-only ([]): re-running this whenever `data` changes would
    // race onRun's own marker, clearing a session-matched one the instant it sets
    // it.
  }, []);

  async function onRun() {
    setStatus('running');
    setError(null);
    // Captured before anything is awaited: the identity for every guard below is
    // the PROJECT, not a ref or a token held by this component instance. A rename
    // (not a genuine switch) reuses this very instance, and even when a switch
    // DOES remount it, updateNodeData still reaches into whichever project is
    // CURRENTLY loaded — never the one this closure started in.
    const startedIn = getProject();
    // Persisted before the request: local `status` alone is wiped by a genuine
    // switch's remount, so without this a switch-and-back would show an enabled
    // Run button for a request still in flight — a second click would be a
    // second paid run. Stamped with SESSION_ID so a marker outliving this tab
    // reads as abandoned on mount instead of disabling the button forever — see
    // the mount effect above.
    updateNodeData(id, { running: { startedAt: Date.now(), session: SESSION_ID } });
    try {
      const { prompt, input_references } = buildRequest(getNodes(), getEdges(), id);
      // The node's own textarea is the last part, after everything wired in.
      const own = (data.text || '').trim();
      const full = [prompt, own].filter(Boolean).join('\n\n');
      if (!full.trim()) {
        throw new Error('Nothing to run. Wire a prompt node in, or type one below.');
      }
      const resp = await runText({ prompt: full, input_references, model });
      if (getProject() !== startedIn) {
        // A run outlives a project switch, and node ids come from one counter
        // shared by every project, so this id may now belong to a DIFFERENT
        // project's node. Writing would attribute someone else's answer to it —
        // and data.result is what @id resolves to, so every downstream prompt
        // over there would quietly build from text that was never meant for it.
        updateNodeData(id, { running: undefined });
        setStatus('idle');
        return;
      }
      updateNodeData(id, { result: resp.text, cost: resp.cost, running: undefined });
      setStatus('idle');
    } catch (err) {
      if (getProject() !== startedIn) {
        // Same reasoning as the success path: an error belonging to a run
        // started somewhere else must not surface on whatever node is showing
        // now, and the marker it left behind is not this node's to keep either.
        updateNodeData(id, { running: undefined });
        setStatus('idle');
        return;
      }
      setError(err.message);
      setStatus('error');
      updateNodeData(id, { running: undefined });
    }
  }

  // True whenever a run is in flight, whether or not THIS instance is the one
  // that started it: local `status` alone is wiped the moment a genuine project
  // switch remounts the node (App.jsx's canvasGeneration), so the persisted
  // marker is what lets the button keep reading "Running…" across that gap.
  const isRunning = status === 'running' || Boolean(data.running);

  // Copy, not move: the result stays on this node so anything referencing it by
  // @id keeps resolving, and the new node is a plain prompt you can edit without
  // re-running the model.
  function addResultAsPrompt() {
    const spot = freeSpot(getNode, getNodes, id);
    addNodes({
      id: `p-${Date.now()}`,
      type: 'prompt',
      position: spot,
      data: { text: data.result },
    });
  }

  // See fieldResize.js for why this needs a mousedown-armed window listener rather
  // than a plain mouseup handler on the field. This node has two resizable fields,
  // told apart by the `xnode-text-result` class on the Result field.
  const onResizeMouseDown = useFieldResize({
    id,
    data,
    updateNodeData,
    keyFor: (box) => (box.classList.contains('xnode-text-result') ? 'resultSize' : 'size'),
  });

  return (
    <Card width="fit-content" padding={0} elevation="low" className="xnode-text">
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <NodeHeader kind="textOutput" title="text" family="output" right={`@${id}`} />

      <VStack gap={3} padding={3} onMouseDown={onResizeMouseDown}>
        <ModelPicker
          models={models}
          value={model}
          kind="text"
          onChange={(v) => updateNodeData(id, { model: v, ...resetModelParams('textOutput') })}
        />

        <TextArea
          className="xnode-text-field nodrag nowheel"
          style={data.size}
          label="Instructions"
          rows={3}
          hasSpellCheck={false}
          placeholder="Optional: added after anything wired in"
          value={data.text || ''}
          onChange={(v) => updateNodeData(id, { text: v })}
        />

        <Button
          className="nodrag"
          label={isRunning ? 'Running…' : 'Run'}
          variant="primary"
          isLoading={isRunning}
          // A run in flight disables Run outright — a second click would be a
          // second paid run for the one this node is already tracking, however
          // many times the canvas has remounted since it started.
          isDisabled={isRunning}
          onClick={onRun}
        />

        {status === 'error' && <StatusLine type="error">{error}</StatusLine>}

        {data.result && (
          <VStack gap={1}>
            <TextArea
              className="xnode-text-field xnode-text-result nodrag nowheel"
              style={data.resultSize}
              label="Result"
              rows={6}
              hasSpellCheck={false}
              value={data.result}
              onChange={(v) => updateNodeData(id, { result: v })}
            />
            <Button
              className="nodrag"
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
