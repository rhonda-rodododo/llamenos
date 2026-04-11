import { describe, expect, test } from 'bun:test'
import { type SimBridgeEvent, type SimChannelState, SimSipBridge } from './sim-sip-bridge'

describe('SimSipBridge — endpoint provisioning', () => {
  test('provisionEndpoint returns deterministic-shaped creds', async () => {
    const bridge = new SimSipBridge()
    const { username, password } = await bridge.provisionEndpoint('pubkey-abc')
    expect(username).toMatch(/^vol_/)
    expect(password.length).toBeGreaterThanOrEqual(32)
  })

  test('provisionEndpoint is idempotent per pubkey', async () => {
    const bridge = new SimSipBridge()
    const first = await bridge.provisionEndpoint('pubkey-abc')
    const second = await bridge.provisionEndpoint('pubkey-abc')
    expect(second).toEqual(first)
  })

  test('deprovisionEndpoint removes state', async () => {
    const bridge = new SimSipBridge()
    await bridge.provisionEndpoint('pubkey-abc')
    await bridge.deprovisionEndpoint('pubkey-abc')
    expect(bridge.getEndpoint('pubkey-abc')).toBeUndefined()
  })
})

describe('SimSipBridge — event bus (ARI WebSocket mock)', () => {
  test('subscribers receive emitted events', () => {
    const bridge = new SimSipBridge()
    const events: SimBridgeEvent[] = []
    bridge.onEvent((e) => events.push(e))
    bridge.emit({
      type: 'channel_create',
      channelId: 'ch-1',
      callerNumber: '+15550001',
      calledNumber: '+15550002',
      timestamp: new Date('2026-04-11T00:00:00Z').toISOString(),
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'channel_create', channelId: 'ch-1' })
  })

  test('off() removes subscribers', () => {
    const bridge = new SimSipBridge()
    const events: SimBridgeEvent[] = []
    const handler = (e: SimBridgeEvent) => events.push(e)
    bridge.onEvent(handler)
    bridge.off(handler)
    bridge.emit({
      type: 'channel_hangup',
      channelId: 'ch-1',
      cause: 16,
      causeText: 'NORMAL_CLEARING',
      timestamp: new Date().toISOString(),
    })
    expect(events).toHaveLength(0)
  })

  test('multiple subscribers all receive events', () => {
    const bridge = new SimSipBridge()
    const a: SimBridgeEvent[] = []
    const b: SimBridgeEvent[] = []
    bridge.onEvent((e) => a.push(e))
    bridge.onEvent((e) => b.push(e))
    bridge.emit({
      type: 'dtmf_received',
      channelId: 'ch-1',
      digit: '5',
      durationMs: 100,
      timestamp: new Date().toISOString(),
    })
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
  })
})

describe('SimSipBridge — inject() dialplan simulation', () => {
  test('inject() fires channel_create then channel_answer for pstn mode', async () => {
    const bridge = new SimSipBridge()
    const events: SimBridgeEvent[] = []
    bridge.onEvent((e) => events.push(e))
    await bridge.inject({
      callId: 'call-1',
      callerNumber: '+15551111',
      calledNumber: '+15552222',
      mode: 'pstn',
    })
    expect(events.map((e) => e.type)).toEqual(['channel_create', 'channel_answer'])
    const create = events[0]
    if (create.type !== 'channel_create') throw new Error('unreachable')
    expect(create.channelId).toBe('call-1')
    expect(create.callerNumber).toBe('+15551111')
    expect(create.args).toEqual(['pstn'])
  })

  test('inject() sframe mode stamps "sframe" in stasis args', async () => {
    const bridge = new SimSipBridge()
    const events: SimBridgeEvent[] = []
    bridge.onEvent((e) => events.push(e))
    await bridge.inject({
      callId: 'call-2',
      callerNumber: '+15551111',
      calledNumber: '+15552222',
      mode: 'sframe',
    })
    const create = events[0]
    if (create.type !== 'channel_create') throw new Error('unreachable')
    expect(create.args).toEqual(['sframe'])
  })

  test('hangup() emits channel_hangup', async () => {
    const bridge = new SimSipBridge()
    await bridge.inject({
      callId: 'call-1',
      callerNumber: '+15551111',
      calledNumber: '+15552222',
      mode: 'pstn',
    })
    const events: SimBridgeEvent[] = []
    bridge.onEvent((e) => events.push(e))
    await bridge.hangup('call-1', 16, 'NORMAL_CLEARING')
    expect(events).toHaveLength(1)
    const hangup = events[0]
    if (hangup.type !== 'channel_hangup') throw new Error('unreachable')
    expect(hangup.channelId).toBe('call-1')
    expect(hangup.cause).toBe(16)
    expect(hangup.causeText).toBe('NORMAL_CLEARING')
  })
})

