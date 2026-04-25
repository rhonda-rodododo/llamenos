import { hexToBytes } from '@noble/hashes/utils.js'
import {
  LABEL_FIREHOSE_AGENT_SEAL,
  LABEL_FIREHOSE_BUFFER_ENCRYPT,
  LABEL_FIREHOSE_REPORT_WRAP,
} from '@shared/crypto-labels'
import type { Ciphertext } from '@shared/crypto-types'
import { KIND_FIREHOSE_REPORT } from '@shared/nostr-events'
import { type BufferEnvelopeJson, BufferEnvelopeJsonSchema } from '@shared/schemas/firehose'
import type { RecipientEnvelope } from '@shared/types'
import type { Database } from '../db'
import { getNostrPublisher } from '../lib/adapters'
import { unsealAgentNsec } from '../lib/agent-identity'
import type { CryptoService } from '../lib/crypto-service'
import { createLogger } from '../lib/logger'
import type { ConversationService } from './conversations'
import type { FirehoseService } from './firehose'
import type {
  CustomFieldDef,
  DecryptedFirehoseMessage,
  ExtractionResult,
  FirehoseInferenceClient,
  MessageCluster,
} from './firehose-inference'
import type { IdentityService } from './identity'
import type { RecordsService } from './records'
import type { SettingsService } from './settings'

const log = createLogger('services.firehose-agent')

/** In-memory state for a running extraction agent */
interface AgentInstance {
  connectionId: string
  hubId: string
  agentPubkey: string
  nsecBytes: Uint8Array
  intervalHandle: ReturnType<typeof setInterval>
  inferenceClient: FirehoseInferenceClient
}

/** Minimum messages before attempting extraction */
const MIN_CLUSTER_SIZE = 2
/** Time window (ms) for heuristic clustering — 5 minutes */
const CLUSTER_WINDOW_MS = 5 * 60 * 1000
/** Default inference endpoint if none configured per-connection */
const DEFAULT_INFERENCE_ENDPOINT = 'http://localhost:8000/v1'
/** Default inference model */
const DEFAULT_INFERENCE_MODEL = 'Qwen/Qwen3.5-9B'
/** Minimum confidence score to accept an extraction */
const CONFIDENCE_THRESHOLD = 0.3
/** Consecutive extraction failures before auto-pausing a connection */
const CIRCUIT_BREAKER_THRESHOLD = 3

export class FirehoseAgentService {
  private agents = new Map<string, AgentInstance>()
  private inferenceClients = new Map<string, FirehoseInferenceClient>()
  /** Consecutive extraction failure counts per connection */
  private extractionFailureCounts = new Map<string, number>()

  constructor(
    readonly _db: Database,
    private readonly crypto: CryptoService,
    private readonly firehose: FirehoseService,
    private readonly conversations: ConversationService,
    private readonly identity: IdentityService,
    private readonly records: RecordsService,
    private readonly settings: SettingsService,
    private readonly sealKey: string,
    private readonly env: {
      SERVER_NOSTR_SECRET?: string
      NOSTR_RELAY_URL?: string
      ADMIN_PUBKEY?: string
      ADMIN_DECRYPTION_PUBKEY?: string
    }
  ) {}

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Load all active connections from DB, unseal their agent nsecs, and start
   * extraction loops.
   */
  async init(): Promise<void> {
    const connections = await this.firehose.listActiveConnections()
    log.info('Initializing active agents', { count: connections.length })

    for (const conn of connections) {
      try {
        await this.startAgent(conn.id)
      } catch (err) {
        log.error('Failed to start agent', err, { connectionId: conn.id })
      }
    }

    const started = this.agents.size
    const failed = connections.length - started
    if (failed > 0) {
      log.warn('Partial agent startup', { started, total: connections.length, failed })
    } else {
      log.info('All agents started successfully', { started })
    }
  }

