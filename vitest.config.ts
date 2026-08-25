import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // Belt and braces: even if real provider keys are present in .env, a test
    // run must never reach a live payment account.
    env: { PAYMENTS_FORCE_FAKE: "true" },
    // These are integration tests: they share one dev server and one database,
    // and several create and delete rows. Running files in parallel makes the
    // latency assertions measure contention between suites rather than the
    // query, and lets fixtures from one file collide with another's.
    fileParallelism: false,
    // *.spec.ts are the acceptance tests: they go over real HTTP and need
    // `npm run dev` plus a bulk-seeded database.
    include: ["tests/**/*.test.ts", "tests/**/*.spec.ts"],
    testTimeout: 30_000,
  },
});
