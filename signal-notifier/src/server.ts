import { Hono } from 'hono'
import { sendSignalMessage } from './bridge-client'
import { IdentifierStore } from './store'

const port = Number(process.env.PORT ?? 3100)
const apiKey = process.env.NOTIFIER_API_KEY ?? ''
const dbPath = process.env.NOTIFIER_DB_PATH ?? './data/notifier.db'
const bridgeUrl = process.env.SIGNAL_BRIDGE_URL ?? 'http://signal-cli-rest-api:8080'
const bridgeApiKey = process.env.SIGNAL_BRIDGE_API_KEY ?? ''
const registeredNumber = process.env.SIGNAL_REGISTERED_NUMBER ?? ''

const store = new IdentifierStore(dbPath)
const app = new Hono()

// App-server-only auth middleware. All endpoints require the shared API key;
// clients never talk to the notifier directly. The app server proxies
// registrations on the user's behalf.
const requireApiKey = async (
  c: Parameters<Parameters<typeof app.use>[1]>[0],
  next: () => Promise<void>
) => {
  const header = c.req.header('authorization')
  if (!apiKey || header !== `Bearer ${apiKey}`) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
}
app.use('/notify', requireApiKey)
app.use('/identities/register', requireApiKey)
app.use('/identities/:hash', requireApiKey)

// App-server-only registration: the app server proxies the registration on
// the user's behalf after authenticating them via JWT.
app.post('/identities/register', async (c) => {
  const body = await c.req.json<{
    identifierHash: string
    plaintextIdentifier: string
    identifierType: 'phone' | 'username'
  }>()
  if (!body.identifierHash || !body.plaintextIdentifier) {
    return c.json({ error: 'Invalid body' }, 400)
  }
  if (body.identifierType !== 'phone' && body.identifierType !== 'username') {
    return c.json({ error: 'Invalid identifier type' }, 400)
  }
  store.register(body.identifierHash, body.plaintextIdentifier, body.identifierType)
  return c.json({ ok: true })
})

// App-server-only: send a notification
app.post('/notify', async (c) => {
  const body = await c.req.json<{
    identifierHash: string
    message: string
    disappearingTimerSeconds?: number
  }>()
  const entry = store.lookup(body.identifierHash)
  if (!entry) {
    return c.json({ error: 'Identifier not found' }, 404)
  }
  const result = await sendSignalMessage(
    { bridgeUrl, bridgeApiKey, registeredNumber },
    entry.plaintext,
    body.message,
    body.disappearingTimerSeconds ?? null
  )
  if (!result.ok) {
    return c.json({ error: result.error }, 502)
  }
  return c.json({ ok: true })
})

// App-server-only: delete an identifier
app.delete('/identities/:hash', async (c) => {
  const hash = c.req.param('hash')
  store.remove(hash)
  return c.json({ ok: true })
})

app.get('/healthz', (c) => c.json({ ok: true }))

export default { port, fetch: app.fetch }
