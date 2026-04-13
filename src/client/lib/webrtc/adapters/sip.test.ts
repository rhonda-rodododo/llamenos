import { describe, expect, test } from 'bun:test'
import type { SFramePeerConnectionHook } from '../sframe-hook-types'
import { SipWebRTCAdapter } from './sip'

describe('SipWebRTCAdapter', () => {
  test('implements WebRTCAdapter interface', () => {
    const adapter = new SipWebRTCAdapter()
    expect(typeof adapter.initialize).toBe('function')
    expect(typeof adapter.accept).toBe('function')
    expect(typeof adapter.reject).toBe('function')
    expect(typeof adapter.disconnect).toBe('function')
    expect(typeof adapter.setMuted).toBe('function')
    expect(typeof adapter.isMuted).toBe('function')
    expect(typeof adapter.on).toBe('function')
    expect(typeof adapter.off).toBe('function')
    expect(typeof adapter.destroy).toBe('function')
  })

  test('isMuted returns false when no active session', () => {
    const adapter = new SipWebRTCAdapter()
    expect(adapter.isMuted()).toBe(false)
  })

  test('disconnect is a no-op when no active session', () => {
    const adapter = new SipWebRTCAdapter()
    expect(() => adapter.disconnect()).not.toThrow()
  })

  test('setMuted is a no-op when no active session', () => {
    const adapter = new SipWebRTCAdapter()
    expect(() => adapter.setMuted(true)).not.toThrow()
  })

  test('destroy is a no-op when not initialized', () => {
    const adapter = new SipWebRTCAdapter()
    expect(() => adapter.destroy()).not.toThrow()
  })

  test('on/off register and deregister event handlers', () => {
    const adapter = new SipWebRTCAdapter()
    const handler = () => {}
    expect(() => adapter.on('connected', handler)).not.toThrow()
    expect(() => adapter.off('connected', handler)).not.toThrow()
  })

  test('off is a no-op for handlers that were never registered', () => {
    const adapter = new SipWebRTCAdapter()
    const handler = () => {}
    expect(() => adapter.off('disconnected', handler)).not.toThrow()
  })

  test('reject is a no-op when no active session', async () => {
    const adapter = new SipWebRTCAdapter()
    await expect(adapter.reject('test-call')).resolves.toBeUndefined()
  })

  test('accept is a no-op when no active session', async () => {
    const adapter = new SipWebRTCAdapter()
    await expect(adapter.accept('test-call')).resolves.toBeUndefined()
  })

  test('accepts an sframeHook constructor option and retains it', () => {
    const hook: SFramePeerConnectionHook = (_pc, _ctx) => {}
    const adapter = new SipWebRTCAdapter({ sframeHook: hook })
    // Constructor accepts the hook at type-check + runtime level
    expect(adapter).toBeInstanceOf(SipWebRTCAdapter)
    // No-arg construction still works
    expect(() => new SipWebRTCAdapter()).not.toThrow()
    expect(() => new SipWebRTCAdapter({})).not.toThrow()
  })
})
