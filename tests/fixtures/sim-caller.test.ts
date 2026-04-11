import { beforeEach, describe, expect, test } from 'bun:test'
import { DTMF_DIGITS, type DtmfDigit, SimCaller } from './sim-caller'

describe('SimCaller — construction', () => {
  test('requires a deviceId', () => {
    const caller = new SimCaller('device-a')
    expect(caller.deviceId).toBe('device-a')
  })

  test('defaults to a 2-second clip at 20ms frames (100 frames)', () => {
    const caller = new SimCaller('device-a')
    expect(caller.totalFrames()).toBe(100)
  })

  test('custom clip duration scales total frames', () => {
    const caller = new SimCaller('device-a', {
      clipDurationMs: 500,
      frameIntervalMs: 20,
    })
    expect(caller.totalFrames()).toBe(25)
  })

  test('custom frame interval scales total frames', () => {
    const caller = new SimCaller('device-a', {
      clipDurationMs: 1000,
      frameIntervalMs: 10,
    })
    expect(caller.totalFrames()).toBe(100)
  })
})

describe('SimCaller — canned audio clip', () => {
  test('nextFrame returns a non-empty Uint8Array until the clip is drained', () => {
    const caller = new SimCaller('device-a', { clipDurationMs: 60, frameIntervalMs: 20 })
    const frames: Uint8Array[] = []
    let frame = caller.nextFrame()
    while (frame !== null) {
      frames.push(frame)
      frame = caller.nextFrame()
    }
    expect(frames).toHaveLength(3)
    for (const f of frames) {
      expect(f.length).toBeGreaterThan(0)
    }
  })

  test('clip is deterministic — same seed, same bytes', () => {
    const a = new SimCaller('device-a', { clipDurationMs: 40, frameIntervalMs: 20 })
    const b = new SimCaller('device-a', { clipDurationMs: 40, frameIntervalMs: 20 })
    const frameA = a.nextFrame()
    const frameB = b.nextFrame()
    expect(frameA).not.toBeNull()
    expect(frameB).not.toBeNull()
    if (frameA && frameB) {
      expect(frameA).toEqual(frameB)
    }
  })

  test('each frame carries a visible 440Hz-stub marker (0xfc header byte)', () => {
    const caller = new SimCaller('device-a', { clipDurationMs: 20, frameIntervalMs: 20 })
    const frame = caller.nextFrame()
    expect(frame).not.toBeNull()
    if (frame) {
      // Obvious stub prefix so the fake is unambiguous in dumps.
      expect(frame[0]).toBe(0xfc)
    }
  })

  test('nextFrame returns null after the clip is drained', () => {
    const caller = new SimCaller('device-a', { clipDurationMs: 20, frameIntervalMs: 20 })
    expect(caller.nextFrame()).not.toBeNull()
    expect(caller.nextFrame()).toBeNull()
  })

  test('reset() rewinds the clip', () => {
    const caller = new SimCaller('device-a', { clipDurationMs: 20, frameIntervalMs: 20 })
    caller.nextFrame()
    expect(caller.nextFrame()).toBeNull()
    caller.reset()
    expect(caller.nextFrame()).not.toBeNull()
  })

  test('getFramesSent() counts drained frames', () => {
    const caller = new SimCaller('device-a', { clipDurationMs: 60, frameIntervalMs: 20 })
    caller.nextFrame()
    caller.nextFrame()
    expect(caller.getFramesSent()).toBe(2)
  })
})