describe('SimSipBridge — RTP packet capture', () => {
  test('bridgePacket records a single direction', () => {
    const bridge = new SimSipBridge()
    const bytes = new Uint8Array([0x01, 0x02, 0x03])
    bridge.bridgePacket('caller', bytes)
    const captured = bridge.getCapturedPackets()
    expect(captured).toHaveLength(1)
    expect(captured[0].direction).toBe('a-to-b')
    expect(captured[0].bytes).toEqual(bytes)
  })

  test('bridgePacket records both directions in order', () => {
    const bridge = new SimSipBridge()
    bridge.bridgePacket('caller', new Uint8Array([0x01]))
    bridge.bridgePacket('volunteer', new Uint8Array([0x02]))
    bridge.bridgePacket('caller', new Uint8Array([0x03]))
    const captured = bridge.getCapturedPackets()
    expect(captured.map((p) => p.direction)).toEqual(['a-to-b', 'b-to-a', 'a-to-b'])
  })

  test('bridgePacket is a pass-through (returns the same bytes)', () => {
    const bridge = new SimSipBridge()
    const bytes = new Uint8Array([0xff, 0xee, 0xdd])
    const forwarded = bridge.bridgePacket('caller', bytes)
    expect(forwarded).toEqual(bytes)
  })

  test('clear() wipes captured packets', () => {
    const bridge = new SimSipBridge()
    bridge.bridgePacket('caller', new Uint8Array([0x01]))
    bridge.clear()
    expect(bridge.getCapturedPackets()).toHaveLength(0)
  })

  test('getCapturedPackets returns a copy (defensive)', () => {
    const bridge = new SimSipBridge()
    bridge.bridgePacket('caller', new Uint8Array([0x01]))
    const first = bridge.getCapturedPackets()
    first.push({
      direction: 'a-to-b',
      bytes: new Uint8Array([0xff]),
      time: 0,
    })
    expect(bridge.getCapturedPackets()).toHaveLength(1)
  })
})

describe('SimSipBridge — channel + bridge state', () => {
  test('getChannels() lists active channels', async () => {
    const bridge = new SimSipBridge()
    await bridge.inject({
      callId: 'ch-a',
      callerNumber: '+1',
      calledNumber: '+2',
      mode: 'sframe',
    })
    expect(bridge.getChannels().map((c) => c.id)).toEqual(['ch-a'])
  })

  test('hangup removes the channel from getChannels()', async () => {
    const bridge = new SimSipBridge()
    await bridge.inject({
      callId: 'ch-a',
      callerNumber: '+1',
      calledNumber: '+2',
      mode: 'sframe',
    })
    await bridge.hangup('ch-a', 16, 'NORMAL_CLEARING')
    expect(bridge.getChannels()).toHaveLength(0)
  })

  test('getChannels() returned array mutation does not touch internal state', async () => {
    const bridge = new SimSipBridge()
    await bridge.inject({
      callId: 'ch-a',
      callerNumber: '+1',
      calledNumber: '+2',
      mode: 'sframe',
    })
    const channels = bridge.getChannels()
    // `readonly` is compile-time; the array at runtime is a fresh copy.
    ;(channels as SimChannelState[]).pop()
    expect(bridge.getChannels()).toHaveLength(1)
  })
})

