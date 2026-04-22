import fs from 'node:fs'
import { createStorageManager } from './lib/storage-manager'
import { createTranscriptionService } from './lib/transcription'

/**
 * Read a secret from /run/secrets/ (Docker secrets) or fall back to env var.
 *
 * @knipignore — Docker secrets utility; used by container orchestration startup path
 */
export function readSecret(name: string, envKey?: string): string {
  const filePath = `/run/secrets/${name}`
  try {
    return fs.readFileSync(filePath, 'utf-8').trim()
  } catch {
    const key = envKey || name.toUpperCase().replace(/-/g, '_')
    return process.env[key] || ''
  }
}

/**
 * Load the server environment from secrets / env vars.
 * Synchronous — called once at startup before the server starts.
 *
 * Returns an Env-compatible object for use with the Hono app.
 */
export function loadEnv() {
  return {
    DATABASE_URL: readSecret('database-url', 'DATABASE_URL'),
    ADMIN_PUBKEY: readSecret('admin-pubkey', 'ADMIN_PUBKEY'),
    ADMIN_DECRYPTION_PUBKEY: process.env.ADMIN_DECRYPTION_PUBKEY || undefined,
    HMAC_SECRET: readSecret('hmac-secret', 'HMAC_SECRET'),
    HOTLINE_NAME: process.env.HOTLINE_NAME || 'Hotline',
    ENVIRONMENT: process.env.ENVIRONMENT || 'production',
    DEMO_MODE: process.env.DEMO_MODE || undefined,
    DEMO_RESET_CRON: process.env.DEMO_RESET_CRON || undefined,
    DEV_RESET_SECRET: process.env.DEV_RESET_SECRET || undefined,
    TWILIO_ACCOUNT_SID: readSecret('twilio-account-sid', 'TWILIO_ACCOUNT_SID'),
    TWILIO_AUTH_TOKEN: readSecret('twilio-auth-token', 'TWILIO_AUTH_TOKEN'),
    TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER || '',
    SERVER_NOSTR_SECRET: readSecret('server-nostr-secret', 'SERVER_NOSTR_SECRET') || undefined,
    CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS || undefined,
    APP_ORIGIN: process.env.APP_ORIGIN || undefined,
    API_COOKIE_DOMAIN: process.env.API_COOKIE_DOMAIN || undefined,
    APP_URL: process.env.APP_URL || undefined,
    NOSTR_RELAY_URL: process.env.NOSTR_RELAY_URL || undefined,
    NOSTR_RELAY_PUBLIC_URL: process.env.NOSTR_RELAY_PUBLIC_URL || undefined,
    // Auth / IdP
    JWT_SECRET: readSecret('jwt-secret', 'JWT_SECRET'),
    IDP_VALUE_ENCRYPTION_KEY:
      readSecret('idp-value-encryption-key', 'IDP_VALUE_ENCRYPTION_KEY') || undefined,
    // Push notification keys
    APNS_KEY_P8: process.env.APNS_KEY_P8 || undefined,
    APNS_KEY_ID: process.env.APNS_KEY_ID || undefined,
    APNS_TEAM_ID: process.env.APNS_TEAM_ID || undefined,
    FCM_SERVICE_ACCOUNT_KEY: process.env.FCM_SERVICE_ACCOUNT_KEY || undefined,
    // Platform bindings
    ASSETS: null as null, // Static files served by Hono serveStatic
    AI: createTranscriptionService(),
    STORAGE: createStorageManager(),
  }
}

export type NodeEnv = ReturnType<typeof loadEnv>
