/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_ORIGIN?: string
  readonly VITE_CRYPTO_ORIGIN?: string
  readonly VITE_APP_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
