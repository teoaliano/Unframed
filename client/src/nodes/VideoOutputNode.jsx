import { useState, useEffect, useRef } from 'react';
import { Handle, Position, useReactFlow, useNodes, useEdges } from '@xyflow/react';
import { Card } from '@astryxdesign/core/Card';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { Selector } from '@astryxdesign/core/Selector';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Icon } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/Stack';
import { useToast } from '@astryxdesign/core/Toast';
import NodeHeader from './NodeHeader.jsx';
import StatusLine from './StatusLine.jsx';
import ExpandableNote from './ExpandableNote.jsx';
import { MAX_VIDEO_BYTES } from './VideoNode.jsx';
import { useModels, useModelParams, freeSpot } from './output/core.js';
import { resetModelParams } from './output/defaults.js';
import { ModelPicker, ParamControls, CostFoot } from './output/controls.jsx';
import { buildRequest, bucketSources } from '../graph/resolve.js';
import { startVideo, pollVideo } from '../api.js';
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
  // Bumped by pollVideo's status callback purely to force a re-render, so the
  // elapsed "(N min)" on the button keeps advancing while a poll is in flight —
  // its value is never read.
  const [, bump] = useState(0);
  // Inlining a clip means fetching and base64-ing it, which is not instant.
  const [addingVideo, setAddingVideo] = useState(false);
  const liveNodes = useNodes();
  const liveEdges = useEdges();
  // Every job id this component instance has already started a poll loop for, once
  // each — no matter how many times a project switch brings that same job back into
  // view (React Flow keys node components by id, not by project, so the instance
  // survives a switch without unmounting), or React StrictMode's dev-only
  // double-mount fires the resume effect below twice. Without it, either would start
  // a SECOND loop for a job something else already has one running for, and the
  // server re-downloads (and re-saves) a completed job on every poll that reaches
  // it rather than caching it — see the completion branch of /api/video/:id.
  const startedJobIds = useRef(new Set());

  const { models, defaultModel } = useModels('video');
  const model = data.videoModel || defaultModel;

  const entry = models.find((m) => m.id === model);
  const params = useModelParams(entry, 'video');
  const { exactSizes, resolutionTiers, ratios, durations, canAudio, supported } = params;
  const duration = Number(durations?.includes(String(data.duration)) ? data.duration : durations?.[0]);

  // Seedance exposes four task types and OpenRouter surfaces the frame ones through
  // supported_frame_images. Offer only what this model declares -- the same rule as
  // every other control here -- and never a selector with one option.
  const frameTypes = entry?.params?.frame_images || null;
  const FRAME_MODE_LABELS = { first_frame: 'First frame', first_last: 'First and last frame' };
  const inputModes = [
    { value: 'reference', label: 'References' },
    ...(frameTypes?.includes('first_frame') ? [{ value: 'first_frame', label: FRAME_MODE_LABELS.first_frame }] : []),
    ...(frameTypes?.includes('first_frame') && frameTypes?.includes('last_frame')
      ? [{ value: 'first_last', label: FRAME_MODE_LABELS.first_last }]
      : []),
  ];
  // A stored mode this model doesn't currently declare -- entry not yet loaded, or a
  // real mismatch the self-heal effect below hasn't caught up with yet -- still needs a
  // row to change it from. Kept out of `inputModes` itself: that list is also what the
  // effect and the request consider valid, and folding the stray value into it would
  // make an unsupported mode look supported forever, so the reset it exists to catch
  // would never fire.
  const unconfirmedMode = Boolean(data.inputMode) && !inputModes.some((o) => o.value === data.inputMode);
  const selectorOptions = unconfirmedMode
    ? [...inputModes, { value: data.inputMode, label: FRAME_MODE_LABELS[data.inputMode] || data.inputMode }]
    : inputModes;
  const inputMode = data.inputMode || 'reference';
  // A node with no stored model follows the global default, so Settings can change its
  // model without a switch. Clearing an inputMode the model cannot honour keeps the badge,
  // the red edges and the request from ever disagreeing -- same self-healing shape as
  // migrateNodes.
  useEffect(() => {
    // `entry` is not enough: the server manufactures a bare { id, name } for the
    // configured model when the catalogue is unavailable, and a missing params means
    // "we do not know", not "this model has no frames". Healing on that wipes a valid
    // setting during an upstream outage.
    if (!models.length || !entry?.params) return;
    if (data.inputMode && !inputModes.some((o) => o.value === data.inputMode)) {
      updateNodeData(id, { inputMode: undefined });
    }
  }, [models.length, entry, data.inputMode, inputModes, id, updateNodeData]);

  const ignoredCount = bucketSources(liveNodes, liveEdges, id).excess.length;

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

  // Polls one job through to a conclusion — a completed result, a genuine failure,
  // or the polling budget running out — and is the only place any of the three
  // outcomes are handled. Shared by every caller that already holds a job id:
  // starting one, and picking one back up (a fresh mount, or a project switch that
  // reveals a pending job on this same node id). Named jobParams, not params: this
  // component already has a `params` (the model's capability set from
  // useModelParams), and the two are easy to confuse for one another.
  async function runJob(jobId, jobParams) {
    // A loop outlives the job that started it — Forget, then Generate again while
    // this one is still mid-poll, is enough. Every write below the await must
    // confirm it still owns the node's CURRENT job, or a finished job A clears (or
    // overwrites the UI for) a job B that started after it — the one outcome this
    // entire task exists to prevent. Not needed above the await: jobId is only ever
    // passed in already matching data.job.id at call time.
    const stillOurs = () => getNode(id)?.data?.job?.id === jobId;

    setStatus('running');
    setError(null);
    try {
      const d = await pollVideo(jobId, jobParams, () => stillOurs() && bump((n) => n + 1));
      if (!stillOurs()) return;
      if (d.pending) {
        // Not a failure, and not a reason to touch data.job — the node stays
        // exactly as it was, waiting for the next mount, the next project switch
        // back into view, or a longer budget next time around.
        setStatus('idle');
        return;
      }
      setResult({ url: d.url, cost: d.cost });
      setStatus('done');
      updateNodeData(id, { job: undefined });
    } catch (err) {
      if (!stillOurs()) return;
      setError(err.message);
      setStatus('error');
      // A genuine failure (the job itself failed upstream) is the only other
      // reason to clear the job — pollVideo never throws for a transient error
      // reaching our own server, only for that.
      updateNodeData(id, { job: undefined });
    }
  }

  // Picks up a pending job with no user action — the entire point of persisting
  // one. Fires whenever data.job?.id changes to something this component instance
  // hasn't already started a loop for: on a genuine fresh mount (a reload), and
  // just as much on switching INTO a project whose same-id node has one pending —
  // React Flow keys node components by id, not by project, so the instance
  // survives that switch without ever unmounting, and a mount-only effect would
  // never see it. startedJobIds is what stops this from ALSO starting a second
  // loop for a job onGenerate (or React StrictMode's double-mount) already has one
  // running for; stillOurs() inside runJob is what keeps two loops from
  // corrupting each other's state if they ever do briefly overlap.
  useEffect(() => {
    const jobId = data.job?.id;
    if (jobId && !startedJobIds.current.has(jobId)) {
      startedJobIds.current.add(jobId);
      // Whatever result/error is showing locally belongs to a different job, or a
      // different project's view of this same node id — never to this one: a job
      // and a result for IT are never both present at once (runJob clears one
      // exactly when it sets the other).
      setResult(null);
      setError(null);
      runJob(jobId, data.job.params);
    }
  }, [data.job?.id]);

  // Clears the job HERE only. OpenRouter has no cancel for a running video job,
  // so this cannot stop the render — only stop this node from watching for it.
  // Without an escape hatch, a node whose polling window keeps expiring would be
  // permanently stuck showing "Rendering…" with no way back to Generate.
  function forgetJob() {
    updateNodeData(id, { job: undefined });
    setStatus('idle');
    setError(null);
  }

  async function onGenerate() {
    setStatus('running');
    setError(null);
    setResult(null);
    try {
      const { prompt, input_references, frame_images } = buildRequest(getNodes(), getEdges(), id);
      if (!prompt.trim()) {
        throw new Error('Nothing connected. Wire a prompt node into this video node.');
      }

      // Computed once, not inline in both the request and the stored job: the
      // job's params drive every future poll, so they must name the exact same
      // one of size/resolution the request actually sent.
      const size = supported(exactSizes, data.size);
      const resolution = supported(resolutionTiers, data.resolution);

      const resp = await startVideo({
        prompt,
        input_references,
        // Only ever one of the two: the provider treats a request with frames as
        // image-to-video and discards references entirely.
        ...(frame_images.length ? { frame_images } : {}),
        model,
        duration,
        size,
        resolution,
        aspect_ratio: supported(ratios, data.aspect_ratio),
        // Consent re-sent per request: the server refuses local clips without it.
        ...(shareLocalVideos ? { shareLocalVideos: true } : {}),
        ...(canAudio ? { generate_audio: Boolean(data.generateAudio) } : {}),
      });

      // What a poll needs to name the file, kept next to the id so a resumed
      // poll after a reload has everything it needs from data.job alone.
      const jobParams = { prompt, model, duration, resolution, size };
      // Written before the first poll, not after — this line is the whole task:
      // a crash or a reload one line later still leaves the id recoverable.
      updateNodeData(id, { job: { id: resp.id, startedAt: Date.now(), params: jobParams } });
      // Recorded synchronously, before runJob starts: updateNodeData above is
      // queued and only lands on a later React commit, and when it does, the
      // resume effect above will notice data.job?.id changed and re-run. Without
      // this ref already holding the id by then, that effect would see this very
      // job appear and start a second loop for it.
      startedJobIds.current.add(resp.id);
      await runJob(resp.id, jobParams);
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }

  const hasJob = Boolean(data.job);
  // Floored, not rounded: "N min" means N full minutes have passed, not that the
  // Nth one has started.
  const jobMinutes = hasJob ? Math.max(0, Math.floor((Date.now() - data.job.startedAt) / 60000)) : 0;

  return (
    <Card width={300} padding={0}>
      <Handle type="target" position={Position.Left} />
      <NodeHeader kind="videoOutput" title="video" family="output" />

      <VStack gap={3} padding={3}>
        <ModelPicker
          models={models}
          value={model}
          kind="video"
          onChange={(v) => updateNodeData(id, { videoModel: v, ...resetModelParams('videoOutput') })}
        />

        {/* Passed as children so Size, Input, Seconds and Audio share ONE wrapping row.
            As a second HStack they could never wrap into the first, so "First and last
            frame" pushed its neighbours out of the card while space sat unused by Size. */}
        <ParamControls params={params} data={data} onChange={(u) => updateNodeData(id, u)}>
          {/* Boolean(data.inputMode) alongside the usual length check: an unconfirmed
              mode (see selectorOptions above) can leave inputModes itself at length 1
              while there is still a stored mode that needs a visible, changeable row. */}
          {(inputModes.length > 1 || Boolean(data.inputMode)) && (
            <Selector
              label="Input"
              size="sm"
              options={selectorOptions}
              value={inputMode}
              onChange={(v) => updateNodeData(id, { inputMode: v })}
            />
          )}
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
        </ParamControls>

        <Button
          label={hasJob ? `Rendering… (${jobMinutes} min)` : status === 'running' ? 'Starting…' : 'Generate'}
          variant="primary"
          isLoading={status === 'running'}
          // A job in flight disables Generate outright: a second click would
          // start a second paid render for the one this node is already
          // tracking, and the id it would return has nowhere to go.
          isDisabled={hasJob || status === 'running'}
          onClick={onGenerate}
        />

        {hasJob && (
          <Button
            label="Forget this job"
            variant="ghost"
            size="sm"
            tooltip="Stops tracking this job here. It does not cancel the render upstream — if it finishes anyway, this node will never learn about it."
            onClick={forgetJob}
          />
        )}

        {wiredVideoIntoVideo && (
          <StatusLine type="warning">
            Describe the result you want, not a change to make. An instruction like
            &ldquo;edit this video to...&rdquo; switches the model into editing mode, which
            OpenRouter cannot currently express and which fails with a duration error.
          </StatusLine>
        )}

        {/* Count-free on purpose: the red connections already say WHICH inputs, and which
            ones changes as you rewire. The line only has to say that something wired in is
            not going. */}
        {ignoredCount > 0 && (
          <StatusLine type="warning">One or more inputs connected will not be sent</StatusLine>
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
