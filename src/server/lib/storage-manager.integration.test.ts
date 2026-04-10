import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { buildBucketPolicy } from './storage-admin'
import { createStorageManager, resolveStorageCredentials } from './storage-manager'

describe('resolveStorageCredentials', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Clear all storage-related env vars
    process.env.STORAGE_ACCESS_KEY = undefined
    process.env.STORAGE_SECRET_KEY = undefined
    process.env.STORAGE_ENDPOINT = undefined
    process.env.MINIO_APP_USER = undefined
    process.env.MINIO_APP_PASSWORD = undefined
    process.env.MINIO_ACCESS_KEY = undefined
    process.env.MINIO_SECRET_KEY = undefined
    process.env.MINIO_ENDPOINT = undefined
  })

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) process.env[key] = undefined
    }
    Object.assign(process.env, originalEnv)
  })

  it('uses STORAGE_ACCESS_KEY/STORAGE_SECRET_KEY as highest priority', () => {
    process.env.STORAGE_ACCESS_KEY = 'storage-key'
    process.env.STORAGE_SECRET_KEY = 'storage-secret'
    process.env.MINIO_APP_USER = 'minio-user'
    process.env.MINIO_APP_PASSWORD = 'minio-pass'

    const result = resolveStorageCredentials()
    expect(result.accessKeyId).toBe('storage-key')
    expect(result.secretAccessKey).toBe('storage-secret')
  })

  it('falls back to MINIO_APP_USER/MINIO_APP_PASSWORD', () => {
    process.env.MINIO_APP_USER = 'app-user'
    process.env.MINIO_APP_PASSWORD = 'app-pass'

    const writeSpy = mock(() => true)
    const origWrite = process.stdout.write
    process.stdout.write = writeSpy as typeof process.stdout.write

    const result = resolveStorageCredentials()
    expect(result.accessKeyId).toBe('app-user')
    expect(result.secretAccessKey).toBe('app-pass')
    expect(writeSpy).toHaveBeenCalled()

    process.stdout.write = origWrite
  })

  it('falls back to MINIO_ACCESS_KEY/MINIO_SECRET_KEY', () => {
    process.env.MINIO_ACCESS_KEY = 'root-key'
    process.env.MINIO_SECRET_KEY = 'root-secret'

    const writeSpy = mock(() => true)
    const origWrite = process.stdout.write
    process.stdout.write = writeSpy as typeof process.stdout.write

    const result = resolveStorageCredentials()
    expect(result.accessKeyId).toBe('root-key')
    expect(result.secretAccessKey).toBe('root-secret')
    expect(writeSpy).toHaveBeenCalled()

    process.stdout.write = origWrite
  })

  it('throws if no credentials are found', () => {
    expect(() => resolveStorageCredentials()).toThrow('Storage credentials required')
  })

  it('uses STORAGE_ENDPOINT as highest priority', () => {
    process.env.STORAGE_ACCESS_KEY = 'key'
    process.env.STORAGE_SECRET_KEY = 'secret'
    process.env.STORAGE_ENDPOINT = 'http://rustfs:9000'
    process.env.MINIO_ENDPOINT = 'http://minio:9000'

    const result = resolveStorageCredentials()
    expect(result.endpoint).toBe('http://rustfs:9000')
  })

  it('falls back to MINIO_ENDPOINT', () => {
    process.env.STORAGE_ACCESS_KEY = 'key'
    process.env.STORAGE_SECRET_KEY = 'secret'
    process.env.MINIO_ENDPOINT = 'http://minio:9000'

    const result = resolveStorageCredentials()
    expect(result.endpoint).toBe('http://minio:9000')
  })

  it('defaults endpoint to http://localhost:9000', () => {
    process.env.STORAGE_ACCESS_KEY = 'key'
    process.env.STORAGE_SECRET_KEY = 'secret'

    const result = resolveStorageCredentials()
    expect(result.endpoint).toBe('http://localhost:9000')
  })
})

