import type {
  CreateFirehoseConnectionInput,
  FirehoseConnection,
  FirehoseConnectionHealth,
  UpdateFirehoseConnectionInput,
} from '@shared/schemas/firehose'
import { hp, request } from './client'

export type { FirehoseConnection, FirehoseConnectionHealth }

// ---------------------------------------------------------------------------
// Firehose Connections
// ---------------------------------------------------------------------------

export async function listFirehoseConnections(): Promise<{
  connections: FirehoseConnection[]
}> {
  return request(hp('/firehose'))
}

async function _getFirehoseConnection(id: string): Promise<{
  connection: FirehoseConnection
}> {
  return request(hp(`/firehose/${id}`))
}

export async function createFirehoseConnection(
  data: CreateFirehoseConnectionInput
): Promise<{ connection: FirehoseConnection }> {
  return request(hp('/firehose'), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateFirehoseConnection(
  id: string,
  data: UpdateFirehoseConnectionInput
): Promise<{ connection: FirehoseConnection }> {
  return request(hp(`/firehose/${id}`), {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteFirehoseConnection(id: string): Promise<{ ok: boolean }> {
  return request(hp(`/firehose/${id}`), {
    method: 'DELETE',
  })
}

// ---------------------------------------------------------------------------
// Firehose Health / Status
// ---------------------------------------------------------------------------

export async function getFirehoseStatus(): Promise<{
  statuses: FirehoseConnectionHealth[]
}> {
  return request(hp('/firehose/status'))
}
