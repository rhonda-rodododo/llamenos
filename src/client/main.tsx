import { AuthProvider } from '@/lib/auth'
import { ConfigProvider } from '@/lib/config'
import { NoteSheetProvider } from '@/lib/note-sheet-context'
import { ThemeProvider } from '@/lib/theme'
import { ToastProvider } from '@/lib/toast'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { routeTree } from './routeTree.gen'
import '@/lib/i18n'
import '@/app.css'

const router = createRouter({ routeTree })

// Expose router and key-manager for E2E test navigation
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
      encryptNoteV2: typeof import('@shared/crypto-envelopes').encryptNoteV2
      decryptNoteV2: typeof import('./lib/crypto-worker-helpers').decryptNoteV2
      decryptMessage: typeof import('./lib/crypto-worker-helpers').decryptMessage
    }
  }
}
if (typeof window !== 'undefined') {
  window.__TEST_ROUTER = router
  // Test infrastructure globals — exposed for E2E tests (Playwright runs against production builds).
  // CSP script-src restricts execution to same-origin in production, preventing third-party abuse.
  import('./lib/key-manager').then((km) => {
    window.__TEST_KEY_MANAGER = km
  })
  import('./lib/auth-facade-client').then(({ authFacadeClient }) => {
    window.__TEST_AUTH_FACADE = authFacadeClient
  })
  import('./lib/hub-key-cache').then(
    ({ setHubKeyForTest, getHubKeyForId, getHubKeyCacheSizeForTest }) => {
      window.__TEST_HUB_KEY_CACHE = {
        set: setHubKeyForTest,
        has: (hubId: string) => getHubKeyForId(hubId) !== null,
        size: getHubKeyCacheSizeForTest,
      }
    }
  )
  Promise.all([import('@shared/crypto-envelopes'), import('./lib/crypto-worker-helpers')]).then(
    ([envelopes, helpers]) => {
      window.__llamenos_test_crypto = {
        encryptNoteV2: envelopes.encryptNoteV2,
        decryptNoteV2: helpers.decryptNoteV2,
        decryptMessage: helpers.decryptMessage,
      }
    }
  )
}

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(
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