describe('SimSipBridge — misuse contracts', () => {
  test('inject() throws when callId is already active', async () => {
    const bridge = new SimSipBridge()
    await bridge.inject({
      callId: 'ch-a',
      callerNumber: '+1',
      calledNumber: '+2',
      mode: 'sframe',
    })
    await expect(
      bridge.inject({
        callId: 'ch-a',
        callerNumber: '+1',
        calledNumber: '+2',
        mode: 'sframe',
      })
    ).rejects.toThrow(/already active/)
  })

  test('inject() for a previously-hung-up callId succeeds', async () => {
    const bridge = new SimSipBridge()
    await bridge.inject({
      callId: 'ch-a',
      callerNumber: '+1',
      calledNumber: '+2',
      mode: 'sframe',
    })
    await bridge.hangup('ch-a', 16, 'NORMAL_CLEARING')
    await expect(
      bridge.inject({
        callId: 'ch-a',
        callerNumber: '+1',
        calledNumber: '+2',
        mode: 'sframe',
      })
    ).resolves.toBeUndefined()
  })

  test('hangup() throws when channelId is unknown', async () => {
    const bridge = new SimSipBridge()
    await expect(bridge.hangup('ghost', 16, 'NORMAL_CLEARING')).rejects.toThrow(/unknown channelId/)
  })

  test('hangup() is not idempotent — second call throws', async () => {
    const bridge = new SimSipBridge()
    await bridge.inject({
      callId: 'ch-a',
      callerNumber: '+1',
      calledNumber: '+2',
      mode: 'sframe',
    })
    await bridge.hangup('ch-a', 16, 'NORMAL_CLEARING')
    await expect(bridge.hangup('ch-a', 16, 'NORMAL_CLEARING')).rejects.toThrow(/unknown channelId/)
  })
})

describe('SimSipBridge — sendDtmf', () => {
  test('emits a dtmf_received event for an active channel', async () => {
    const bridge = new SimSipBridge()
    await bridge.inject({
      callId: 'ch-a',
      callerNumber: '+1',
      calledNumber: '+2',
      mode: 'sframe',
    })
    const events: SimBridgeEvent[] = []
    bridge.onEvent((e) => events.push(e))
    await bridge.sendDtmf('ch-a', '5')
    expect(events).toHaveLength(1)
    const dtmf = events[0]
    if (dtmf.type !== 'dtmf_received') throw new Error('unreachable')
    expect(dtmf.channelId).toBe('ch-a')
    expect(dtmf.digit).toBe('5')
    expect(dtmf.durationMs).toBe(100)
  })

  test('respects a custom durationMs', async () => {
    const bridge = new SimSipBridge()
    await bridge.inject({
      callId: 'ch-a',
      callerNumber: '+1',
      calledNumber: '+2',
      mode: 'sframe',
    })
    const events: SimBridgeEvent[] = []
    bridge.onEvent((e) => events.push(e))
    await bridge.sendDtmf('ch-a', '7', 250)
    const dtmf = events[0]
    if (dtmf.type !== 'dtmf_received') throw new Error('unreachable')
    expect(dtmf.durationMs).toBe(250)
  })

  test('throws for an unknown channel', async () => {
    const bridge = new SimSipBridge()
    await expect(bridge.sendDtmf('ghost', '5')).rejects.toThrow(/unknown channelId/)
  })
})

