/** A connection's name: trimmed, 1 to 40 characters (spec 14, "Connections and tokens"). */
export const connectionNameProblem = (name: string): string | undefined => {
  const trimmed = name.trim();
  if (trimmed === "") return "Name the connection.";
  if (trimmed.length > 40) return "Keep the name to 40 characters.";
  return undefined;
};

export const trimConnectionName = (name: string): string => name.trim();

