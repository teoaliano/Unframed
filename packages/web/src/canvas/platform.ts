/** The OS this page runs on, named as Node names it, for menu labels and shortcut hints. */
export const platform = (): "darwin" | "win32" | "linux" => {
  const name = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform;
  if (/mac/i.test(name)) return "darwin";
  if (/win/i.test(name)) return "win32";
  return "linux";
};
