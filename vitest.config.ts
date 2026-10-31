import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  // Stops Vite from opening .env.local, which holds production secrets.
  envDir: false,
  resolve: {
    alias: [{ find: /^@\//, replacement: root }],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup.ts"],
    // All files share one database, so they run one at a time.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 30_000,
    // DATABASE_URL comes from tests/setup.ts, because the port is only known once the database is running.
    env: {
      ANTHROPIC_API_KEY: "test-key-not-real",
      // Nothing listens here, so a client that a test forgot to fake can't reach the real service.
      ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
      AI_DAILY_LIMIT: "",
    },
  },
});
