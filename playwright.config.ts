import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testIgnore: ["**/live/**"],
  globalTeardown: "./tests/global-teardown.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 3 : parseInt(process.env.PLAYWRIGHT_WORKERS || "3"),
  reporter: process.env.CI
    ? [
        ["github"],
        ["junit", { outputFile: "test-results.xml" }],
        ["list"],
      ]
    : [["html"], ["list"]],
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000",
    ignoreHTTPSErrors: !!process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS,
    trace: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      // UI setup — real browser bootstrap. Calls test-reset-no-admin, then runs
      // full admin bootstrap + invite onboarding flow.
      // Runs BEFORE api-setup to avoid DB race conditions (both reset the DB).
      name: "setup",
      testMatch: /global-setup\.ts/,
      timeout: 300_000, // 5 min for real bootstrap + 4 invite onboardings
      use: { trace: "off" }, // Disable trace for setup — avoids ENOENT on trace artifacts
    },
    {
      // API setup — seeds admin from ADMIN_PUBKEY via test-reset (no browser needed).
      // Runs AFTER UI setup completes to avoid test-reset re-creating the admin
      // that test-reset-no-admin just deleted.
      name: "api-setup",
      testMatch: /api-global-setup\.ts/,
      timeout: 60_000,
      use: { trace: "off" },
      // Independent of UI setup — API tests create their own test users via helpers.
    },
    {
      // API integration tests — no browser, request fixture only.
      // Depends on api-setup (NOT the UI setup which does real browser bootstrap).
      name: "api",
      testDir: "./tests/api",
      use: {
        // API requests need longer timeouts when running in parallel with UI tests
        // (3 workers + PBKDF2 + DB queries compete for CPU/IO)
        actionTimeout: 30_000,
      },
      dependencies: ["api-setup"],
    },
    {
      // UI E2E tests — full browser
      name: "ui",
      testDir: "./tests/ui",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /bootstrap\.spec\.ts/,
      dependencies: ["setup"],
    },
    {
      // Bootstrap tests run after main UI tests to avoid admin-deletion race conditions
      name: "bootstrap",
      testDir: "./tests/ui",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /bootstrap\.spec\.ts/,
      dependencies: ["ui"],
    },
    {
      name: "mobile",
      testDir: "./tests/ui",
      // Mobile tests run in parallel with UI tests — PBKDF2 under 3 workers needs more time
      timeout: 120_000,
      use: { ...devices["Pixel 7"] },
      testMatch: /responsive\.spec\.ts/,
      dependencies: ["setup"],
    },
    {
      // Bridge integration tests — no browser, no webserver, no global setup needed
      name: "bridge",
      testMatch: /asterisk-auto-config\.spec\.ts/,
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : [
        {
          command: "bun run build && bun run start",
          url: "http://localhost:3000/api/health/ready",
          reuseExistingServer: !process.env.CI,
          env: {
            ...process.env,
            USE_TEST_ADAPTER: "true",
            // Disable opaque-token rotation in test mode so Playwright storage-state
            // fixtures can reuse refresh cookies across tests. Rotation + replay
            // detection remain enabled in dev/prod and are covered by unit tests.
            DISABLE_TOKEN_ROTATION: "true",
          },
        },
        // sip-bridge for Asterisk API tests. Skipped in CI (started via docker
        // compose in the workflow) and when the bridge is already running.
        ...(process.env.CI || process.env.SKIP_SIP_BRIDGE
          ? []
          : [
              {
                command: "bun run dev:bridge",
                url: "http://localhost:3001/health",
                reuseExistingServer: true,
                env: {
                  ...process.env,
                  ARI_URL: process.env.ARI_URL ?? "ws://localhost:8089/ari/events",
                  ARI_REST_URL: process.env.ARI_REST_URL ?? "http://localhost:8089/ari",
                  ARI_USERNAME: process.env.ARI_USERNAME ?? "llamenos",
                  ARI_PASSWORD: process.env.ARI_PASSWORD ?? "changeme",
                  WORKER_WEBHOOK_URL: process.env.WORKER_WEBHOOK_URL ?? "http://localhost:3000",
                  BRIDGE_SECRET: process.env.BRIDGE_SECRET ?? "dev-bridge-secret",
                  BRIDGE_PORT: process.env.BRIDGE_PORT ?? "3001",
                  STASIS_APP: process.env.STASIS_APP ?? "llamenos",
                  PBX: process.env.PBX ?? "asterisk",
                },
              },
            ]),
      ],
});
