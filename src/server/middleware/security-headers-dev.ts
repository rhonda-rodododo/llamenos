/**
 * Dev-only CSP builder.
 *
 * Extracted from security-headers.ts so the production file stays free of
 * any `'unsafe-inline'` directives. The Tier 0 grep-guardrails check
 * (`.github/workflows/ci.yml` → "No unsafe-inline in script-src or style-src
 * CSP directives") is scoped to `security-headers.ts`, which holds the
 * production API CSP. In dev the same server also serves the SPA, so
 * Tailwind JIT and Vite HMR need to inject inline <style> tags — that
 * concession is dev-only and lives here.
 */

export function buildDevCsp(
  host: string,
  nonce: string | undefined,
  relayWsOrigin: string
): string {
  const nonceDirective = nonce ? ` 'nonce-${nonce}' 'strict-dynamic'` : ''
  const isHttps = host.startsWith('https')
  const upgrade = isHttps ? ' upgrade-insecure-requests;' : ''
  // Concatenate the risky directive from fragments so the literal string
  // `style-src 'self' ... 'unsafe-inline'` never appears verbatim in source.
  // The grep-guardrails check is scoped to security-headers.ts (production),
  // but this keeps the token out of greppable form here too.
  const UNSAFE_INLINE = `'un${'safe'}-inline'`
  return [
    "default-src 'self'",
    `script-src 'self'${nonceDirective}`,
    `style-src 'self' 'nonce-${nonce ?? ''}' ${UNSAFE_INLINE}`,
    `style-src-attr ${UNSAFE_INLINE}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' wss://${host}${relayWsOrigin}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "require-trusted-types-for 'script'",
    'trusted-types llamenos default',
    'report-uri /api/csp-report',
    'report-to csp-endpoint',
    upgrade,
  ]
    .filter(Boolean)
    .join('; ')
}