describe('StorageManager interface compliance', () => {
  it('STORAGE_NAMESPACES has expected shape', async () => {
    const { STORAGE_NAMESPACES } = await import('../types')
    expect(STORAGE_NAMESPACES.voicemails.defaultRetentionDays).toBe(365)
    expect(STORAGE_NAMESPACES.attachments.defaultRetentionDays).toBeNull()
    expect(Object.keys(STORAGE_NAMESPACES)).toEqual(['voicemails', 'attachments'])
  })

  it('createStorageManager returns object with all required methods', () => {
    const manager = createStorageManager({
      endpoint: 'http://localhost:9999',
      accessKeyId: 'test',
      secretAccessKey: 'test',
    })

    expect(typeof manager.put).toBe('function')
    expect(typeof manager.get).toBe('function')
    expect(typeof manager.delete).toBe('function')
    expect(typeof manager.provisionHub).toBe('function')
    expect(typeof manager.destroyHub).toBe('function')
    expect(typeof manager.setRetention).toBe('function')
    expect(typeof manager.healthy).toBe('function')
    expect(typeof manager.withCredentials).toBe('function')
  })

  it('healthy returns false when endpoint is unreachable', async () => {
    const manager = createStorageManager({
      endpoint: 'http://localhost:1', // unreachable port
      accessKeyId: 'test',
      secretAccessKey: 'test',
    })

    const result = await manager.healthy()
    expect(result).toBe(false)
  })

  it('withCredentials returns a new manager with all methods', () => {
    const manager = createStorageManager({
      endpoint: 'http://localhost:9999',
      accessKeyId: 'root',
      secretAccessKey: 'rootsecret',
    })

    const hubManager = manager.withCredentials('hub-key', 'hub-secret')
    expect(typeof hubManager.put).toBe('function')
    expect(typeof hubManager.get).toBe('function')
    expect(typeof hubManager.delete).toBe('function')
    expect(typeof hubManager.provisionHub).toBe('function')
    expect(typeof hubManager.destroyHub).toBe('function')
    expect(typeof hubManager.healthy).toBe('function')
    expect(typeof hubManager.withCredentials).toBe('function')
  })
})

describe('buildBucketPolicy', () => {
  it('generates a valid S3 policy for given buckets', () => {
    const buckets = ['hub-abc-voicemails', 'hub-abc-attachments']
    const policy = buildBucketPolicy(buckets)

    expect(policy.Version).toBe('2012-10-17')
    expect(Array.isArray(policy.Statement)).toBe(true)

    const statements = policy.Statement as Array<{
      Effect: string
      Action: string[]
      Resource: string[]
    }>
    expect(statements).toHaveLength(2)

    // Object-level actions
    expect(statements[0].Effect).toBe('Allow')
    expect(statements[0].Action).toContain('s3:GetObject')
    expect(statements[0].Action).toContain('s3:PutObject')
    expect(statements[0].Action).toContain('s3:DeleteObject')
    expect(statements[0].Resource).toContain('arn:aws:s3:::hub-abc-voicemails/*')
    expect(statements[0].Resource).toContain('arn:aws:s3:::hub-abc-attachments/*')

    // Bucket-level actions
    expect(statements[1].Effect).toBe('Allow')
    expect(statements[1].Action).toContain('s3:ListBucket')
    expect(statements[1].Resource).toContain('arn:aws:s3:::hub-abc-voicemails')
    expect(statements[1].Resource).toContain('arn:aws:s3:::hub-abc-attachments')
  })

  it('handles single bucket', () => {
    const policy = buildBucketPolicy(['my-bucket'])
    const statements = policy.Statement as Array<{ Resource: string[] }>
    expect(statements[0].Resource).toEqual(['arn:aws:s3:::my-bucket/*'])
    expect(statements[1].Resource).toEqual(['arn:aws:s3:::my-bucket'])
  })
})
