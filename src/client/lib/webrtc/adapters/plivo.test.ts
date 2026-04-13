import { describe, expect, test } from 'bun:test'
import type { SFramePeerConnectionHook } from '../sframe-hook-types'
import { PlivoWebRTCAdapter } from './plivo'

describe('PlivoWebRTCAdapter', () => {
  test('implements WebRTCAdapter interface', () => {
    const adapter = new PlivoWebRTCAdapter()
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

  test('isMuted returns false when no active call', () => {
    const adapter = new PlivoWebRTCAdapter()
    expect(adapter.isMuted()).toBe(false)
  })

  test('disconnect is a no-op when no active call', () => {
    const adapter = new PlivoWebRTCAdapter()
    expect(() => adapter.disconnect()).not.toThrow()
  })

  test('setMuted is a no-op when no client initialized', () => {
    const adapter = new PlivoWebRTCAdapter()
    expect(() => adapter.setMuted(true)).not.toThrow()
    // isMuted stays false since no client exists to track state
    expect(adapter.isMuted()).toBe(false)
  })

  test('destroy is a no-op when not initialized', () => {
    const adapter = new PlivoWebRTCAdapter()
    expect(() => adapter.destroy()).not.toThrow()
  })

  test('on/off register and deregister event handlers', () => {
    const adapter = new PlivoWebRTCAdapter()
    const handler = () => {}
    expect(() => adapter.on('connected', handler)).not.toThrow()
    expect(() => adapter.off('connected', handler)).not.toThrow()
  })

  test('off is a no-op for handlers that were never registered', () => {
    const adapter = new PlivoWebRTCAdapter()
    const handler = () => {}
    expect(() => adapter.off('disconnected', handler)).not.toThrow()
  })

  test('off with event that has no registered handlers does not throw', () => {
    const adapter = new PlivoWebRTCAdapter()
    const handler = () => {}
    expect(() => adapter.off('incoming', handler)).not.toThrow()
    expect(() => adapter.off('error', handler as (e: Error) => void)).not.toThrow()
  })

  test('destroy clears handlers and resets state', () => {
    const adapter = new PlivoWebRTCAdapter()
    const handler = () => {}
    adapter.on('connected', handler)
    adapter.on('disconnected', handler)
    expect(() => adapter.destroy()).not.toThrow()
    // After destroy, further off calls should not throw
    expect(() => adapter.off('connected', handler)).not.toThrow()
    expect(() => adapter.off('disconnected', handler)).not.toThrow()
  })

  test('multiple on registrations for same event do not throw', () => {
    const adapter = new PlivoWebRTCAdapter()
    const handler1 = () => {}
    const handler2 = () => {}
    expect(() => adapter.on('incoming', handler1)).not.toThrow()
    expect(() => adapter.on('incoming', handler2)).not.toThrow()
    expect(() => adapter.off('incoming', handler1)).not.toThrow()
    expect(() => adapter.off('incoming', handler2)).not.toThrow()
  })

  test('accepts an sframeHook constructor option and retains it', () => {
    const hook: SFramePeerConnectionHook = (_pc, _ctx) => {}
    const adapter = new PlivoWebRTCAdapter({ sframeHook: hook })
    expect(adapter).toBeInstanceOf(PlivoWebRTCAdapter)
    expect(() => new PlivoWebRTCAdapter()).not.toThrow()
    expect(() => new PlivoWebRTCAdapter({})).not.toThrow()
  })
})
