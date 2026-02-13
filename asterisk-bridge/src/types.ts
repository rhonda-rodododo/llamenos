// ---- ARI Event Types ----

/** Base ARI event — all events include these fields */
export interface AriEvent {
  type: string
  application: string
  timestamp: string
}

/** StasisStart — a channel has entered the Stasis application */
export interface StasisStartEvent extends AriEvent {
  type: 'StasisStart'
  args: string[]
  channel: AriChannel
}

/** StasisEnd — a channel has left the Stasis application */
export interface StasisEndEvent extends AriEvent {
  type: 'StasisEnd'
  channel: AriChannel
}

/** ChannelDtmfReceived — a DTMF digit was received on a channel */
export interface ChannelDtmfReceivedEvent extends AriEvent {
  type: 'ChannelDtmfReceived'
  digit: string
  duration_ms: number
  channel: AriChannel
}

/** ChannelStateChange — a channel's state has changed */
export interface ChannelStateChangeEvent extends AriEvent {
  type: 'ChannelStateChange'
  channel: AriChannel
}

/** ChannelHangupRequest — a hangup was requested on a channel */
export interface ChannelHangupRequestEvent extends AriEvent {
  type: 'ChannelHangupRequest'
  cause: number
  channel: AriChannel
}

/** ChannelDestroyed — a channel has been destroyed */
export interface ChannelDestroyedEvent extends AriEvent {
  type: 'ChannelDestroyed'
  cause: number
  cause_txt: string
  channel: AriChannel
}

/** PlaybackFinished — a playback has finished */
export interface PlaybackFinishedEvent extends AriEvent {
  type: 'PlaybackFinished'
  playback: AriPlayback
}

/** RecordingFinished — a recording has finished */
export interface RecordingFinishedEvent extends AriEvent {
  type: 'RecordingFinished'
  recording: AriRecording
}

/** RecordingFailed — a recording has failed */
export interface RecordingFailedEvent extends AriEvent {
  type: 'RecordingFailed'
  recording: AriRecording
}

/** ChannelEnteredBridge — a channel entered a bridge */
export interface ChannelEnteredBridgeEvent extends AriEvent {
  type: 'ChannelEnteredBridge'
  bridge: AriBridge
  channel: AriChannel
}

/** ChannelLeftBridge — a channel left a bridge */
export interface ChannelLeftBridgeEvent extends AriEvent {
  type: 'ChannelLeftBridge'
  bridge: AriBridge
  channel: AriChannel
}

export type AnyAriEvent =
  | StasisStartEvent
  | StasisEndEvent
  | ChannelDtmfReceivedEvent
  | ChannelStateChangeEvent
  | ChannelHangupRequestEvent
  | ChannelDestroyedEvent
  | PlaybackFinishedEvent
  | RecordingFinishedEvent
  | RecordingFailedEvent
  | ChannelEnteredBridgeEvent
  | ChannelLeftBridgeEvent
  | AriEvent // fallback for unknown events

// ---- ARI Resource Types ----

export interface AriChannel {
  id: string
  name: string
  state: 'Down' | 'Rsrved' | 'OffHook' | 'Dialing' | 'Ring' | 'Ringing' | 'Up' | 'Busy' | 'Dialing Offhook' | 'Pre-ring' | 'Unknown'
  caller: { name: string; number: string }
  connected: { name: string; number: string }
  accountcode: string
  dialplan: { context: string; exten: string; priority: number }
  creationtime: string
  language: string
}

export interface AriBridge {
  id: string
  technology: string
  bridge_type: string
  bridge_class: string
  creator: string
  name: string
  channels: string[]
}

export interface AriPlayback {
  id: string
  media_uri: string
  target_uri: string
  language: string
  state: 'queued' | 'playing' | 'complete' | 'failed'
}

export interface AriRecording {
  name: string
  format: string
  state: 'queued' | 'recording' | 'paused' | 'done' | 'failed' | 'canceled'
  target_uri: string
  duration?: number
  talking_duration?: number
  silence_duration?: number
  cause?: string
}

// ---- Webhook Types (sent to CF Worker) ----

/** Webhook payload sent to the CF Worker, mimicking Twilio's format */
export interface WebhookPayload {
  /** Event type, maps to Twilio's webhook URL paths */
  event: 'incoming' | 'language-selected' | 'captcha' | 'call-status' | 'wait-music' | 'queue-exit' | 'volunteer-answer' | 'call-recording' | 'voicemail-recording' | 'voicemail-complete'
  /** Channel ID (equivalent to Twilio CallSid) */
  CallSid: string
  /** Caller phone number in E.164 (equivalent to Twilio From) */
  From: string
  /** Called number (equivalent to Twilio To) */
  To: string
  /** DTMF digits pressed (for gather responses) */
  Digits?: string
  /** Call status for status callbacks */
  CallStatus?: 'initiated' | 'ringing' | 'in-progress' | 'completed' | 'busy' | 'no-answer' | 'failed'
  /** Queue time in seconds */
  QueueTime?: string
  /** Queue exit result */
  QueueResult?: 'leave' | 'queue-full' | 'error' | 'bridged' | 'hangup'
  /** Recording status */
  RecordingStatus?: 'completed' | 'failed'
  /** Recording identifier */
  RecordingSid?: string
  /** Additional query params passed through */
  [key: string]: string | undefined
}

