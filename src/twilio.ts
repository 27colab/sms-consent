/**
 * Thin, optional Twilio adapter. No Twilio SDK dependency: signature verification
 * uses node:crypto and the response is plain TwiML.
 *
 * Note: Twilio's own Advanced Opt-Out may already handle STOP/START/HELP at the
 * platform level for your Messaging Service. This helper keeps *your* ledger in sync.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ConsentStore, TransitionOptions } from './consent.js';
import { handleInbound, type InboundReplies } from './inbound.js';
import { normalizePhone } from './phone.js';
import type { KeywordOptions } from './keywords.js';

/** Compute the X-Twilio-Signature for a request (HMAC-SHA1 over url + sorted params). */
export function computeTwilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

export function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string | undefined,
): boolean {
  if (!signature) return false;
  const expected = Buffer.from(computeTwilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function parseFormBody(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
  return out;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function twiml(message?: string): string {
  return message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
    : '<?xml version="1.0" encoding="UTF-8"?><Response/>';
}

export interface TwilioInboundParams {
  store: ConsentStore;
  accountId: string;
  /** Raw form-encoded body, or already-parsed fields. */
  body: string | Record<string, string>;
  replies: InboundReplies;
  keywords?: KeywordOptions;
  transitions?: TransitionOptions;
  /** Provide to verify X-Twilio-Signature. Omit to skip verification (do not do this in production). */
  verify?: { authToken: string; url: string; signature: string | undefined };
}

export interface TwilioInboundResponse {
  status: 200 | 400 | 403;
  contentType: 'text/xml';
  body: string;
}

export async function handleTwilioInbound(p: TwilioInboundParams): Promise<TwilioInboundResponse> {
  const fields = typeof p.body === 'string' ? parseFormBody(p.body) : p.body;
  if (p.verify && !verifyTwilioSignature(p.verify.authToken, p.verify.url, fields, p.verify.signature)) {
    return { status: 403, contentType: 'text/xml', body: twiml() };
  }
  const from = normalizePhone(fields.From ?? '');
  if (!from) return { status: 400, contentType: 'text/xml', body: twiml() };
  const result = await handleInbound({
    store: p.store,
    accountId: p.accountId,
    from,
    body: fields.Body ?? '',
    replies: p.replies,
    ...(p.keywords ? { keywords: p.keywords } : {}),
    ...(p.transitions ? { transitions: p.transitions } : {}),
  });
  return { status: 200, contentType: 'text/xml', body: twiml(result.reply) };
}
