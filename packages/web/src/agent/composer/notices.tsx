import { orderNotices, type NoticeGroup } from "@unframed/domain";
import { Info, X } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { cn } from "~/lib/utils";
import { BANNER, BANNER_ROW, WARNING_BANNER } from "./panels.tsx";

export interface ComposerNotice {
  readonly id: string;
  readonly variant: "error" | "warning" | "info";
  readonly group?: NoticeGroup;
  readonly icon: ReactNode;
  readonly title: string;
  readonly actions?: ReactNode;
  readonly dismissLabel?: string;
  readonly onDismiss?: () => void;
}

const ERROR_BANNER = cn(BANNER, "border-error/32 bg-linear-to-b from-error/8 to-error/8");

/** The notices above the composer (t3code's ComposerBannerStack), each its own glass card, fading in as it arrives. */
export const NoticeStack = ({ items }: { readonly items: ReadonlyArray<ComposerNotice> }) => {
  const ordered = orderNotices(items);
  if (ordered.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5" data-testid="composer-notices">
      {ordered.map((item) => (
        <NoticeCard key={item.id} item={item} />
      ))}
    </div>
  );
};

const NoticeCard = ({ item }: { readonly item: ComposerNotice }) => (
  <section
    role={item.variant === "info" ? undefined : "alert"}
    className={cn(
      item.variant === "error" ? ERROR_BANNER : item.variant === "warning" ? WARNING_BANNER : BANNER,
      "py-1.5 transition-opacity duration-150 ease-out starting:opacity-0 motion-reduce:transition-none",
    )}
    data-notice={item.id}
    data-variant={item.variant}
    data-group={item.group ?? "attention"}
  >
    <div className={BANNER_ROW}>
      <span aria-hidden className={`flex shrink-0 items-center [&>svg]:size-3.5 ${item.variant === "error" ? "text-error" : item.variant === "warning" ? "text-warning" : "text-muted-foreground"}`}>
        {item.icon}
      </span>
      <NoticeText detailsLabel={`Show full title: ${item.title}`}>{item.title}</NoticeText>
      {(item.actions !== undefined || item.onDismiss !== undefined) && (
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {item.actions}
          {item.onDismiss && (
            <Button variant="ghost-muted" size="icon-xs" aria-label={item.dismissLabel ?? "Dismiss"} onClick={item.onDismiss}>
              <X aria-hidden />
            </Button>
          )}
        </span>
      )}
    </div>
  </section>
);

/** A notice's one line; when it is clipped, an info button beside it shows the whole of it (t3code's NoticeText). */
const NoticeText = ({ children, detailsLabel }: { readonly children: string; readonly detailsLabel: string }) => {
  const text = useRef<HTMLSpanElement>(null);
  const details = useRef<HTMLButtonElement>(null);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const element = text.current;
    if (!element) return;
    const measure = () => {
      // The button's own width does not count, or it would keep itself shown once the text fits.
      const recovered = details.current ? details.current.offsetWidth + 4 : 0;
      setClipped(element.scrollWidth > element.clientWidth + recovered);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [children]);
  return (
    <>
      <span ref={text} className="min-w-0 flex-1 truncate font-medium text-foreground" data-testid="notice-title">
        {children}
      </span>
      {clipped && (
        <Popover>
          <PopoverTrigger openOnHover render={<Button ref={details} variant="ghost-muted" size="icon-xs" aria-label={detailsLabel} className="shrink-0" />}>
            <Info aria-hidden />
          </PopoverTrigger>
          <PopoverPopup aria-label="Notice details" tooltipStyle side="top" className="max-w-[min(30rem,calc(100vw-2rem))] whitespace-normal wrap-anywhere">
            {children}
          </PopoverPopup>
        </Popover>
      )}
    </>
  );
};
