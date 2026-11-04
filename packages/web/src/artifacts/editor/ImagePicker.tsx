import type { ArtifactImage } from "@unframed/contracts";
import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { previewUrl, uploadFile } from "../../canvas/assetStore.ts";
import { useEngine } from "../../context.ts";
import { messageOf } from "../../agent/store.ts";
import { Tip } from "../../chrome/ui.tsx";
import { showError } from "../../toasts.tsx";

interface ImagePickerProps {
  readonly project: string;
  readonly onChoose: (file: string) => void;
}

const useImages = (project: string, open: boolean): readonly ArtifactImage[] | undefined => {
  const engine = useEngine();
  const [images, setImages] = useState<readonly ArtifactImage[] | undefined>(undefined);
  useEffect(() => {
    if (!open) return;
    let live = true;
    engine
      .call("artifact.images", { project })
      .then((answer) => {
        if (live) setImages(answer.images);
      })
      .catch((error: unknown) => {
        if (live) showError(messageOf(error));
      });
    return () => {
      live = false;
    };
  }, [engine, project, open]);
  return images;
};

export const ImagePicker = ({ project, onChoose }: ImagePickerProps) => {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const images = useImages(project, open);
  const upload = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const close = () => {
    setOpen(false);
    setFilter("");
  };

  const needle = filter.trim().toLowerCase();
  const shown = (images ?? []).filter((image) => needle === "" || image.fileName.toLowerCase().includes(needle));

  const onFile = async (file: File) => {
    setUploading(true);
    try {
      const uploaded = await uploadFile(project, file, file.name);
      close();
      onChoose(uploaded.file);
    } catch (error) {
      showError(messageOf(error));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
    >
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>Replace image</PopoverTrigger>
      <PopoverPopup side="bottom" align="start" sideOffset={6} padding="compact" className="w-70" aria-label="Choose an image" initialFocus={false}>
        <div className="flex flex-col gap-2">
          <Input aria-label="Filter images" placeholder="Filter images" value={filter} onChange={(event) => setFilter(event.currentTarget.value)} />
          {images !== undefined && images.length === 0 && <p className="m-0 text-sm text-muted-foreground">No images in this project yet.</p>}
          {images !== undefined && images.length > 0 && shown.length === 0 && <p className="m-0 text-sm text-muted-foreground">No images match.</p>}
          <div className="grid max-h-72 grid-cols-3 gap-1.5 overflow-auto">
            {shown.map((image) => (
              <Tip key={image.file} label={image.fileName}>
                <Button
                  variant="ghost"
                  size="sm-multiline"
                  data-image-file={image.file}
                  aria-label={image.fileName}
                  className="min-w-0 flex-col items-stretch"
                  onClick={() => {
                    close();
                    onChoose(image.file);
                  }}
                >
                  <img alt="" src={previewUrl(project, image.file, 512)} className="aspect-square w-full rounded-sm object-cover" />
                  <span className="truncate text-xs text-muted-foreground">{image.fileName}</span>
                </Button>
              </Tip>
            ))}
          </div>
          {/* oxlint-disable-next-line react/forbid-elements -- a hidden native file picker, opened by Upload image */}
          <input
            ref={upload}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void onFile(file);
            }}
          />
          <Button variant="outline" size="sm" disabled={uploading} onClick={() => upload.current?.click()}>
            Upload image
          </Button>
        </div>
      </PopoverPopup>
    </Popover>
  );
};
