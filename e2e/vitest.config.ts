import { defineConfig } from "vitest/config";

/**
 * Tests that mutate global state and must run after all parallel tests.
 * New tests are parallel by default — only add here if the test mutates
 * shared state (rate limits, connection caps, bulk deletes, plan limits).
 */
const SEQUENTIAL_TESTS = [
  "tests/30-plan-limits.test.ts",
  "tests/32-ws-limits.test.ts",
  "tests/39-data-retention.test.ts",
  "tests/40-rate-limiting.test.ts",
];

/**
 * Browser tests (Playwright) are auto-detected by filename pattern.
 * They run one-at-a-time (fileParallelism: false) because Playwright
 * is resource-heavy, but in the same groupOrder as parallel tests.
 */
const BROWSER_PATTERN = "tests/*-browser-*.test.ts";

const SHARED = {
  testTimeout: 120_000,
  hookTimeout: 300_000,
  pool: "forks" as const,
};

export default defineConfig({
  test: {
    globalSetup: "./global-setup.ts",
    projects: [
      {
        test: {
          ...SHARED,
          name: "parallel",
          fileParallelism: true,
          maxWorkers: 4,
          include: ["tests/**/*.test.ts"],
          exclude: [...SEQUENTIAL_TESTS, BROWSER_PATTERN],
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          ...SHARED,
          name: "browser",
          fileParallelism: false,
          include: [BROWSER_PATTERN],
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          ...SHARED,
          name: "sequential",
          fileParallelism: false,
          include: SEQUENTIAL_TESTS,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
