import { useRef, useState } from 'react';
import { HStack } from '@astryxdesign/core/Stack';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Icon } from '@astryxdesign/core/Icon';
import { Slider } from '@astryxdesign/core/Slider';
import { Text } from '@astryxdesign/core/Text';
import { Play, Pause } from 'lucide-react';

// A clip with its controls OUTSIDE the video element, which is the only way a node
// can have both a scrubber and a drag surface. Native controls live in shadow DOM, so
// a press on the timeline retargets to the <video> itself: nothing downstream can tell
// a scrub from a drag, and the clip had to carry `nodrag` to stay usable. Out here the
// frame is an ordinary drag surface like a picture, and the control row opts out the
// same way every other control in a node does.
//
// Deliberately NOT `nowheel`: with no native controls there is nothing on the clip for
// a wheel to work, so keeping it would mean scrolling over a clip did nothing while
// scrolling anywhere else panned the canvas.
//
// The frame and the controls are SEPARATE components over one hook because the input
// node now places them in different parts of the tree — the clip inside the card, the
// transport below it, out on the canvas beside the role line. That is the same rule as
// above taken one step further: not merely off the <video>, but off the card entirely,
// so the clip runs edge to edge. VideoOutputNode wants them adjacent and uses the
// default export, which is the two of them stacked as before.

function clock(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const s = Math.floor(seconds % 60);
  return `${Math.floor(seconds / 60)}:${String(s).padStart(2, '0')}`;
}

// Owns the element and everything the transport needs to know about it. The caller
// holds the returned object and hands it to both halves, so the two stay in step
// however far apart they are rendered.
export function useVideoPlayback() {
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [length, setLength] = useState(0);
  return { ref, playing, setPlaying, at, setAt, length, setLength };
}

export function VideoFrame({ player, src }) {
  const { ref, setLength, setAt, setPlaying } = player;
  return (
    <video
      className="xnode-video"
      ref={ref}
      src={src}
      muted
      preload="metadata"
      onLoadedMetadata={(e) => setLength(e.currentTarget.duration || 0)}
      // `timeupdate` fires roughly four times a second, which is enough for a
      // scrubber. A requestAnimationFrame loop would be smoother and would mean a
      // running frame loop per video node on the canvas.
      onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
    />
  );
}

export function VideoControls({ player }) {
  const { ref, playing, at, setAt, length } = player;
  const maxLength = length || 1;

  function toggle() {
    if (ref.current?.paused) ref.current.play();
    else ref.current?.pause();
  }

  function seek(v) {
    setAt(v);
    if (ref.current) ref.current.currentTime = v;
  }

  return (
    <HStack className="xnode-player nodrag" gap={2} vAlign="center">
      <IconButton
        variant="ghost"
        size="sm"
        label={playing ? 'Pause' : 'Play'}
        icon={<Icon icon={playing ? Pause : Play} />}
        onClick={toggle}
      />
      <Slider
        className="xnode-player-track"
        label="Position"
        isLabelHidden
        // Astryx's default is a value bubble built on Tooltip, and an anchored
        // tooltip inside a node can render at a corner of the window in the packaged
        // app — the same defect that keeps the model parameters on native selects.
        valueDisplay="none"
        min={0}
        max={maxLength}
        step={0.01}
        value={Math.min(at, maxLength)}
        onChange={seek}
      />
      {/* Tabular numbers so the row does not twitch as the seconds tick over. */}
      <Text type="supporting" color="secondary" hasTabularNumbers>
        {`${clock(at)} / ${clock(length)}`}
      </Text>
    </HStack>
  );
}

// Frame and transport together, for callers that want them adjacent inside one card.
export default function VideoPlayer({ src }) {
  const player = useVideoPlayback();
  return (
    <>
      <VideoFrame player={player} src={src} />
      <VideoControls player={player} />
    </>
  );
}
