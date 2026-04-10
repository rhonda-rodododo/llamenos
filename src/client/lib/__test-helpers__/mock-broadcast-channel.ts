/**
 * In-memory `BroadcastChannel`-ish mock for cross-tab unit tests.
 *
 * Each `MockBroadcastHub` represents one browsing-context-group. All
 * `MockBroadcastChannel`s sharing the same hub deliver postMessage calls
 * asynchronously to every OTHER channel on the hub, mirroring real
 * BroadcastChannel semantics (messages do not echo back to the sender).
 *
 * Used by `session-capsule.test.ts` to exercise the cross-tab token sync
 * protocol and by `key-manager.test.ts` to exercise the lock-broadcast
 * receiver without requiring a real BroadcastChannel implementation.
 *
 * Usage:
 *
 *   const hub = new MockBroadcastHub()
 *   const chA = new MockBroadcastChannel(hub)
 *   const chB = new MockBroadcastChannel(hub)
 *   chB.onmessage = (e) => console.log('tab B got', e.data)
 *   chA.postMessage({ type: 'hello' })
 *   // → queueMicrotask → chB.onmessage fires; chA does not receive its own post.
 */

type Listener = (e: MessageEvent<unknown>) => void

export class MockBroadcastHub {
  private channels = new Set<MockBroadcastChannel>()
  register(ch: MockBroadcastChannel) {
    this.channels.add(ch)
  }
  unregister(ch: MockBroadcastChannel) {
    this.channels.delete(ch)
  }
  deliver(sender: MockBroadcastChannel, data: unknown) {
    for (const ch of this.channels) {
      if (ch === sender || ch.isClosed()) continue
      // Deliver asynchronously, same as real BroadcastChannel
      queueMicrotask(() => {
        const event = { data } as MessageEvent<unknown>
        if (ch.onmessage) ch.onmessage(event)
        for (const l of ch.listeners()) l(event)
      })
    }
  }
}

export class MockBroadcastChannel {
  public onmessage: ((e: MessageEvent<unknown>) => void) | null = null
  private _listeners = new Set<Listener>()
  private closed = false
  constructor(private hub: MockBroadcastHub) {
    hub.register(this)
  }
  postMessage(data: unknown) {
    if (this.closed) throw new Error('channel is closed')
    this.hub.deliver(this, data)
  }
  addEventListener(_type: 'message', listener: Listener) {
    this._listeners.add(listener)
  }
  removeEventListener(_type: 'message', listener: Listener) {
    this._listeners.delete(listener)
  }
  close() {
    this.closed = true
    this.hub.unregister(this)
  }
  isClosed() {
    return this.closed
  }
  listeners() {
    return this._listeners
  }
}
