// Tier 4 — boot gate unit tests.
//
// We rely on the injection seams (`verifyFn`, `gossipFn`, `renderFailClosed`)
// exposed by `runBootReleaseVerifier` to avoid pulling in a DOM or opening
// any sockets. The underlying verifier is exercised directly in
// binary-verifier.test.ts; this suite covers the boot glue — gating,
// fail-closed rendering, gossip fire-and-forget.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { VerifierFailure, type VerifierResult } from './binary-verifier'
import { renderFailClosedScreen, runBootReleaseVerifier } from './boot-release-verifier'

const MATCH: VerifierResult = {
  status: 'match',
  checkedFiles: 3,
  mismatches: [],
  releaseTag: 'v1.2.3',
}

const MISMATCH: VerifierResult = {
  status: 'mismatch',
  checkedFiles: 3,
  mismatches: [{ path: 'assets/evil.js', expected: 'a'.repeat(64), actual: 'b'.repeat(64) }],
  releaseTag: 'v1.2.3',
}

const NOT_CONFIGURED: VerifierResult = {
  status: 'not-configured',
  checkedFiles: 0,
  mismatches: [],
  releaseTag: '',
  detail: 'VITE_RELEASE_SIGNING_PUBKEY or VITE_API_ORIGIN not set; refusing to skip silently',
}

describe('runBootReleaseVerifier', () => {
  test('resolves and calls gossip when verifier returns match', async () => {
    let gossipCalled = false
    let failCalled = false
    const result = await runBootReleaseVerifier({
      verifyFn: async () => MATCH,
      gossipFn: () => {
        gossipCalled = true
      },
      renderFailClosed: () => {
        failCalled = true
      },
    })
    expect(result.status).toBe('match')
    expect(gossipCalled).toBe(true)
    expect(failCalled).toBe(false)
  })

  test('throws VerifierFailure and renders fail screen on mismatch', async () => {
    let renderedResult: VerifierResult | null = null
    let renderCalled = false
    let gossipCalled = false
    await expect(
      runBootReleaseVerifier({
        verifyFn: async () => {
          throw new VerifierFailure(MISMATCH)
        },
        gossipFn: () => {
          gossipCalled = true
        },
        renderFailClosed: (result) => {
          renderCalled = true
          renderedResult = result
        },
      })
    ).rejects.toBeInstanceOf(VerifierFailure)
    expect(renderCalled).toBe(true)
    expect(renderedResult).not.toBeNull()
    expect((renderedResult as VerifierResult | null)?.status).toBe('mismatch')
    expect(gossipCalled).toBe(false)
  })

  test('throws VerifierFailure on not-configured (dev without pinned key)', async () => {
    let rendered = false
    await expect(
      runBootReleaseVerifier({
        verifyFn: async () => {
          throw new VerifierFailure(NOT_CONFIGURED)
        },
        gossipFn: () => {},
        renderFailClosed: () => {
          rendered = true
        },
      })
    ).rejects.toBeInstanceOf(VerifierFailure)
    expect(rendered).toBe(true)
  })

  test('defensively rejects if verifier returns non-match without throwing', async () => {
    // If verifyFn is swapped to the underlying `runBinaryVerifier` (which
    // does NOT throw), the boot gate must still refuse to continue on any
    // status other than `match`. This ensures a future refactor that
    // accidentally downgrades verifyOrThrow → runBinaryVerifier cannot
    // silently boot a tampered bundle.
    let rendered: VerifierResult | null = null
    await expect(
      runBootReleaseVerifier({
        verifyFn: async () => MISMATCH,
        gossipFn: () => {},
        renderFailClosed: (r) => {
          rendered = r
        },
      })
    ).rejects.toBeInstanceOf(VerifierFailure)
    expect(rendered).not.toBeNull()
  })

  test('gossip throw does not block boot', async () => {
    const result = await runBootReleaseVerifier({
      verifyFn: async () => MATCH,
      gossipFn: () => {
        throw new Error('relay unreachable')
      },
      renderFailClosed: () => {
        throw new Error('should not render fail screen when verifier matches')
      },
    })
    expect(result.status).toBe('match')
  })
})

