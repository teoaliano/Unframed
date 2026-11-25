import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { chromeCandidates } from "@unframed/domain";

export const chromeOnMachine = chromeCandidates({
  platform: process.platform,
  env: process.env,
  home: homedir(),
  versionsIn: (dir) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  },
}).find((path) => existsSync(path));
