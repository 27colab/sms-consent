import { describe, expect, it } from 'vitest';
import { defaultReplies, getConsent, handleInbound, MemoryConsentStore, type InboundReplies } from '../src/index.js';

const P = '+15550001111';
const replies: InboundReplies = { ...defaultReplies('Acme Test', 'help@example.test'), confirmed: 'Thanks, you are confirmed.' };

async function inbound(store: MemoryConsentStore, body: string, extra = {}) {
  return handleInbound({ store, accountId: 'a', from: P, body, replies, ...extra });
}

describe('handleInbound', () => {
  it('STOP opts out and replies; repeated STOP stays opted out', async () => {
    const store = new MemoryConsentStore();
    const a = await inbound(store, 'STOP');
    const b = await inbound(store, 'stop.');
    expect(a.record?.status).toBe('opted_out');
    expect(b.record?.status).toBe('opted_out');
    expect(b.reply).toContain('opted out');
  });

  it('full double opt-in lifecycle', async () => {
    const store = new MemoryConsentStore();
    const { applyConsentEvent } = await import('../src/index.js');
    await applyConsentEvent(store, 'a', P, { type: 'request_opt_in' });
    const yes = await inbound(store, 'Yes!');
    expect(yes).toMatchObject({ keyword: 'YES', reply: replies.confirmed });
    expect((await getConsent(store, 'a', P)).status).toBe('opted_in');
    await inbound(store, 'QUIT');
    expect((await getConsent(store, 'a', P)).status).toBe('opted_out');
    await inbound(store, 'YES');
    expect((await getConsent(store, 'a', P)).status).toBe('opted_out'); // YES alone does not re-opt-in
    const start = await inbound(store, 'START');
    expect(start.record?.status).toBe('opted_in');
    expect(start.reply).toContain('opted in');
  });

  it('START can require a YES to finish', async () => {
    const store = new MemoryConsentStore();
    await inbound(store, 'STOP');
    const r = await inbound(store, 'START', { transitions: { startRequiresConfirmation: true } });
    expect(r.record?.status).toBe('pending');
  });

  it('YES from an unknown number changes nothing and sends no reply', async () => {
    const store = new MemoryConsentStore();
    const r = await inbound(store, 'yes');
    expect(r.reply).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('YES without a configured confirmation reply sends nothing', async () => {
    const store = new MemoryConsentStore();
    const { applyConsentEvent } = await import('../src/index.js');
    await applyConsentEvent(store, 'a', P, { type: 'request_opt_in' });
    const r = await inbound(store, 'yes', { replies: defaultReplies('Acme Test') });
    expect(r.reply).toBeUndefined();
    expect(r.record?.status).toBe('opted_in');
  });

  it('HELP replies without touching consent; OTHER does nothing', async () => {
    const store = new MemoryConsentStore();
    const h = await inbound(store, 'help');
    expect(h.reply).toContain('help@example.test');
    expect(defaultReplies('Acme Test').help).not.toContain('contact');
    const o = await inbound(store, 'see you at 5');
    expect(o).toEqual({ keyword: 'OTHER', record: null });
    expect(store.size).toBe(0);
  });

  it('forwards a custom clock', async () => {
    const store = new MemoryConsentStore();
    const r = await inbound(store, 'stop', { now: () => new Date('2030-01-01T00:00:00Z') });
    expect(r.record?.updatedAt).toBe('2030-01-01T00:00:00.000Z');
    expect(r.record?.source).toBe('inbound:STOP');
  });
});
