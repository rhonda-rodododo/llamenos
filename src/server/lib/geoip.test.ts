import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { lookupIp } from './geoip'

const DEV_DB_PATH = './data/geoip/dbip-city.mmdb'

describe('geoip', () => {
  test('lookupIp returns unknown country for invalid IP', async () => {
    const result = await lookupIp('not-an-ip', DEV_DB_PATH)
    expect(result.country).toBe('unknown')
  })

  test('lookupIp returns unknown for private IP', async () => {
    const result = await lookupIp('10.0.0.1', DEV_DB_PATH)
    expect(result.country).toBe('unknown')
  })

  test.if(existsSync(DEV_DB_PATH))('lookupIp resolves Google DNS', async () => {
    const result = await lookupIp('8.8.8.8', DEV_DB_PATH)
    expect(result.country).toBe('US')
  })

  test('lookupIp returns unknown when DB file missing', async () => {
    const result = await lookupIp('8.8.8.8', '/nonexistent/path.mmdb')
    expect(result.country).toBe('unknown')
  })
})
