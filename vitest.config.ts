import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "domain",
          include: ["packages/domain/test/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "engine",
          include: ["packages/engine/test/**/*.test.ts"],
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
