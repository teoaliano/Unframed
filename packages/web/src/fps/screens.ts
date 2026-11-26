export interface ScreenCounts {
  readonly live: number;
  readonly loading: number;
  readonly queued: number;
  readonly replays: number;
  readonly retries: number;
  readonly failed: number;
}

const counts: { -readonly [key in keyof ScreenCounts]: number } = { live: 0, loading: 0, queued: 0, replays: 0, retries: 0, failed: 0 };
let counted = false;

export const countScreens = (key: keyof ScreenCounts, by = 1): void => {
  counts[key] += by;
  counted = true;
};

export const screenCounts = (): ScreenCounts | undefined => (counted ? { ...counts } : undefined);
