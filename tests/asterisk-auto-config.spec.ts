import { type ChildProcess, spawn } from 'node:child_process'
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { type TestInfo, expect, test } from '@playwright/test'

// Real Asterisk ARI connection details — set via env or default to dev compose values
const REAL_ARI_URL = process.env.ARI_REST_URL ?? 'http://127.0.0.1:8089/ari'
const REAL_ARI_USERNAME = process.env.ARI_USERNAME ?? 'llamenos'
const REAL_ARI_PASSWORD = process.env.ARI_PASSWORD ?? 'changeme'

/** Check if a real Asterisk instance is reachable */
async function isAsteriskAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${REAL_ARI_URL}/asterisk/info`, {
      headers: { Authorization: `Basic ${btoa(`${REAL_ARI_USERNAME}:${REAL_ARI_PASSWORD}`)}` },
      signal: AbortSignal.timeout(2000),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Make an authenticated ARI REST call */
async function ariRequest(method: string, path: string, body?: unknown): Promise<Response> {
  const url = `${REAL_ARI_URL}${path}`
  const headers: Record<string, string> = {
    Authorization: `Basic ${btoa(`${REAL_ARI_USERNAME}:${REAL_ARI_PASSWORD}`)}`,
  }
  const init: RequestInit = { method, headers }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  return fetch(url, init)
}

interface MockAri {
  port: number
  calls: Array<{ method: string; path: string; body: string }>
  stop: () => Promise<void>
}

// Starts a mock ARI HTTP server on a dynamic port that records all requests
async function startMockAri(): Promise<MockAri> {
  const calls: Array<{ method: string; path: string; body: string }> = []
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      calls.push({ method: req.method ?? '', path: req.url ?? '', body })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    port,
    calls,
    stop: () =>
      new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  }
}

/** Spawns the bridge process with the given env overrides */
function spawnBridge(extraEnv: Record<string, string>): ChildProcess {
  return spawn('bun', ['run', 'src/index.ts'], {
    cwd: `${process.cwd()}/sip-bridge`,
    env: { ...process.env, ...extraEnv },
    stdio: 'pipe',
  })
}

/** Polls /health on the given port until the predicate returns true or timeout elapses */
async function pollHealth(
  port: number,
  predicate: (body: Record<string, unknown>) => boolean,
  timeoutMs = 10_000
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`)
      if (res.ok) {
        const raw: unknown = await res.json()
        if (typeof raw === 'object' && raw !== null) {
          const body = raw as Record<string, unknown>
          if (predicate(body)) return body
        }
      }
    } catch {
      // bridge not ready yet — keep polling
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`pollHealth timed out after ${timeoutMs}ms on port ${port}`)
}

/** Kills a child process and waits for it to exit */
async function killProcess(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null) {
      resolve()
      return
    }
    proc.kill('SIGTERM')
    const forceKillTimer = setTimeout(() => {
      if (proc.exitCode === null) proc.kill('SIGKILL')
    }, 2000)
    proc.once('exit', () => {
      clearTimeout(forceKillTimer)
      resolve()
    })
  })
}

/** Returns a free port by binding to :0 and immediately closing */
async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo
      srv.close((err) => (err ? reject(err) : resolve(port)))
    })
  })
}

test('auto-configures PJSIP trunk when SIP env vars are present', async () => {
  const mockAri = await startMockAri()
  const bridgePort = await getFreePort()
  const bridge = spawnBridge({
    ARI_URL: `ws://127.0.0.1:${mockAri.port}/ari/events`,
    ARI_REST_URL: `http://127.0.0.1:${mockAri.port}/ari`,
    ARI_USERNAME: 'test',
    ARI_PASSWORD: 'test',
    WORKER_WEBHOOK_URL: 'http://127.0.0.1:9999',
    BRIDGE_SECRET: 'testsecret',
    SIP_PROVIDER: 'sip.example.com',
    SIP_USERNAME: 'testuser',
    SIP_PASSWORD: 'testpass',
    BRIDGE_PORT: String(bridgePort),
  })

  try {
    await pollHealth(bridgePort, (body) => body.sipConfigured === true)

    const configCalls = mockAri.calls.filter(
      (c) => c.method === 'PUT' && c.path.startsWith('/ari/asterisk/config/dynamic/')
    )
    const paths = configCalls.map((c) => c.path)

    expect(paths).toContain('/ari/asterisk/config/dynamic/res_pjsip/auth/trunk-auth')
    expect(paths).toContain('/ari/asterisk/config/dynamic/res_pjsip/aor/trunk')
    expect(paths).toContain('/ari/asterisk/config/dynamic/res_pjsip/endpoint/trunk')
    expect(paths).toContain('/ari/asterisk/config/dynamic/res_pjsip/registration/trunk-reg')

    const reloadCalls = mockAri.calls.filter(
      (c) => c.method === 'PUT' && c.path === '/ari/asterisk/modules/res_pjsip.so'
    )
    expect(reloadCalls.length).toBeGreaterThan(0)
  } finally {
    await killProcess(bridge)
    await mockAri.stop()
  }
})

