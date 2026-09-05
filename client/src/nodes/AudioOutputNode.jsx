import { useState, useEffect } from 'react';
import { Handle, Position, useReactFlow } from '@xyflow/react';
import { Card } from '@astryxdesign/core/Card';
import { Button } from '@astryxdesign/core/Button';
import { TextArea } from '@astryxdesign/core/TextArea';
import { VStack } from '@astryxdesign/core/Stack';
import NodeHeader from './NodeHeader.jsx';
import { useNodeCommand } from './nodeCommands.js';
import StatusLine from './StatusLine.jsx';
import { NativeSelect, CostFoot } from './output/controls.jsx';
import { freeSpot } from './output/core.js';
import { buildRequest } from '../graph/resolve.js';
import { withDrag } from '../graph/starter.js';
import { generateAudio, listVoices, listAudioModels, getHealth, SESSION_ID } from '../api.js';
import { useProject } from '../graph/project.js';

// An output node that emits speech instead of an image. It consumes edges exactly
// like the other outputs -- same buildRequest -- and speaks the wired text through
// an ElevenLabs voice. Unlike the OpenRouter-backed outputs, this calls a second
// vendor with its own key (server/index.js's ELEVENLABS_API_KEY), so it degrades to
// a clear message rather than a picker with nothing in it when that key is missing.
export default function AudioOutputNode({ id, data }) {
  const { ref: projectRef } = useProject();
  const { getNodes, getEdges, getNode, addNodes, updateNodeData } = useReactFlow();
  const [status, setStatus] = useState('idle'); // idle | running | error
  const [error, setError] = useState(null);
  const [voices, setVoices] = useState([]);
  const [models, setModels] = useState([]);
  const [hasKey, setHasKey] = useState(true); // optimistic until health answers
  const [defaultModel, setDefaultModel] = useState('');

  const model = data.model_id || defaultModel;

  useEffect(() => {
    let live = true;
    getHealth().then((h) => {
      if (!live) return;
      setHasKey(Boolean(h.hasElevenLabsKey));
      setDefaultModel(h.audioModel || '');
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!hasKey) return;
    let live = true;
    listVoices().then((v) => live && setVoices(v));
    // ElevenLabs' models are account-wide, not fetched from OpenRouter's
    // catalogue the way the other outputs' ModelPicker is -- see
    // GET /api/elevenlabs/models, which already filters to
    // can_do_text_to_speech so this node never offers a voice-conversion or
    // sound-effects model that would 422 on a plain `text` field.
    listAudioModels().then((m) => live && setModels(m));
    return () => {
      live = false;
    };
  }, [hasKey]);

  // Same self-healing shape as TextOutputNode's own mount effect: a marker left
  // by a closed or reloaded tab can never be resumed, since a speech request is
  // one call and the server has already answered it by the time anyone reopens
  // this node.
  useEffect(() => {
    if (data.running && data.running.session !== SESSION_ID) {
      updateNodeData(id, { running: undefined });
    }
  }, []);

  async function onGenerate() {
    setStatus('running');
    setError(null);
    // Captured before anything is awaited: the identity for every guard below is
    // the PROJECT, not this component instance -- see TextOutputNode's own onRun.
    const startedIn = projectRef.current;
    updateNodeData(id, { running: { startedAt: Date.now(), session: SESSION_ID } });
    try {
      const { prompt } = buildRequest(getNodes(), getEdges(), id);
      const own = (data.text || '').trim();
      const full = [prompt, own].filter(Boolean).join('\n\n');
      if (!full.trim()) {
        throw new Error('Nothing to speak. Wire a prompt node in, or type one below.');
      }
      if (!data.voice_id) {
        throw new Error('Pick a voice first.');
      }
      const resp = await generateAudio({ text: full, voice_id: data.voice_id, model_id: model }, startedIn);
      if (projectRef.current !== startedIn) {
        // A run outlives a project switch, and node ids come from one counter
        // shared by every project, so this id may now belong to a DIFFERENT
        // project's node -- see TextOutputNode's own guard.
        updateNodeData(id, { running: undefined });
        setStatus('idle');
        return;
      }
      // A pointer, not the bytes: media left the document (server/media.js) --
      // the route already saved it to the project folder, and this node just
      // keeps the /api/file URL, same as ImageOutputNode's own result.
      updateNodeData(id, { result: { url: resp.url }, running: undefined });
      setStatus('idle');
    } catch (err) {
      if (projectRef.current !== startedIn) {
        updateNodeData(id, { running: undefined });
        setStatus('idle');
        return;
      }
      setError(err.message);
      setStatus('error');
      updateNodeData(id, { running: undefined });
    }
  }

  // The selection toolbar's button runs the same thing this node's own does.
  useNodeCommand(id, 'run', onGenerate);

  const isRunning = status === 'running' || Boolean(data.running);

  // Put the generated clip on the canvas as an audio input node, so it can be
  // wired back in later -- same shape as ImageOutputNode's own addToCanvas, and
  // just as trivial now that media left the document: the file is already in
  // the project folder, so the new node just names it, no bytes pulled back in.
  function addToCanvas() {
    // The generated file is already in the project folder and `url` is its
    // /api/file/<project>/<name> pointer, so the new node just names the file --
    // no bytes are pulled back in. Same derivation as ImageOutputNode's own.
    const file = decodeURIComponent(String(data.result?.url || '').split('/').pop() || '');
    if (!file) return;
    addNodes(
      withDrag({
        id: `gen-${Date.now()}`,
        type: 'audio',
        position: freeSpot(getNode, getNodes, id),
        data: { fileName: file, file },
      }),
    );
  }

  return (
    <>
      <NodeHeader kind="audioOutput" title="audio" family="output" />
      <Card width="fit-content" padding={0} elevation="low" className="xnode-text">
        <Handle type="target" position={Position.Left} />
        <Handle type="source" position={Position.Right} />

        <VStack gap={3} padding={3}>
          {!hasKey ? (
            <StatusLine type="error">
              No ElevenLabs key yet. Add one in Settings to use this node.
            </StatusLine>
          ) : (
            <>
              <NativeSelect
                label="Voice"
                options={voices.map((v) => ({ value: v.voice_id, label: v.name }))}
                value={voices.some((v) => v.voice_id === data.voice_id) ? data.voice_id : undefined}
                onChange={(v) => updateNodeData(id, { voice_id: v })}
              />

              <NativeSelect
                label="Model"
                options={models.map((m) => ({ value: m.model_id, label: m.name }))}
                value={models.some((m) => m.model_id === model) ? model : undefined}
                onChange={(v) => updateNodeData(id, { model_id: v })}
              />
            </>
          )}

          <TextArea
            className="xnode-text-field nodrag nowheel"
            label="Instructions"
            rows={3}
            hasSpellCheck={false}
            placeholder="Optional: added after anything wired in"
            value={data.text || ''}
            onChange={(v) => updateNodeData(id, { text: v })}
          />

          <Button
            className="nodrag"
            label={isRunning ? 'Generating…' : 'Generate'}
            variant="primary"
            isLoading={isRunning}
            isDisabled={isRunning || !hasKey}
            onClick={onGenerate}
          />

          {status === 'error' && <StatusLine type="error">{error}</StatusLine>}

          {data.result?.url && (
            <VStack gap={1}>
              <audio className="nodrag" controls src={data.result.url} style={{ width: '100%' }} />
              <Button
                className="nodrag"
                label="Add to canvas"
                variant="secondary"
                size="sm"
                tooltip="Add this clip to the canvas as an audio node"
                onClick={addToCanvas}
              />
            </VStack>
          )}
        </VStack>
      </Card>
      <CostFoot cost={null} extra={data.result ? model : null} />
    </>
  );
}
