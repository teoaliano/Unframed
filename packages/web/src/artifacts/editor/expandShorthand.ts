export const expandShorthand = (shorthand: string, value: string, longhand: string): string => {
  const probe = document.createElement("i");
  probe.style.cssText = `${shorthand}: ${value}`;
  return probe.style.getPropertyValue(longhand);
};
