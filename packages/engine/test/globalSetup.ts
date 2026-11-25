import { sweepTempDirs } from "./engineProcess.ts";

export default async function globalSetup() {
  await sweepTempDirs();
}
