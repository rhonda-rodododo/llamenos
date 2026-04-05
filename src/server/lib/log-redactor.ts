const SENSITIVE_KEY_RE =
  /phone|email|nsec|secret|token|ciphertext|encrypted|content|recovery|^pin$|password|credential/i

// Exclude 'name' alone — it has too many safe uses ('componentName', 'eventName').
// But catch first/last/full name:
const NAME_KEY_RE = /^(first|last|full|display|user)?name$/i

const NSEC_RE = /nsec1[0-9a-z]{58}/g
const HEX_PUBKEY_RE = /\b[0-9a-f]{64}\b/gi
const MAX_DEPTH = 2

function redactString(s: string): string {
  return s
    .replace(NSEC_RE, '[redacted:nsec]')
    .replace(HEX_PUBKEY_RE, (m) => (m.length === 64 ? '[redacted:hex64]' : m))
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_RE.test(key) || NAME_KEY_RE.test(key)
}

function redactInner(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return redactString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) {
    return { errName: value.name, errMsg: redactString(value.message) }
  }
  if (typeof value !== 'object') return String(value)

  if (seen.has(value as object)) return '[circular]'
  seen.add(value as object)

  if (depth > MAX_DEPTH) return value

  if (Array.isArray(value)) {
    return value.map((v) => redactInner(v, depth + 1, seen))
  }

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    if (isSensitiveKey(k)) {
      out[k] = '[redacted]'
    } else {
      try {
        out[k] = redactInner(v, depth + 1, seen)
      } catch {
        out[k] = '[redact-error]'
      }
    }
  }
  return out
}

/** Walks value up to depth 2, redacting sensitive keys and string patterns. */
export function redact<T>(value: T): T {
  return redactInner(value, 0, new WeakSet()) as T
}
