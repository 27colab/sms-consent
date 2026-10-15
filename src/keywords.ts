/**
 * Inbound SMS keyword classification (CTIA-style opt-out / opt-in / help).
 *
 * Matching is tolerant of case, accents, surrounding punctuation, emoji,
 * zero-width characters and extra whitespace. English and Spanish are built in;
 * pass extra words via `options` for other languages.
 */

export type InboundKeyword = 'STOP' | 'START' | 'HELP' | 'YES' | 'OTHER';

export interface KeywordOptions {
  stop?: readonly string[];
  start?: readonly string[];
  help?: readonly string[];
  yes?: readonly string[];
}

/** Lowercase, strip accents, drop everything but letters/digits/spaces. */
export function normalizeText(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[​-‍⁠﻿]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const STOP_WORDS = [
  'stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'optout', 'revoke',
  // Spanish
  'parar', 'para', 'detener', 'alto', 'basta', 'cancelar', 'baja', 'salir', 'terminar',
];
const START_WORDS = ['start', 'unstop', 'resubscribe', 'subscribe', 'comenzar', 'iniciar'];
const HELP_WORDS = ['help', 'info', 'ayuda'];
// Deliberately excludes "ok"/"sure": too ambiguous to count as an opt-in confirmation.
const YES_WORDS = ['yes', 'y', 'yep', 'yeah', 'confirm', 'si'];

function buildSet(base: readonly string[], extra?: readonly string[]): Set<string> {
  return new Set([...base, ...(extra ?? [])].map(normalizeText));
}

/** Short messages containing a stop word anywhere still count as STOP ("please stop"). */
const SHORT_MESSAGE_TOKENS = 3;

export function classifyInbound(body: string, options: KeywordOptions = {}): InboundKeyword {
  const tokens = normalizeText(body).split(' ').filter(Boolean);
  if (tokens.length === 0) return 'OTHER';

  const stop = buildSet(STOP_WORDS, options.stop);
  const start = buildSet(START_WORDS, options.start);
  const help = buildSet(HELP_WORDS, options.help);
  const yes = buildSet(YES_WORDS, options.yes);

  // Opting out always wins: fail toward honouring the opt-out.
  const first = tokens[0]!;
  if (stop.has(first)) return 'STOP';
  if (tokens.length <= SHORT_MESSAGE_TOKENS && tokens.some((t) => stop.has(t))) return 'STOP';
  // "stop all", "opt out" (two words)
  if (tokens.length <= SHORT_MESSAGE_TOKENS && tokens.join(' ').includes('opt out')) return 'STOP';

  if (start.has(first)) return 'START';
  if (help.has(first)) return 'HELP';
  if (yes.has(first)) return 'YES';
  return 'OTHER';
}
