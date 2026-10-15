import { describe, expect, it, vi } from 'vitest';
import {
  applyConsentEvent, ensureOptOutFooter, guardSend, hasOptOutFooter, MemoryConsentStore, sendGuarded,
  type ConsentStatus, type DenyReason,
} from '../src/index.js';

const DAY = new Date('2030-06-01T16:00:00Z'); // 12:00 New York
const NIGHT = new Date('2030-06-02T03:00:00Z'); // 23:00 New York
const NY = 'America/New_York';
const BODY = 'Your table is ready. Reply STOP to opt out.';
const P = '+15550001111';

const base = { now: DAY, timeZone: NY };

describe('guardSend', () => {
  it('allows opted-in recipient with footer in daytime', () => {
    expect(guardSend({ status: 'opted_in' }, BODY, base)).toEqual({ allow: true });
  });

  const denials: [ConsentStatus | null, string, DenyReason][] = [
    [null, BODY, 'no_consent'],
    ['none', BODY, 'no_consent'],
    ['pending', BODY, 'pending_confirmation'],
    ['opted_out', BODY, 'opted_out'],
    ['opted_in', 'Your table is ready.', 'missing_opt_out_footer'],
    ['opted_in', '   ', 'empty_body'],
  ];
  it.each(denials)('status %s, body %j -> deny %s', (status, body, reason) => {
    const d = guardSend(status ? { status } : null, body, base);
    expect(d).toMatchObject({ allow: false, reason });
  });

  it('honours opt-out even for opt-in requests', () => {
    expect(guardSend({ status: 'opted_out' }, BODY, { ...base, kind: 'opt_in_request' })).toMatchObject({ reason: 'opted_out' });
  });

  it('allows opt-in requests for none/pending but still needs a footer', () => {
    for (const status of ['none', 'pending'] as const) {
      expect(guardSend({ status }, 'Reply YES to receive texts. Reply STOP to opt out.', { ...base, kind: 'opt_in_request' })).toEqual({ allow: true });
    }
    expect(guardSend({ status: 'none' }, 'Reply YES to receive texts.', { ...base, kind: 'opt_in_request' })).toMatchObject({ reason: 'missing_opt_out_footer' });
  });

  it('replies to inbound messages are always allowed, even opted-out and at night', () => {
    expect(guardSend({ status: 'opted_out' }, 'You are opted out.', { kind: 'reply', now: NIGHT, timeZone: NY })).toEqual({ allow: true });
  });

  it('denies during quiet hours with a retry time', () => {
    const d = guardSend({ status: 'opted_in' }, BODY, { now: NIGHT, timeZone: NY });
    expect(d).toMatchObject({ allow: false, reason: 'quiet_hours' });
    expect((d as { retryAt: Date }).retryAt.toISOString()).toBe('2030-06-02T12:00:00.000Z');
  });

  it('fails closed without a time zone', () => {
    expect(guardSend({ status: 'opted_in' }, BODY, { now: DAY })).toMatchObject({ reason: 'timezone_required' });
  });

  it('quiet hours can be disabled or customised', () => {
    expect(guardSend({ status: 'opted_in' }, BODY, { now: NIGHT, quietHours: false })).toEqual({ allow: true });
    expect(guardSend({ status: 'opted_in' }, BODY, { now: NIGHT, timeZone: NY, quietHours: { start: '23:30', end: '06:00' } })).toEqual({ allow: true });
  });

  it('uses the current time when none is given', () => {
    const d = guardSend({ status: 'opted_in' }, BODY, { timeZone: NY, quietHours: { start: '00:00', end: '23:59' } });
    expect(d.allow).toBe(false);
  });

  it('footer check can be disabled or customised', () => {
    expect(guardSend({ status: 'opted_in' }, 'Hi', { ...base, requireOptOutFooter: false })).toEqual({ allow: true });
    expect(guardSend({ status: 'opted_in' }, 'Hi. Text QUIT to leave.', { ...base, footerPattern: /text quit/i })).toEqual({ allow: true });
  });
});

describe('opt-out footer helpers', () => {
  it.each([
    ['Reply STOP to opt out', true], ['reply stop to unsubscribe', true], ['Text STOP to cancel', true],
    ['Responda STOP para cancelar', true], ['msg. STOP to opt-out', true], ['stop by anytime', false], ['Hello', false],
  ])('hasOptOutFooter(%j) = %s', (body, expected) => expect(hasOptOutFooter(body)).toBe(expected));

  it('ensureOptOutFooter appends only when missing', () => {
    expect(ensureOptOutFooter('Hi there  ')).toBe('Hi there Reply STOP to opt out.');
    expect(ensureOptOutFooter(BODY)).toBe(BODY);
    expect(ensureOptOutFooter('Hi', 'Text STOP to quit.')).toBe('Hi Text STOP to quit.');
  });
});

describe('sendGuarded (phantom-send regression)', () => {
  async function setup(status?: ConsentStatus) {
    const store = new MemoryConsentStore();
    if (status === 'opted_in') await applyConsentEvent(store, 'a', P, { type: 'grant' });
    if (status === 'opted_out') await applyConsentEvent(store, 'a', P, { type: 'stop' });
    if (status === 'pending') await applyConsentEvent(store, 'a', P, { type: 'request_opt_in' });
    return store;
  }
  const params = (store: MemoryConsentStore, send: (p: string, b: string) => Promise<unknown>, extra = {}) => ({
    store, accountId: 'a', phone: P, body: BODY, send, ...base, ...extra,
  });

  it('sends and reports sent only on provider success', async () => {
    const send = vi.fn().mockResolvedValue({ sid: 'x' });
    expect(await sendGuarded(params(await setup('opted_in'), send))).toEqual({ sent: true });
    expect(send).toHaveBeenCalledWith(P, BODY);
  });

  it.each(['none', 'pending', 'opted_out'] as const)('never calls the provider or reports sent when status is %s', async (status) => {
    const send = vi.fn();
    const r = await sendGuarded(params(await setup(status === 'none' ? undefined : status), send));
    expect(r.sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('a STOP that arrives before the send blocks it', async () => {
    const store = await setup('opted_in');
    await applyConsentEvent(store, 'a', P, { type: 'stop' });
    const send = vi.fn();
    expect(await sendGuarded(params(store, send))).toMatchObject({ sent: false, reason: 'opted_out' });
    expect(send).not.toHaveBeenCalled();
  });

  it('quiet-hours denial surfaces retryAt and does not send', async () => {
    const send = vi.fn();
    const r = await sendGuarded(params(await setup('opted_in'), send, { now: NIGHT }));
    expect(r).toMatchObject({ sent: false, reason: 'quiet_hours' });
    expect((r as { retryAt?: Date }).retryAt).toBeInstanceOf(Date);
    expect(send).not.toHaveBeenCalled();
  });

  it('a provider failure is reported as not sent', async () => {
    const err = new Error('carrier down');
    const r = await sendGuarded(params(await setup('opted_in'), vi.fn().mockRejectedValue(err)));
    expect(r).toMatchObject({ sent: false, reason: 'send_failed', error: err });
  });

  it('sends to the normalised number', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await sendGuarded(params(await setup('opted_in'), send, { phone: '(555) 000-1111' }));
    expect(send).toHaveBeenCalledWith(P, BODY);
  });
});
