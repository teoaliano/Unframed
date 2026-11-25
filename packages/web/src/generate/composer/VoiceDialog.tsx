import { UnframedError, type Voice } from "@unframed/contracts";
import { Check, CircleAlert, ExternalLink, Play, Search, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button, InlineButton } from "~/components/ui/button";
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { Spinner } from "~/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { Tip } from "../../chrome/ui.tsx";
import { useEngine } from "../../context.ts";

const SEARCH_WAIT_MS = 300;

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

const Columns = () => (
  <colgroup>
    <col className="w-[34%]" />
    <col />
    <col className="w-(--voice-dialog-category-column-width)" />
    <col className="w-13" />
  </colgroup>
);

export interface VoiceDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly current: string | undefined;
  readonly onPick: (voice: { readonly id: string; readonly name: string }) => void;
  readonly finalFocus?: () => HTMLElement | null;
}

export const VoiceDialog = ({ open, onOpenChange, current, onPick, finalFocus }: VoiceDialogProps) => {
  const engine = useEngine();
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState("");
  const [voices, setVoices] = useState<ReadonlyArray<Voice>>();
  const [next, setNext] = useState<string | null>(null);
  const [failure, setFailure] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [previewing, setPreviewing] = useState<string>();
  const player = useRef<HTMLAudioElement | null>(null);
  const request = useRef(0);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onOpenChange(false);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open) return;
    setQuery("");
    setAsked("");
    player.current?.pause();
    setPreviewing(undefined);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setAsked(query.trim()), query.trim() === asked ? 0 : SEARCH_WAIT_MS);
    return () => clearTimeout(timer);
  }, [open, query, asked]);

  const load = useCallback(async (search: string, pageToken?: string) => {
    const id = ++request.current;
    setLoading(true);
    try {
      const answer = await engine.call("voices.list", { ...(search === "" ? {} : { search }), ...(pageToken === undefined ? {} : { pageToken }) });
      if (id !== request.current) return;
      setFailure(undefined);
      setVoices((known) => (pageToken === undefined ? answer.voices : [...(known ?? []), ...answer.voices]));
      setNext(answer.nextPageToken);
    } catch (error) {
      if (id !== request.current) return;
      setFailure(messageOf(error));
      if (pageToken === undefined) setVoices([]);
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [engine]);

  useEffect(() => {
    if (open) void load(asked);
  }, [open, asked, load]);

  const preview = (voice: Voice) => {
    if (!voice.previewUrl) return;
    if (!player.current) {
      player.current = new Audio();
      player.current.onended = () => setPreviewing(undefined);
      player.current.onpause = () => setPreviewing(undefined);
    }
    const audio = player.current;
    if (previewing === voice.id) {
      audio.pause();
      return;
    }
    audio.pause();
    audio.src = voice.previewUrl;
    setPreviewing(voice.id);
    void audio.play().catch(() => setPreviewing(undefined));
  };

  const rows = voices ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup
        className="max-h-[min(var(--voice-dialog-height),calc(100vh-(--spacing(12))))] max-w-(--voice-dialog-width)"
        initialFocus={search}
        data-testid="voice-dialog"
        {...(finalFocus === undefined ? {} : { finalFocus: () => finalFocus() ?? true })}
      >
        <DialogHeader>
          <div className="flex items-center justify-between gap-4 pe-8">
            <DialogTitle>Voices</DialogTitle>
            <span className="text-xs">
              <InlineButton tone="muted" render={<a href="https://elevenlabs.io/app/voice-library" target="_blank" rel="noreferrer" />}>
                Browse voices on ElevenLabs
                <ExternalLink aria-hidden className="size-3" />
              </InlineButton>
            </span>
          </div>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 pb-6">
          <InputGroup>
            <InputGroupAddon>
              <Search aria-hidden />
            </InputGroupAddon>
            <InputGroupInput ref={search} aria-label="Search voices" placeholder="Search voices…" value={query} onChange={(event) => setQuery(event.target.value)} />
            {loading && (
              <InputGroupAddon align="inline-end">
                <Spinner aria-hidden />
              </InputGroupAddon>
            )}
          </InputGroup>
          {failure !== undefined && (
            <Alert variant="error">
              <CircleAlert aria-hidden />
              <AlertTitle>{failure}</AlertTitle>
            </Alert>
          )}
          {voices !== undefined && rows.length === 0 && failure === undefined ? (
            <p className="m-0 py-6 text-center text-sm text-(--voice-dialog-description)">No voice matches. Clear the search.</p>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 overflow-y-hidden [scrollbar-gutter:stable]">
                <Table className="table-fixed">
                  <Columns />
                  <TableHeader>
                    <TableRow>
                      <TableHead>Voice</TableHead>
                      <TableHead>Labels</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>
                        <span className="sr-only">Preview</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                </Table>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
                <Table className="table-fixed">
                  <Columns />
                  <TableBody>
                    {rows.map((voice) => {
                      const isCurrent = voice.id === current;
                      const labels = Object.values(voice.labels).join(" · ");
                      return (
                        <TableRow key={voice.id} data-voice={voice.id}>
                          <TableCell>
                            <InlineButton
                              title={voice.name}
                              onClick={() => {
                                onPick({ id: voice.id, name: voice.name });
                                onOpenChange(false);
                              }}
                            >
                              <span className={isCurrent ? "truncate font-bold" : "truncate"}>{voice.name}</span>
                              {isCurrent && <Check aria-label="Current voice" className="size-3.5 shrink-0" />}
                            </InlineButton>
                          </TableCell>
                          <TableCell>
                            {labels !== "" && (
                              <Tip label={labels} side="top">
                                <span className="block truncate text-(--voice-dialog-meta)">{labels}</span>
                              </Tip>
                            )}
                          </TableCell>
                          <TableCell>{voice.category !== null && <Badge variant="outline">{voice.category}</Badge>}</TableCell>
                          <TableCell>
                            {voice.previewUrl !== null && (
                              <Button variant="ghost" size="icon-xs" aria-label={previewing === voice.id ? `Stop ${voice.name}` : `Preview ${voice.name}`} onClick={() => preview(voice)}>
                                {previewing === voice.id ? <Square aria-hidden /> : <Play aria-hidden />}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {next !== null && (
                  <div className="flex justify-center pt-2">
                    <Button variant="ghost" size="sm" disabled={loading} onClick={() => void load(asked, next)}>
                      Load more
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogPopup>
    </Dialog>
  );
};
