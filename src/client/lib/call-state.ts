// Module-level call state store — readable outside React without re-render coupling.
// Updated by useCalls hook as a side effect.

let ringingCallIds: string[] = []
let currentCallId: string | null = null

export function getRingingCallIds(): string[] {
  return ringingCallIds
}

function setRingingCallIds(ids: string[]) {
  ringingCallIds = ids
}

export function getCurrentCallId(): string | null {
  return currentCallId
}

function setCurrentCallId(id: string | null) {
  currentCallId = id
}