// ---- Command Types (received from CF Worker) ----

/** Commands the CF Worker can send back to the bridge */
export type BridgeCommand =
  | PlaybackCommand
  | GatherCommand
  | BridgeCallCommand
  | HangupCommand
  | RecordCommand
  | RingCommand
  | QueueCommand
  | RejectCommand
  | RedirectCommand

export interface PlaybackCommand {
  action: 'playback'
  channelId: string
  /** Media URI — sound:filename for Asterisk sounds, or a URL */
  media: string
  /** TTS text (if no media URI, use Asterisk TTS or Festival) */
  text?: string
  /** Language for TTS */
  language?: string
}

export interface GatherCommand {
  action: 'gather'
  channelId: string
  /** Maximum number of digits to collect */
  numDigits: number
  /** Timeout in seconds waiting for input */
  timeout: number
  /** Media to play while gathering */
  media?: string
  /** TTS text to play while gathering */
  text?: string
  /** Language for TTS */
  language?: string
  /** URL to send gathered digits to (relative path on worker) */
  callbackPath: string
  /** Additional query params for the callback */
  callbackParams?: Record<string, string>
}

export interface BridgeCallCommand {
  action: 'bridge'
  /** Caller channel to bridge */
  callerChannelId: string
  /** Volunteer channel to bridge */
  volunteerChannelId: string
  /** Whether to record the bridge */
  record?: boolean
  /** Callback path for recording status */
  recordingCallbackPath?: string
  /** Additional params for recording callback */
  recordingCallbackParams?: Record<string, string>
}

export interface HangupCommand {
  action: 'hangup'
  channelId: string
  /** SIP cause code (default 16 = Normal Clearing) */
  cause?: number
}

export interface RecordCommand {
  action: 'record'
  channelId: string
  /** Recording name (used to retrieve later) */
  name: string
  /** Max recording duration in seconds */
  maxDuration: number
  /** Whether to play a beep before recording */
  beep: boolean
  /** Callback path when recording finishes */
  callbackPath: string
  /** Additional params for the callback */
  callbackParams?: Record<string, string>
}

export interface RingCommand {
  action: 'ring'
  /** Endpoint to call (e.g., PJSIP/volunteer1) */
  endpoint: string
  /** Caller ID to show */
  callerId: string
  /** Timeout in seconds */
  timeout: number
  /** Callback path when volunteer answers */
  answerCallbackPath: string
  /** Additional params for the callback */
  answerCallbackParams?: Record<string, string>
  /** Callback path for status changes */
  statusCallbackPath: string
  /** Additional params for the status callback */
  statusCallbackParams?: Record<string, string>
}

export interface QueueCommand {
  action: 'queue'
  channelId: string
  /** Hold music (Asterisk MOH class or media URI) */
  musicOnHold?: string
  /** Callback path for periodic wait updates */
  waitCallbackPath?: string
  /** Interval in seconds for wait callbacks */
  waitCallbackInterval?: number
  /** Callback path when caller leaves queue */
  exitCallbackPath?: string
  /** Additional params for callbacks */
  callbackParams?: Record<string, string>
}

export interface RejectCommand {
  action: 'reject'
  channelId: string
  /** SIP cause code (default 21 = Call Rejected) */
  cause?: number
}

export interface RedirectCommand {
  action: 'redirect'
  /** New webhook path to call on the worker */
  path: string
  /** Query params */
  params?: Record<string, string>
  /** Channel context */
  channelId: string
}

// ---- Bridge Internal State ----

/** Active call state tracked by the bridge */
export interface ActiveCall {
  channelId: string
  callerNumber: string
  calledNumber: string
  startedAt: number
  language?: string
  /** Bridge ID if this call is bridged */
  bridgeId?: string
  /** Volunteer channel IDs ringing for this call */
  ringingChannels: string[]
  /** DTMF digits collected so far (for gather) */
  dtmfBuffer: string
  /** Active gather config */
  activeGather?: {
    numDigits: number
    timeout: number
    callbackPath: string
    callbackParams?: Record<string, string>
    timeoutTimer?: ReturnType<typeof setTimeout>
  }
  /** Queue state */
  queue?: {
    waitTimer?: ReturnType<typeof setTimeout>
    exitCallbackPath?: string
    callbackParams?: Record<string, string>
    startedAt: number
  }
}

/** Configuration for the bridge service */
export interface BridgeConfig {
  ariUrl: string
  ariRestUrl: string
  ariUsername: string
  ariPassword: string
  workerWebhookUrl: string
  bridgeSecret: string
  bridgePort: number
  /** Stasis application name */
  stasisApp: string
}