test('skips PJSIP config when SIP env vars are absent', async () => {
  const mockAri = await startMockAri()
  const bridgePort = await getFreePort()
  const bridge = spawnBridge({
    ARI_URL: `ws://127.0.0.1:${mockAri.port}/ari/events`,
    ARI_REST_URL: `http://127.0.0.1:${mockAri.port}/ari`,
    ARI_USERNAME: 'test',
    ARI_PASSWORD: 'test',
    WORKER_WEBHOOK_URL: 'http://127.0.0.1:9999',
    BRIDGE_SECRET: 'testsecret',
    BRIDGE_PORT: String(bridgePort),
  })

  try {
    await pollHealth(bridgePort, (body) => body.sipConfigSkipped === true)

    const configCalls = mockAri.calls.filter(
      (c) => c.method === 'PUT' && c.path.startsWith('/ari/asterisk/config/dynamic/')
    )
    expect(configCalls.length).toBe(0)
  } finally {
    await killProcess(bridge)
    await mockAri.stop()
  }
})

test('PJSIP auto-config is idempotent across restarts', async () => {
  const mockAri = await startMockAri()
  const bridgePort1 = await getFreePort()
  const bridgePort2 = await getFreePort()

  const makeEnv = (bridgePort: number): Record<string, string> => ({
    ARI_URL: `ws://127.0.0.1:${mockAri.port}/ari/events`,
    ARI_REST_URL: `http://127.0.0.1:${mockAri.port}/ari`,
    ARI_USERNAME: 'test',
    ARI_PASSWORD: 'test',
    WORKER_WEBHOOK_URL: 'http://127.0.0.1:9999',
    BRIDGE_SECRET: 'testsecret',
    SIP_PROVIDER: 'sip.example.com',
    SIP_USERNAME: 'testuser',
    SIP_PASSWORD: 'testpass',
    BRIDGE_PORT: String(bridgePort),
  })

  // First run
  const bridge1 = spawnBridge(makeEnv(bridgePort1))
  try {
    await pollHealth(bridgePort1, (body) => body.sipConfigured === true)
  } finally {
    await killProcess(bridge1)
  }

  const callsAfterFirst = mockAri.calls.length

  // Second run on a fresh port — must also issue all four ARI PUT calls and a reload without error
  const bridge2 = spawnBridge(makeEnv(bridgePort2))
  try {
    await pollHealth(bridgePort2, (body) => body.sipConfigured === true)

    const newCalls = mockAri.calls.slice(callsAfterFirst)
    const newConfigPaths = newCalls
      .filter((c) => c.method === 'PUT' && c.path.startsWith('/ari/asterisk/config/dynamic/'))
      .map((c) => c.path)

    expect(newConfigPaths).toContain('/ari/asterisk/config/dynamic/res_pjsip/auth/trunk-auth')
    expect(newConfigPaths).toContain('/ari/asterisk/config/dynamic/res_pjsip/aor/trunk')
    expect(newConfigPaths).toContain('/ari/asterisk/config/dynamic/res_pjsip/endpoint/trunk')
    expect(newConfigPaths).toContain(
      '/ari/asterisk/config/dynamic/res_pjsip/registration/trunk-reg'
    )

    const newReloadCalls = newCalls.filter(
      (c) => c.method === 'PUT' && c.path === '/ari/asterisk/modules/res_pjsip.so'
    )
    expect(newReloadCalls.length).toBeGreaterThan(0)
  } finally {
    await killProcess(bridge2)
    await mockAri.stop()
  }
})

// ================================================================
// Real Asterisk integration tests — require dev docker compose running
// Skip automatically if Asterisk is not reachable
// ================================================================

