import { FileText, RotateCw, X } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { formatSize, type Staged } from "./attachments.ts";

/**
 * The staged attachments above the box: images as a shelf of 64 x 64 thumbnails with
 * their upload progress, other files as chips with their size.
 */
export const AttachmentShelf = ({ staged, onRemove, onRetry }: { readonly staged: ReadonlyArray<Staged>; readonly onRemove: (key: string) => void; readonly onRetry: (key: string) => void }) => {
  if (staged.length === 0) return null;
  const images = staged.filter((item) => item.kind === "image");
  const files = staged.filter((item) => item.kind === "file");
  return (
    <div className="flex flex-wrap gap-1" data-testid="attachments">
      {images.length > 0 && (
        <div className="flex w-full flex-wrap gap-1.5">
          {images.map((item) => (
            <div key={item.key} className="relative size-16 overflow-hidden rounded-lg border border-border/80 bg-background/70" data-status={item.status}>
              {item.preview !== undefined ? (
                <a href={item.preview} target="_blank" rel="noopener noreferrer" aria-label={`Preview ${item.name}`} className="block size-full">
                  <img src={item.preview} alt="" className="block size-full object-cover" />
                </a>
              ) : (
                <span aria-label={`Preview ${item.name}`} className="block size-full" />
              )}
              {item.status === "uploading" && (
                <span className="absolute inset-0 flex items-center justify-center bg-background/60 text-xs text-foreground tabular-nums">{`${item.progress}%`}</span>
              )}
              {item.status === "failed" && (
                <span className="absolute inset-0 flex items-center justify-center bg-background/60">
                  <Button variant="ghost" size="icon-xs" aria-label={`Retry upload for ${item.name}`} onClick={() => onRetry(item.key)}>
                    <RotateCw aria-hidden />
                  </Button>
                </span>
              )}
              <span className="absolute top-0.5 right-0.5">
                <Button variant="outline" size="icon-tiny" aria-label={`Remove ${item.name}`} onClick={() => onRemove(item.key)}>
                  <X aria-hidden />
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}
      {files.map((item) => (
        <Badge key={item.key} variant={item.status === "failed" ? "error" : "outline"} size="lg" className="max-w-full" data-chip="file" data-status={item.status}>
          <FileText aria-hidden />
          <span className="min-w-0 truncate" data-testid="chip-label">
            {item.name}
          </span>
          <span className="shrink-0 text-3xs opacity-80">{item.status === "failed" ? "upload failed" : formatSize(item.size)}</span>
          {item.status === "failed" && (
            <Button variant="ghost-muted" size="icon-tiny" aria-label={`Retry upload for ${item.name}`} onClick={() => onRetry(item.key)}>
              <RotateCw aria-hidden />
            </Button>
          )}
          <Button variant="ghost-muted" size="icon-tiny" aria-label={`Remove ${item.name}`} onClick={() => onRemove(item.key)}>
            <X aria-hidden />
          </Button>
        </Badge>
      ))}
    </div>
  );
};
