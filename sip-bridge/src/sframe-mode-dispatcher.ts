/**
 * SframeModeDispatcher — Tier 5 voice E2EE guard.
 *
 * Calls that enter Stasis from the `[volunteers-sframe]` dialplan context
 * pass `sframe` as a Stasis application argument. We mark those calls as
 * SFrame-mode and enforce a compile-time + runtime recording ban: the
 * sip-bridge will NEVER call MixMonitor, Record, recordBridge, or
 * recordChannel on an SFrame call.
 *
 * PSTN calls (no `sframe` arg) retain normal recording semantics so the
 * existing voicemail and opt-in recording paths keep working.
 */

export interface CallMode {
  mode: 'sframe' | 'pstn'
}

/**
 * Parse Stasis app arguments into a CallMode.
 *
 * Asterisk 18+ delivers `Stasis(llamenos,sframe)` as `event.args = ['sframe']`.
 * When the bridge originates the volunteer leg via `originateChannel` with
 * `appArgs: 'dialed,<parentCallSid>,<pubkey>'` there is no `sframe` token,
 * so the outbound volunteer leg defaults to `pstn`. The bridge assembler
 * propagates mode from the caller leg to the bridge recording guard.
 */
export function parseStasisArgs(args: string[]): CallMode {
  if (args.includes('sframe')) return { mode: 'sframe' }
  return { mode: 'pstn' }
}

export class SframeModeDispatcher {
  /**
   * Throws if `cm.mode === 'sframe'`. Callers must invoke this BEFORE any
   * recording side effect — never after.
   */
  assertRecordingAllowed(cm: CallMode): void {
    if (cm.mode === 'sframe') {
      throw new Error('recording banned on sframe mode (Tier 5 — SFrame)')
    }
  }
}
