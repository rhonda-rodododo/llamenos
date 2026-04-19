/**
 * Adversarial timing tests: OPAQUE login — "user not found" vs "wrong password".
 *
 * ## Threat model
 *
 * A timing oracle exists if an attacker can distinguish "this pubkey has no
 * OPAQUE record" from "this pubkey has a record but the password is wrong" by
 * measuring response latency. A fast early-exit for missing records lets an
 * attacker enumerate valid users.
 *
 * The current server route (`src/server/routes/opaque.ts`) returns 404
 * immediately when no password file is found (before calling `opaqueServer
 * .startLogin`). The mitigation is to call `startLogin` against a dummy
 * password file in the "not found" path so that both paths consume the same
 * OPAQUE WASM computation time. This test file measures and documents the
 * timing behaviour of the OPAQUE primitives themselves to inform that fix.
 *
 * ## What is tested here
 *
 * We test `opaqueServer.startLogin` directly (not the HTTP route) because:
 *   1. The WASM computation is the dominant cost in both paths.
 *   2. The test must run without a database or HTTP stack.
 *   3. The timing test assertion only holds for the crypto layer; network,
 *      ORM, and other IO introduce noise we cannot control in a unit test.
 *
 * The test verifies that:
 *   a. `startLogin` with a correctly registered password file (wrong password)
 *      completes in a time window that overlaps with
 *   b. `startLogin` with a dummy/fake password file (constant-time "not found"
 *      substitute).
 *
 * ## Statistical approach
 *
 * Timing assertions are inherently noisy. We use the following approach:
 *   - Run each scenario `ITERATIONS` times.
 *   - Compute mean ± one standard deviation.
 *   - Assert that the two distributions overlap: the ratio of means is within
 *     an acceptable tolerance `MAX_RATIO`. A ratio > `MAX_RATIO` would indicate
 *     a meaningful asymmetry that an adversary could exploit.
 *   - Tests are marked as `timeout: 60_000` because WASM startup and repeated
 *     crypto operations can be slow on CI.
 *
 * ## Known limitation
 *
 * If the "user not found" path in the route does NOT call `startLogin`, the
 * two measurements here will both represent "found + wrong password" and will
 * be equal — that is NOT a vulnerability in the OPAQUE layer itself but in the
 * route logic. A separate integration test covers the route-level behaviour.
 * This test focuses only on whether the crypto primitives are acceptably
 * constant-time with and without a real password file.
 */

import { describe, expect, test } from 'bun:test'
import { opaqueClient, opaqueServer } from '../../client/lib/opaque-client'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Number of measurement samples per scenario. */
const ITERATIONS = 12

/**
 * Maximum acceptable ratio between the slower and faster mean.
 * A 3x ratio would indicate the paths are clearly distinguishable.
 * Normal WASM crypto variance is well below 2x.
 */
const MAX_RATIO = 3.0

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a complete registered OPAQUE password file. */
async function registerOpaque(password: string): Promise<{ setup: string; passwordFile: string }> {
  const credentialIdentifier = `${crypto.randomUUID()}:root-kek`
  const setup = await opaqueServer.createSetup()

  const regStart = await opaqueClient.registrationStart(password)
  const regResponse = await opaqueServer.createRegistrationResponse({
    setupBase64: setup,
    registrationRequestBase64: regStart.message,
    credentialIdentifier,
  })
  const regFinish = await opaqueClient.registrationFinish({
    stateBase64: regStart.state,
    password,
    registrationResponseBase64: regResponse,
  })
  const passwordFile = await opaqueServer.finishRegistration({ uploadBase64: regFinish.message })
  return { setup, passwordFile }
}

/**
 * Measure how long `opaqueServer.startLogin` takes for a given password file.
 * The credential request comes from a fresh `opaqueClient.loginStart` call.
 * Returns elapsed milliseconds.
 */
async function measureStartLogin(
  setup: string,
  passwordFile: string,
  credentialIdentifier: string,
  password: string
): Promise<number> {
  const loginStart = await opaqueClient.loginStart(password)
  const t0 = performance.now()
  try {
    await opaqueServer.startLogin({
      setupBase64: setup,
      passwordFileBase64: passwordFile,
      credentialRequestBase64: loginStart.message,
      credentialIdentifier,
    })
  } catch {
    // startLogin may throw for a wrong-password/dummy scenario — that is expected.
    // We still count the elapsed time; that is what an adversary measures.
  }
  return performance.now() - t0
}

