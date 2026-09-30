import { videoStatusLines } from "@unframed/domain";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { InlineButton } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";
import type { MediumStatusProps } from "../mediumRegistry.ts";
import { videoCounts } from "../videoPlan.ts";
import { StatusBand, StatusLine } from "./StatusLine.tsx";

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
    <div className="flex flex-col gap-1" data-testid="share-block">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs">
        <Label>
          <Checkbox
            checked={on}
            onCheckedChange={(next) => {
              onChange(next);
              // Turning sharing off opens the note, so the warning that generating will fail is read.
              if (!next) setOpen(true);
            }}
          />
          {SHARE_LABEL}
        </Label>
        <InlineButton tone="muted" aria-expanded={open} onClick={() => setOpen(!open)}>
          {SHARE_NOTE}
          <ChevronDown aria-hidden className="size-3 transition-transform data-[open=true]:rotate-180" data-open={open ? "true" : undefined} />
        </InlineButton>
      </div>
      {open &&
        (on ? <StatusLine kind="info">{SHARE_ON}</StatusLine> : <StatusLine kind="warning">{SHARE_OFF}</StatusLine>)}
    </div>
  );
};

/** The video tray's status band: its warnings in order with the share block among them, then the blockers and the last start error. */
export const VideoStatus = ({ status, failure, values, source, entry, setProps }: MediumStatusProps) => {
  const lines = videoStatusLines({ counts: videoCounts(source, values.props, entry), entry, shareLocalVideos: values.props.shareLocalVideos });
  if (lines.length === 0 && status.blockers.length === 0 && failure === undefined) return null;
  return (
    <StatusBand>
      {lines.map((line) =>
        line.kind === "share" ? (
          <ShareBlock key="share" on={line.on} onChange={(on) => setProps({ ...values.props, shareLocalVideos: on })} />
        ) : (
          <StatusLine key={line.text} kind="warning">
            {line.text}
          </StatusLine>
        ),
      )}
      {status.blockers.map((line) => (
        <StatusLine key={line} kind="blocked">
          {line}
        </StatusLine>
      ))}
      {failure !== undefined && <StatusLine kind="error">{failure}</StatusLine>}
    </StatusBand>
  );
};

