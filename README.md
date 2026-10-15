# @27colab/sms-consent

A small, dependency-free TypeScript **reference implementation** of SMS consent handling:

- **Keyword classifier**: STOP / STOPALL / UNSUBSCRIBE / CANCEL / END / QUIT, START / UNSTOP, HELP, YES. Tolerant of case, accents, punctuation, emoji, zero-width characters and whitespace. English and Spanish built in, extensible.
- **Consent state machine** per `(accountId, phone)`: `none → pending → opted_in → opted_out`, with idempotent STOP and re-opt-in via START.
- **`guardSend()`**: a pure allow/deny decision with a reason: consent required, opt-outs honoured, opt-out footer required, quiet hours in the recipient's time zone.
- **`sendGuarded()`**: guard + provider call that never reports a "phantom send".
- **`ConsentStore`** interface with in-memory and SQLite adapters (SQLite via any handle shaped like `better-sqlite3` / `node:sqlite`; no dependency on either).
- **Twilio webhook helper** (optional, no Twilio SDK): inbound STOP/START/HELP handling, TwiML response, `X-Twilio-Signature` verification.

> **Important: reference implementation, not legal advice, no compliance guarantees.**
> This library is a starting point that encodes common conventions. Whether your messaging program meets the TCPA, CTIA guidelines, carrier/10DLC registration rules or any other law or policy depends on your content, your consent collection and your jurisdiction. It makes no claim that using it makes you compliant. Review with qualified counsel. Provided "as is" under the MIT license.

Background reading:

- [CTIA Messaging Principles and Best Practices](https://www.ctia.org/the-wireless-industry/industry-commitments/messaging-interoperability-sms-mms)
- [Twilio: Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out)
- [Twilio: Webhooks security (request signatures)](https://www.twilio.com/docs/usage/webhooks/webhooks-security)
- [Twilio: Messaging policy & compliance](https://www.twilio.com/en-us/legal/messaging-policy)

## Install

```sh
npm install @27colab/sms-consent
```

Node 20+. ESM only.

## Usage

```ts
import {
  MemoryConsentStore, applyConsentEvent, sendGuarded, handleInbound, defaultReplies,
} from '@27colab/sms-consent';

const store = new MemoryConsentStore(); // or new SqliteConsentStore(db)

// 1. Ask for consent (double opt-in).
await applyConsentEvent(store, 'acct-1', '+15550001111', { type: 'request_opt_in' });
await sendGuarded({
  store, accountId: 'acct-1', phone: '+15550001111',
  kind: 'opt_in_request', timeZone: 'America/New_York',
  body: 'Acme: Reply YES to get texts. Msg & data rates may apply. Reply STOP to opt out.',
  send: (to, body) => myProvider.send(to, body),
});

// 2. Handle inbound replies.
const replies = defaultReplies('Acme', 'help@example.test');
const { reply } = await handleInbound({ store, accountId: 'acct-1', from: '+15550001111', body: 'yes', replies });
// reply (if any) should be sent with kind: 'reply'

// 3. Send, safely.
const result = await sendGuarded({
  store, accountId: 'acct-1', phone: '+15550001111', timeZone: 'America/New_York',
  body: 'Your order shipped. Reply STOP to opt out.',
  send: (to, body) => myProvider.send(to, body),
});
if (!result.sent) console.log(result.reason, result.retryAt); // e.g. 'quiet_hours'
```

### Guard decisions

`guardSend(record, body, options)` is pure and returns `{ allow: true }` or `{ allow: false, reason, detail, retryAt? }`.

| reason | meaning |
|---|---|
| `empty_body` | nothing to send |
| `opted_out` | recipient sent STOP; only START re-enables |
| `no_consent` / `pending_confirmation` | no confirmed opt-in on record |
| `missing_opt_out_footer` | body does not tell the recipient how to opt out (use `ensureOptOutFooter`) |
| `timezone_required` | quiet hours are on but no recipient time zone was given (fails closed) |
| `quiet_hours` | inside the quiet window (default 21:00–08:00 recipient-local); `retryAt` is the next allowed minute |
| `send_failed` | (`sendGuarded` only) the provider call threw |

Send kinds: `message` (needs `opted_in`), `opt_in_request` (allowed for `none`/`pending`, never for `opted_out`), `reply` (direct response to an inbound message, such as a STOP confirmation or HELP text; always allowed, so use it only for that).

### No phantom sends

`sendGuarded` returns `sent: true` only if the guard allowed it **and** the provider call resolved. A denied send never reaches the provider; a failed provider call is reported as `sent: false`. Don't tell a user or an LLM "I texted you" unless `sent` is `true`.

### Keyword behaviour (and limits)

- STOP wins ties. A message of up to three words containing a stop word ("please stop", "yes stop") is a STOP. Longer free text is only treated as STOP when it *starts* with a stop word. Free text such as "I can never stop thinking about it" is `OTHER`.
- `ok` and `sure` are intentionally **not** YES, because they are too ambiguous to treat as consent.
- Add languages via `classifyInbound(body, { stop: [...], start: [...], help: [...], yes: [...] })`.

### SQLite

```ts
import Database from 'better-sqlite3';
import { SqliteConsentStore } from '@27colab/sms-consent';
const store = new SqliteConsentStore(new Database('consent.db'));
```

Creates `sms_consent` plus an append-only `sms_consent_events` log. Rows are never deleted. Implement `ConsentStore` (`get`/`put`) for Postgres or anything else.

### Twilio

```ts
import { handleTwilioInbound } from '@27colab/sms-consent';

const res = await handleTwilioInbound({
  store, accountId: 'acct-1', replies,
  body: rawFormBody,
  verify: { authToken: process.env.TWILIO_AUTH_TOKEN!, url: publicWebhookUrl, signature: req.headers['x-twilio-signature'] },
});
// respond with res.status, res.contentType, res.body
```

Twilio's Advanced Opt-Out may already intercept STOP/START/HELP for your Messaging Service; this helper keeps *your* ledger in sync with what recipients texted. Always pass `verify` in production.

## Development

```sh
npm install
npm test
npm run coverage
npm run build
```

## License

MIT © 2026 27 Colab LLC
