import { describe, expect, test } from 'bun:test'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { LABEL_HUB_FIELD } from '@shared/crypto-labels'
import { decryptFromHub, encryptForHub, generateHubKey } from './hub-key-manager'

describe('hub-key encryption AAD', () => {
  test('matching AAD round-trips', () => {
    const key = generateHubKey()
    const aad = utf8ToBytes(`${LABEL_HUB_FIELD}:row-123:encrypted_name`)
    const ct = encryptForHub('hello', key, aad)
    const pt = decryptFromHub(ct, key, aad)
    expect(pt).toBe('hello')
  })

  test('mismatched AAD returns null (decrypt fails)', () => {
    const key = generateHubKey()
    const ct = encryptForHub('hello', key, utf8ToBytes(`${LABEL_HUB_FIELD}:row-A:encrypted_name`))
    const pt = decryptFromHub(ct, key, utf8ToBytes(`${LABEL_HUB_FIELD}:row-B:encrypted_name`))
    expect(pt).toBeNull()
  })
})
