import { defineConfig } from "@playwright/test";
import { e2eBaseUrl } from "./helpers/env";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 75_000,
  expect: {
    timeout: 15_000,
  },
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  outputDir: "./test-results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "report", open: "never" }],
    ["json", { outputFile: "report/results.json" }],
  ],
  use: {
    baseURL: e2eBaseUrl(),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
