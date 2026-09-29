import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

/*
 * t3code's message actions (ComposerPrimaryActions): the round Send and Stop and the
 * labelled pill that takes Send's place (Submit answer, Implement). They are the
 * composer's own buttons, not restyled kit Buttons, as they are in t3code.
 */

const ROUND =
  "relative isolate flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full shadow-xs outline-none transition-all duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background enabled:cursor-pointer enabled:inset-shadow-2xs enabled:inset-shadow-primary-foreground/16 hover:scale-105 active:shadow-none disabled:pointer-events-none disabled:opacity-64 disabled:shadow-none disabled:hover:scale-100 motion-reduce:transition-none motion-reduce:hover:scale-100";

const TONES = {
  send: `${ROUND} bg-message-action text-message-action-foreground enabled:shadow-message-action/24 hover:bg-message-action-hover`,
  stop: `${ROUND} bg-destructive/90 text-primary-foreground shadow-destructive/24 hover:bg-destructive`,
  pill: "inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-message-action px-3 font-medium text-sm text-message-action-foreground shadow-xs shadow-message-action/24 outline-none hover:bg-message-action-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 disabled:shadow-none sm:h-7 [&_svg]:size-3.5 [&_svg]:shrink-0",
} as const;

export const MessageAction = ({ tone, render, ...props }: useRender.ComponentProps<"button"> & { readonly tone: keyof typeof TONES }) => {
  const defaultProps = { className: TONES[tone], "data-slot": "message-action", type: render ? undefined : ("button" as const) };
  return useRender({ defaultTagName: "button", props: mergeProps<"button">(defaultProps, props), render });
};

/** t3code's arrow in the round Send. */
export const SendArrow = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** t3code's square in the round Stop. */
export const StopSquare = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
    <rect x="2" y="2" width="8" height="8" rx="1.5" />
  </svg>
);
