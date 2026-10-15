import { applyConsentEvent, type ConsentRecord, type ConsentStore, type TransitionOptions } from './consent.js';
import { classifyInbound, type InboundKeyword, type KeywordOptions } from './keywords.js';

export interface InboundReplies {
  stop: string;
  start: string;
  help: string;
  /** Sent when a YES confirms a pending opt-in. Default: none. */
  confirmed?: string;
}

export function defaultReplies(brand: string, helpContact?: string): InboundReplies {
  return {
    stop: `${brand}: You are opted out and will not receive more texts. Reply START to opt back in.`,
    start: `${brand}: You are opted in. Msg & data rates may apply. Reply STOP to opt out, HELP for help.`,
    help: `${brand}: For help${helpContact ? ` contact ${helpContact}` : ''}. Msg & data rates may apply. Reply STOP to opt out.`,
  };
}

export interface InboundParams {
  store: ConsentStore;
  accountId: string;
  from: string;
  body: string;
  replies: InboundReplies;
  keywords?: KeywordOptions;
  transitions?: TransitionOptions;
  now?: () => Date;
}

export interface InboundResult {
  keyword: InboundKeyword;
  record: ConsentRecord | null;
  /** Text to send back (use SendKind "reply"), if any. */
  reply?: string;
}

/** Classify an inbound message, update consent, and say what to reply. */
export async function handleInbound(p: InboundParams): Promise<InboundResult> {
  const keyword = classifyInbound(p.body, p.keywords);
  const opts = { ...p.transitions, ...(p.now ? { now: p.now } : {}) };
  const source = `inbound:${keyword}`;
  switch (keyword) {
    case 'STOP': {
      const { record } = await applyConsentEvent(p.store, p.accountId, p.from, { type: 'stop', source }, opts);
      // Repeated STOP is idempotent in state but still gets a confirmation (carriers expect one).
      return { keyword, record, reply: p.replies.stop };
    }
    case 'START': {
      const { record } = await applyConsentEvent(p.store, p.accountId, p.from, { type: 'start', source }, opts);
      return { keyword, record, reply: p.replies.start };
    }
    case 'YES': {
      const { record, changed } = await applyConsentEvent(p.store, p.accountId, p.from, { type: 'confirm', source }, opts);
      return {
        keyword,
        record,
        ...(changed && p.replies.confirmed ? { reply: p.replies.confirmed } : {}),
      };
    }
    case 'HELP':
      return { keyword, record: null, reply: p.replies.help };
    case 'OTHER':
      return { keyword, record: null };
  }
}
