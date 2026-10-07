/** A time of day in the local zone for UI copy: always a 12-hour clock with am or pm, as "8:00 am". */
export const clockTime = (date: Date): string => {
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${hours < 12 ? "am" : "pm"}`;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * When a usage limit resets, to follow "It resets ": the clock time alone today, with the
 * weekday one to six days away, with the date otherwise, so a weekly reset never reads as today.
 */
export const resetMoment = (reset: Date, now: Date): string => {
  const day = (date: Date) => Math.round(new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 86_400_000);
  const days = day(reset) - day(now);
  const time = clockTime(reset);
  if (days === 0) return `at ${time}`;
  if (days >= 1 && days <= 6) return `${WEEKDAYS[reset.getDay()]} at ${time}`;
  return `on ${reset.getDate()} ${MONTHS[reset.getMonth()]} at ${time}`;
};
