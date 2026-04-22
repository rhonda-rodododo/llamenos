import { expect, test } from '@playwright/test'
import { getPublicKey, nip19 } from 'nostr-tools'
import { signAccessToken } from '../../src/server/lib/jwt'
import { ADMIN_NSEC } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'
import type { AuthedRequest } from '../helpers/authed-request'

/**
 * Upload a binary chunk with proper auth and Content-Type: application/octet-stream.
 * The standard AuthedRequest.put sets Content-Type: application/json, so we
 * bypass it for raw binary uploads.
 */
async function putChunk(
  request: Parameters<typeof createAuthedRequestFromNsec>[0],
  nsec: string,
  path: string,
  data: Buffer
) {
  const decoded = nip19.decode(nsec)
  if (decoded.type !== 'nsec') throw new Error('Expected nsec')
  const pubkey = getPublicKey(decoded.data)
  const jwtSecret =
    process.env.JWT_SECRET || '0000000000000000000000000000000000000000000000000000000000000003'
  const token = await signAccessToken({ pubkey, permissions: ['admin'] }, jwtSecret)
  return request.put(path, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
    },
    data,
  })
}

test.describe('File upload lifecycle', () => {
  let authedApi: AuthedRequest

  test.beforeEach(async ({ request }) => {
    authedApi = createAuthedRequestFromNsec(request, ADMIN_NSEC)
  })

  test('full upload flow: init → chunks → complete → download', async ({ request }) => {
    // Use a dummy conversationId — file upload init does not validate it
    const conversationId = `test-conv-file-upload-${Date.now()}`

    const adminPubkey = authedApi.pubkey
    expect(typeof adminPubkey).toBe('string')

    // Init upload
    const initRes = await authedApi.post('/api/uploads/init', {
      totalSize: 10,
      totalChunks: 2,
      conversationId,
      recipientEnvelopes: [
        {
          v: 3,
          labelId: 0,
          enc: 'dGVzdA',
          ct: 'dGVzdA',
          pubkey: adminPubkey,
        },
      ],
      encryptedMetadata: [
        {
          v: 3,
          labelId: 0,
          enc: 'dGVzdA',
          ct: 'dGVzdA',
          pubkey: adminPubkey,
        },
      ],
    })
    expect(initRes.ok()).toBe(true)
    const initData = await initRes.json()
    const uploadId = initData.uploadId as string
    expect(typeof uploadId).toBe('string')

    // Upload chunk 0
    const chunk0Res = await putChunk(
      request,
      ADMIN_NSEC,
      `/api/uploads/${uploadId}/chunks/0`,
      Buffer.from([1, 2, 3, 4, 5])
    )
    expect(chunk0Res.ok()).toBe(true)
    const chunk0Result = await chunk0Res.json()
    expect(chunk0Result.completedChunks).toBe(1)
    expect(chunk0Result.totalChunks).toBe(2)

    // Upload chunk 1
    const chunk1Res = await putChunk(
      request,
      ADMIN_NSEC,
      `/api/uploads/${uploadId}/chunks/1`,
      Buffer.from([6, 7, 8, 9, 10])
    )
    expect(chunk1Res.ok()).toBe(true)

    // Check status before completing
    const statusRes = await authedApi.get(`/api/uploads/${uploadId}/status`)
    const statusData = await statusRes.json()
    expect(statusData.completedChunks).toBe(2)
    expect(statusData.totalChunks).toBe(2)
    expect(statusData.status).toBe('uploading')

    // Complete the upload
    const completeRes = await authedApi.post(`/api/uploads/${uploadId}/complete`)
    expect(completeRes.ok()).toBe(true)
    const completeData = await completeRes.json()
    expect(completeData.fileId).toBe(uploadId)
    expect(completeData.status).toBe('complete')

    // Download content
    const downloadRes = await authedApi.get(`/api/files/${uploadId}/content`)
    expect(downloadRes.ok()).toBe(true)
    const downloadBuf = await downloadRes.body()
    const downloadedBytes = Array.from(new Uint8Array(downloadBuf))
    expect(downloadedBytes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

    // Get envelopes from DB
    const envelopesRes = await authedApi.get(`/api/files/${uploadId}/envelopes`)
    const envelopes = await envelopesRes.json()
    expect(Array.isArray(envelopes)).toBe(true)
    expect(envelopes[0].pubkey).toBe(adminPubkey)

    // Get metadata from DB
    const metaRes = await authedApi.get(`/api/files/${uploadId}/metadata`)
    const meta = await metaRes.json()
    expect(Array.isArray(meta)).toBe(true)
    expect(meta[0].pubkey).toBe(adminPubkey)
  })

  test('cannot complete upload with missing chunks', async ({ request }) => {
    // Use a dummy conversationId — file upload init does not validate it
    const conversationId = `test-conv-missing-chunks-${Date.now()}`
    const adminPubkey = authedApi.pubkey

    const initRes = await authedApi.post('/api/uploads/init', {
      totalSize: 100,
      totalChunks: 3,
      conversationId,
      recipientEnvelopes: [{ v: 3, labelId: 0, enc: 'dGVzdA', ct: 'dGVzdA', pubkey: adminPubkey }],
      encryptedMetadata: [{ v: 3, labelId: 0, enc: 'dGVzdA', ct: 'dGVzdA', pubkey: adminPubkey }],
    })
    const initData = await initRes.json()
    const uploadId = initData.uploadId as string

    // Only upload 1 of 3 chunks
    await putChunk(request, ADMIN_NSEC, `/api/uploads/${uploadId}/chunks/0`, Buffer.from([1, 2, 3]))

    const completeRes = await authedApi.post(`/api/uploads/${uploadId}/complete`)
    expect(completeRes.status()).toBe(400)
    const completeBody = await completeRes.json()
    expect(completeBody.completedChunks).toBe(1)
    expect(completeBody.totalChunks).toBe(3)
  })
})
