/**
 * Screenshot capture script for documentation.
 *
 * Captures screenshots of the application at mobile and desktop viewports
 * for use in the documentation site and README.
 *
 * Usage:
 *   1. Start the dev server: bun run dev:worker
 *   2. Run this script: bunx playwright test scripts/capture-screenshots.ts
 *
 * Screenshots are saved to site/public/screenshots/
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/auth'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Viewport configurations
const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 375, height: 812 },
} as const

// Output directory
const SCREENSHOT_DIR = path.join(__dirname, '..', '..', 'site', 'public', 'screenshots')

// Skip in CI - this test is only run manually for documentation
// biome-ignore lint/correctness/noEmptyPattern: Playwright skip callback signature
test.skip(({}, testInfo) => !!process.env.CI, 'Screenshot capture only runs manually')

/**
 * Navigate using SPA router (no page reload).
 */
async function navigateTo(page: Page, pathname: string): Promise<void> {
  await page.evaluate((path) => {
    const router = (
      window as unknown as { __TEST_ROUTER?: { navigate: (opts: { to: string }) => void } }
    ).__TEST_ROUTER
    if (router) {
      router.navigate({ to: path })
    }
  }, pathname)
  await page.waitForURL((u) => u.pathname === pathname, { timeout: 10000 })
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
}

/**
 * Take a screenshot at the specified viewport.
 */
async function captureScreen(
  page: Page,
  name: string,
  viewport: 'desktop' | 'mobile'
): Promise<void> {
  const vp = VIEWPORTS[viewport]
  await page.setViewportSize(vp)
  // Wait for any animations/transitions
  await page.waitForTimeout(500)

  const filename = `${name}-${viewport}.png`
  const filepath = path.join(SCREENSHOT_DIR, filename)

  await page.screenshot({
    path: filepath,
    fullPage: false,
  })

  console.log(`  ✓ Captured ${filename}`)
}

/**
 * Seed realistic test data for screenshots.
 */
async function seedTestData(page: Page): Promise<void> {
  // Create some users via API
  const users = [
    { name: 'Maria Santos', phone: '+15551234567' },
    { name: 'James Chen', phone: '+15559876543' },
    { name: 'Sarah Johnson', phone: '+15551112222' },
  ]

  for (const vol of users) {
    try {
      await page.request.post('/api/users', {
        data: {
          name: vol.name,
          phone: vol.phone,
          roleIds: ['role-volunteer'],
          // Generate a random pubkey for seeded users
          pubkey: bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
        },
      })
    } catch {
      // User might already exist
    }
  }

  // Create some shifts
  const shifts = [
    { name: 'Morning Shift', startTime: '08:00', endTime: '14:00', days: [1, 2, 3, 4, 5] },
    { name: 'Evening Shift', startTime: '14:00', endTime: '22:00', days: [1, 2, 3, 4, 5] },
    { name: 'Weekend Coverage', startTime: '10:00', endTime: '18:00', days: [0, 6] },
  ]

  for (const shift of shifts) {
    try {
      await page.request.post('/api/shifts', { data: shift })
    } catch {
      // Shift might already exist
    }
  }

  // Create some bans
  const bans = [
    { phone: '+15550001111', reason: 'Repeated prank calls' },
    { phone: '+15550002222', reason: 'Threatening language' },
  ]

  for (const ban of bans) {
    try {
      await page.request.post('/api/bans', { data: ban })
    } catch {
      // Ban might already exist
    }
  }
}

// Main test that captures all screenshots
test.describe('Screenshot Capture', () => {
  test.beforeAll(async () => {
    // Ensure output directory exists
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
    }
  })

  test('capture all documentation screenshots', async ({ adminPage }) => {
    console.log('\n📸 Capturing documentation screenshots...\n')

    // Seed test data
    console.log('🌱 Seeding test data...')
    await seedTestData(adminPage)

    // Wait for data to settle
    await adminPage.waitForTimeout(1000)

    // === Dashboard ===
    console.log('\n📍 Dashboard')
    await navigateTo(adminPage, '/')
    await adminPage.waitForTimeout(500)
    await captureScreen(adminPage, 'dashboard', 'desktop')
    await captureScreen(adminPage, 'dashboard', 'mobile')

    // === Users ===
    console.log('\n📍 Users')
    await navigateTo(adminPage, '/users')
    await adminPage.waitForSelector('[data-testid^="user-row-"]', { timeout: 5000 }).catch(() => {})
    await captureScreen(adminPage, 'users', 'desktop')

    // === Shifts ===
    console.log('\n📍 Shifts')
    await navigateTo(adminPage, '/shifts')
    await adminPage.waitForTimeout(500)
    await captureScreen(adminPage, 'shifts', 'desktop')

    // === Notes ===
    console.log('\n📍 Notes')
    await navigateTo(adminPage, '/notes')
    await adminPage.waitForTimeout(500)
    await captureScreen(adminPage, 'notes', 'desktop')
    await captureScreen(adminPage, 'notes', 'mobile')

    // === Conversations ===
    console.log('\n📍 Conversations')
    await navigateTo(adminPage, '/conversations')
    await adminPage.waitForTimeout(500)
    await captureScreen(adminPage, 'conversations', 'desktop')
    await captureScreen(adminPage, 'conversations', 'mobile')

    // === Call History ===
    console.log('\n📍 Call History')
    await navigateTo(adminPage, '/calls')
    await adminPage.waitForTimeout(500)
    await captureScreen(adminPage, 'calls', 'desktop')

    // === Audit Log ===
    console.log('\n📍 Audit Log')
    await navigateTo(adminPage, '/audit')
    await adminPage.waitForTimeout(500)
    await captureScreen(adminPage, 'audit', 'desktop')

    // === Ban List ===
    console.log('\n📍 Ban List')
    await navigateTo(adminPage, '/bans')
    await adminPage.waitForSelector('[data-testid="ban-row"]', { timeout: 5000 }).catch(() => {})
    await captureScreen(adminPage, 'bans', 'desktop')

    // === Hub Settings ===
    console.log('\n📍 Hub Settings')
    await navigateTo(adminPage, '/admin/settings')
    await adminPage.waitForTimeout(500)
    await captureScreen(adminPage, 'settings', 'desktop')

    // === Login Screen ===
    console.log('\n📍 Login Screen')
    // Clear session to show login
    await adminPage.evaluate(() => {
      sessionStorage.clear()
      localStorage.removeItem('llamenos-encrypted-key')
    })
    await adminPage.goto('/login')
    await adminPage.waitForTimeout(500)
    await captureScreen(adminPage, 'login', 'desktop')
    await captureScreen(adminPage, 'login', 'mobile')

    console.log('\n✅ All screenshots captured successfully!')
    console.log(`📁 Output directory: ${SCREENSHOT_DIR}\n`)
  })
})
