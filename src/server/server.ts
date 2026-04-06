import path from 'node:path'
/**
 * Node.js server entry point.
 * Runs the Hono app with @hono/node-server, serving static files.
 *
 * Real-time events use the Nostr relay (strfry) — no direct WebSocket
 * handling needed in the app server. Clients connect to the relay via
 * the Caddy reverse proxy at /nostr.
 */
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { Hono } from 'hono'
import { initDb } from './db'
import { loadEnv } from './env'
import { scheduleBlastProcessor } from './jobs/blast-processor'
import { scheduleRetentionPurge } from './jobs/retention-purge'
import {
  closeNostrPublisher,
  getMessagingAdapter,
  getNostrPublisher,
  getTelephony,
} from './lib/adapters'
import { CryptoService } from './lib/crypto-service'
import { createStorageAdmin } from './lib/storage-admin'
import { createStorageManager, resolveStorageCredentials } from './lib/storage-manager'
import { errorHandler } from './middleware/error'
import { servicesMiddleware } from './middleware/services'
import { createServices } from './services'
import { ProviderHealthService } from './services/provider-health'
import type { StorageManager } from './types'

async function main() {
  console.log('[llamenos] Starting server...')

  const env = loadEnv()

  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required')
  }
  if (env.DATABASE_URL !== env.DATABASE_URL.trim()) {
    throw new Error('DATABASE_URL must not contain leading/trailing whitespace')
  }
  if (!env.HMAC_SECRET) {
    throw new Error('HMAC_SECRET is required')
  }
  if (env.HMAC_SECRET !== env.HMAC_SECRET.trim()) {
    throw new Error('HMAC_SECRET must not contain leading/trailing whitespace')
  }
  if (env.ADMIN_PUBKEY) {
    if (env.ADMIN_PUBKEY !== env.ADMIN_PUBKEY.trim()) {
      throw new Error('ADMIN_PUBKEY must not contain leading/trailing whitespace')
    }
    if (!/^[0-9a-f]{64}$/i.test(env.ADMIN_PUBKEY)) {
      throw new Error('ADMIN_PUBKEY must be a 64-character hex string (x-only Nostr pubkey)')
    }
  }
  if (env.SERVER_NOSTR_SECRET && !/^[0-9a-f]{64}$/i.test(env.SERVER_NOSTR_SECRET)) {
    throw new Error('SERVER_NOSTR_SECRET must be exactly 64 lowercase hex characters')
  }
  if (!env.JWT_SECRET) {
    throw new Error('JWT_SECRET is required')
  }
  if (env.JWT_SECRET !== env.JWT_SECRET.trim()) {
    throw new Error('JWT_SECRET must not contain leading/trailing whitespace')
  }
  if (env.IDP_VALUE_ENCRYPTION_KEY) {
    if (!/^[0-9a-f]{64}$/i.test(env.IDP_VALUE_ENCRYPTION_KEY)) {
      throw new Error('IDP_VALUE_ENCRYPTION_KEY must be a 64-character hex string')
    }
  }

  // Refuse to start in production with session token rotation disabled.
  if (process.env.DISABLE_TOKEN_ROTATION === 'true' && process.env.NODE_ENV === 'production') {
    console.error('FATAL: DISABLE_TOKEN_ROTATION must not be enabled in production')
    process.exit(1)
  }
  if (process.env.DISABLE_TOKEN_ROTATION === 'true') {
    console.warn('[auth] Session token rotation DISABLED (test/dev only)')
  }

  // Phase 4: Startup diagnostics for optional env vars
  if (!env.APP_URL) {
    console.warn('[llamenos] ⚠  APP_URL not set — invite links and webhooks may use wrong base URL')
  }
  if (!env.CORS_ALLOWED_ORIGINS) {
    console.warn(
      '[llamenos] ⚠  CORS_ALLOWED_ORIGINS not set — only built-in origins allowed (localhost in dev)'
    )
  }
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    console.warn('[llamenos] ⚠  Twilio credentials missing — telephony features disabled')
  }
  if (!env.NOSTR_RELAY_URL) {
    console.warn('[llamenos] ⚠  NOSTR_RELAY_URL not set — real-time relay events degraded')
  }

  const db = initDb(env.DATABASE_URL)
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), 'drizzle', 'migrations') })
  console.log('[llamenos] Migrations applied')

  let storage: StorageManager | null = null
  try {
    const storageCreds = resolveStorageCredentials()
    const admin = createStorageAdmin({
      endpoint: storageCreds.endpoint,
      accessKeyId: storageCreds.accessKeyId,
      secretAccessKey: storageCreds.secretAccessKey,
    })

    // Check if RustFS admin API is available for per-hub IAM
    const iamAvailable = await admin.available()
    if (iamAvailable) {
      console.log('[llamenos] RustFS admin API available — per-hub IAM enabled')
    } else {
      console.warn(
        '[llamenos] RustFS admin API not available — per-hub IAM disabled, using root credentials for all hubs'
      )
    }

    storage = createStorageManager({
      ...storageCreds,
      admin: iamAvailable ? admin : undefined,
    })
    console.log('[llamenos] RustFS storage manager connected')

    // Ensure the "global" fallback buckets exist for operations without hub context
    try {
      await storage.provisionHub('global')
    } catch {
      // Buckets may already exist — safe to ignore
    }
  } catch {
    console.warn('[llamenos] Storage not configured — file upload/download routes will return 503')
  }

  const crypto = new CryptoService(env.SERVER_NOSTR_SECRET ?? '', env.HMAC_SECRET ?? '')
  const services = createServices(db, crypto, storage)

  // Initialize firehose agents if seal key is configured
  const firehoseSealKey = process.env.FIREHOSE_AGENT_SEAL_KEY
  if (firehoseSealKey) {
    try {
      const { FirehoseAgentService } = await import('./services/firehose-agent')
      const agentService = new FirehoseAgentService(
        db,
        crypto,
        services.firehose,
        services.conversations,
        services.identity,
        services.records,
        services.settings,
        firehoseSealKey,
        {
          SERVER_NOSTR_SECRET: env.SERVER_NOSTR_SECRET,
          NOSTR_RELAY_URL: env.NOSTR_RELAY_URL,
          ADMIN_PUBKEY: env.ADMIN_PUBKEY,
          ADMIN_DECRYPTION_PUBKEY: env.ADMIN_DECRYPTION_PUBKEY,
        }
      )
      services.firehoseAgent = agentService
      await agentService.init()
      console.log('[llamenos] Firehose agent service initialized')
    } catch (err) {
      console.error('[llamenos] Failed to initialize firehose agents:', err)
    }
  }

  // Provider health monitoring
  const providerHealth = new ProviderHealthService()
  services.providerHealth = providerHealth

  const healthInterval = Number.parseInt(process.env.HEALTH_CHECK_INTERVAL_MS ?? '60000', 10)
  providerHealth.start(async () => {
    try {
      const adapter = await getTelephony(services.settings)
      if (adapter) await providerHealth.checkProvider('telephony', 'active', adapter)
    } catch (err) {
      console.error('[health] Telephony check error:', err)
    }

    try {
      const config = await services.settings.getMessagingConfig()
      for (const channel of config?.enabledChannels ?? []) {
        try {
          const msgAdapter = await getMessagingAdapter(channel, services.settings, crypto)
          await providerHealth.checkProvider('messaging', channel, {
            async testConnection() {
              const status = await msgAdapter.getChannelStatus()
              return { connected: status.connected, latencyMs: 0, error: status.error }
            },
          })
        } catch {
          /* channel not configured */
        }
      }
    } catch (err) {
      console.error('[health] Messaging check error:', err)
    }
  }, healthInterval)
  console.log(`[llamenos] Provider health monitoring started (interval: ${healthInterval}ms)`)

  // Schedule daily retention purge at 03:00 UTC
  scheduleRetentionPurge(services)
  console.log('[llamenos] Data retention purge scheduled')

  // Schedule Signal digest crons
  const { runDigestCron } = await import('./services/digest-cron')
  const dailyDigestInterval = setInterval(
    () => {
      runDigestCron(
        db,
        services.authEvents,
        services.securityPrefs,
        services.signalContacts,
        services.userNotifications,
        'daily'
      ).catch((err) => console.error('[digest] daily digest failed:', err))
    },
    24 * 3600 * 1000
  )
  dailyDigestInterval.unref?.()
  const weeklyDigestInterval = setInterval(
    () => {
      runDigestCron(
        db,
        services.authEvents,
        services.securityPrefs,
        services.signalContacts,
        services.userNotifications,
        'weekly'
      ).catch((err) => console.error('[digest] weekly digest failed:', err))
    },
    7 * 24 * 3600 * 1000
  )
  weeklyDigestInterval.unref?.()
  console.log('[llamenos] Signal digest crons scheduled')

  // Initialize IdP adapter (Authentik by default) — hard-fail on error; Docker restarts via restart: unless-stopped
  const { createIdPAdapter } = await import('./idp/index')
  const idpAdapter = await createIdPAdapter()
  const { setIdPAdapter } = await import('./app')
  setIdPAdapter(idpAdapter)
  console.log(`[llamenos] IdP adapter initialized (${process.env.IDP_ADAPTER || 'authentik'})`)

  const blastProcessorInterval = scheduleBlastProcessor(
    services,
    crypto,
    env.SERVER_NOSTR_SECRET ?? ''
  )
  console.log('[llamenos] Blast delivery processor started (30s poll)')

  // Eagerly connect Nostr publisher
  const publisher = getNostrPublisher(env)
  if (publisher.connect) {
    publisher.connect().catch((err) => {
      console.warn('[llamenos] Nostr publisher eager connect failed (will retry):', err)
    })
    console.log('[llamenos] Nostr publisher connecting eagerly')
  }

  const { default: serverApp } = await import('./app')

  // Create a top-level Hono app
  const app = new Hono()

  // Inject env bindings into every request via middleware
  app.use('*', async (c, next) => {
    // biome-ignore lint/suspicious/noExplicitAny: env injection into Hono context
    ;(c as any).env = env
    await next()
  })

  app.use('*', servicesMiddleware(services))

  // Mount the server app routes
  // biome-ignore lint/suspicious/noExplicitAny: cross-platform mount
  app.route('/', serverApp as any)

  app.onError(errorHandler)

  // Static file serving (replaces CF ASSETS binding)
  // The worker app's catch-all calls next() when ASSETS is null,
  // allowing these middleware to serve static files on Node.js.
  const staticDir = path.resolve(process.cwd(), 'dist', 'client')
  app.use('*', serveStatic({ root: staticDir }))

  // SPA fallback — serve index.html for all unmatched routes
  app.use('*', serveStatic({ root: staticDir, path: '/index.html' }))

  const port = Number(process.env.PORT) || 3000
  const server = serve(
    {
      fetch: app.fetch,
      port,
    },
    (info) => {
      console.log(`[llamenos] Server running at http://localhost:${info.port}`)
    }
  )

  // Graceful shutdown
  const shutdown = () => {
    console.log('[llamenos] Shutting down...')

    services.firehoseAgent?.shutdown()
    providerHealth.stop()
    closeNostrPublisher()
    clearInterval(blastProcessorInterval)

    server.close(() => {
      console.log('[llamenos] Server stopped')
      process.exit(0)
    })
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('[llamenos] Failed to start:', err)
  process.exit(1)
})
