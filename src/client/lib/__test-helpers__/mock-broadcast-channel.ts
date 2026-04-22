/**
 * In-memory `BroadcastChannel`-ish mock for cross-tab unit tests.
 *
 * Each `MockBroadcastHub` represents one browsing-context-group. All
 * `MockBroadcastChannel`s sharing the same hub deliver postMessage calls
 * synchronously to every OTHER channel on the hub (sender is excluded, same
 * as real BroadcastChannel). Delivery is intentionally synchronous — real
 * async delivery is exercised by the UI E2E suite against a real browser.
 * Synchronous delivery eliminates microtask-ordering flakiness in unit tests
 * that would otherwise require fragile `await flushMicrotasks()` calls tuned
 * to the exact depth of the queueMicrotask chain.
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
 *   // → chB.onmessage fires synchronously; chA does not receive its own post.
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
    // Snapshot the channel set before iterating so that any onmessage handler
    // that triggers a nested postMessage (and thus a nested deliver) does not
    // see a partially-iterated live Set.
    const targets = [...this.channels].filter((ch) => ch !== sender && !ch.isClosed())
    for (const ch of targets) {
      const event = { data } as MessageEvent<unknown>
      if (ch.onmessage) ch.onmessage(event)
      for (const l of ch.listeners()) l(event)
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
