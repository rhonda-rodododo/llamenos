/**
 * DEV-only scoped debug logger. In production builds the entire function
 * body is dead-code-eliminated by Vite (import.meta.env.DEV === false) AND
 * stripped by esbuild's `drop: ['console']` + `pure: [...]` config.
 *
 * Runtime scoping (DEV only): set `localStorage.debug` to a comma-separated
 * list of namespaces/globs, e.g.:
 *   localStorage.setItem('debug', 'llamenos:crypto,llamenos:sip:*')
 *
 * Matching rules: exact namespace match, or glob `ns:*` / `ns*` = startsWith `ns`.
 */

/**
 * Pure matching helper — exported for testability without touching import.meta.env.
 */
export function matchesDebug(namespace: string, debugEnv: string | null): boolean {
  const patterns = (debugEnv ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return patterns.some((p) => {
    if (p === namespace) return true
    if (p.endsWith(':*')) return namespace.startsWith(p.slice(0, -1))
    if (p.endsWith('*')) return namespace.startsWith(p.slice(0, -1))
    return false
  })
}

export function createDebugLog(namespace: string) {
  return (...args: unknown[]) => {
    if (!import.meta.env.DEV) return
    if (!matchesDebug(namespace, globalThis.localStorage?.getItem('debug') ?? null)) return
    console.log(`[${namespace}]`, ...args)
  }
}
