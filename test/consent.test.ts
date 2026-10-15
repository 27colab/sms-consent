import { describe, expect, it } from 'vitest';
import {
  applyConsentEvent, getConsent, InvalidPhoneError, MemoryConsentStore, nextStatus, normalizePhone,
  type ConsentEvent, type ConsentStatus,
} from '../src/index.js';

const P = '+15550001111';
const fixed = () => new Date('2030-01-01T12:00:00Z');

describe('nextStatus', () => {
  const table: [ConsentStatus, ConsentEvent['type'], ConsentStatus][] = [
    ['none', 'request_opt_in', 'pending'],
    ['pending', 'request_opt_in', 'pending'],
    ['opted_in', 'request_opt_in', 'opted_in'],
    ['opted_out', 'request_opt_in', 'opted_out'],
    ['pending', 'confirm', 'opted_in'],
    ['none', 'confirm', 'none'],
    ['opted_out', 'confirm', 'opted_out'],
    ['opted_in', 'confirm', 'opted_in'],
    ['none', 'grant', 'opted_in'],
    ['pending', 'grant', 'opted_in'],
    ['opted_out', 'grant', 'opted_in'],
    ['none', 'stop', 'opted_out'],
    ['pending', 'stop', 'opted_out'],
    ['opted_in', 'stop', 'opted_out'],
    ['opted_out', 'stop', 'opted_out'],
    ['opted_out', 'start', 'opted_in'],
    ['none', 'start', 'opted_in'],
    ['opted_in', 'start', 'opted_in'],
  ];
  it.each(table)('%s + %s -> %s', (from, type, to) => {
    expect(nextStatus(from, { type } as ConsentEvent)).toBe(to);
  });

  it('START can require confirmation', () => {
    expect(nextStatus('opted_out', { type: 'start' }, { startRequiresConfirmation: true })).toBe('pending');
    expect(nextStatus('opted_in', { type: 'start' }, { startRequiresConfirmation: true })).toBe('opted_in');
  });
});

describe('applyConsentEvent', () => {
  it('walks the full lifecycle', async () => {
    const store = new MemoryConsentStore();
    const run = (event: ConsentEvent) => applyConsentEvent(store, 'acct-1', P, event, { now: fixed });
    expect((await run({ type: 'request_opt_in' })).record.status).toBe('pending');
    expect((await run({ type: 'confirm', source: 'inbound:YES' })).record).toMatchObject({ status: 'opted_in', source: 'inbound:YES' });
    expect((await run({ type: 'stop' })).record.status).toBe('opted_out');
    expect((await run({ type: 'start' })).record.status).toBe('opted_in');
  });

  it('STOP is idempotent and does not rewrite the record', async () => {
    const store = new MemoryConsentStore();
    await applyConsentEvent(store, 'a', P, { type: 'grant' }, { now: fixed });
    const first = await applyConsentEvent(store, 'a', P, { type: 'stop' }, { now: fixed });
    const second = await applyConsentEvent(store, 'a', P, { type: 'stop' }, { now: () => new Date('2031-01-01') });
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.record.updatedAt).toBe(first.record.updatedAt);
  });

  it('stray events from none do not create records', async () => {
    const store = new MemoryConsentStore();
    const r = await applyConsentEvent(store, 'a', P, { type: 'confirm' });
    expect(r).toMatchObject({ changed: false, previous: 'none' });
    expect(r.record.status).toBe('none');
    expect(store.size).toBe(0);
  });

  it('scopes consent per account', async () => {
    const store = new MemoryConsentStore();
    await applyConsentEvent(store, 'a', P, { type: 'grant' });
    expect((await getConsent(store, 'b', P)).status).toBe('none');
    expect((await getConsent(store, 'a', P)).status).toBe('opted_in');
  });

  it('normalises phone formatting', async () => {
    const store = new MemoryConsentStore();
    await applyConsentEvent(store, 'a', '(555) 000-1111', { type: 'grant' });
    expect((await getConsent(store, 'a', '+1 555 000 1111')).status).toBe('opted_in');
  });

  it('rejects invalid phones', async () => {
    const store = new MemoryConsentStore();
    await expect(applyConsentEvent(store, 'a', 'nope', { type: 'stop' })).rejects.toBeInstanceOf(InvalidPhoneError);
    await expect(getConsent(store, 'a', '123')).rejects.toThrow(/Invalid phone/);
  });

  it('uses the real clock by default', async () => {
    const store = new MemoryConsentStore();
    const r = await applyConsentEvent(store, 'a', P, { type: 'grant' });
    expect(Date.now() - Date.parse(r.record.updatedAt)).toBeLessThan(5000);
    const none = await applyConsentEvent(store, 'a', '+15550002222', { type: 'confirm' });
    expect(none.record.status).toBe('none');
  });
});

describe('normalizePhone', () => {
  it.each([
    ['+1 (555) 000-1111', '+15550001111'],
    ['5550001111', '+15550001111'],
    ['1-555-000-1111', '+15550001111'],
    ['+44 20 7946 0958', '+442079460958'],
    ['', null], ['abc', null], ['12345', null], ['+123', null], ['+1234567890123456', null],
  ])('%j -> %j', (input, expected) => expect(normalizePhone(input)).toBe(expected));
});
