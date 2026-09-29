import { FileText, RotateCw, X } from "lucide-react";
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
    <div className="unframed-agent-attachments" data-testid="attachments">
      {images.length > 0 && (
        <div className="unframed-agent-thumbs">
          {images.map((item) => (
            <div key={item.key} className="unframed-agent-thumb" data-status={item.status}>
              {item.preview !== undefined ? (
                <a href={item.preview} target="_blank" rel="noopener noreferrer" aria-label={`Preview ${item.name}`}>
                  <img src={item.preview} alt="" />
                </a>
              ) : (
                <span aria-label={`Preview ${item.name}`} className="unframed-agent-thumb__blank" />
              )}
              {item.status === "uploading" && <span className="unframed-agent-thumb__progress">{`${item.progress}%`}</span>}
              {item.status === "failed" && (
                <button type="button" className="unframed-agent-thumb__retry" aria-label={`Retry upload for ${item.name}`} onClick={() => onRetry(item.key)}>
                  <RotateCw size={14} aria-hidden />
                </button>
              )}
              <button type="button" className="unframed-agent-thumb__remove" aria-label={`Remove ${item.name}`} onClick={() => onRemove(item.key)}>
                <X size={11} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
      {files.map((item) => (
        <span key={item.key} className="unframed-agent-chip" data-chip="file" data-status={item.status}>
          <FileText size={12} aria-hidden />
          <span className="unframed-agent-chip__label">{item.name}</span>
          <span className="unframed-agent-chip__meta">{item.status === "failed" ? "upload failed" : formatSize(item.size)}</span>
          {item.status === "failed" && (
            <button type="button" aria-label={`Retry upload for ${item.name}`} onClick={() => onRetry(item.key)}>
              <RotateCw size={11} aria-hidden />
            </button>
          )}
          <button type="button" aria-label={`Remove ${item.name}`} onClick={() => onRemove(item.key)}>
            <X size={11} aria-hidden />
          </button>
        </span>
      ))}
    </div>
  );
};
