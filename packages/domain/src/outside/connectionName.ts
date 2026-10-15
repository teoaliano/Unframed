/** A connection's name: trimmed, 1 to 40 characters (spec 14, "Connections and tokens"). */
export const connectionNameProblem = (name: string): string | undefined => {
  const trimmed = name.trim();
  if (trimmed === "") return "Name the connection.";
  if (trimmed.length > 40) return "Keep the name to 40 characters.";
  return undefined;
};

export const trimConnectionName = (name: string): string => name.trim();

/** The chat title an outside chat gets: `<connection name> · <time>`, the time in am or pm (spec 14). */
export const outsideChatTitle = (connectionName: string, startedAt: Date): string => {
  const hours24 = startedAt.getHours();
  const minutes = String(startedAt.getMinutes()).padStart(2, "0");
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const meridiem = hours24 < 12 ? "am" : "pm";
  return `${connectionName} · ${hours12}:${minutes} ${meridiem}`;
};
