import { useState, useEffect, useRef } from 'react';
import { Handle, Position, useReactFlow, useNodes, useEdges } from '@xyflow/react';
import { Card } from '@astryxdesign/core/Card';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
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
import { ModelPicker, ParamControls, CostFoot, NativeSelect } from './output/controls.jsx';
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
  // { url, cost, savedPath } for a run finished in THIS component instance. NOT
  // seeded from data.result: a lazy useState initialiser runs exactly once per
  // instance, and React Flow reuses an instance (rather than mounting a fresh one)
  // whenever a node with this id is already on the canvas — which is every page
  // load, since the starter graph's own videoOutput node shares the loaded
  // project's id space. A seed here would silently never fire on that path. See
  // `shown` below, computed fresh on every render, for what actually displays.
  const [result, setResult] = useState(null);
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
  // each — no matter how many times React StrictMode's dev-only double-mount fires
  // the resume effect below twice, or onGenerate's own call into runJob lands before
  // the data.job update it just wrote has round-tripped back through props (see that
  // effect's comment). A genuine project switch no longer needs this guard: the
  // canvas remounts on `canvasGeneration` (App.jsx), so a switch gives this job a
  // brand new component instance with an empty set, same as a reload. Without this
  // guard, either remaining case would start a SECOND loop for a job something else
  // already has one running for, and the server re-downloads (and re-saves) a
  // completed job on every poll that reaches it rather than caching it — see the
  // completion branch of /api/video/:id.
  const startedJobIds = useRef(new Set());
  // True while a poll loop -- fast or the slow re-arm below -- is actively in flight
  // for the CURRENT job. Unlike startedJobIds (which never clears, and only stops
  // THIS component's own effects from re-firing for a job they already started once),
  // this clears the moment a loop exits. It exists so the resume effect and the
  // re-arm effect can never both start a loop for the same job in the same commit:
  // if a job is already pending when this component mounts, both effects run in the
  // same pass, and setStatus('running') from the first one is not yet visible to the
  // second one's closure (state updates are batched) -- but this ref IS, since runJob
  // sets it synchronously before its first await.
  const loopRunning = useRef(false);

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

  // Computed once and shared by every count below, so the three things this card can
  // say about its wired videos -- the ignored-input warning, the "probably ignored"
  // capability warning, and the sharing block's promises -- describe the same request
  // bucketSources itself will build, rather than three independent readings of the
  // edges that can disagree the moment a frame mode is active.
  const buckets = bucketSources(liveNodes, liveEdges, id);
  const ignoredCount = buckets.excess.length;

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
  //
  // Read off buckets.references rather than the raw edges: a frame mode sends no
  // references at all (frames are images only, so any wired video lands in `excess`
  // instead -- see bucketSources), and counting from the edges directly ignored that,
  // which is how one card ended up claiming a video would be sent, ignored, AND shared
  // over a tunnel all at once.
  const wiredVideoSources = buckets.references.filter((n) => n.type === 'video' && n.data?.dataUrl);
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
  // Takes the url to add explicitly rather than closing over `result`: the only
  // caller passes `shown.url`, since a reopened node's clip lives in `data.result`
  // with no local `result` of its own (see `shown` below).
  async function addVideoToCanvas(url) {
    setAddingVideo(true);
    try {
      const blob = await fetch(url).then((r) => {
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
        className: 'nowheel',
        position: freeSpot(getNode, getNodes, id),
        data: { fileName: url.split('/').pop() || 'generated.mp4', dataUrl },
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
    // Persisted pointer goes too (dropped from graph.json entirely, same as
    // `job: undefined` below) — otherwise a cleared node would show the clip again
    // the next time it reloads.
    updateNodeData(id, { result: undefined });
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
  // `pollOpts` is forwarded straight to pollVideo -- undefined means its own 15-minute
  // default (the fast 4s-interval window); the slow re-arm effect below passes
  // `{ until: 0 }` for a single immediate check instead of resuming a full fast loop.
  async function runJob(jobId, jobParams, pollOpts) {
    // A loop outlives the job that started it — Forget, then Generate again while
    // this one is still mid-poll, is enough. Every write below the await must
    // confirm it still owns the node's CURRENT job, or a finished job A clears (or
    // overwrites the UI for) a job B that started after it — the one outcome this
    // entire task exists to prevent. Not needed above the await: jobId is only ever
    // passed in already matching data.job.id at call time.
    const stillOurs = () => getNode(id)?.data?.job?.id === jobId;

    // Set synchronously, before setStatus or any await -- see loopRunning's own
    // comment for why that ordering is what lets the resume and re-arm effects share
    // one guard even when both run in the same commit.
    loopRunning.current = true;
    setStatus('running');
    setError(null);
    try {
      const d = await pollVideo(jobId, jobParams, () => stillOurs() && bump((n) => n + 1), pollOpts);
      if (!stillOurs()) return;
      if (d.pending) {
        // Not a failure, and not a reason to touch data.job — the node stays
        // exactly as it was. The re-arm effect below is what stops this from being
        // a dead end: it notices status is back to idle with a job still stored,
        // and schedules another look.
        setStatus('idle');
        return;
      }
      const finished = { url: d.url, cost: d.cost, savedPath: d.savedPath };
      setResult(finished);
      setStatus('done');
      // The pointer, not the bytes -- there are none to persist, the clip already
      // plays from `url` same as it always has. Written in the same call that
      // clears `job`: a result and a pending job are never both true at once (see
      // the comment on the resume effect below), and one updateNodeData call is
      // what keeps that atomic instead of two writes a remount could land between.
      updateNodeData(id, { job: undefined, result: finished });
    } catch (err) {
      if (!stillOurs()) return;
      setError(err.message);
      setStatus('error');
      // A genuine failure (the job itself failed upstream) is the only other
      // reason to clear the job — pollVideo never throws for a transient error
      // reaching our own server, only for that.
      updateNodeData(id, { job: undefined });
    } finally {
      loopRunning.current = false;
    }
  }

  // Picks up a pending job with no user action — the entire point of persisting
  // one. Fires whenever data.job?.id changes to something this component instance
  // hasn't already started a loop for: on a genuine fresh mount, which now covers
  // both a reload AND a project switch (the canvas remounts on `canvasGeneration` —
  // see App.jsx — so a switch into a project with a pending job is indistinguishable
  // from a reload as far as this effect is concerned). startedJobIds is what stops
  // this from ALSO starting a second loop for a job onGenerate (or React
  // StrictMode's dev-only double-mount) already has one running for; stillOurs()
  // inside runJob is what keeps two loops from corrupting each other's state if
  // they ever do briefly overlap.
  useEffect(() => {
    const jobId = data.job?.id;
    if (jobId && !startedJobIds.current.has(jobId)) {
      startedJobIds.current.add(jobId);
      // Whatever result/error is showing locally belongs to a stale run — a
      // StrictMode double-mount, or onGenerate's own start already updating this
      // job — never to this one: a job and a result for IT are never both present
      // at once (runJob clears one exactly when it sets the other).
      setResult(null);
      setError(null);
      runJob(jobId, data.job.params);
    }
  }, [data.job?.id]);

  // The fast loop above gives up after its budget (pollVideo's default 15 minutes),
  // leaving data.job in place — that part is deliberate, the job may still be
  // rendering. But nothing then asked again: startedJobIds already has this id, and
  // the effect above only fires when data.job?.id CHANGES, so a render queued for
  // over an hour sat frozen at "Rendering… (N min)" until a reload. This re-arms at
  // a much slower cadence instead of a reload: once runJob has actually given up
  // (status idle) and nothing is already polling this job (loopRunning, checked so
  // this can never stack a second loop under one still running), wait, then take a
  // single look (`{ until: 0 }` makes pollVideo check once and return immediately
  // instead of resuming a full 4s-interval window). If still pending, status goes
  // back to idle and this effect reschedules itself. The server's own sweep is what
  // actually finishes an abandoned job; this only keeps the node's display current
  // with no user action, without polling every 4s indefinitely.
  useEffect(() => {
    const jobId = data.job?.id;
    if (!jobId || status !== 'idle' || loopRunning.current) return;
    const RECHECK_MS = 2 * 60 * 1000;
    const timer = setTimeout(() => {
      if (!loopRunning.current && getNode(id)?.data?.job?.id === jobId) {
        runJob(jobId, data.job.params, { until: 0 });
      }
    }, RECHECK_MS);
    // Unmounting cancels the scheduled recheck outright — there is no node left to
    // update, and the fast loop's own in-flight fetch (if any) is already guarded by
    // stillOurs() inside runJob.
    return () => clearTimeout(timer);
  }, [data.job?.id, status]);

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
      // result: undefined clears any PREVIOUS run's persisted pointer here too, so
      // a reload while this new job is still rendering shows "no result yet"
      // rather than resurrecting the clip this run is about to replace.
      updateNodeData(id, {
        job: { id: resp.id, startedAt: Date.now(), params: jobParams },
        result: undefined,
      });
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

  // What actually displays: this instance's own finished run if it has one, else
  // whatever pointer survived in node data (a reopened node that never finished a
  // job in THIS component instance — see the comment on `result` above). Derived
  // on every render rather than seeded once, so it stays correct across the
  // reused-instance page-load case a lazy initialiser missed entirely.
  const shown = result ?? data.result ?? null;

  return (
    <Card width={300} padding={0}>
      <Handle type="target" position={Position.Left} />
      <NodeHeader kind="videoOutput" title="video" family="output" />

      {/* nodrag on the whole body, not per control: Astryx portals a Selector's
          popup UP to this stack, so no wrapper around the control can ever contain
          it, and an open model list would otherwise drag the node. Everything in
          here is a control anyway -- these nodes drag by their header, footer and
          card edge. See the 2026-08-18 canvas-interaction spec. */}
      <VStack gap={3} padding={3} className="nodrag">
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
            <NativeSelect
              label="Input"
              options={selectorOptions}
              value={inputMode}
              onChange={(v) => updateNodeData(id, { inputMode: v })}
            />
          )}
          {durations && (
            <NativeSelect
              label="Seconds"
              options={durations}
              value={String(duration)}
              onChange={(v) => updateNodeData(id, { duration: Number(v) })}
            />
          )}
          {canAudio && (
            // A checkbox, not a toggle-button: this is an on/off flag, and a
            // ghost button reads as "not set" rather than "off". The wrapper
            // gives it the same height as the select's box so the two line up
            // on their centres — bottom-aligning them does not, since the
            // select's box is taller than the checkbox.
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

        {shown?.url && (
          // Played from the file on disk, not from node data: a clip inlined into
          // the graph would be written back to graph.json on every edit. The add
          // button is the one place that does inline it, on demand. `shown`, not
          // `result`: a reopened node (page load or project switch) has a
          // persisted pointer but no local `result` of its own.
          <span className="xnode-result">
            <video className="xnode-video nowheel" src={shown.url} controls preload="metadata" />
            <span className="xnode-result-add">
              <Button
                label="Add this video to the canvas"
                tooltip="Add to canvas as a video node, so it can be wired back in as a reference"
                isIconOnly
                icon={<Icon icon={AddToCanvasIcon} size="xsm" />}
                size="sm"
                isLoading={addingVideo}
                onClick={() => addVideoToCanvas(shown.url)}
              />
            </span>
          </span>
        )}
      </VStack>

      <CostFoot
        cost={shown?.cost != null ? shown.cost : null}
        before={
          !shown && estimate ? (
            // The upcoming click's price, from the model's per-second rate. Images
            // get no estimate: their pricing is per token, and a guess dressed as a
            // number would be worse than silence.
            <Text type="supporting" color="secondary" hasTabularNumbers>
              est. ~${estimate.toFixed(2)}
            </Text>
          ) : null
        }
        after={
          shown ? (
            <span className="xnode-foot-end">
              <Button
                className="nodrag"
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
