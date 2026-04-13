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
    // Explicit sample array — easier to reason about than a closure
    // that counts calls by parity. Samples chosen to hit: (a) the lower
    // bound, (b) the upper bound, (c) the midpoint.
    const samples = [0.0, 0.999, 0.5]
    let idx = 0
    caller.useRng(() => samples[idx++] as number)
    // 0.0 → 20 + (0*2 - 1)*5 = 15ms (exact lower bound)
    expect(caller.nextFrameDelayMs()).toBe(15)
    // 0.999 → 20 + (0.998)*5 ≈ 24.99ms, Math.round → 25
    expect(caller.nextFrameDelayMs()).toBe(25)
    // 0.5 → 20 + 0*5 = 20ms (midpoint)
    expect(caller.nextFrameDelayMs()).toBe(20)
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

  test('pressSequence handles 10+ digit PIN-entry-style input', () => {
    caller.pressSequence('0123456789*#')
    expect(caller.drainDigits()).toEqual([
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
    ])
    expect(caller.getDigitsEmitted()).toBe(12)
  })

  test('pressSequence with an empty string is a no-op', () => {
    caller.pressSequence('')
    expect(caller.drainDigits()).toEqual([])
    expect(caller.getDigitsEmitted()).toBe(0)
  })

  test('pressSequence with whitespace-only input is a no-op', () => {
    caller.pressSequence('   \t\n')
    expect(caller.drainDigits()).toEqual([])
    expect(caller.getDigitsEmitted()).toBe(0)
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

  test('reset() mid-sequence clears queue AND lifetime counter even if more digits arrive after', () => {
    caller.pressDigit('1')
    caller.pressDigit('2')
    caller.reset()
    expect(caller.drainDigits()).toEqual([])
    expect(caller.getDigitsEmitted()).toBe(0)
    caller.pressDigit('3')
    expect(caller.getDigitsEmitted()).toBe(1)
    expect(caller.drainDigits()).toEqual(['3'])
  })

  test('reset() clears the DTMF queue AND the lifetime counter', () => {
    caller.pressSequence('123')
    caller.reset()
    expect(caller.drainDigits()).toEqual([])
    expect(caller.getDigitsEmitted()).toBe(0)
  })
})

describe('SimCaller — SFrame', () => {
  test('produces and consumes a frame successfully', async () => {
    const callSecret = new Uint8Array(32).fill(0x11)
    const caller = new SimCaller('device-a')
    caller.bindCall(callSecret, '00000000-0000-4000-8000-000000000001')
    await caller.loadKey(0)
    const plaintext = new Uint8Array([0x01, 0xaa, 0xbb, 0xcc])
    const wire = await caller.produceFrame(plaintext, 0, 1)
    const ok = await caller.consumeFrame(wire, plaintext, 0, 1, 'device-a')
    expect(ok).toBe(true)
  })

  test('consumes a frame from another sender with the same callSecret', async () => {
    const callSecret = new Uint8Array(32).fill(0x22)
    const callId = '00000000-0000-4000-8000-000000000002'
    const alice = new SimCaller('alice-device')
    const bob = new SimCaller('bob-device')
    alice.bindCall(callSecret, callId)
    bob.bindCall(callSecret, callId)
    await alice.loadKey(0)
    await bob.loadKey(0)
    const plaintext = new Uint8Array([0x01, 0xde, 0xad, 0xbe, 0xef])
    const wire = await alice.produceFrame(plaintext, 0, 1)
    const ok = await bob.consumeFrame(wire, plaintext, 0, 1, 'alice-device')
    expect(ok).toBe(true)
  })

  test('produceFrame throws if called before bindCall', async () => {
    const caller = new SimCaller('device-a')
    await expect(caller.produceFrame(new Uint8Array([0x01]), 0, 1)).rejects.toThrow(/bindCall/)
  })

  test('produceFrame throws if the key was never loaded', async () => {
    const caller = new SimCaller('device-a')
    caller.bindCall(new Uint8Array(32).fill(0x33), '00000000-0000-4000-8000-000000000099')
    await expect(caller.produceFrame(new Uint8Array([0x01]), 0, 1)).rejects.toThrow(/not loaded/)
  })

  test('bindCall twice with a different callId throws', () => {
    const caller = new SimCaller('device-a')
    const secret = new Uint8Array(32).fill(0x44)
    caller.bindCall(secret, '00000000-0000-4000-8000-000000000010')
    expect(() => caller.bindCall(secret, '00000000-0000-4000-8000-000000000011')).toThrow(
      /already bound/
    )
  })
})
