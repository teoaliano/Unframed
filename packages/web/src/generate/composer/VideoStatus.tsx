import { videoStatusLines } from "@unframed/domain";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { MediumStatusProps } from "../mediumRegistry.ts";
import { videoCounts } from "../videoPlan.ts";

export const SHARE_LABEL = "Share via temporary link while generating";
export const SHARE_NOTE = "What sharing does";
export const SHARE_ON =
  "While this generates, the clip is served from this machine through a temporary public link only the model provider receives. Nothing is uploaded to storage, and the link stops working when the job ends.";
export const SHARE_OFF =
  "Video generation only accepts a reference video as a public https:// link, and this one is a local file. Generating will fail unless you tick this, or use the clip in a text run instead, which does take local files.";

/** The share consent and its note, shown only while a local clip will be sent. */
const ShareBlock = ({ on, onChange }: { readonly on: boolean; readonly onChange: (on: boolean) => void }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="unframed-share" data-testid="share-block">
      <div className="unframed-share__row">
        <label className="unframed-share__consent">
          <input
            type="checkbox"
            checked={on}
            onChange={(event) => {
              const next = event.currentTarget.checked;
              onChange(next);
              // Turning sharing off opens the note, so the warning that generating will fail is read.
              if (!next) setOpen(true);
            }}
          />
          {SHARE_LABEL}
        </label>
        <button type="button" className="unframed-share__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {SHARE_NOTE}
          <ChevronDown size={12} aria-hidden data-open={open ? "true" : undefined} />
        </button>
      </div>
      {open &&
        (on ? (
          <p role="status" data-kind="info">
            {SHARE_ON}
          </p>
        ) : (
          <p role="status" data-kind="warning">
            {SHARE_OFF}
          </p>
        ))}
    </div>
  );
};

/** The video tray's status band: its warnings in order with the share block among them, then the blockers and the last start error. */
export const VideoStatus = ({ status, failure, values, source, entry, setProps }: MediumStatusProps) => {
  const lines = videoStatusLines({ counts: videoCounts(source, values.props, entry), entry, shareLocalVideos: values.props.shareLocalVideos });
  if (lines.length === 0 && status.blockers.length === 0 && failure === undefined) return null;
  return (
    <div className="unframed-composer-status" data-testid="composer-status">
      {lines.map((line) =>
        line.kind === "share" ? (
          <ShareBlock key="share" on={line.on} onChange={(on) => setProps({ ...values.props, shareLocalVideos: on })} />
        ) : (
          <p key={line.text} role="status" data-kind="warning">
            {line.text}
          </p>
        ),
      )}
      {status.blockers.map((line) => (
        <p key={line} role="status" data-kind="blocked">
          {line}
        </p>
      ))}
      {failure !== undefined && (
        <p role="alert" data-kind="error">
          {failure}
        </p>
      )}
    </div>
  );
};