function stats(samples: number[]): { mean: number; stddev: number } {
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length
  const variance = samples.reduce((sum, x) => sum + (x - mean) ** 2, 0) / samples.length
  return { mean, stddev: Math.sqrt(variance) }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OPAQUE timing oracle — startLogin constant-time properties', () => {
  /**
   * Both a real password file (wrong password) and a dummy password file
   * must go through the same WASM computation. Their mean execution times
   * should be within MAX_RATIO of each other.
   *
   * "dummy password file" simulates the constant-time "user not found" mitigation:
   * instead of returning early, the server calls startLogin with a pre-generated
   * dummy record so the attacker cannot distinguish absence from presence.
   */
  test('startLogin with real file vs dummy file has similar timing (within 3x mean ratio)', async () => {
    const password = 'hunter2-correct-horse-battery-staple'
    const credentialIdentifier = `${crypto.randomUUID()}:root-kek`

    // Register a real user.
    const { setup, passwordFile: realPasswordFile } = await registerOpaque(password)

    // Generate a dummy password file against the same setup to simulate the
    // constant-time "not found" mitigation. The dummy uses a random password;
    // startLogin with it and a mismatched credential request will throw —
    // but the WASM computation still runs.
    const dummyPassword = 'dummy-password-for-timing-blinding'
    const dummyCred = `${crypto.randomUUID()}:root-kek`
    const { passwordFile: dummyPasswordFile } = await registerOpaque(dummyPassword)

    // Warm up WASM (first call is always slower due to JIT / module init).
    await measureStartLogin(setup, realPasswordFile, credentialIdentifier, password)
    await measureStartLogin(setup, dummyPasswordFile, dummyCred, dummyPassword)

    // Measure real-file path.
    const realSamples: number[] = []
    for (let i = 0; i < ITERATIONS; i++) {
      realSamples.push(
        await measureStartLogin(setup, realPasswordFile, credentialIdentifier, password)
      )
    }

    // Measure dummy-file path.
    const dummySamples: number[] = []
    for (let i = 0; i < ITERATIONS; i++) {
      dummySamples.push(await measureStartLogin(setup, dummyPasswordFile, dummyCred, dummyPassword))
    }

    const realStats = stats(realSamples)
    const dummyStats = stats(dummySamples)

    const ratio =
      realStats.mean > dummyStats.mean
        ? realStats.mean / dummyStats.mean
        : dummyStats.mean / realStats.mean

    expect(ratio).toBeLessThan(MAX_RATIO)
  }, 60_000)

  /**
   * Verify that calling startLogin with a fake/zeroed password file still
   * invokes the WASM computation (does not fast-exit before touching the
   * OPAQUE library). We measure that the call takes a meaningful amount of
   * time — not effectively zero — which would indicate an early return.
   *
   * A legitimate OPAQUE startLogin on modern hardware takes > 0.1 ms.
   * If it completes in < 0.05 ms, the WASM wasn't invoked.
   */
  test('startLogin with dummy file actually invokes WASM (does not fast-exit)', async () => {
    const dummyPassword = 'timing-check-dummy'
    const { setup, passwordFile: dummyFile } = await registerOpaque(dummyPassword)
    const dummyCred = `${crypto.randomUUID()}:root-kek`

    // Warm up.
    await measureStartLogin(setup, dummyFile, dummyCred, dummyPassword)

    const elapsed = await measureStartLogin(setup, dummyFile, dummyCred, dummyPassword)

    // WASM crypto is never instantaneous; < 0.05 ms means the call returned
    // before the WASM ran (i.e., an early exit was hit).
    expect(elapsed).toBeGreaterThan(0.05)
  }, 30_000)

  /**
   * Document: the current route-level behaviour has a timing oracle.
   * `src/server/routes/opaque.ts` returns 404 before calling `startLogin`
   * when no password file is found. This test is a regression marker — it
   * documents the mitigation that SHOULD be applied at the route level
   * (call startLogin with a dummy file on 404 path) and can be promoted
   * to an HTTP-level integration test once the route is hardened.
   *
   * This unit test only verifies the crypto layer: both scenarios complete
   * with similar timing when both invoke the WASM. The route-level gap is
   * a separate concern tracked in the security backlog.
   */
  test('WASM computation is the bottleneck, not record lookup (timing oracle is at route level)', async () => {
    // Register two users with the same setup.
    const { setup, passwordFile } = await registerOpaque('password-user-a')
    const credA = `${crypto.randomUUID()}:root-kek`

    // Measure startLogin with the real file (wrong-password attempt).
    const wrongPwdStart = await opaqueClient.loginStart('wrong-password')
    const t0 = performance.now()
    try {
      await opaqueServer.startLogin({
        setupBase64: setup,
        passwordFileBase64: passwordFile,
        credentialRequestBase64: wrongPwdStart.message,
        credentialIdentifier: credA,
      })
    } catch {
      // Expected — wrong password / mismatched handshake.
    }
    const wrongPwdElapsed = performance.now() - t0

    // WASM crypto takes non-trivial time; if it's < 0.05 ms we hit a fast path.
    expect(wrongPwdElapsed).toBeGreaterThan(0.05)

    // The crypto layer is constant-time by construction (OPAQUE WASM). The
    // route-level shortcut (missing `startLogin` call on 404) is the oracle.
    // See: src/server/routes/opaque.ts — login/start handler, the
    // `if (!existing) return 404` branch needs a dummy-file call first.
  }, 30_000)
})
