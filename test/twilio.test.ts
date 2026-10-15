import { describe, expect, it } from 'vitest';
import {
  applyConsentEvent, computeTwilioSignature, defaultReplies, escapeXml, getConsent, handleTwilioInbound,
  MemoryConsentStore, parseFormBody, twiml, verifyTwilioSignature,
} from '../src/index.js';

const TOKEN = 'test-auth-token-not-real';
const URL_ = 'https://example.test/sms/inbound';
const replies = defaultReplies('Acme Test');
const raw = 'From=%2B15550001111&To=%2B15550009999&Body=STOP&MessageSid=SMtest';

describe('twilio signature', () => {
  it('matches an independently computed HMAC-SHA1 vector (openssl)', () => {
    expect(computeTwilioSignature('tok', 'https://x.test/h', { b: '2', a: '1' })).toBe('qnanJdNkvtS6/0aqvgEWVzgolIg=');
  });

  it('verifies valid and rejects invalid, missing or tampered signatures', () => {
    const params = parseFormBody(raw);
    const sig = computeTwilioSignature(TOKEN, URL_, params);
    expect(verifyTwilioSignature(TOKEN, URL_, params, sig)).toBe(true);
    expect(verifyTwilioSignature(TOKEN, URL_, params, undefined)).toBe(false);
    expect(verifyTwilioSignature(TOKEN, URL_, params, 'short')).toBe(false);
    expect(verifyTwilioSignature(TOKEN, URL_, params, sig.slice(0, -2) + (sig.endsWith('A=') ? 'B=' : 'A='))).toBe(false);
    expect(verifyTwilioSignature(TOKEN, URL_, { ...params, Body: 'START' }, sig)).toBe(false);
    expect(verifyTwilioSignature('other', URL_, params, sig)).toBe(false);
  });
});

describe('twiml helpers', () => {
  it('escapes XML', () => {
    expect(escapeXml(`<a href="x">Tom & 'Jerry'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jerry&apos;&lt;/a&gt;');
    expect(twiml('a & b')).toContain('<Message>a &amp; b</Message>');
    expect(twiml()).toContain('<Response/>');
  });
});

describe('handleTwilioInbound', () => {
  it('processes STOP from a raw form body and answers with TwiML', async () => {
    const store = new MemoryConsentStore();
    const res = await handleTwilioInbound({ store, accountId: 'a', body: raw, replies });
    expect(res.status).toBe(200);
    expect(res.contentType).toBe('text/xml');
    expect(res.body).toContain('opted out');
    expect((await getConsent(store, 'a', '+15550001111')).status).toBe('opted_out');
  });

  it('accepts parsed fields and ignores unrelated messages', async () => {
    const store = new MemoryConsentStore();
    const res = await handleTwilioInbound({ store, accountId: 'a', body: { From: '+15550001111', Body: 'see you soon' }, replies });
    expect(res.body).toBe(twiml());
    expect(store.size).toBe(0);
  });

  it('verifies signatures when configured', async () => {
    const store = new MemoryConsentStore();
    await applyConsentEvent(store, 'a', '+15550001111', { type: 'grant' });
    const sig = computeTwilioSignature(TOKEN, URL_, parseFormBody(raw));
    const bad = await handleTwilioInbound({ store, accountId: 'a', body: raw, replies, verify: { authToken: TOKEN, url: URL_, signature: 'nope' } });
    expect(bad.status).toBe(403);
    expect((await getConsent(store, 'a', '+15550001111')).status).toBe('opted_in'); // forged request had no effect
    const good = await handleTwilioInbound({ store, accountId: 'a', body: raw, replies, verify: { authToken: TOKEN, url: URL_, signature: sig } });
    expect(good.status).toBe(200);
    expect((await getConsent(store, 'a', '+15550001111')).status).toBe('opted_out');
  });

  it('returns 400 when From is missing or invalid', async () => {
    const store = new MemoryConsentStore();
    expect((await handleTwilioInbound({ store, accountId: 'a', body: 'Body=STOP', replies })).status).toBe(400);
    expect((await handleTwilioInbound({ store, accountId: 'a', body: { From: 'x', Body: 'STOP' }, replies })).status).toBe(400);
  });

  it('passes keyword and transition options through; empty body is OTHER', async () => {
    const store = new MemoryConsentStore();
    await handleTwilioInbound({
      store, accountId: 'a', body: { From: '+15550001111', Body: 'arretez' }, replies,
      keywords: { stop: ['arretez'] }, transitions: { startRequiresConfirmation: true },
    });
    expect((await getConsent(store, 'a', '+15550001111')).status).toBe('opted_out');
    await handleTwilioInbound({ store, accountId: 'a', body: { From: '+15550001111', Body: 'start' }, replies, transitions: { startRequiresConfirmation: true } });
    expect((await getConsent(store, 'a', '+15550001111')).status).toBe('pending');
    const r = await handleTwilioInbound({ store, accountId: 'a', body: { From: '+15550001111' }, replies });
    expect(r.body).toBe(twiml());
  });
});
