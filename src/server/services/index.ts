import type { Database } from '../db'
import type { CryptoService } from '../lib/crypto-service'
import type { StorageManager } from '../types'
import { AuthEventsService } from './auth-events'
import { BlastService } from './blasts'
import { CallService } from './calls'
import { ContactService } from './contacts'
import { ConversationService } from './conversations'
import { FilesService } from './files'
import { FirehoseService } from './firehose'
import type { FirehoseAgentService } from './firehose-agent'
import { GdprService } from './gdpr'
import { IdentityService } from './identity'
import { IntakesService } from './intakes'
import type { ProviderHealthService } from './provider-health'
import { PushService } from './push'
import { RecordsService } from './records'
import { ReportTypeService } from './report-types'
import { SecurityActionsService } from './security-actions'
import { SecurityPrefsService } from './security-prefs'
import { SessionService } from './sessions'
import { SettingsService } from './settings'
import { ShiftService } from './shifts'
import { SignalContactsService } from './signal-contacts'
import { TagsService } from './tags'
import { TeamsService } from './teams'
import { UserNotificationsService } from './user-notifications'

export type {
  AuthEventsService,
  BlastService,
  FirehoseService,
  FirehoseAgentService,
  CallService,
  ContactService,
  ConversationService,
  FilesService,
  GdprService,
  IdentityService,
  IntakesService,
  PushService,
  RecordsService,
  ReportTypeService,
  SessionService,
  SettingsService,
  ShiftService,
  TagsService,
  TeamsService,
  ProviderHealthService,
  SignalContactsService,
  SecurityPrefsService,
  SecurityActionsService,
  UserNotificationsService,
}

export interface Services {
  identity: IdentityService
  settings: SettingsService
  records: RecordsService
  shifts: ShiftService
  calls: CallService
  conversations: ConversationService
  blasts: BlastService
  files: FilesService
  gdpr: GdprService
  reportTypes: ReportTypeService
  sessions: SessionService
  authEvents: AuthEventsService
  push: PushService
  contacts: ContactService
  intakes: IntakesService
  tags: TagsService
  teams: TeamsService
  firehose: FirehoseService
  firehoseAgent?: FirehoseAgentService
  providerHealth?: ProviderHealthService
  storage: StorageManager | null
  crypto: CryptoService
  signalContacts: SignalContactsService
  securityPrefs: SecurityPrefsService
  securityActions: SecurityActionsService
  userNotifications: UserNotificationsService
}

export function createServices(
  db: Database,
  crypto: CryptoService,
  storage: StorageManager | null = null
): Services {
  const settings = new SettingsService(db, crypto)
  const contactService = new ContactService(db, crypto)
  const teamsService = new TeamsService(db, crypto)

  // Late-bind cross-service dependencies to avoid circular constructor coupling
  contactService.setTeamsService(teamsService)

  const authEvents = new AuthEventsService(db, crypto)
  const signalContacts = new SignalContactsService(db, process.env.HMAC_SECRET ?? '')
  const securityPrefs = new SecurityPrefsService(db)
  const userNotifications = new UserNotificationsService(
    signalContacts,
    securityPrefs,
    authEvents,
    {
      notifierUrl: process.env.SIGNAL_NOTIFIER_URL ?? 'http://signal-notifier:3100',
      notifierApiKey: process.env.SIGNAL_NOTIFIER_API_KEY ?? '',
    }
  )
  const identity = new IdentityService(db, crypto)
  const sessions = new SessionService(db, process.env.HMAC_SECRET ?? '')
  const securityActions = new SecurityActionsService(
    sessions,
    identity,
    authEvents,
    userNotifications
  )

  return {
    identity,
    settings,
    records: new RecordsService(db, crypto),
    shifts: new ShiftService(db, crypto, settings),
    calls: new CallService(db, crypto),
    conversations: new ConversationService(db, crypto),
    blasts: new BlastService(db, crypto, settings),
    files: new FilesService(db, storage),
    gdpr: new GdprService(db, crypto),
    reportTypes: new ReportTypeService(db, crypto, settings),
    sessions,
    authEvents,
    signalContacts,
    securityPrefs,
    securityActions,
    userNotifications,
    push: new PushService(db, crypto),
    contacts: contactService,
    intakes: new IntakesService(db, crypto),
    tags: new TagsService(db, crypto),
    teams: teamsService,
    firehose: new FirehoseService(db, crypto),
    storage,
    crypto,
  }
}
