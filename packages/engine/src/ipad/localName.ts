import { execFile } from "node:child_process";

export const readLocalName = (platform: NodeJS.Platform, testName: string | undefined): Promise<string | undefined> => {
  if (testName !== undefined) return Promise.resolve(testName.trim().toLowerCase());
  if (platform !== "darwin") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    execFile("scutil", ["--get", "LocalHostName"], { timeout: 5000 }, (error, stdout) => {
      const name = error ? "" : stdout.trim().toLowerCase();
      resolve(name === "" ? undefined : `${name}.local`);
    });
  });
};
