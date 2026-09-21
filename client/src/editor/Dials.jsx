import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { HStack, VStack, StackItem } from '@astryxdesign/core/Stack';
import { TextArea } from '@astryxdesign/core/TextArea';
import { SlidersHorizontal, Sparkles } from 'lucide-react';
import { createDialRoot, createDialKit } from 'dialkit/vanilla';
import 'dialkit/vanilla/styles.css';

// The editor's Parameters column: the controls an artifact exposed, hosted here rather
// than inside the artifact. Design: docs/superpowers/specs/2026-09-06-chats-and-tags-design.md,
// decision 8; the contract the agent writes against is server/dials.js.
//
// The artifact announces `{ name, config, values }` through the viewer, which relays it
// (server/motion.js, viewerHtml). This mounts DialKit on that config and sends every
// change back down. Nothing about the artifact's own file changes: a parameter is a value
// on the NODE, so tuning is an ordinary undoable canvas edit and re-rendering picks it up.
//
// DialKit is imported here and NOT copied into the project folder, which is what keeps
// 250KB out of every project and every render -- a render needs the values, never a
// control to drag. The one thing that costs is a composition opened outside the app: with
// no canvas above it there is nobody to host this panel, so the action below installs
// DialKit beside the artifacts and the viewer mounts its own.
// What the agent is asked when someone describes a parameter here. It names the artifact,
// says where the controls have to end up, and insists the callback APPLIES the value rather
// than declaring one it then ignores -- the failure that looks like a working control doing
// nothing. Kept whole and in one place: it is the instruction, and reading it is how anyone
// knows what this box actually does.
const ASK = (title, kind, wanted) =>
  [
    `Add ${wanted.trim()} as ${/\band\b|,/.test(wanted) ? 'parameters' : 'a parameter'} on the ${kind} "${title}".`,
    'Expose them with a single `unframed.dials` call so they appear in the Parameters column,',
    'and make the callback actually apply each value.',
    // Without this clause the model reaches for a DOM write every time, which is correct
    // only for a value nothing animates. Anything the timeline owns has to be wired INTO
    // it, or the control works until the clip is played and then appears to forget itself.
    'If any of them is part of the animation rather than just dressing, wire it into the timeline —',
    'rebuild the timeline from the values instead of setting an animated property alongside it —',
    'and express anything that changes over time as its start, its end and a duration.',
    'Keep every parameter it already has, and change nothing else about it.',
  ].join(' ');

