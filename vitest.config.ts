import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    hookTimeout: 30000,
    testTimeout: 30000,
    env: { LOG_LEVEL: "silent" },
  },
});