test.describe('real Asterisk ARI', () => {
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires object destructuring for fixtures
  test.beforeEach(async ({}, testInfo: TestInfo) => {
    const available = await isAsteriskAvailable()
    if (!available) {
      testInfo.skip(true, 'Asterisk not available (run bun run dev:docker)')
    }
  })

  test('connects to ARI and retrieves Asterisk info', async () => {
    const res = await ariRequest('GET', '/asterisk/info')
    expect(res.ok).toBe(true)
    const info = (await res.json()) as Record<string, unknown>
    expect(info).toHaveProperty('build')
    expect(info).toHaveProperty('system')
    const system = info.system as Record<string, unknown>
    expect(typeof system.version).toBe('string')
  })

  test('PJSIP dynamic config: create, read, and delete objects', async () => {
    const testId = `test-${Date.now()}`

    // Create an auth object via dynamic config API
    const createRes = await ariRequest('PUT', `/asterisk/config/dynamic/res_pjsip/auth/${testId}`, {
      fields: [
        { attribute: 'auth_type', value: 'userpass' },
        { attribute: 'username', value: 'testuser' },
        { attribute: 'password', value: 'testpass' },
      ],
    })
    expect(createRes.status).toBeLessThan(300)

    // Read it back
    const readRes = await ariRequest('GET', `/asterisk/config/dynamic/res_pjsip/auth/${testId}`)
    expect(readRes.ok).toBe(true)
    const fields = (await readRes.json()) as Array<{ attribute: string; value: string }>
    const usernameField = fields.find((f) => f.attribute === 'username')
    expect(usernameField?.value).toBe('testuser')

    // Delete it
    const deleteRes = await ariRequest(
      'DELETE',
      `/asterisk/config/dynamic/res_pjsip/auth/${testId}`
    )
    expect(deleteRes.status).toBeLessThan(300)

    // Verify it's gone
    const verifyRes = await ariRequest('GET', `/asterisk/config/dynamic/res_pjsip/auth/${testId}`)
    expect(verifyRes.ok).toBe(false)
  })

  test('res_pjsip module can be reloaded', async () => {
    const res = await ariRequest('PUT', '/asterisk/modules/res_pjsip.so')
    // PUT on modules endpoint triggers a reload — 204 No Content on success
    expect(res.status).toBeLessThan(300)
  })

  test('PJSIP auto-config via bridge against real Asterisk', async () => {
    const bridgePort = await getFreePort()
    const testProvider = `test-${Date.now()}.example.com`

    // Clean up any leftover objects from previous runs
    await ariRequest('DELETE', '/asterisk/config/dynamic/res_pjsip/registration/trunk-reg').catch(
      () => {}
    )
    await ariRequest('DELETE', '/asterisk/config/dynamic/res_pjsip/endpoint/trunk').catch(() => {})
    await ariRequest('DELETE', '/asterisk/config/dynamic/res_pjsip/aor/trunk').catch(() => {})
    await ariRequest('DELETE', '/asterisk/config/dynamic/res_pjsip/auth/trunk-auth').catch(() => {})

    const bridge = spawnBridge({
      ARI_URL: 'ws://127.0.0.1:8089/ari/events',
      ARI_REST_URL: REAL_ARI_URL,
      ARI_USERNAME: REAL_ARI_USERNAME,
      ARI_PASSWORD: REAL_ARI_PASSWORD,
      WORKER_WEBHOOK_URL: 'http://127.0.0.1:9999',
      BRIDGE_SECRET: 'testsecret',
      SIP_PROVIDER: testProvider,
      SIP_USERNAME: 'autoconfig-test',
      SIP_PASSWORD: 'autoconfig-pass',
      BRIDGE_PORT: String(bridgePort),
    })

    try {
      // Wait for bridge to configure PJSIP — longer timeout for real ARI connection
      await pollHealth(bridgePort, (body) => body.sipConfigured === true, 20_000)

      // Verify the objects were created in Asterisk
      const authRes = await ariRequest('GET', '/asterisk/config/dynamic/res_pjsip/auth/trunk-auth')
      expect(authRes.ok).toBe(true)
      const authFields = (await authRes.json()) as Array<{ attribute: string; value: string }>
      expect(authFields.find((f) => f.attribute === 'username')?.value).toBe('autoconfig-test')

      const aorRes = await ariRequest('GET', '/asterisk/config/dynamic/res_pjsip/aor/trunk')
      expect(aorRes.ok).toBe(true)
      const aorFields = (await aorRes.json()) as Array<{ attribute: string; value: string }>
      expect(aorFields.find((f) => f.attribute === 'contact')?.value).toContain(testProvider)

      const endpointRes = await ariRequest(
        'GET',
        '/asterisk/config/dynamic/res_pjsip/endpoint/trunk'
      )
      expect(endpointRes.ok).toBe(true)

      // Registration may or may not exist — Asterisk 22.x doesn't support dynamic
      // registration objects. Just verify it doesn't break the bridge.
      const regRes = await ariRequest(
        'GET',
        '/asterisk/config/dynamic/res_pjsip/registration/trunk-reg'
      )
      // regRes.ok may be false on Asterisk 22.x — that's expected
      if (regRes.ok) {
        const regFields = (await regRes.json()) as Array<{ attribute: string; value: string }>
        expect(regFields.find((f) => f.attribute === 'server_uri')?.value).toContain(testProvider)
      }
    } finally {
      await killProcess(bridge)
      // Clean up: delete the objects we created
      await ariRequest('DELETE', '/asterisk/config/dynamic/res_pjsip/registration/trunk-reg').catch(
        () => {}
      )
      await ariRequest('DELETE', '/asterisk/config/dynamic/res_pjsip/endpoint/trunk').catch(
        () => {}
      )
      await ariRequest('DELETE', '/asterisk/config/dynamic/res_pjsip/aor/trunk').catch(() => {})
      await ariRequest('DELETE', '/asterisk/config/dynamic/res_pjsip/auth/trunk-auth').catch(
        () => {}
      )
    }
  })
})