export default function Dials({ project, node, dials, onChange, onAsk, frameRef }) {
  const host = useRef(null);
  const root = useRef(null);
  const kit = useRef(null);
  // What the artifact last announced: { name, config, values } | null.
  const [panel, setPanel] = useState(null);
  // What the person is asking for, and the request in flight.
  const [wanted, setWanted] = useState('');
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState(null);
  // The latest values, for the debounced write. A ref so the timer does not capture a
  // stale set and undo a change made while it was pending.
  const latest = useRef(null);
  const timer = useRef(null);
  // The callback in a ref, NOT in the effect's dependencies. It arrives as a fresh
  // function on every render of the editor, and with it in the deps the DialKit
  // controller was rebuilt each time -- and `subscribe` fires immediately, so every
  // rebuild pushed the panel's CURRENT values down again. A change would land and then be
  // overwritten by the defaults a moment later, and a drag would fight the same reset.
  const notify = useRef(onChange);
  useEffect(() => {
    notify.current = onChange;
  }, [onChange]);

  // Say hello to the viewer, which replays whatever the composition already announced.
  // The canvas has to speak first: neither side knows the other's origin until it does,
  // and that is what lets every message be addressed rather than posted to "*".
  useEffect(() => {
    const win = frameRef.current?.contentWindow;
    if (!win) return undefined;
    const hello = () => win.postMessage({ type: 'unframed:dials:hello' }, '*');
    hello();
    // The frame may still be loading; a second hello once it is up costs nothing.
    const frame = frameRef.current;
    frame.addEventListener('load', hello);
    return () => frame.removeEventListener('load', hello);
  }, [frameRef]);

  useEffect(() => {
    function onMessage(event) {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (event.data?.type !== 'unframed:dials') return;
      setPanel({ name: event.data.name, config: event.data.config, values: event.data.values });
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frameRef]);

  // Mount DialKit on whatever was announced, and send every change down. `dials` (the
  // node's saved values) are applied over the announced ones, so reopening the editor
  // shows what was tuned rather than the composition's defaults.
  useEffect(() => {
    if (!panel || !host.current) return undefined;
    if (!root.current) root.current = createDialRoot({ target: host.current, mode: 'inline', theme: 'dark' });
    const controller = createDialKit(panel.name || 'Parameters', panel.config, { id: `unframed-${panel.name || 'dials'}` });
    kit.current = controller;
    if (dials && Object.keys(dials).length) {
      try {
        controller.setValues(dials);
      } catch {
        // A saved value the new version of the composition no longer has: the artifact's
        // own merge already dropped it, and DialKit refusing it here is the same answer.
      }
    }
    const off = controller.subscribe((values) => {
      latest.current = values;
      frameRef.current?.contentWindow?.postMessage({ type: 'unframed:dials:set', values }, '*');
      // One op per pause, not one per pixel of a drag -- the same 400ms the document
      // treats as a unit of work, so a drag is one undo step.
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => notify.current(latest.current), 400);
    });
    return () => {
      off();
      controller.destroy();
      kit.current = null;
      // FLUSH the pending write, never cancel it. Closing the editor within the debounce
      // window used to drop the last thing you changed, silently and permanently: the
      // preview showed it, the node never heard about it, and the canvas correctly showed
      // the untuned artifact afterwards -- which read as the canvas resetting your work
      // (Matteo, 2026-09-14). Every way out unmounts this, so flushing here covers Escape,
      // Back, deleting the artifact and switching to another one alike.
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        if (latest.current) notify.current(latest.current);
      }
    };
    // `dials` is deliberately not a dependency either: it is the SAVED value, and
    // re-running this on every write would rebuild the panel under the pointer mid-drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, frameRef]);

  useEffect(() => () => root.current?.destroy(), []);

  // Send it to the artifact's own chat, and let the panel beside this column show the
  // answer -- the request is an ordinary message, not a hidden side channel.
  async function ask() {
    const text = wanted.trim();
    if (!text || asking) return;
    setAsking(true);
    setAskError(null);
    try {
      await onAsk(node.id, ASK(node.data?.title || node.id, node.type, text));
      setWanted('');
    } catch (err) {
      setAskError(err.message);
    } finally {
      setAsking(false);
    }
  }

  return (
    <>
      <div className="editor-col-head">
        <HStack gap={2} align="center">
          <Icon icon={SlidersHorizontal} size="sm" />
          <Text type="label">Parameters</Text>
        </HStack>
      </div>
      {panel ? (
        <div className="editor-dials" ref={host} />
      ) : (
        <Text type="supporting" color="secondary" className="editor-hint">
          No parameters yet.
        </Text>
      )}
      {/* Asking for a parameter. This replaced an "install the controls into the project"
          button, which was the wrong thing in the right place: it answered a question
          almost nobody has while sitting where people look for a way to ADD a control.
          Describing what you want and having the agent write it is the straight line, and
          it gives the column a purpose when an artifact has no parameters at all. */}
      <VStack gap={1} className="editor-dials-foot">
        <div
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.isComposing) {
              e.preventDefault();
              ask();
            }
          }}
        >
          <TextArea
            label="Add a parameter"
            rows={2}
            value={wanted}
            placeholder={panel ? 'Add a parameter… (e.g. the background colour, the title size)' : 'Describe a parameter… (e.g. the accent colour and the intro speed)'}
            isDisabled={asking}
            onChange={setWanted}
          />
        </div>
        <HStack gap={2} align="center">
          <Text type="supporting" color="secondary">
            The agent writes it
          </Text>
          <StackItem size="fill" />
          <Button
            size="sm"
            variant="secondary"
            label={asking ? 'Asking…' : 'Add'}
            icon={<Icon icon={Sparkles} />}
            isLoading={asking}
            isDisabled={!wanted.trim() || asking}
            onClick={ask}
          />
        </HStack>
        {askError && (
          <Text type="supporting" color="secondary">
            {askError}
          </Text>
        )}
      </VStack>
    </>
  );
}
