import type { ConsentRecord, ConsentStore } from './consent.js';
import { getConsent } from './consent.js';
import { isQuietHour, nextAllowedTime, type QuietHours } from './quiet-hours.js';

/**
 * - `message`: normal outbound message. Needs opted-in status, footer, outside quiet hours.
 * - `opt_in_request`: asks the recipient to reply YES. Allowed for none/pending; needs footer.
 * - `reply`: direct answer to an inbound message (HELP text, STOP confirmation). Always allowed;
 *   the caller is responsible for only using it in response to an inbound message.
 */
export type SendKind = 'message' | 'opt_in_request' | 'reply';

export type DenyReason =
  | 'empty_body'
  | 'no_consent'
  | 'pending_confirmation'
  | 'opted_out'
  | 'missing_opt_out_footer'
  | 'timezone_required'
  | 'quiet_hours'
  | 'send_failed';

export type GuardDecision =
  | { allow: true }
  | { allow: false; reason: DenyReason; detail: string; retryAt?: Date };

export interface GuardOptions {
  kind?: SendKind;
  now?: Date;
  /** Recipient IANA time zone. Required unless `quietHours` is `false`. */
  timeZone?: string;
  /** `false` disables quiet-hours checks. Default window 21:00-08:00. */
  quietHours?: QuietHours | false;
  /** Set false to skip the footer check. Default true. */
  requireOptOutFooter?: boolean;
  /** Override how an opt-out instruction is detected. */
  footerPattern?: RegExp;
}

export const DEFAULT_FOOTER = 'Reply STOP to opt out.';

const DEFAULT_FOOTER_PATTERN =
  /(?:reply|text|send|responde|responda|env[ií]a|env[ií]e)\s+stop\b|\bstop\s+to\s+(?:opt|unsub|cancel|end|quit|cancelar)/i;

export function hasOptOutFooter(body: string, pattern: RegExp = DEFAULT_FOOTER_PATTERN): boolean {
  return pattern.test(body);
}

/** Append the default opt-out footer when missing. */
export function ensureOptOutFooter(body: string, footer: string = DEFAULT_FOOTER): string {
  return hasOptOutFooter(body) ? body : `${body.trimEnd()} ${footer}`;
}

/**
 * Decide whether `body` may be sent given the recipient's consent record.
 * Pure: no I/O. Checks run in order of severity so the reason is the most fundamental one.
 */
export function guardSend(
  record: Pick<ConsentRecord, 'status'> | null,
  body: string,
  options: GuardOptions = {},
): GuardDecision {
  const kind = options.kind ?? 'message';
  const status = record?.status ?? 'none';

  if (kind === 'reply') return { allow: true };

  if (!body.trim()) return deny('empty_body', 'Message body is empty.');

  if (status === 'opted_out') return deny('opted_out', 'Recipient opted out; only START re-enables messaging.');

  if (kind === 'message') {
    if (status === 'none') return deny('no_consent', 'No consent on record; send an opt-in request first.');
    if (status === 'pending') return deny('pending_confirmation', 'Opt-in requested but not yet confirmed (reply YES).');
  }

  if (
    options.requireOptOutFooter !== false &&
    !hasOptOutFooter(body, options.footerPattern)
  ) {
    return deny('missing_opt_out_footer', 'Body must tell the recipient how to opt out (e.g. "Reply STOP to opt out").');
  }

  if (options.quietHours !== false) {
    if (!options.timeZone) return deny('timezone_required', 'Recipient time zone is required to evaluate quiet hours.');
    const now = options.now ?? new Date();
    const quiet = options.quietHours ?? {};
    if (isQuietHour(now, options.timeZone, quiet)) {
      return {
        allow: false,
        reason: 'quiet_hours',
        detail: 'Inside recipient quiet hours.',
        retryAt: nextAllowedTime(now, options.timeZone, quiet),
      };
    }
  }

  return { allow: true };
}

function deny(reason: DenyReason, detail: string): GuardDecision {
  return { allow: false, reason, detail };
}

export type SendFn = (phone: string, body: string) => Promise<unknown>;

export type GuardedSendResult =
  | { sent: true }
  | { sent: false; reason: DenyReason; detail: string; retryAt?: Date; error?: unknown };

export interface SendGuardedParams extends GuardOptions {
  store: ConsentStore;
  accountId: string;
  phone: string;
  body: string;
  send: SendFn;
}

/**
 * Guard + send. Guarantees no "phantom sends": `sent: true` is returned only if the
 * consent check passed AND the provider call resolved. A denied or failed send never
 * reports success, and the provider is never called when the guard denies.
 */
export async function sendGuarded(params: SendGuardedParams): Promise<GuardedSendResult> {
  const { store, accountId, phone, body, send, ...options } = params;
  const record = await getConsent(store, accountId, phone);
  const decision = guardSend(record, body, options);
  if (!decision.allow) {
    return {
      sent: false,
      reason: decision.reason,
      detail: decision.detail,
      ...(decision.retryAt ? { retryAt: decision.retryAt } : {}),
    };
  }
  try {
    await send(record.phone, body);
  } catch (error) {
    return { sent: false, reason: 'send_failed', detail: 'Provider call failed; nothing was delivered.', error };
  }
  return { sent: true };
}
