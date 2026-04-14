// The Trusted Types `llamenos` and `default` policies are installed by the
// inline <script> in index.html, BEFORE this module bundle starts loading.
// That ordering is required because top-level singletons in this dependency
// graph (crypto-worker-client, transcription-manager, sframe-worker-client,
// vite-plugin-pwa registerSW) construct Workers and a Service Worker as soon
// as their modules are evaluated, and the CSP enforces
// `require-trusted-types-for 'script'`. See index.html and
// src/client/lib/trusted-types-policy.ts for the policy rules.
//
// Tier 4 — release integrity gate.
//
// The SPA MUST NOT touch network, crypto, or router state until the running
// bundle has been verified against a signed release manifest. To enforce
// that, everything below (crypto sandbox boot, React mount, test-global
// wiring) runs inside `bootSPA()` and only after `runBootReleaseVerifier()`
// resolves. On verifier failure, that helper renders a fail-closed HTML
// screen and throws — React never mounts, no network happens.
//
// Static imports below are limited to:
//   * the verifier boot gate itself (needed to run the gate)
//   * React / router / providers (pure module bodies — no side effects)
// Side-effecting imports (crypto sandbox, i18n, CSS, test globals) happen
// inside `bootSPA()` via dynamic import so they cannot execute until the
// gate passes.

import { AuthProvider } from '@/lib/auth'
import { runBootReleaseVerifier } from '@/lib/boot-release-verifier'
import { ConfigProvider } from '@/lib/config'
import { NoteSheetProvider } from '@/lib/note-sheet-context'
import { ThemeProvider } from '@/lib/theme'
import { ToastProvider } from '@/lib/toast'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { routeTree } from './routeTree.gen'

const router = createRouter({ routeTree })

declare global {
  interface Window {
    __TEST_ROUTER: typeof router
    __TEST_KEY_MANAGER: typeof import('./lib/key-manager')
    __TEST_AUTH_FACADE: typeof import('./lib/auth-facade-client').authFacadeClient
    __TEST_HUB_KEY_CACHE: {
      set: (hubId: string, key: Uint8Array) => void
      has: (hubId: string) => boolean
      size: () => number
    }
    __llamenos_test_crypto: {
      encryptNote: typeof import('@shared/crypto-envelopes').encryptNote
      decryptNote: typeof import('./lib/crypto-worker-helpers').decryptNote
      decryptMessage: typeof import('./lib/crypto-worker-helpers').decryptMessage
    }
  }
}

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

async function bootSPA(): Promise<void> {
  // Gate 1: fail-closed binary verifier. Throws on any non-match, renders a
  // refusal screen into #root, and never returns on failure.
  await runBootReleaseVerifier()

  // Gate 2: crypto sandbox iframe + i18n + CSS (side-effecting modules).
  // Loaded lazily so they cannot run before verification passes.
  const [{ bootCryptoSandbox }] = await Promise.all([
    import('@/lib/boot-crypto-sandbox'),
    import('@/lib/i18n'),
    import('@/app.css'),
  ])
  bootCryptoSandbox()

  // Gate 3: wire test globals (Playwright uses these against prod builds).
  // CSP script-src restricts execution to same-origin in production.
  if (typeof window !== 'undefined') {
    window.__TEST_ROUTER = router
    void import('./lib/key-manager').then((km) => {
      window.__TEST_KEY_MANAGER = km
    })
    void import('./lib/auth-facade-client').then(({ authFacadeClient }) => {
      window.__TEST_AUTH_FACADE = authFacadeClient
    })
    void import('./lib/hub-key-cache').then(
      ({ setHubKeyForTest, getHubKeyForId, getHubKeyCacheSizeForTest }) => {
        window.__TEST_HUB_KEY_CACHE = {
          set: setHubKeyForTest,
          has: (hubId: string) => getHubKeyForId(hubId) !== null,
          size: getHubKeyCacheSizeForTest,
        }
      }
    )
    void Promise.all([
      import('@shared/crypto-envelopes'),
      import('./lib/crypto-worker-helpers'),
    ]).then(([envelopes, helpers]) => {
      window.__llamenos_test_crypto = {
        encryptNote: envelopes.encryptNote,
        decryptNote: helpers.decryptNote,
        decryptMessage: helpers.decryptMessage,
      }
    })
  }

  // Gate 4: React mount.
  const rootEl = document.getElementById('root')
  if (!rootEl) throw new Error('boot: #root element missing')

  createRoot(rootEl).render(
    <StrictMode>
      <ThemeProvider>
        <ConfigProvider>
          <ToastProvider>
            <AuthProvider>
              <NoteSheetProvider>
                <RouterProvider router={router} />
              </NoteSheetProvider>
            </AuthProvider>
          </ToastProvider>
        </ConfigProvider>
      </ThemeProvider>
    </StrictMode>
  )
}

void bootSPA().catch((err) => {
  // `runBootReleaseVerifier` already rendered the fail-closed screen before
  // throwing. Everything else is a genuine boot crash — log it and leave the
  // page in whatever state it reached.
  // biome-ignore lint/suspicious/noConsole: boot crash path — no structured logger is available pre-mount
  console.error('[boot] SPA bootstrap failed:', err)
})