// ---- renderFailClosedScreen -------------------------------------------------
//
// These tests exercise the DOM path by installing a minimal document
// polyfill. Bun's test runner runs in node, not a real browser, so we stub
// just enough of the DOM API for the renderer to work.

interface FakeElement {
  tagName: string
  children: FakeElement[]
  textContent: string
  style: { cssText: string }
  attributes: Record<string, string>
  setAttribute(name: string, value: string): void
  appendChild(child: FakeElement): FakeElement
  firstChild: FakeElement | null
  removeChild(child: FakeElement): FakeElement
}

function makeFakeDocument(): {
  doc: {
    getElementById: (id: string) => FakeElement | null
    createElement: (tag: string) => FakeElement
    body: FakeElement
    title: string
    documentElement: {
      setAttribute: (n: string, v: string) => void
      attributes: Record<string, string>
    }
  }
  root: FakeElement
} {
  const docEl = {
    attributes: {} as Record<string, string>,
    setAttribute(n: string, v: string) {
      this.attributes[n] = v
    },
  }
  const makeEl = (tag: string): FakeElement => {
    const el: FakeElement = {
      tagName: tag,
      children: [],
      textContent: '',
      style: { cssText: '' },
      attributes: {},
      firstChild: null,
      setAttribute(name, value) {
        this.attributes[name] = value
      },
      appendChild(child) {
        this.children.push(child)
        this.firstChild = this.children[0] ?? null
        return child
      },
      removeChild(child) {
        this.children = this.children.filter((c) => c !== child)
        this.firstChild = this.children[0] ?? null
        return child
      },
    }
    return el
  }
  const root = makeEl('div')
  root.setAttribute('id', 'root')
  // Pre-populate root with a child to prove the renderer clears it.
  const stale = makeEl('div')
  stale.textContent = 'stale react output'
  root.appendChild(stale)
  const body = makeEl('body')
  const doc = {
    getElementById: (id: string) => (id === 'root' ? root : null),
    createElement: (tag: string) => makeEl(tag),
    body,
    title: '',
    documentElement: docEl,
  }
  return { doc, root }
}

describe('renderFailClosedScreen', () => {
  let originalDocument: unknown

  beforeEach(() => {
    originalDocument = (globalThis as { document?: unknown }).document
  })

  afterEach(() => {
    ;(globalThis as { document?: unknown }).document = originalDocument
  })

  test('clears #root and injects the fail-closed wrapper', () => {
    const { doc, root } = makeFakeDocument()
    ;(globalThis as { document?: unknown }).document = doc
    renderFailClosedScreen(MISMATCH, new VerifierFailure(MISMATCH))
    // stale React output gone
    expect(root.children.length).toBe(1)
    const wrapper = root.children[0]
    expect(wrapper?.attributes['data-testid']).toBe('release-verifier-fail-closed')
    expect(wrapper?.attributes.role).toBe('alert')
    // Contains heading + body + details
    const texts = wrapper?.children.map((c) => c.textContent) ?? []
    expect(texts.some((t) => t.includes('Refusing to load'))).toBe(true)
    expect(texts.some((t) => t.includes('mismatch'))).toBe(true)
  })

  test('includes mismatch paths in the detail block', () => {
    const { doc, root } = makeFakeDocument()
    ;(globalThis as { document?: unknown }).document = doc
    renderFailClosedScreen(MISMATCH, new VerifierFailure(MISMATCH))
    const wrapper = root.children[0]
    const detail = wrapper?.children.find(
      (c) => c.attributes['data-testid'] === 'release-verifier-fail-detail'
    )
    expect(detail).toBeDefined()
    expect(detail?.textContent).toContain('status: mismatch')
    expect(detail?.textContent).toContain('assets/evil.js')
  })

  test('handles null result (verifier crashed before returning)', () => {
    const { doc } = makeFakeDocument()
    ;(globalThis as { document?: unknown }).document = doc
    // Should not throw
    renderFailClosedScreen(null, new Error('fetch broke'))
    expect(doc.title).toContain('Integrity check failed')
  })

  test('is a no-op when document is undefined (server-side / test)', () => {
    ;(globalThis as { document?: unknown }).document = undefined
    // Must not throw.
    renderFailClosedScreen(MISMATCH, null)
  })
})
