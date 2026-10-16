# @27colab/sms-consent

A dependency-free TypeScript reference for SMS consent handling: classify STOP/START/HELP, track consent per number, and gate every send behind a guard.

[![CI](https://github.com/27colab/sms-consent/actions/workflows/ci.yml/badge.svg)](https://github.com/27colab/sms-consent/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@27colab/sms-consent)](https://www.npmjs.com/package/@27colab/sms-consent)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![types: TypeScript](https://img.shields.io/badge/types-TypeScript-3178c6.svg)](https://www.typescriptlang.org/)

> **Reference implementation, not legal advice, no compliance guarantee.** It encodes common conventions as a starting point. Whether your program meets the TCPA, CTIA guidelines, carrier or 10DLC rules or any other law depends on your content, your consent collection and your jurisdiction. Review with qualified counsel.

## Why

- **One decision point.** `guardSend()` returns allow/deny with a reason: no consent, opted out, missing opt-out footer, or quiet hours in the recipient's time zone (fails closed without one).
- **No phantom sends.** `sendGuarded()` reports `sent: true` only if the guard allowed it and your provider call resolved, so you never tell a user or an LLM "I texted you" when you didn't.
- **Messy replies handled.** English and Spanish keywords, tolerant of case, accents, punctuation, emoji and zero-width characters; STOP wins ties. 180 offline tests.

## Install

```bash
npm install @27colab/sms-consent
```

Node 20+, ESM, zero runtime dependencies, TypeScript types included.

## Quickstart

Runs as-is with the in-memory store and a `console.log` standing in for your SMS provider.

```ts
import { MemoryConsentStore, applyConsentEvent, handleInbound, defaultReplies, sendGuarded } from '@27colab/sms-consent';

const store = new MemoryConsentStore();                     // or SqliteConsentStore(db)
const [accountId, phone] = ['acct-1', '+15550001111'];
const send = async (to: string, body: string) => console.log(`-> ${to}: ${body}`);  // your SMS provider here
const base = { store, accountId, phone, timeZone: 'America/New_York', now: new Date('2026-06-02T15:00:00Z'), send };

await applyConsentEvent(store, accountId, phone, { type: 'request_opt_in' });
await sendGuarded({ ...base, kind: 'opt_in_request',
  body: 'Acme: Reply YES to get texts. Msg & data rates may apply. Reply STOP to opt out.' });

const replies = defaultReplies('Acme', 'help@example.test');
await handleInbound({ store, accountId, from: phone, body: 'yes', replies });   // pending -> opted_in
console.log(await sendGuarded({ ...base, body: 'Your order shipped. Reply STOP to opt out.' }));

await handleInbound({ store, accountId, from: phone, body: 'STOP', replies });  // opted_in -> opted_out
const blocked = await sendGuarded({ ...base, body: 'Sale today! Reply STOP to opt out.' });
console.log(blocked.sent, !blocked.sent && blocked.reason);                     // false 'opted_out'
```

Output:

```
-> +15550001111: Acme: Reply YES to get texts. Msg & data rates may apply. Reply STOP to opt out.
-> +15550001111: Your order shipped. Reply STOP to opt out.
{ sent: true }
false opted_out
```

## Bring your own keys

None required. You pass a plain `send(to, body)` function, so any provider works. The optional Twilio helper (`handleTwilioInbound`) uses your Twilio auth token only to verify `X-Twilio-Signature`; there is no Twilio SDK dependency. Pass `verify` when you run it for real.

## API

| Export | Purpose |
|---|---|
| `classifyInbound(body, opts?)` | `STOP \| START \| HELP \| YES \| OTHER`; extend keyword lists per language. |
| `applyConsentEvent(store, accountId, phone, event)` | State machine `none → pending → opted_in → opted_out`; idempotent STOP, START re-opts in. |
| `guardSend(record, body, opts)` | Pure allow/deny with `reason` and `retryAt`. |
| `sendGuarded({ store, send, … })` | Guard plus provider call; never a phantom send. |
| `handleInbound(…)` / `defaultReplies(brand, help?)` | Classify an inbound message, update consent, return the reply to send. |
| `handleTwilioInbound(…)` | Webhook helper: TwiML response and signature check. |
| `MemoryConsentStore`, `SqliteConsentStore` | Stores; SQLite takes any `better-sqlite3`-shaped handle. Implement `ConsentStore` for anything else. |

Full reference, guard reasons and keyword rules: **[docs.27colab.com/packages/sms-consent](https://docs.27colab.com/packages/sms-consent/)**

## Limits

- `ok` and `sure` are deliberately not treated as YES.
- Twilio Advanced Opt-Out may already intercept STOP/START/HELP; this keeps your own ledger in sync with what recipients texted.
- Consent collection, message content and registration are yours to get right.

## Not for you if…

- You want assurance that a messaging program is compliant. Nothing here can give you that.
- You need a provider SDK or delivery tracking; the package only decides whether to send and records consent.
- You need consent handling for channels other than SMS.

## Develop

```bash
npm ci && npm test && npm run typecheck
```

MIT, see [LICENSE](LICENSE).

---

Built by [Jesus Vasquez](https://github.com/vasquezjesus2710) · [27 Colab](https://27colab.com)