  /**
   * Start an extraction agent for the given connection.
   * Unseals the agent nsec, creates an inference client, and begins the
   * periodic extraction loop.
   */
  async startAgent(connectionId: string): Promise<void> {
    if (this.agents.has(connectionId)) {
      log.warn('Agent already running', { connectionId })
      return
    }

    const conn = await this.firehose.getConnection(connectionId)
    if (!conn) {
      throw new Error(`Connection ${connectionId} not found`)
    }
    if (conn.status !== 'active') {
      throw new Error(`Connection ${connectionId} is not active (status: ${conn.status})`)
    }

    // Unseal the agent's nsec
    const nsecHex = unsealAgentNsec(
      connectionId,
      conn.encryptedAgentNsec,
      this.sealKey,
      LABEL_FIREHOSE_AGENT_SEAL
    )
    const nsecBytes = hexToBytes(nsecHex)

    // Get or create inference client for this endpoint
    const endpoint = conn.inferenceEndpoint || DEFAULT_INFERENCE_ENDPOINT
    const inferenceClient = this.getOrCreateInferenceClient(endpoint)

    // Start extraction loop
    const intervalMs = (conn.extractionIntervalSec ?? 60) * 1000
    const intervalHandle = setInterval(() => {
      this.runExtractionLoop(connectionId).catch((err) => {
        log.error('Extraction loop error', err, { connectionId })
      })
    }, intervalMs)

    this.agents.set(connectionId, {
      connectionId,
      hubId: conn.hubId,
      agentPubkey: conn.agentPubkey,
      nsecBytes,
      intervalHandle,
      inferenceClient,
    })
    // Reset circuit breaker state on (re)start
    this.extractionFailureCounts.set(connectionId, 0)

    log.info('Started agent', { connectionId, intervalSec: conn.extractionIntervalSec })
  }

  /**
   * Stop an extraction agent: clear the interval, zero the nsec, and remove
   * from the active map.
   */
  stopAgent(connectionId: string): void {
    const agent = this.agents.get(connectionId)
    if (!agent) return

    clearInterval(agent.intervalHandle)
    // Zero nsec from memory
    agent.nsecBytes.fill(0)
    this.agents.delete(connectionId)
    this.extractionFailureCounts.delete(connectionId)

    log.info('Stopped agent', { connectionId })
  }

  /**
   * Graceful shutdown — stop all running agents.
   */
  shutdown(): void {
    log.info('Shutting down agents', { count: this.agents.size })
    for (const connectionId of this.agents.keys()) {
      this.stopAgent(connectionId)
    }
    this.inferenceClients.clear()
  }

  /** Check if an agent is currently running for a connection */
  isRunning(connectionId: string): boolean {
    return this.agents.has(connectionId)
  }

  // ---------------------------------------------------------------------------
  // Extraction Loop
  // ---------------------------------------------------------------------------

