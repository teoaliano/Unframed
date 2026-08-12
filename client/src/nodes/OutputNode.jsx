import { useState, useEffect } from 'react';
import { Handle, Position, useReactFlow, useNodes, useEdges } from '@xyflow/react';
import { Card } from '@astryxdesign/core/Card';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { Selector } from '@astryxdesign/core/Selector';
import { Thumbnail } from '@astryxdesign/core/Thumbnail';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Icon } from '@astryxdesign/core/Icon';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { useToast } from '@astryxdesign/core/Toast';
import NodeHeader from './NodeHeader.jsx';
import RunsControl, { clampRuns } from './RunsControl.jsx';
import StatusLine from './StatusLine.jsx';
import ExpandableNote from './ExpandableNote.jsx';
import { MAX_VIDEO_BYTES } from './VideoNode.jsx';
import { ImageIcon, VideoIcon } from './nodeIcons.jsx';
import { useModels, useModelParams, freeSpot } from './output/core.js';
import { ModelPicker, ParamControls, CostFoot } from './output/controls.jsx';
import { buildRequest, splitSections, findWiredTextNode, freeRunPrompts } from '../graph/resolve.js';
import { generate, generateVideo, runText } from '../api.js';
// Arrow leaving a frame: "send this out onto the canvas". From lucide-react, like
// every other icon here, so it shares the set's grid and stroke.
import { ExternalLink as AddToCanvasIcon } from 'lucide-react';