describe('SimCaller — jitter buffer', () => {
  test('getFrameDelayMs returns the configured inter-packet delay', () => {
    const caller = new SimCaller('device-a', { frameIntervalMs: 30 })
    expect(caller.getFrameDelayMs()).toBe(30)
  })

  test('setJitter adds bounded randomness inside the interval', () => {
    const caller = new SimCaller('device-a', { frameIntervalMs: 20 })
    caller.setJitter(5)
    // Deterministic random for the test — override the RNG.
    let i = 0
    const rng = () => (i++ % 2 === 0 ? 0.0 : 0.999)
    caller.useRng(rng)
    // First delay: 0.0 → 20 - 5 = 15ms minimum
    expect(caller.nextFrameDelayMs()).toBe(15)
    // Second delay: ~0.999 → 20 + ~5 = ~25ms
    expect(caller.nextFrameDelayMs()).toBeGreaterThanOrEqual(24)
    expect(caller.nextFrameDelayMs()).toBeLessThanOrEqual(25)
  })

  test('zero jitter returns the exact interval every time', () => {
    const caller = new SimCaller('device-a', { frameIntervalMs: 20 })
    for (let i = 0; i < 10; i++) {
      expect(caller.nextFrameDelayMs()).toBe(20)
    }
  })

  test('setJitter rejects negative values', () => {
    const caller = new SimCaller('device-a', { frameIntervalMs: 20 })
    expect(() => caller.setJitter(-1)).toThrow(/>= 0/)
  })

  test('setJitter rejects values >= frameIntervalMs', () => {
    const caller = new SimCaller('device-a', { frameIntervalMs: 20 })
    expect(() => caller.setJitter(20)).toThrow(/strictly less than/)
    expect(() => caller.setJitter(21)).toThrow(/strictly less than/)
  })

  test('setJitter rejects NaN', () => {
    const caller = new SimCaller('device-a', { frameIntervalMs: 20 })
    expect(() => caller.setJitter(Number.NaN)).toThrow(/finite/)
  })

  test('setJitter rejects Infinity', () => {
    const caller = new SimCaller('device-a', { frameIntervalMs: 20 })
    expect(() => caller.setJitter(Number.POSITIVE_INFINITY)).toThrow(/finite/)
    expect(() => caller.setJitter(Number.NEGATIVE_INFINITY)).toThrow(/finite/)
  })

  test('setJitter accepts the largest legal value', () => {
    const caller = new SimCaller('device-a', { frameIntervalMs: 20 })
    expect(() => caller.setJitter(19)).not.toThrow()
  })

  test('nextFrameDelayMs throws when the RNG returns a value outside [0, 1)', () => {
    const caller = new SimCaller('device-a', { frameIntervalMs: 20 })
    caller.setJitter(5)
    caller.useRng(() => 1)
    expect(() => caller.nextFrameDelayMs()).toThrow(/\[0, 1\)/)
    caller.useRng(() => -0.1)
    expect(() => caller.nextFrameDelayMs()).toThrow(/\[0, 1\)/)
    caller.useRng(() => Number.NaN)
    expect(() => caller.nextFrameDelayMs()).toThrow(/\[0, 1\)/)
    caller.useRng(() => Number.POSITIVE_INFINITY)
    expect(() => caller.nextFrameDelayMs()).toThrow(/\[0, 1\)/)
  })

  test('nextFrameDelayMs does not validate the RNG when jitter is 0', () => {
    const caller = new SimCaller('device-a', { frameIntervalMs: 20 })
    caller.useRng(() => Number.NaN)
    // zero-jitter short-circuit returns the interval directly
    expect(caller.nextFrameDelayMs()).toBe(20)
  })
})

describe('SimCaller — DTMF', () => {
  let caller: SimCaller
  beforeEach(() => {
    caller = new SimCaller('device-a')
  })

  test('pressDigit enqueues one digit', () => {
    caller.pressDigit('5')
    expect(caller.drainDigits()).toEqual(['5'])
  })

  test('drainDigits clears the queue', () => {
    caller.pressDigit('5')
    caller.drainDigits()
    expect(caller.drainDigits()).toEqual([])
  })

  test('pressSequence enqueues digits in order', () => {
    caller.pressSequence('1234#')
    expect(caller.drainDigits()).toEqual(['1', '2', '3', '4', '#'])
  })

  test('pressSequence ignores whitespace', () => {
    caller.pressSequence('1 2 3')
    expect(caller.drainDigits()).toEqual(['1', '2', '3'])
  })

  test('pressDigit rejects invalid digits at the type layer', () => {
    // @ts-expect-error — DtmfDigit type should narrow valid inputs
    expect(() => caller.pressDigit('x')).toThrow()
  })

  test('pressSequence throws on invalid chars', () => {
    expect(() => caller.pressSequence('12x')).toThrow()
  })

  test('DTMF_DIGITS covers standard keypad including A-D', () => {
    const expected: DtmfDigit[] = [
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '*',
      '#',
      'A',
      'B',
      'C',
      'D',
    ]
    for (const d of expected) {
      expect(DTMF_DIGITS).toContain(d)
    }
  })

  test('getDigitsEmitted counts over the lifetime (not cleared by drain)', () => {
    caller.pressSequence('123')
    caller.drainDigits()
    caller.pressDigit('4')
    expect(caller.getDigitsEmitted()).toBe(4)
  })

  test('reset() clears the DTMF queue AND the lifetime counter', () => {
    caller.pressSequence('123')
    caller.reset()
    expect(caller.drainDigits()).toEqual([])
    expect(caller.getDigitsEmitted()).toBe(0)
  })
})