  /**
   * Core extraction loop for a single connection:
   * 1. Fetch unextracted buffer messages
   * 2. Decrypt them using the agent's nsec
   * 3. Cluster by time proximity (heuristic)
   * 4. Optionally refine clusters with LLM
   * 5. Extract structured reports from each cluster
   * 6. Submit reports as E2EE conversations
   */
  async runExtractionLoop(connectionId: string): Promise<void> {
    const agent = this.agents.get(connectionId)
    if (!agent) return

    // 1. Get unextracted messages
    const bufferMessages = await this.firehose.getUnextractedMessages(connectionId)
    if (bufferMessages.length < MIN_CLUSTER_SIZE) return

    // 2. Decrypt messages using the agent's pubkey to find its envelope
    const agentPubkey = agent.agentPubkey
    const decrypted: DecryptedFirehoseMessage[] = []
    for (const msg of bufferMessages) {
      try {
        const parsed = this.parseBufferEnvelope(msg.encryptedContent)
        const senderParsed = this.parseBufferEnvelope(msg.encryptedSenderInfo)

        // Find the agent's envelope
        const contentEnvelope = parsed.envelopes.find((e) => e.pubkey === agentPubkey)
        const senderEnvelope = senderParsed.envelopes.find((e) => e.pubkey === agentPubkey)

        if (!contentEnvelope || !senderEnvelope) {
          log.warn('No agent envelope found for message', { messageId: msg.id })
          continue
        }

        const content = await this.crypto.envelopeDecrypt(
          parsed.encrypted as Ciphertext,
          contentEnvelope as RecipientEnvelope,
          LABEL_FIREHOSE_BUFFER_ENCRYPT
        )

        const senderJson = await this.crypto.envelopeDecrypt(
          senderParsed.encrypted as Ciphertext,
          senderEnvelope as RecipientEnvelope,
          LABEL_FIREHOSE_BUFFER_ENCRYPT
        )

        const sender = JSON.parse(senderJson) as {
          identifier: string
          identifierHash: string
          username: string
          timestamp: number
        }

        decrypted.push({
          id: msg.id,
          senderUsername: sender.username,
          content,
          timestamp: msg.signalTimestamp.toISOString(),
        })
      } catch (err) {
        log.error('Failed to decrypt message', err, { messageId: msg.id })
        // Audit so admins can see decryption issues in the UI
        this.records
          .addAuditEntry(agent.hubId, 'firehoseDecryptionFailed', agent.agentPubkey, {
            messageId: msg.id,
            connectionId: connectionId,
            error: err instanceof Error ? err.message : String(err),
          })
          .catch(() => {})
      }
    }

    if (decrypted.length < MIN_CLUSTER_SIZE) return

    // 3. Heuristic clustering
    const clusters = this.heuristicCluster(decrypted)

    // 4. Load connection for metadata
    const conn = await this.firehose.getConnection(connectionId)
    if (!conn) return

    // 5. For each cluster, attempt LLM extraction and submit report
    for (const cluster of clusters) {
      if (cluster.messages.length < MIN_CLUSTER_SIZE) continue

      try {
        // Load custom fields for the report type's schema
        const fieldDefs = await this.getFieldDefsForReportType(conn.hubId, conn.reportTypeId)
        const schema = agent.inferenceClient.buildJsonSchemaFromFields(fieldDefs)

        // Extract report via LLM
        const extraction = await agent.inferenceClient.extractReport(
          cluster.messages,
          schema,
          conn.geoContext ?? undefined,
          conn.systemPromptSuffix ?? undefined
        )

        // Skip low-confidence extractions
        if (extraction.confidence < CONFIDENCE_THRESHOLD) {
          log.info('Skipping low-confidence extraction', {
            confidence: extraction.confidence,
            clusterId: cluster.id,
          })
          continue
        }

        // Submit as E2EE report
        const reportId = await this.submitExtractedReport(conn, cluster, extraction)

        // Mark buffer messages as extracted
        const messageIds = cluster.messages.map((m) => m.id)
        await this.firehose.markMessagesExtracted(messageIds, reportId, cluster.id)

        // Reset circuit breaker on success
        this.extractionFailureCounts.set(connectionId, 0)

        log.info('Extracted report', {
          reportId,
          sourceMessageCount: messageIds.length,
          confidence: extraction.confidence,
        })
      } catch (err) {
        log.error('Extraction failed for cluster', err, { clusterId: cluster.id })

        // Circuit breaker: track consecutive failures and auto-pause after threshold
        const failures = (this.extractionFailureCounts.get(connectionId) ?? 0) + 1
        this.extractionFailureCounts.set(connectionId, failures)

        if (failures >= CIRCUIT_BREAKER_THRESHOLD) {
          log.warn('Circuit breaker tripped — pausing connection', {
            connectionId,
            failures,
          })
          this.stopAgent(connectionId)
          await this.firehose.updateConnection(connectionId, { status: 'paused' })
          await this.records
            .addAuditEntry(agent.hubId, 'firehoseCircuitBreakerTripped', agent.agentPubkey, {
              connectionId,
              consecutiveFailures: failures,
              lastError: err instanceof Error ? err.message : String(err),
            })
            .catch(() => {})
          // Break out of cluster loop — agent is stopped
          return
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Heuristic Clustering
  // ---------------------------------------------------------------------------

  /**
   * Group messages by time proximity — messages within 5-minute windows form
   * a cluster. This is a simple first-pass before optional LLM refinement.
   */
  heuristicCluster(messages: DecryptedFirehoseMessage[]): MessageCluster[] {
    if (messages.length === 0) return []

    // Sort by timestamp
    const sorted = [...messages].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )

    const clusters: MessageCluster[] = []
    let currentCluster: DecryptedFirehoseMessage[] = [sorted[0]]

    for (let i = 1; i < sorted.length; i++) {
      const prevTime = new Date(sorted[i - 1].timestamp).getTime()
      const currTime = new Date(sorted[i].timestamp).getTime()

      if (currTime - prevTime <= CLUSTER_WINDOW_MS) {
        currentCluster.push(sorted[i])
      } else {
        clusters.push({
          id: crypto.randomUUID(),
          messages: currentCluster,
          confidence: 0.7, // heuristic baseline
        })
        currentCluster = [sorted[i]]
      }
    }

    // Push final cluster
    if (currentCluster.length > 0) {
      clusters.push({
        id: crypto.randomUUID(),
        messages: currentCluster,
        confidence: 0.7,
      })
    }

    return clusters
  }

  // ---------------------------------------------------------------------------
  // Report Submission
  // ---------------------------------------------------------------------------

  /**
   * Submit an extracted report as an E2EE conversation following the existing
   * report creation pattern (see src/server/routes/reports.ts).
   */
  private async submitExtractedReport(
    conn: { id: string; hubId: string; reportTypeId: string; agentPubkey: string },
    cluster: MessageCluster,
    extraction: ExtractionResult
  ): Promise<string> {
    // Build report content
    const reportContent = JSON.stringify({
      extractedFields: extraction.fields,
      confidence: extraction.confidence,
      sourceMessageCount: cluster.messages.length,
      sourceMessageIds: cluster.messages.map((m) => m.id),
      agentPubkey: conn.agentPubkey,
      clusterId: cluster.id,
      incidentTimestamp: cluster.messages[0]?.timestamp,
      extractedAt: new Date().toISOString(),
    })

    // Get recipients for envelope encryption: admin pubkeys + users with reports:read-all
    const adminPubkeys = await this.identity.getSuperAdminPubkeys()
    const recipientPubkeys = [
      ...new Set([conn.agentPubkey, ...adminPubkeys.filter((pk) => /^[0-9a-f]{64}$/i.test(pk))]),
    ]

    if (recipientPubkeys.length === 0) {
      throw new Error('No valid recipient pubkeys for report envelope')
    }

    // Envelope-encrypt the report content
    const { encrypted, envelopes } = await this.crypto.envelopeEncrypt(
      reportContent,
      recipientPubkeys,
      LABEL_FIREHOSE_REPORT_WRAP,
      '',
      'content'
    )

    // Create conversation with report metadata (follows reports.ts pattern)
    const conversation = await this.conversations.createConversation({
      hubId: conn.hubId,
      channelType: 'web',
      contactIdentifierHash: conn.agentPubkey,
      skipDedup: true,
      status: 'waiting',
      metadata: {
        type: 'report',
        reportTitle: `Firehose extraction — ${new Date().toISOString()}`,
        reportCategory: 'firehose-extraction',
        firehoseConnectionId: conn.id,
        firehoseClusterId: cluster.id,
        firehoseConfidence: extraction.confidence,
        extractedAt: new Date().toISOString(),
      },
      reportTypeId: conn.reportTypeId,
    })

    // Add the encrypted report as the first message
    await this.conversations.addMessage({
      conversationId: conversation.id,
      direction: 'inbound',
      authorPubkey: conn.agentPubkey,
      encryptedContent: encrypted as string,
      readerEnvelopes: envelopes,
      hasAttachments: false,
      status: 'delivered',
    })

    // Publish Nostr event
    try {
      const publisher = getNostrPublisher(this.env)
      publisher
        .publish({
          kind: KIND_FIREHOSE_REPORT,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['d', conn.hubId],
            ['t', 'llamenos:event'],
            ['c', conn.id],
          ],
          content: JSON.stringify({
            type: 'firehose:report',
            connectionId: conn.id,
            conversationId: conversation.id,
            confidence: extraction.confidence,
          }),
        })
        .catch((err) => log.error('Nostr publish failed', err))
    } catch (err) {
      // Only log unexpected errors — missing publisher config is expected in some envs
      if (err instanceof Error && !err.message.includes('not configured')) {
        log.error('Unexpected Nostr error', err)
      }
    }

    // Audit log
    await this.records.addAuditEntry(conn.hubId, 'firehoseReportExtracted', conn.agentPubkey, {
      conversationId: conversation.id,
      connectionId: conn.id,
      clusterId: cluster.id,
      confidence: extraction.confidence,
      sourceMessageCount: cluster.messages.length,
    })

    // Notify admins about the new report
    await this.notifyAdmins(conn, conversation.id, extraction.confidence)

    return conversation.id
  }

  /**
   * Notify admins of a newly extracted firehose report.
   *
   * Always publishes a Nostr KIND_FIREHOSE_REPORT event. If the connection has
   * `notifyViaSignal` enabled, also logs that a Signal DM would be sent to each
   * non-opted-out admin user.
   *
   * TODO: Wire up actual Signal DM sending via MessagingAdapter once the
   * identity→Signal phone mapping is available in IdentityService.
   */
  private async notifyAdmins(
    conn: { id: string; hubId: string; reportTypeId: string },
    reportId: string,
    confidence: number
  ): Promise<void> {
    // Fetch the full connection record to get display name and notifyViaSignal flag
    const connection = await this.firehose.getConnection(conn.id)
    if (!connection) {
      log.warn('Connection disappeared during notification', { connectionId: conn.id })
      return
    }

    // Publish Nostr notification event
    try {
      const publisher = getNostrPublisher(this.env)
      publisher
        .publish({
          kind: KIND_FIREHOSE_REPORT,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['d', conn.hubId],
            ['t', 'llamenos:event'],
            ['c', conn.id],
          ],
          content: JSON.stringify({
            type: 'firehose:report:notify',
            connectionId: conn.id,
            reportId,
            confidence,
          }),
        })
        .catch((err) => log.error('Nostr notify publish failed', err))
    } catch (err) {
      // Only log unexpected errors — missing publisher config is expected in some envs
      if (err instanceof Error && !err.message.includes('not configured')) {
        log.error('Unexpected Nostr error', err)
      }
    }

    // Signal DM notifications (if enabled for this connection)
    if (!connection.notifyViaSignal) return

    const shortCode = connection.id.slice(0, 8).toUpperCase()
    const connectionDisplayName =
      connection.displayName || connection.encryptedDisplayName || connection.id
    // Report type name would need hub-key decryption — use ID as fallback
    const reportTypeName = connection.reportTypeId

    const _message = [
      `[Llamenos] Firehose report submitted from "${connectionDisplayName}"`,
      `Report type: ${reportTypeName} | Confidence: ${confidence.toFixed(2)}`,
      `Reply STOP-${shortCode} to disable Signal notifications for this connection.`,
    ].join('\n')

    // Get all admin pubkeys to check opt-out status
    const adminPubkeys = await this.identity.getSuperAdminPubkeys()

    for (const pubkey of adminPubkeys) {
      try {
        const optedOut = await this.firehose.isOptedOut(connection.id, pubkey)
        if (optedOut) {
          log.info('Skipping Signal DM for opted-out admin', {
            adminPubkeyPrefix: pubkey.slice(0, 8),
            connectionId: connection.id,
          })
          continue
        }

        // TODO: Send actual Signal DM via MessagingAdapter once admin Signal phone
        // mapping is available. Requires IdentityService.getSignalIdentifierForUser(pubkey)
        // and a configured Signal MessagingAdapter for this hub.
        log.info('Would send Signal DM to admin', {
          adminPubkeyPrefix: pubkey.slice(0, 8),
          connectionId: connection.id,
        })
      } catch (err) {
        log.error('Failed to check opt-out for admin', err, {
          adminPubkeyPrefix: pubkey.slice(0, 8),
        })
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Parse and validate a buffer column's JSON envelope format */
  private parseBufferEnvelope(json: string): BufferEnvelopeJson {
    return BufferEnvelopeJsonSchema.parse(JSON.parse(json))
  }

  /** Get or create a cached inference client for an endpoint URL */
  private getOrCreateInferenceClient(endpoint: string): FirehoseInferenceClient {
    const existing = this.inferenceClients.get(endpoint)
    if (existing) return existing
    // Import is eager since firehose-agent is only loaded when FIREHOSE_AGENT_SEAL_KEY is set
    const { FirehoseInferenceClient: ClientClass } = require('./firehose-inference') as {
      FirehoseInferenceClient: new (baseURL: string, model?: string) => FirehoseInferenceClient
    }
    const client = new ClientClass(endpoint, DEFAULT_INFERENCE_MODEL)
    this.inferenceClients.set(endpoint, client)
    return client
  }

  /**
   * Convert custom field definitions from the DB into the inference client's
   * CustomFieldDef format.
   */
  private async getFieldDefsForReportType(
    hubId: string,
    reportTypeId: string
  ): Promise<CustomFieldDef[]> {
    // Get custom fields for this hub's reports context
    const allFields = await this.settings.getCustomFields('admin', hubId)

    // Filter to fields that apply to this report type
    const relevant = allFields.filter((f) => {
      if (f.context !== 'reports') return false
      // If field has reportTypeIds, check if this report type is included
      if (f.reportTypeIds && f.reportTypeIds.length > 0) {
        return f.reportTypeIds.includes(reportTypeId)
      }
      // No reportTypeIds means it applies to all report types
      return true
    })

    // Map to inference-compatible format
    return relevant.map((f) => ({
      name: f.name || f.id,
      label: f.label || f.name || f.id,
      type: this.mapFieldType(f.type),
      required: f.required,
      options: f.options ?? [],
    }))
  }

  /** Map app field types to inference-compatible subset */
  private mapFieldType(
    type: string
  ): 'text' | 'select' | 'multiselect' | 'checkbox' | 'date' | 'number' | 'location' {
    switch (type) {
      case 'select':
        return 'select'
      case 'multiselect':
        return 'multiselect'
      case 'checkbox':
        return 'checkbox'
      case 'number':
        return 'number'
      case 'location':
        return 'location'
      case 'date':
        return 'date'
      case 'textarea':
        return 'text'
      case 'file':
      case 'contact':
      case 'contacts':
        return 'text'
      default:
        return 'text'
    }
  }
}
