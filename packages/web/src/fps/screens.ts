export interface ScreenCounts {
  readonly live: number;
  readonly warming: number;
  readonly parked: number;
  readonly snapshot: number;
  readonly picture: number;
  readonly replays: number;
  readonly retries: number;
  readonly failed: number;
}

type TierKey = "live" | "warming" | "parked" | "snapshot" | "picture";

const counts: { -readonly [key in keyof ScreenCounts]: number } = { live: 0, warming: 0, parked: 0, snapshot: 0, picture: 0, replays: 0, retries: 0, failed: 0 };
let counted = false;

export const countScreens = (key: "replays" | "retries" | "failed", by = 1): void => {
  counts[key] += by;
  counted = true;
};

export const setTierCounts = (tiers: Readonly<Record<TierKey, number>>): void => {
  Object.assign(counts, tiers);
  if (Object.values(tiers).some((count) => count > 0)) counted = true;
};

export const screenCounts = (): ScreenCounts | undefined => (counted ? { ...counts } : undefined);
