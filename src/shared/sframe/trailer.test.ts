import { describe, expect, test } from 'bun:test'
import { TRAILER_LENGTH, parseTrailer, writeTrailer } from './trailer.js'

describe('SFrame trailer', () => {
  test('TRAILER_LENGTH is 5 (4 counter + 1 config)', () => {
    expect(TRAILER_LENGTH).toBe(5)
  })

  test('round-trip at zero values', () => {
    const buf = writeTrailer(0, 0)
    expect(buf.byteLength).toBe(TRAILER_LENGTH)
    const parsed = parseTrailer(buf)
    expect(parsed.counter).toBe(0)
    expect(parsed.keyId).toBe(0)
  })

  test('round-trip at counter=1, keyId=1', () => {
    const parsed = parseTrailer(writeTrailer(1, 1))
    expect(parsed.counter).toBe(1)
    expect(parsed.keyId).toBe(1)
  })

  test('round-trip at maximum keyId (0x7f)', () => {
    const parsed = parseTrailer(writeTrailer(42, 0x7f))
    expect(parsed.counter).toBe(42)
    expect(parsed.keyId).toBe(0x7f)
  })

  test('round-trip at maximum counter (0xffffffff)', () => {
    const parsed = parseTrailer(writeTrailer(0xffffffff, 5))
    expect(parsed.counter).toBe(0xffffffff)
    expect(parsed.keyId).toBe(5)
  })

  test('round-trip at mid value 0xdeadbeef', () => {
    const parsed = parseTrailer(writeTrailer(0xdeadbeef, 0x42))
    expect(parsed.counter).toBe(0xdeadbeef)
    expect(parsed.keyId).toBe(0x42)
  })

  test('big-endian byte layout: counter then config', () => {
    const buf = writeTrailer(0x01020304, 0x55)
    expect(buf[0]).toBe(0x01)
    expect(buf[1]).toBe(0x02)
    expect(buf[2]).toBe(0x03)
    expect(buf[3]).toBe(0x04)
    expect(buf[4]).toBe(0x55)
  })

  test('parseTrailer can read trailer at the end of a longer frame', () => {
    const trailer = writeTrailer(0xcafebabe, 0x09)
    const frame = new Uint8Array(20)
    // Fill the front with garbage; parser must look at the tail.
    for (let i = 0; i < 15; i++) frame[i] = 0xff
    frame.set(trailer, 15)
    const parsed = parseTrailer(frame)
    expect(parsed.counter).toBe(0xcafebabe)
    expect(parsed.keyId).toBe(0x09)
  })

  test('parseTrailer respects subarray byteOffset', () => {
    const backing = new Uint8Array(32)
    const trailer = writeTrailer(0x11223344, 0x07)
    backing.set(trailer, 16)
    const view = backing.subarray(10, 21) // last 5 bytes are the trailer
    const parsed = parseTrailer(view)
    expect(parsed.counter).toBe(0x11223344)
    expect(parsed.keyId).toBe(0x07)
  })

  test('parseTrailer throws on frame shorter than 5 bytes', () => {
    expect(() => parseTrailer(new Uint8Array(0))).toThrow(/shorter than trailer/)
    expect(() => parseTrailer(new Uint8Array(4))).toThrow(/shorter than trailer/)
  })

  test('parseTrailer throws when reserved high bit is set', () => {
    const buf = new Uint8Array([0, 0, 0, 1, 0x80])
    expect(() => parseTrailer(buf)).toThrow(/reserved trailer bit set/)
  })

  test('parseTrailer throws when reserved high bit is set with low bits also set', () => {
    const buf = new Uint8Array([0, 0, 0, 0, 0xff])
    expect(() => parseTrailer(buf)).toThrow(/reserved trailer bit set/)
  })

  test('writeTrailer rejects keyId out of range (> 0x7f)', () => {
    expect(() => writeTrailer(0, 128)).toThrow(/keyId out of range/)
    expect(() => writeTrailer(0, 0xff)).toThrow(/keyId out of range/)
  })

  test('writeTrailer rejects negative keyId', () => {
    expect(() => writeTrailer(0, -1)).toThrow(/keyId out of range/)
  })

  test('writeTrailer rejects negative counter', () => {
    expect(() => writeTrailer(-1, 0)).toThrow(/counter out of range/)
  })

  test('writeTrailer rejects counter > 0xffffffff', () => {
    expect(() => writeTrailer(0x100000000, 0)).toThrow(/counter out of range/)
  })
})
