/**
 * Per-(account, phone) consent state machine.
 *
 *   none -> pending -> opted_in -> opted_out -> (START) -> opted_in | pending
 *
 * Transitions are pure; persistence goes through a ConsentStore.
 */
import { normalizePhone } from './phone.js';

export type ConsentStatus = 'none' | 'pending' | 'opted_in' | 'opted_out';

export interface ConsentRecord {
  accountId: string;
  phone: string;
  status: ConsentStatus;
  /** ISO-8601 timestamp of the last status change. */
  updatedAt: string;
  /** Free-form provenance of the last change ("inbound:STOP", "web-form", ...). */
  source?: string;
}

export type ConsentEvent =
  /** We sent an opt-in confirmation request (double opt-in). */
  | { type: 'request_opt_in'; source?: string }
  /** Recipient replied YES to an opt-in request. */
  | { type: 'confirm'; source?: string }
  /** Consent captured out of band (web form, verbal). Overrides any prior state. */
  | { type: 'grant'; source?: string }
  /** Recipient replied STOP (or equivalent). */
  | { type: 'stop'; source?: string }
  /** Recipient replied START after opting out. */
  | { type: 'start'; source?: string };

export interface TransitionOptions {
  /** If true, START moves to `pending` (needs a YES) instead of `opted_in`. Default false. */
  startRequiresConfirmation?: boolean;
}

/** Pure transition: returns the next status (equal to `current` when the event is a no-op). */
export function nextStatus(
  current: ConsentStatus,
  event: ConsentEvent,
  options: TransitionOptions = {},
): ConsentStatus {
  switch (event.type) {
    case 'stop':
      return 'opted_out';
    case 'grant':
      return 'opted_in';
    case 'request_opt_in':
      return current === 'none' ? 'pending' : current;
    case 'confirm':
      // A YES only counts if we asked; stray YES from none/opted_out is ignored.
      return current === 'pending' ? 'opted_in' : current;
    case 'start':
      if (current === 'opted_in') return current;
      return options.startRequiresConfirmation ? 'pending' : 'opted_in';
  }
}

export interface ConsentStore {
  get(accountId: string, phone: string): Promise<ConsentRecord | null>;
  put(record: ConsentRecord): Promise<void>;
}

export class InvalidPhoneError extends Error {
  constructor(input: string) {
    super(`Invalid phone number: ${JSON.stringify(input)}`);
    this.name = 'InvalidPhoneError';
  }
}

export interface ApplyResult {
  record: ConsentRecord;
  previous: ConsentStatus;
  /** False when the event was a no-op (e.g. repeated STOP). The stored record is untouched. */
  changed: boolean;
}

/** Load, transition and persist. Idempotent: no write happens when the status does not change. */
export async function applyConsentEvent(
  store: ConsentStore,
  accountId: string,
  phone: string,
  event: ConsentEvent,
  options: TransitionOptions & { now?: () => Date } = {},
): Promise<ApplyResult> {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new InvalidPhoneError(phone);
  const existing = await store.get(accountId, normalized);
  const previous = existing?.status ?? 'none';
  const next = nextStatus(previous, event, options);
  if (existing && next === previous) {
    return { record: existing, previous, changed: false };
  }
  if (!existing && next === 'none') {
    return {
      record: { accountId, phone: normalized, status: 'none', updatedAt: (options.now ?? (() => new Date()))().toISOString() },
      previous,
      changed: false,
    };
  }
  const record: ConsentRecord = {
    accountId,
    phone: normalized,
    status: next,
    updatedAt: (options.now ?? (() => new Date()))().toISOString(),
    ...(event.source ? { source: event.source } : {}),
  };
  await store.put(record);
  return { record, previous, changed: true };
}

export async function getConsent(
  store: ConsentStore,
  accountId: string,
  phone: string,
): Promise<ConsentRecord> {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new InvalidPhoneError(phone);
  return (
    (await store.get(accountId, normalized)) ?? {
      accountId,
      phone: normalized,
      status: 'none',
      updatedAt: new Date(0).toISOString(),
    }
  );
}
