import { useState } from 'react';
import { Handle, Position, useReactFlow, useNodes, useEdges } from '@xyflow/react';
import { Card } from '@astryxdesign/core/Card';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { Selector } from '@astryxdesign/core/Selector';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { useToast } from '@astryxdesign/core/Toast';
import NodeHeader from './NodeHeader.jsx';
import StatusLine from './StatusLine.jsx';
import ExpandableNote from './ExpandableNote.jsx';
import { MAX_VIDEO_BYTES } from './VideoNode.jsx';
import { useModels, useModelParams, freeSpot } from './output/core.js';
import { ModelPicker, ParamControls, CostFoot } from './output/controls.jsx';
import { buildRequest } from '../graph/resolve.js';
import { generateVideo } from '../api.js';
import { ExternalLink as AddToCanvasIcon } from 'lucide-react';

// Makes a video. Runs once per click and reports the job's own status rather than a
// run counter, because a clip takes minutes and is billed by the second — a Runs
// control here would be a way to spend ten dollars by mistake.
export default function VideoOutputNode({ id, data }) {
  const { getNodes, getEdges, updateNodeData, getNode, addNodes } = useReactFlow();
  const toast = useToast();
  const [status, setStatus] = useState('idle'); // idle | running | done | error
  const [result, setResult] = useState(null); // { url, cost }
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  // Inlining a clip means fetching and base64-ing it, which is not instant.
  const [addingVideo, setAddingVideo] = useState(false);
  const liveNodes = useNodes();
  const liveEdges = useEdges();

  const { models, defaultModel } = useModels('video');
  const model = data.videoModel || defaultModel;

  const entry = models.find((m) => m.id === model);
  const params = useModelParams(entry, 'video');
  const { exactSizes, resolutionTiers, ratios, durations, canAudio, supported } = params;
  const duration = Number(durations?.includes(String(data.duration)) ? data.duration : durations?.[0]);

  // Video is sold by the second, so the price of a click is knowable before it is
  // spent — and worth showing, at a dollar a clip rather than three cents.
  const perSecond = (() => {
    const skus = entry?.pricing;
    if (!skus) return null;
    const key =
      (data.resolution && skus[`cents_per_second_output_${String(data.resolution).toLowerCase()}`]) ||
      skus.cents_per_second_output;
    if (key) return Number(key) / 100;
    // Some models price in dollars per second under a different key.
    return skus.duration_seconds ? Number(skus.duration_seconds) : null;
  })();
  const estimate = perSecond && duration ? perSecond * duration : null;

  // Local clips are counted apart because video generation rejects them outright:
  // OpenRouter's /videos endpoint takes video_url only as a public HTTPS URL, and its
  // Files API (which could have hosted one) accepts images, audio and documents but
  // not video.
  const wiredVideoSources = liveEdges
    .filter((e) => e.target === id)
    .map((e) => liveNodes.find((n) => n.id === e.source && n.type === 'video' && n.data?.dataUrl))
    .filter(Boolean);
  const wiredVideos = wiredVideoSources.length;
  const wiredLocalVideos = wiredVideoSources.filter((n) =>
    String(n.data.dataUrl).startsWith('data:'),
  ).length;
  // On by default: without it a wired local clip can only fail, so the useful
  // default is the one that works. Explicit `false` is the user turning it off.
  const shareLocalVideos = data.shareLocalVideos !== false;

  // Same idea as the image node's add button, with one extra step: the video plays
  // from disk (a URL), but a reference node has to carry base64, because OpenRouter
  // fetches nothing from this machine. So the file is pulled back in and inlined —
  // which is also why the 25MB cap applies here exactly as it does to an upload.
  async function addVideoToCanvas() {
    setAddingVideo(true);
    try {
      const blob = await fetch(result.url).then((r) => {
        if (!r.ok) throw new Error(`could not read the saved file (${r.status})`);
        return r.blob();
      });
      if (blob.size > MAX_VIDEO_BYTES) {
        throw new Error(`it is ${(blob.size / 1024 / 1024).toFixed(0)}MB, over the 25MB reference cap`);
      }
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('could not read the file'));
        reader.readAsDataURL(blob);
      });
      addNodes({
        id: `gen-${Date.now()}-v`,
        type: 'video',
        dragHandle: '.xnode-head',
        className: 'nowheel',
        position: freeSpot(getNode, getNodes, id),
        data: { fileName: result.url.split('/').pop() || 'generated.mp4', dataUrl },
      });
    } catch (err) {
      toast({ body: `Could not add the video: ${err.message}`, uniqueID: `add-video-${id}` });
    } finally {
      setAddingVideo(false);
    }
  }

  function clearResult() {
    setResult(null);
    setNote(null);
    setError(null);
    setStatus('idle');
  }

  // Seedance picks its mode from the PROMPT, and only one of the two works here.
  // Reference-to-video (describe the result you want) is fine: size and duration
  // are honoured. Video EDITING (instruct a change to the clip) is not reachable
  // through OpenRouter at all: the provider then demands `duration: -1`, which
  // OpenRouter's own validation rejects ("expected number to be >=1"), whether we
  // send a duration or leave it out. Verified against the live API, 2026-08-12.
  const wiredVideoIntoVideo = wiredVideos > 0;

  async function onGenerate() {
    setStatus('running');
    setError(null);
    setResult(null);
    setNote(null);
    try {
      const { prompt, input_references } = buildRequest(getNodes(), getEdges(), id);
      if (!prompt.trim()) {
        throw new Error('Nothing connected. Wire a prompt node into this video node.');
      }

      const resp = await generateVideo(
        {
          prompt,
          input_references,
          model,
          duration,
          // One or the other, never both: they are interchangeable upstream, and
          // sending a size alongside a conflicting ratio is asking for trouble.
          size: supported(exactSizes, data.size),
          resolution: supported(resolutionTiers, data.resolution),
          aspect_ratio: supported(ratios, data.aspect_ratio),
          // Consent re-sent per request: the server refuses local clips without it.
          ...(shareLocalVideos ? { shareLocalVideos: true } : {}),
          ...(canAudio ? { generate_audio: Boolean(data.generateAudio) } : {}),
        },
        (jobStatus) => setNote(jobStatus === 'in_progress' ? 'rendering…' : 'queued…'),
      );
      setResult({ url: resp.url, cost: resp.cost });
      setNote(null);
      setStatus('done');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }

  return (
    <Card width={300} padding={0}>
      <Handle type="target" position={Position.Left} />
      <NodeHeader kind="videoOutput" title="video" family="output" />

      <VStack gap={3} padding={3}>
        <ModelPicker
          models={models}
          value={model}
          kind="video"
          onChange={(v) => updateNodeData(id, { videoModel: v })}
        />

        <ParamControls params={params} data={data} onChange={(u) => updateNodeData(id, u)} />

        {(durations || canAudio) && (
          <HStack gap={2} align="end">
            {durations && (
              <Selector
                label="Seconds"
                size="sm"
                options={durations}
                value={String(duration)}
                onChange={(v) => updateNodeData(id, { duration: Number(v) })}
              />
            )}
            {canAudio && (
              // A checkbox, not a toggle-button: this is an on/off flag, and a
              // ghost button reads as "not set" rather than "off". The wrapper
              // gives it the same height as the Selector's input box so the two
              // line up on their centres — bottom-aligning them does not, since
              // the Selector's box is taller than the checkbox.
              <div className="xnode-inline-check">
                <CheckboxInput
                  label="Audio"
                  value={Boolean(data.generateAudio)}
                  onChange={(on) => updateNodeData(id, { generateAudio: on })}
                />
              </div>
            )}
          </HStack>
        )}

        <Button
          label={
            status === 'running'
              // The job's own state reads better in the button than as a small
              // label elsewhere.
              ? note
                ? `${note.replace(/…$/, '')[0].toUpperCase()}${note.replace(/…$/, '').slice(1)}…`
                : 'Rendering…'
              : 'Generate'
          }
          variant="primary"
          isLoading={status === 'running'}
          onClick={onGenerate}
        />

        {wiredVideoIntoVideo && (
          <StatusLine type="warning">
            Describe the result you want, not a change to make. An instruction like
            &ldquo;edit this video to...&rdquo; switches the model into editing mode, which
            OpenRouter cannot currently express and which fails with a duration error.
          </StatusLine>
        )}

        {/* A local clip cannot reach video generation at all — that is a hard 400
            from OpenRouter, not a maybe. Sharing is per-node opt-in, never automatic:
            it makes the clip publicly fetchable (unguessable URL, dedicated
            share-only server, dies with the job), and that is a call the user makes
            knowingly. */}
        {wiredLocalVideos > 0 && (
          <ExpandableNote
            label="What sharing does"
            row={
              <CheckboxInput
                label="Share via temporary link while generating"
                value={shareLocalVideos}
                onChange={(on) => updateNodeData(id, { shareLocalVideos: on })}
              />
            }
          >
            {shareLocalVideos ? (
              <StatusLine type="info">
                While this generates, the clip is served from this machine through a
                temporary public link only the model provider receives. Nothing is
                uploaded to storage, and the link stops working when the job ends.
              </StatusLine>
            ) : (
              <StatusLine type="warning">
                Video generation only accepts a reference video as a public https:// link,
                and this one is a local file. Generating will fail unless you tick this,
                or wire the clip into a text node, which does take local files.
              </StatusLine>
            )}
          </ExpandableNote>
        )}

        {/* Unknown must never render as "does not accept": the capability comes from
            an unofficial endpoint, and a failure there yields null, not false. */}
        {wiredVideos > 0 && wiredLocalVideos === 0 && entry?.acceptsVideo === false && (
          <StatusLine type="warning">
            {wiredVideos === 1 ? 'A video is' : `${wiredVideos} videos are`} wired in, but
            this model is not known to accept video input. It will be sent and probably ignored.
          </StatusLine>
        )}

        {status === 'error' && <StatusLine type="error">{error}</StatusLine>}

        {/* note is not rendered on its own: while a job runs it IS the button's
            label, and after it finishes there is nothing left to say. */}

        {result?.url && (
          // Played from the file on disk, not from node data: a clip inlined into
          // the graph would be written back to graph.json on every edit. The add
          // button is the one place that does inline it, on demand.
          <span className="xnode-result">
            <video className="xnode-video" src={result.url} controls preload="metadata" />
            <span className="xnode-result-add">
              <Button
                label="Add this video to the canvas"
                tooltip="Add to canvas as a video node, so it can be wired back in as a reference"
                isIconOnly
                icon={<Icon icon={AddToCanvasIcon} size="xsm" />}
                size="sm"
                isLoading={addingVideo}
                onClick={addVideoToCanvas}
              />
            </span>
          </span>
        )}
      </VStack>

      <CostFoot
        cost={result?.cost != null ? result.cost : null}
        before={
          !result && estimate ? (
            // The upcoming click's price, from the model's per-second rate. Images
            // get no estimate: their pricing is per token, and a guess dressed as a
            // number would be worse than silence.
            <Text type="supporting" color="secondary" hasTabularNumbers>
              est. ~${estimate.toFixed(2)}
            </Text>
          ) : null
        }
        after={
          result ? (
            <span className="xnode-foot-end">
              <Button
                label="Clear"
                variant="ghost"
                size="sm"
                tooltip="Remove this result from the node. The file already written to disk stays, and a clip added to the canvas stays."
                onClick={clearResult}
              />
            </span>
          ) : null
        }
      />
    </Card>
  );
}
