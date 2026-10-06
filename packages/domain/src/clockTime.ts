/** A time of day in the local zone for UI copy: always a 12-hour clock with am or pm, as "8:00 am". */
export const clockTime = (date: Date): string => {
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${hours < 12 ? "am" : "pm"}`;
};
