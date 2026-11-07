# VERYO SDK

[Русский](README.md)

SDKs for [VERYO](https://veryo.kz) — phone verification codes via Telegram → WhatsApp → SMS. You pay only for the channel that delivered the code.

| Package | Runs in | Does |
|---|---|---|
| [`@veryo/node`](packages/node) | your backend: Node.js 18+, Bun, edge | sends and checks codes, verifies webhook signatures |
| [`@veryo/react-native`](packages/react-native) | Expo / React Native app | collects device signals for antifraud |

## Key security

**The API key lives on your server only.** Never put it in a mobile app, a website or `EXPO_PUBLIC_*` variables: anything shipped in an app bundle can be extracted. `@veryo/react-native` takes no key and makes no network calls — it only collects device signals. The app sends them to **your** backend, which adds the user's IP and calls VERYO with `@veryo/node`.

```
app ── getSignals() + phone ──▶ your backend ── API key + IP ──▶ VERYO
```

## Server: `@veryo/node`

```bash
npm i @veryo/node      # or: bun add @veryo/node / pnpm add @veryo/node
```

Zero dependencies: global `fetch` and WebCrypto only.

```ts
import { Veryo, VeryoError } from '@veryo/node'

const veryo = new Veryo({ apiKey: process.env.VERYO_API_KEY! })

// 1. Send a code
const { id, expires_at } = await veryo.verifications.create({
  phone: '+77011234567',          // Kazakhstan mobile numbers only
  purpose: 'login',               // or 'registration'
  signals: {
    ...deviceSignalsFromApp,      // device_id, device_platform, device_model, os_version, app_version
    ip: clientIp,                 // the user's IP, not your server's
    user_agent: req.headers['user-agent'],
  },
  options: { locale: 'en', code_size: 6 },        // also custom_code, preferred_channel
  metadata: { correlation_id: 'order-42' },       // ≤ 80 chars, echoed in webhooks
})

// 2. Check the code the user typed
const { status } = await veryo.verifications.check({ id, code: '123456' })
if (status === 'verified') {
  // sign the user in
}
```

`status`: `verified` — correct code; `pending` — wrong code, may retry; `failed` — out of attempts; `expired` — timed out.

Signals your server decides (`ip`, `is_trusted_user`) must not come from the app's request — pick the device fields one by one, as in the [example](examples/bun-server/server.ts).

### Errors

Every API error response throws `VeryoError` with `status` (HTTP), `code`, `message` (human-readable) and `reason` (for `fraud_blocked`).

```ts
try {
  await veryo.verifications.create({ phone })
} catch (e) {
  if (e instanceof VeryoError && e.code === 'fraud_blocked') {
    console.warn('antifraud', e.reason)
  }
  throw e
}
```

| HTTP | `code` | Meaning |
|---|---|---|
| 401 | `unauthorized` | wrong or revoked key |
| 402 | `insufficient_balance` | balance is empty |
| 402 | `daily_limit` | account daily limit reached |
| 403 | `phone_blocked` | number is blocklisted |
| 403 | `fraud_blocked` | antifraud refusal, see `reason` |
| 422 | `invalid_phone` | not a Kazakhstan mobile number |
| 429 | `rate_limited` | too frequent for this number |
| — | `http_error` | non-JSON response (e.g. a proxy 502) |

`reason` for `fraud_blocked`:

| `reason` | Why |
|---|---|
| `ip_blocked` | IP is on the VERYO blocklist |
| `ip_country` | IP country is not allowed in settings |
| `ip_rate` | too many sessions from one IP per hour |
| `device_rate` | too many sessions from one device per hour |
| `ip_numbers` | too many different numbers from one IP per day |

### Webhooks

VERYO signs every event: `X-Veryo-Signature: sha256=<HMAC-SHA256(secret, timestamp + "." + body)>`, `X-Veryo-Timestamp` (unix seconds), `X-Veryo-Event-Id`. `webhooks.verify` checks the signature (constant-time), rejects events older than 300 s and returns the event.

Pass the **raw body** exactly as received — re-serialized JSON will not match the signature.

```ts
// Bun / edge / any Fetch API runtime
const event = await veryo.webhooks.verify(await req.text(), req.headers, process.env.VERYO_WEBHOOK_SECRET!)

// Express
app.post('/veryo', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const event = await veryo.webhooks.verify(req.body, req.headers, secret)
    if (event.type === 'verification.verified') { /* event.data.verification_id */ }
    res.sendStatus(200)
  } catch {
    res.sendStatus(400)
  }
})
```

Event types: `verification.delivered`, `verification.verified`, `verification.failed`, `webhook.test`. On failure it throws `VeryoError` with `status: 400` and `code` `invalid_signature` or `stale_timestamp`. Events may be redelivered — dedupe by `event.id`.

## App: `@veryo/react-native`

```bash
npx expo install @veryo/react-native expo-device expo-application expo-secure-store
```

```ts
import { getSignals } from '@veryo/react-native'

const signals = await getSignals()
// { device_id, device_platform, device_model, os_version, app_version }

await fetch('https://your-backend.example/auth/start', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone, signals }),
})
```

`device_id` is a random UUID generated once and kept in `expo-secure-store` (web has no SecureStore, so there the id lasts until reload). The package makes no network calls and takes no API key.

## Examples

- [`examples/bun-server`](examples/bun-server/server.ts) — Bun backend: `POST /start` and `POST /check`.
  ```bash
  pnpm i && pnpm build
  cd examples/bun-server && VERYO_API_KEY=sk_... bun run start
  ```
- [`examples/expo`](examples/expo/App.tsx) — app: phone screen → code screen.
  ```bash
  cd examples/expo && EXPO_PUBLIC_API_URL=http://<your-computer-IP>:3000 pnpm start
  ```

## Development

```bash
pnpm i
pnpm -r build
pnpm -r test
pnpm changeset   # describe a change for the next release
```
