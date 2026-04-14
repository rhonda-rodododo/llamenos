import type { ReactNode } from 'react'

/**
 * Tier 4 PR-B — SandboxLoader.
 *
 * Displays a minimal "Loading secure sandbox…" placeholder until the
 * crypto sandbox iframe has reported ready. When `ready` is already true
 * (the common case until call sites migrate to the iframe client),
 * SandboxLoader is a transparent passthrough and adds zero DOM weight.
 *
 * The placeholder UI is intentionally bare — it runs on the SPA origin
 * before any authenticated data is fetched, so it has no localization or
 * branding hooks yet. A follow-up PR wires real translations once the
 * blocking-boot mode is enabled.
 */
export function SandboxLoader({
  children,
  ready,
}: {
  children: ReactNode
  ready: boolean
}) {
  if (!ready) {
    return (
      <div data-testid="sandbox-loader" className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading secure sandbox…</div>
      </div>
    )
  }
  return <>{children}</>
}
