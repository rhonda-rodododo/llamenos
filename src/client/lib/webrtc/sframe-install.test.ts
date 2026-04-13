import { describe, expect, test } from 'bun:test'
import { installSFrameTransforms } from './sframe-install.js'

interface MockSender {
  track: { kind: 'audio' | 'video' }
  transform: unknown
}

interface MockReceiver {
  transform: unknown
}

interface MockPc {
  getSenders: () => MockSender[]
  addEventListener: (name: string, cb: (ev: Event) => void) => void
  fireTrack: (receiver: MockReceiver, kind: 'audio' | 'video') => void
}

function mockSender(kind: 'audio' | 'video'): MockSender {
  return { track: { kind }, transform: null }
}

function mockPc(senders: MockSender[]): MockPc {
  const trackListeners: Array<(ev: Event) => void> = []
  return {
    getSenders: () => senders,
    addEventListener: (name, cb) => {
      if (name === 'track') trackListeners.push(cb)
    },
    fireTrack: (receiver, kind) => {
      const ev = { receiver, track: { kind } } as unknown as Event
      for (const cb of trackListeners) cb(ev)
    },
  }
}

const makeFactory = () => {
  const built: Array<{ options: unknown; stub: { __kind: string } }> = []
  return {
    built,
    buildTransform: (options: unknown): unknown => {
      const stub = { __kind: 'mock-transform' }
      built.push({ options, stub })
      return stub
    },
  }
}

describe('installSFrameTransforms', () => {
  test('installs outbound transform on audio senders only', () => {
    const audio = mockSender('audio')
    const video = mockSender('video')
    const pc = mockPc([audio, video])
    const factory = makeFactory()
    installSFrameTransforms(pc as unknown as RTCPeerConnection, {
      callId: 'call-1',
      senderId: 'sender-a',
      sframeClient: factory,
    })
    expect(audio.transform).toBeTruthy()
    expect(video.transform).toBeNull()
    const outboundCall = factory.built[0]
    expect(outboundCall).toBeDefined()
    expect((outboundCall.options as { direction: string }).direction).toBe('outbound')
    expect((outboundCall.options as { senderId: string }).senderId).toBe('sender-a')
  })

  test('subscribes to track events and installs on audio receivers only', () => {
    const pc = mockPc([])
    const factory = makeFactory()
    installSFrameTransforms(pc as unknown as RTCPeerConnection, {
      callId: 'call-1',
      senderId: 'sender-a',
      sframeClient: factory,
    })
    const receiver: MockReceiver = { transform: null }
    pc.fireTrack(receiver, 'audio')
    expect(receiver.transform).toBeTruthy()

    const videoReceiver: MockReceiver = { transform: null }
    pc.fireTrack(videoReceiver, 'video')
    expect(videoReceiver.transform).toBeNull()

    const inboundCall = factory.built.find(
      (c) => (c.options as { direction: string }).direction === 'inbound'
    )
    expect(inboundCall).toBeDefined()
  })

  test('throws sframe_unsupported when client is null', () => {
    const pc = mockPc([])
    expect(() =>
      installSFrameTransforms(pc as unknown as RTCPeerConnection, {
        callId: 'call-1',
        senderId: 'sender-a',
        sframeClient: null,
      })
    ).toThrow(/sframe_unsupported/)
  })

  test('passes through codecHeaderLength', () => {
    const audio = mockSender('audio')
    const pc = mockPc([audio])
    const factory = makeFactory()
    installSFrameTransforms(pc as unknown as RTCPeerConnection, {
      callId: 'call-1',
      senderId: 'sender-a',
      sframeClient: factory,
      codecHeaderLength: 3,
    })
    expect((factory.built[0].options as { codecHeaderLength: number }).codecHeaderLength).toBe(3)
  })
})
