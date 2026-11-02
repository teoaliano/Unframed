/**
 * The value the browser gives a longhand when a shorthand in the source is the only declaration
 * (`background: #fff` gives background-color). The owner rule compares a longhand with this.
 */
export const expandShorthand = (shorthand: string, value: string, longhand: string): string => {
  const probe = document.createElement("i");
  probe.style.cssText = `${shorthand}: ${value}`;
  return probe.style.getPropertyValue(longhand);
};
