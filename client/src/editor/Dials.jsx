import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Check, Download, SlidersHorizontal } from 'lucide-react';
import { createDialRoot, createDialKit } from 'dialkit/vanilla';
import 'dialkit/vanilla/styles.css';
import { dialsControls, installDialsControls } from '../api.js';

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
export default function Dials({ project, dials, onChange, frameRef }) {
  const host = useRef(null);
  const root = useRef(null);
  const kit = useRef(null);
  // What the artifact last announced: { name, config, values } | null.
  const [panel, setPanel] = useState(null);
  const [installed, setInstalled] = useState(null); // null = not asked yet
  const [installing, setInstalling] = useState(false);
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
      if (timer.current) clearTimeout(timer.current);
    };
    // `dials` is deliberately not a dependency either: it is the SAVED value, and
    // re-running this on every write would rebuild the panel under the pointer mid-drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, frameRef]);

  useEffect(() => () => root.current?.destroy(), []);

  // Only asked once there is something to be self-contained about.
  useEffect(() => {
    if (!panel || installed !== null) return;
    dialsControls(project).then(setInstalled);
  }, [panel, installed, project]);

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
          No parameters yet. Ask the agent to expose some — “expose the accent colour and the intro speed as parameters”.
        </Text>
      )}
      {/* Making the FILE self-contained -- nothing about the controls above, which are
          already here and working. The first wording led with the mechanism ("install
          them in the project") while the person was looking at working controls, and read
          as if they were not installed (Matteo, 2026-09-07). It now leads with the
          situation it is about: the file, opened somewhere else. */}
      {panel && installed !== null && (
        <VStack gap={1} className="editor-dials-foot">
          {installed ? (
            <HStack gap={1} align="center">
              <Icon icon={Check} size="sm" />
              <Text type="supporting" color="secondary">
                Opened outside Unframed, this file carries these controls with it.
              </Text>
            </HStack>
          ) : (
            <>
              {/* Stacked, not a row: this column is ~300px and a row of sentence + button
                  + note wrapped into three narrow ribbons. */}
              <Text type="supporting" color="secondary">
                Opened outside Unframed, this file plays without these controls. Adding them costs about 300KB, once per project.
              </Text>
              <Button
                size="sm"
                variant="secondary"
                label={installing ? 'Adding…' : 'Add them to the file'}
                icon={<Icon icon={Download} />}
                isLoading={installing}
                onClick={async () => {
                  setInstalling(true);
                  try {
                    setInstalled(await installDialsControls(project));
                  } catch {
                    setInstalled(false);
                  } finally {
                    setInstalling(false);
                  }
                }}
              />
            </>
          )}
        </VStack>
      )}
    </>
  );
}