describe('SimSipBridge — emit() error isolation', () => {
  test('one throwing handler does not prevent others from receiving the event', () => {
    const bridge = new SimSipBridge()
    const received: SimBridgeEvent[] = []
    bridge.onEvent(() => {
      throw new Error('boom')
    })
    bridge.onEvent((e) => received.push(e))
    expect(() =>
      bridge.emit({
        type: 'channel_answer',
        channelId: 'ch-a',
        timestamp: new Date().toISOString(),
      })
    ).toThrow(AggregateError)
    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('channel_answer')
  })

  test('AggregateError carries every handler error', () => {
    const bridge = new SimSipBridge()
    bridge.onEvent(() => {
      throw new Error('a')
    })
    bridge.onEvent(() => {
      throw new Error('b')
    })
    let caught: unknown
    try {
      bridge.emit({
        type: 'channel_answer',
        channelId: 'ch-a',
        timestamp: new Date().toISOString(),
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(AggregateError)
    if (caught instanceof AggregateError) {
      expect(caught.errors).toHaveLength(2)
    }
  })

  test('emit() does not fan out to handlers added during the current emission', () => {
    const bridge = new SimSipBridge()
    const received: SimBridgeEvent[] = []
    bridge.onEvent(() => {
      bridge.onEvent((e) => received.push(e))
    })
    bridge.emit({
      type: 'channel_answer',
      channelId: 'ch-a',
      timestamp: new Date().toISOString(),
    })
    expect(received).toHaveLength(0)
  })
})

describe('SimSipBridge — deterministic clock', () => {
  test('first event stamps at 2026-04-11T00:00:00.000Z', async () => {
    const bridge = new SimSipBridge()
    const events: SimBridgeEvent[] = []
    bridge.onEvent((e) => events.push(e))
    await bridge.inject({
      callId: 'ch-a',
      callerNumber: '+1',
      calledNumber: '+2',
      mode: 'sframe',
    })
    expect(events[0].timestamp).toBe('2026-04-11T00:00:00.000Z')
  })

  test('sequential events advance one second each', async () => {
    const bridge = new SimSipBridge()
    const events: SimBridgeEvent[] = []
    bridge.onEvent((e) => events.push(e))
    await bridge.inject({
      callId: 'ch-a',
      callerNumber: '+1',
      calledNumber: '+2',
      mode: 'sframe',
    })
    // inject emits two events: channel_create + channel_answer
    expect(events[0].timestamp).toBe('2026-04-11T00:00:00.000Z')
    expect(events[1].timestamp).toBe('2026-04-11T00:00:01.000Z')
  })

  test('two bridge instances do not share the clock', async () => {
    const a = new SimSipBridge()
    const b = new SimSipBridge()
    const eventsA: SimBridgeEvent[] = []
    const eventsB: SimBridgeEvent[] = []
    a.onEvent((e) => eventsA.push(e))
    b.onEvent((e) => eventsB.push(e))
    await a.inject({
      callId: 'ch-a',
      callerNumber: '+1',
      calledNumber: '+2',
      mode: 'sframe',
    })
    await b.inject({
      callId: 'ch-b',
      callerNumber: '+1',
      calledNumber: '+2',
      mode: 'sframe',
    })
    expect(eventsA[0].timestamp).toBe('2026-04-11T00:00:00.000Z')
    expect(eventsB[0].timestamp).toBe('2026-04-11T00:00:00.000Z')
  })
})

describe('SimSipBridge — bridgePacket defensive byte copy', () => {
  test('mutating captured bytes does not affect internal state', () => {
    const bridge = new SimSipBridge()
    bridge.bridgePacket('caller', new Uint8Array([0x01, 0x02, 0x03]))
    const first = bridge.getCapturedPackets()
    first[0].bytes[0] = 0xff
    expect(bridge.getCapturedPackets()[0].bytes[0]).toBe(0x01)
  })

  test('mutating the input after bridgePacket does not corrupt history', () => {
    const bridge = new SimSipBridge()
    const input = new Uint8Array([0x01, 0x02, 0x03])
    bridge.bridgePacket('caller', input)
    input[0] = 0xff
    expect(bridge.getCapturedPackets()[0].bytes[0]).toBe(0x01)
  })
})
