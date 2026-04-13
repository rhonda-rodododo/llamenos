import { describe, expect, test } from 'bun:test'
import type { SFramePeerConnectionHook } from '../sframe-hook-types'
import { TwilioWebRTCAdapter } from './twilio'

describe('TwilioWebRTCAdapter', () => {
  test('implements WebRTCAdapter interface', () => {
    const adapter = new TwilioWebRTCAdapter()
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

  test('has Twilio-specific updateToken method', () => {
    const adapter = new TwilioWebRTCAdapter()
    expect(typeof adapter.updateToken).toBe('function')
  })

  test('isMuted returns false when no active connection', () => {
    const adapter = new TwilioWebRTCAdapter()
    expect(adapter.isMuted()).toBe(false)
  })

  test('disconnect is a no-op when no active connection', () => {
    const adapter = new TwilioWebRTCAdapter()
    expect(() => adapter.disconnect()).not.toThrow()
  })

  test('setMuted is a no-op when no active connection', () => {
    const adapter = new TwilioWebRTCAdapter()
    expect(() => adapter.setMuted(true)).not.toThrow()
  })

  test('destroy is a no-op when not initialized', () => {
    const adapter = new TwilioWebRTCAdapter()
    expect(() => adapter.destroy()).not.toThrow()
  })

  test('on/off register and deregister event handlers', () => {
    const adapter = new TwilioWebRTCAdapter()
    const handler = () => {}
    // Should not throw when adding or removing handlers
    expect(() => adapter.on('connected', handler)).not.toThrow()
    expect(() => adapter.off('connected', handler)).not.toThrow()
  })

  test('off is a no-op for handlers that were never registered', () => {
    const adapter = new TwilioWebRTCAdapter()
    const handler = () => {}
    expect(() => adapter.off('disconnected', handler)).not.toThrow()
  })

  test('accepts an sframeHook constructor option and retains it', () => {
    const hook: SFramePeerConnectionHook = (_pc, _ctx) => {}
    const adapter = new TwilioWebRTCAdapter({ sframeHook: hook })
    expect(adapter).toBeInstanceOf(TwilioWebRTCAdapter)
    expect(() => new TwilioWebRTCAdapter()).not.toThrow()
    expect(() => new TwilioWebRTCAdapter({})).not.toThrow()
  })
})
