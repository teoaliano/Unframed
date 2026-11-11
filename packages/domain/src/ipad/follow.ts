export type FollowState = { readonly kind: "following" } | { readonly kind: "detached"; readonly project: string };

export type FollowEvent =
  | { readonly type: "macActive"; readonly project: string }
  | { readonly type: "localChoice"; readonly project: string };

export const followTabs = (state: FollowState | undefined, event: FollowEvent): FollowState =>
  event.type === "macActive" ? { kind: "following" } : { kind: "detached", project: event.project };
