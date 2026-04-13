/**
 * SimCompromisedBridge — adversarial subclass of `SimSipBridge` that models
 * an attacker sitting between SFrame-capable endpoints on the PBX media
 * plane. The base `SimSipBridge` is a passive recording pass-through; this
 * subclass adds three primitives that adversarial tests use to assert the
 * SFrame pipeline catches every form of media-plane tampering:
 *
 *   - `modifyFrame(frame, position, byte)` — flip exactly one byte inside a
 *     wire frame. Used to prove AES-GCM tag verification rejects tampered
 *     ciphertext.
 *   - `modifyTrailer(frame, field, value)` — overwrite either the `keyId`
 *     (final byte of the SFrame trailer) or the 32-bit big-endian `counter`
 *     (four bytes immediately before the keyId). The trailer is bound into
 *     the per-frame AAD, so flipping it makes authentication fail even
 *     though the bytes travel in the clear.
 *   - `maybeDrop(frame)` — stochastic drop gated by `setDropRate`. Tests
 *     that want deterministic drops should set the rate to `1.0` (always
 *     drop) or `0.0` (never drop) — any fractional value is explicitly a
 *     randomness source and should not be compared for equality.
 *
 * The class body is byte-level and format-agnostic; it carries no SFrame
 * imports of its own. The accompanying `.test.ts` exercises it through
 * `SimCaller.produceFrame` / `consumeFrame` (Task 19b), which is why the
 * two tasks land together in the Tier 5 main PR.
 */

import { SimSipBridge } from './sim-sip-bridge.js'

export class SimCompromisedBridge extends SimSipBridge {
  private dropRate = 0

  /**
   * Stochastic drop probability for `maybeDrop`. `0.0` never drops, `1.0`
   * always drops. Values are clamped at the call site: the constructor
   * starts at zero and `setDropRate` is the only mutator.
   */
  setDropRate(rate: number): void {
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
      throw new Error(`SimCompromisedBridge.setDropRate: rate must be in [0, 1], got ${rate}`)
    }
    this.dropRate = rate
  }

  /**
   * Return a modified copy of `frame` with `frame[position]` replaced by
   * `byte`. Never mutates the input — adversarial tests rely on the
   * original wire frame staying intact for control-arm assertions.
   */
  modifyFrame(frame: Uint8Array, position: number, byte: number): Uint8Array {
    if (position < 0 || position >= frame.byteLength) {
      throw new Error(
        `SimCompromisedBridge.modifyFrame: position ${position} out of range for frame of ${frame.byteLength} bytes`
      )
    }
    const modified = new Uint8Array(frame)
    modified[position] = byte & 0xff
    return modified
  }

  /**
   * Overwrite one of the two fields in the SFrame trailer:
   *
   *   - `keyId`: the final byte of the frame (bits 6..0 — the top bit is
   *     reserved, so `value` is masked with `0x7f`).
   *   - `counter`: the four bytes immediately before the keyId, big-endian
   *     unsigned 32-bit.
   *
   * Returns a modified copy; the original frame is untouched.
   */
  modifyTrailer(frame: Uint8Array, field: 'keyId' | 'counter', value: number): Uint8Array {
    const modified = new Uint8Array(frame)
    if (field === 'keyId') {
      modified[modified.length - 1] = value & 0x7f
      return modified
    }
    // counter lives at bytes [length - 5 .. length - 2], BE u32.
    const offset = modified.length - 5
    const view = new DataView(modified.buffer, modified.byteOffset + offset, 4)
    view.setUint32(0, value >>> 0, false)
    return modified
  }

  /**
   * With probability `dropRate`, return `null`; otherwise return `frame`
   * unchanged. The base-class `bridgePacket` signature already allows
   * `null` returns precisely so adversarial subclasses like this one can
   * drop packets without widening the type contract.
   */
  maybeDrop(frame: Uint8Array): Uint8Array | null {
    if (Math.random() < this.dropRate) return null
    return frame
  }
}
