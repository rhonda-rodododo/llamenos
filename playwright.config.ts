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
      testMatch: /\/global-setup\.ts$/,
      timeout: 300_000, // 5 min for real bootstrap + 4 invite onboardings
      use: { trace: "off" }, // Disable trace for setup — avoids ENOENT on trace artifacts
    },
    {
      // API setup — seeds admin from ADMIN_PUBKEY via test-reset (no browser needed).
      // Depends on "setup" to enforce serial execution — test-reset sets
      // setupCompleted=true which would break the UI bootstrap flow if it ran first.
      name: "api-setup",
      testMatch: /api-global-setup\.ts/,
      timeout: 60_000,
      use: { trace: "off" },
      dependencies: ["setup"],
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
            ENVIRONMENT: process.env.ENVIRONMENT ?? "development",
            USE_TEST_ADAPTER: "true",
            // Disable opaque-token rotation in test mode so Playwright storage-state
            // fixtures can reuse refresh cookies across tests. Rotation + replay
            // detection remain enabled in dev/prod and are covered by unit tests.
            DISABLE_TOKEN_ROTATION: "true",
            // Dev defaults — use process.env overrides if set
            DATABASE_URL:
              process.env.DATABASE_URL ??
              "postgres://llamenos:llamenos@localhost:5433/llamenos",
            JWT_SECRET:
              process.env.JWT_SECRET ??
              "0000000000000000000000000000000000000000000000000000000000000003",
            HMAC_SECRET:
              process.env.HMAC_SECRET ??
              "deadbeefcafebabe0123456789abcdef0123456789abcdef0123456789abcdef",
            SERVER_NOSTR_SECRET:
              process.env.SERVER_NOSTR_SECRET ??
              "0000000000000000000000000000000000000000000000000000000000000001",
            IDP_VALUE_ENCRYPTION_KEY:
              process.env.IDP_VALUE_ENCRYPTION_KEY ??
              "0000000000000000000000000000000000000000000000000000000000000088",
            IDP_VALUE_KEY_VERSION: process.env.IDP_VALUE_KEY_VERSION ?? "1",
            AUTHENTIK_URL:
              process.env.AUTHENTIK_URL ?? "http://localhost:9100",
            AUTHENTIK_API_TOKEN:
              process.env.AUTHENTIK_API_TOKEN ??
              "dev-bootstrap-token-not-for-production",
            STORAGE_ACCESS_KEY:
              process.env.STORAGE_ACCESS_KEY ?? "rustfsadmin",
            STORAGE_SECRET_KEY:
              process.env.STORAGE_SECRET_KEY ?? "rustfsadmin",
            STORAGE_ENDPOINT:
              process.env.STORAGE_ENDPOINT ?? "http://localhost:9002",
            NOSTR_RELAY_URL:
              process.env.NOSTR_RELAY_URL ?? "ws://localhost:7778",
            FIREHOSE_AGENT_SEAL_KEY:
              process.env.FIREHOSE_AGENT_SEAL_KEY ??
              "0000000000000000000000000000000000000000000000000000000000000001",
            AUTH_WEBAUTHN_RP_ID:
              process.env.AUTH_WEBAUTHN_RP_ID ?? "localhost",
            AUTH_WEBAUTHN_RP_NAME:
              process.env.AUTH_WEBAUTHN_RP_NAME ?? "Llamenos",
            AUTH_WEBAUTHN_ORIGIN:
              process.env.AUTH_WEBAUTHN_ORIGIN ?? "http://localhost:3000",
            DEV_RESET_SECRET:
              process.env.DEV_RESET_SECRET ?? "test-reset-secret",
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
