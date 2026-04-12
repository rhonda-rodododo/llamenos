import { afterEach, describe, expect, test } from 'bun:test'
import { isSFrameSupported } from './feature-detect.js'

describe('isSFrameSupported', () => {
  const g = globalThis as unknown as Record<string, unknown>
  const originalTransform = g.RTCRtpScriptTransform
  const originalWorker = g.Worker

  afterEach(() => {
    g.RTCRtpScriptTransform = originalTransform
    g.Worker = originalWorker
  })

  test('returns false when RTCRtpScriptTransform is undefined', () => {
    g.RTCRtpScriptTransform = undefined
    expect(isSFrameSupported()).toBe(false)
  })

  test('returns false when Worker is undefined', () => {
    g.RTCRtpScriptTransform = class {}
    g.Worker = undefined
    expect(isSFrameSupported()).toBe(false)
  })

  test('returns true when both exist and crypto.subtle.importKey is a function', () => {
    g.RTCRtpScriptTransform = class {}
    g.Worker = class {}
    expect(isSFrameSupported()).toBe(true)
  })
})
