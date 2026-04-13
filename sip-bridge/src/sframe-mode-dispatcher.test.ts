import { describe, expect, test } from 'bun:test'
import { SframeModeDispatcher, parseStasisArgs } from './sframe-mode-dispatcher'

describe('parseStasisArgs', () => {
  test('detects sframe mode', () => {
    expect(parseStasisArgs(['sframe'])).toEqual({ mode: 'sframe' })
  })

  test('defaults to pstn when no args', () => {
    expect(parseStasisArgs([])).toEqual({ mode: 'pstn' })
  })

  test('ignores unknown args', () => {
    expect(parseStasisArgs(['other'])).toEqual({ mode: 'pstn' })
  })

  test('detects sframe mode when mixed with other args', () => {
    expect(parseStasisArgs(['dialed', 'sframe'])).toEqual({ mode: 'sframe' })
  })

  test('detects sframe mode case-insensitively', () => {
    expect(parseStasisArgs(['SFrame'])).toEqual({ mode: 'sframe' })
    expect(parseStasisArgs(['SFRAME'])).toEqual({ mode: 'sframe' })
    expect(parseStasisArgs(['Sframe'])).toEqual({ mode: 'sframe' })
  })
})

describe('SframeModeDispatcher', () => {
  test('forbids recording on sframe mode', () => {
    const d = new SframeModeDispatcher()
    expect(() => d.assertRecordingAllowed({ mode: 'sframe' })).toThrow('recording banned')
  })

  test('allows recording on pstn mode', () => {
    const d = new SframeModeDispatcher()
    expect(() => d.assertRecordingAllowed({ mode: 'pstn' })).not.toThrow()
  })
})