export default function OutputNode({ id, data }) {
  const { getNodes, getEdges, updateNodeData, getNode, addNodes } = useReactFlow();
  const toast = useToast();
  const [status, setStatus] = useState('idle'); // idle | running | done | error | partial
  const [results, setResults] = useState([]); // [{ image, cost, savedPath, runIndex }]
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(null); // null while the run count isn't known yet
  const [repairCost, setRepairCost] = useState(0); // Free mode's re-split call, if any
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  // Inlining a clip means fetching and base64-ing it, which is not instant.
  const [addingVideo, setAddingVideo] = useState(false);
  const liveNodes = useNodes();
  const liveEdges = useEdges();

  // An output node makes an image or a video; they are different catalogues, with
  // different parameters and different money per click, so the tab decides both.
  const kind = data.kind === 'video' ? 'video' : 'image';

  const { models, defaultModel } = useModels(kind);

  // Fall back to the server's configured model until the user picks one, so this
  // keeps tracking OPENROUTER_IMAGE_MODEL unless explicitly overridden.
  const model = (kind === 'video' ? data.videoModel : data.model) || defaultModel;
  const freeRuns = Boolean(data.freeRuns);
  const runs = clampRuns(data.runs ?? 1);

  const entry = models.find((m) => m.id === model);
  const params = useModelParams(entry, kind);
  const { exactSizes, resolutionTiers, ratios, qualities, backgrounds, durations, canAudio, supported } = params;
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
  const estimate = kind === 'video' && perSecond && duration ? perSecond * duration : null;

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

  // Same idea for a generated clip, with one extra step: the video plays from disk
  // (a URL), but a reference node has to carry base64, because OpenRouter fetches
  // nothing from this machine. So the file is pulled back in and inlined — which is
  // also why the 25MB cap applies here exactly as it does to an uploaded clip.
  async function addVideoToCanvas() {
    setAddingVideo(true);
    try {
      const blob = await fetch(videoUrl).then((r) => {
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
      const spot = freeSpot(getNode, getNodes, id);
      addNodes({
        id: `gen-${Date.now()}-v`,
        type: 'video',
        dragHandle: '.xnode-head',
        className: 'nowheel',
        position: spot,
        data: { fileName: videoUrl.split('/').pop() || 'generated.mp4', dataUrl },
      });
    } catch (err) {
      toast({ body: `Could not add the video: ${err.message}`, uniqueID: `add-video-${id}` });
    } finally {
      setAddingVideo(false);
    }
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

  // Same live subscription, for the video-reference warnings below. Local clips are
  // counted apart because video generation rejects them outright: OpenRouter's
  // /videos endpoint takes video_url only as a public HTTPS URL, and its Files API
  // (which could have hosted one) accepts images, audio and documents but not video.
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

  // Seedance picks its mode from the PROMPT, and only one of the two works here.
  // Reference-to-video (describe the result you want) is fine: size and duration
  // are honoured. Video EDITING (instruct a change to the clip) is not reachable
  // through OpenRouter at all: the provider then demands `duration: -1`, which
  // OpenRouter's own validation rejects ("expected number to be >=1"), whether we
  // send a duration or leave it out. Verified against the live API, 2026-08-12.
  const wiredVideoIntoVideo = kind === 'video' && wiredVideos > 0;

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

      // Video takes minutes and is billed by the second, so it runs once per click
      // and reports the job's own status rather than a run counter.
      if (kind === 'video') {
        setTotal(1);
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
        setVideoUrl(resp.url);
        setResults([{ ...resp, runIndex: 0 }]);
        setDone(1);
        setNote(null);
        setStatus('done');
        return;
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
            resolution: supported(resolutionTiers, data.resolution),
            quality: supported(qualities, data.quality),
            aspect_ratio: supported(ratios, data.aspect_ratio),
            background: supported(backgrounds, data.background),
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

  const spent = results.reduce((sum, r) => sum + (Number(r.cost) || 0), 0) + repairCost;
  const hasSpend = results.some((r) => r.cost != null) || repairCost > 0;
  const hasStrip = results.length > 0 || repairCost > 0;

  return (
    <Card width={300} padding={0}>
      <Handle type="target" position={Position.Left} />
      <NodeHeader kind="output" family="output" />

      <VStack gap={3} padding={3}>
        {/* Image or video is the node's first decision: it picks the catalogue, the
            controls, and the order of magnitude of the bill. */}
        <SegmentedControl
          label="Output kind"
          size="sm"
          layout="fill"
          value={kind}
          onChange={(v) => {
            clearResults();
            setVideoUrl(null);
            updateNodeData(id, { kind: v });
          }}
        >
          <SegmentedControlItem value="image" label="Image" icon={<Icon icon={ImageIcon} />} />
          <SegmentedControlItem value="video" label="Video" icon={<Icon icon={VideoIcon} />} />
        </SegmentedControl>

        <ModelPicker
          models={models}
          value={model}
          kind={kind}
          onChange={(v) => updateNodeData(id, kind === 'video' ? { videoModel: v } : { model: v })}
        />

        <ParamControls params={params} data={data} onChange={(u) => updateNodeData(id, u)} />

        {kind === 'video' && (durations || canAudio) && (
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

        {kind === 'image' && (
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
        )}

        <Button
          label={
            status === 'running'
              ? kind === 'video'
                // The job's own state reads better in the button than as a small
                // label elsewhere — same pattern as the image counter.
                ? note
                  ? `${note.replace(/…$/, '')[0].toUpperCase()}${note.replace(/…$/, '').slice(1)}…`
                  : 'Rendering…'
                : total
                  ? `Generating ${done} / ${total}…`
                  : 'Generating…'
              : kind === 'video'
                ? 'Generate'
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
          isDisabled={kind === 'image' && freeRuns && !liveWiredTextNode}
          onClick={onGenerate}
        />

        {/* A local clip cannot reach video generation at all — that is a hard 400
            from OpenRouter, not a maybe — so it is called out even for models that
            do accept footage. Sharing is per-node opt-in, never automatic: it makes
            the clip publicly fetchable (unguessable URL, dedicated share-only
            server, dies with the job), and that is a call the user makes knowingly. */}

        {wiredVideoIntoVideo && (
          <StatusLine type="warning">
            Describe the result you want, not a change to make. An instruction like
            &ldquo;edit this video to...&rdquo; switches the model into editing mode, which
            OpenRouter cannot currently express and which fails with a duration error.
          </StatusLine>
        )}

        {kind === 'video' && wiredLocalVideos > 0 && (
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

        {wiredVideos > 0 && wiredLocalVideos === 0 && (kind === 'image' || entry?.acceptsVideo === false) && (
          <StatusLine type="warning">
            {wiredVideos === 1 ? 'A video is' : `${wiredVideos} videos are`} wired in, but{' '}
            {kind === 'video'
              ? 'this model is not known to accept video input'
              : 'image models do not take video input'}
            . It will be sent and probably ignored.
          </StatusLine>
        )}

        {kind === 'image' && freeRuns && !liveWiredTextNode && (
          <StatusLine type="info">
            {'Wire a text node with a "---" separated list'}
            <br />
            Each item turns into one generation.
          </StatusLine>
        )}

        {/* The message already carries the outcome ("2 of 3 succeeded. …"), so the
            icon only has to say which kind of outcome it is. */}
        {(status === 'error' || status === 'partial') && (
          <StatusLine type={status === 'partial' ? 'warning' : 'error'}>{error}</StatusLine>
        )}

        {/* note is not rendered on its own: while a video job runs it IS the
            button's label, and after it finishes there is nothing left to say. */}

        {kind === 'video' && videoUrl && (
          // Played from the file on disk, not from node data: a clip inlined into
          // the graph would be written back to graph.json on every edit. The add
          // button is the one place that does inline it, on demand.
          <span className="xnode-result">
            <video className="xnode-video" src={videoUrl} controls preload="metadata" />
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

        {kind === 'image' && hasStrip && (
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
                    <Button
                      label={`Add result ${r.runIndex + 1} to the canvas`}
                      tooltip="Add to canvas as an image node"
                      isIconOnly
                      icon={<Icon icon={AddToCanvasIcon} size="xsm" />}
                      size="sm"
                      onClick={() => addToCanvas(r, 0, freeSpot(getNode, getNodes, id))}
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
                  const base = freeSpot(getNode, getNodes, id);
                  [...results]
                    .sort((a, b) => a.runIndex - b.runIndex)
                    .forEach((r, i) => addToCanvas(r, i, base));
                }}
              />
            )}
          </VStack>
        )}
      </VStack>

      <CostFoot
        cost={hasSpend ? spent : null}
        before={
          !hasStrip && estimate ? (
            // The upcoming click's price, from the model's per-second rate. Images
            // get no estimate: their pricing is per token, and a guess dressed as
            // a number would be worse than silence.
            <Text type="supporting" color="secondary" hasTabularNumbers>
              est. ~${estimate.toFixed(2)}
            </Text>
          ) : null
        }
        after={
          hasStrip ? (
            <>
              {hasSpend && results.length > 1 && (
                <Text type="supporting" color="secondary">{results.length} images</Text>
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
            </>
          ) : null
        }
      />
    </Card>
  );
}
