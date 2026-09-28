/** Every line the engine prints after the banner starts with two spaces. */
export const logInfo = (text: string): void => {
  process.stdout.write(`  ${text}\n`);
};

export const logError = (text: string): void => {
  process.stderr.write(`  ${text}\n`);
};

export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const stackText = (error: unknown): string =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);
