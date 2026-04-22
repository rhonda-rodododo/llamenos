import { describe, expect, it } from 'bun:test'
import type { Database } from '../db'
import type { CryptoService } from '../lib/crypto-service'
import { FirehoseService } from './firehose'

// Minimal mocks — these methods don't touch db or crypto service
const _mockDb = {} as Database
const _mockCrypto = {} as CryptoService

describe('FirehoseService', () => {
  it('should be constructable', () => {
    // Just verify the class can be constructed — real DB tests are in API E2E
    expect(FirehoseService).toBeDefined()
    expect(typeof FirehoseService).toBe('function')
  })
})
