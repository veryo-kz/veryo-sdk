# VERYO SDK

[English](README.en.md)

SDK для [VERYO](https://veryo.kz) — подтверждение номера кодом через Telegram → WhatsApp → SMS. Платите только за канал, который доставил код.

| Пакет | Где работает | Что делает |
|---|---|---|
| [`@veryo/node`](packages/node) | ваш бэкенд: Node.js 18+, Bun, edge | отправляет и проверяет коды, проверяет подпись вебхуков |
| [`@veryo/react-native`](packages/react-native) | приложение на Expo / React Native | собирает сигналы устройства для антифрода |

## Безопасность ключа

**API-ключ живёт только на вашем сервере.** Не кладите его в мобильное приложение, сайт или переменные `EXPO_PUBLIC_*`: всё, что лежит в сборке приложения, можно достать. `@veryo/react-native` ключ не принимает и в сеть не ходит — он только собирает сигналы устройства. Приложение отправляет их **вашему** бэкенду, а бэкенд добавляет IP пользователя и вызывает VERYO через `@veryo/node`.

```
приложение ── getSignals() + телефон ──▶ ваш бэкенд ── API-ключ + IP ──▶ VERYO
```

## Сервер: `@veryo/node`

```bash
npm i @veryo/node      # или: bun add @veryo/node / pnpm add @veryo/node
```

Без зависимостей, только глобальный `fetch` и WebCrypto.

```ts
import { Veryo, VeryoError } from '@veryo/node'

const veryo = new Veryo({ apiKey: process.env.VERYO_API_KEY! })

// 1. Отправить код
const { id, expires_at } = await veryo.verifications.create({
  phone: '+77011234567',          // только мобильные номера Казахстана
  purpose: 'login',               // или 'registration'
  signals: {
    ...deviceSignalsFromApp,      // device_id, device_platform, device_model, os_version, app_version
    ip: clientIp,                 // IP пользователя, не вашего сервера
    user_agent: req.headers['user-agent'],
  },
  options: { locale: 'kk', code_size: 6 },        // также custom_code, preferred_channel
  metadata: { correlation_id: 'order-42' },       // ≤ 80 символов, придёт в вебхуках
})

// 2. Проверить код, который ввёл пользователь
const { status } = await veryo.verifications.check({ id, code: '123456' })
if (status === 'verified') {
  // пускаем пользователя
}
```

`status`: `verified` — код верный; `pending` — неверный, можно ввести ещё раз; `failed` — попытки кончились; `expired` — истёк срок.

Сигналы, которые решает сервер (`ip`, `is_trusted_user`), не берите из запроса приложения — берите поля устройства по одному, как в [примере](examples/bun-server/server.ts).

### Ошибки

Любой ответ API с ошибкой бросает `VeryoError` с полями `status` (HTTP), `code`, `message` (текст для человека) и `reason` (для `fraud_blocked`).

```ts
try {
  await veryo.verifications.create({ phone })
} catch (e) {
  if (e instanceof VeryoError && e.code === 'fraud_blocked') {
    console.warn('антифрод', e.reason)
  }
  throw e
}
```

| HTTP | `code` | Что значит |
|---|---|---|
| 401 | `unauthorized` | неверный или отозванный ключ |
| 402 | `insufficient_balance` | кончился баланс |
| 402 | `daily_limit` | достигнут дневной лимит аккаунта |
| 403 | `phone_blocked` | номер в блок-листе |
| 403 | `fraud_blocked` | отказ антифрода, причина в `reason` |
| 422 | `invalid_phone` | номер не мобильный казахстанский |
| 429 | `rate_limited` | слишком часто для этого номера |
| — | `http_error` | ответ не JSON (например, 502 от прокси) |

`reason` для `fraud_blocked`:

| `reason` | Почему |
|---|---|
| `ip_blocked` | IP в блок-листе VERYO |
| `ip_country` | страна IP не разрешена в настройках |
| `ip_rate` | слишком много сессий с одного IP за час |
| `device_rate` | слишком много сессий с одного устройства за час |
| `ip_numbers` | слишком много разных номеров с одного IP за сутки |

### Вебхуки

VERYO подписывает каждое событие: `X-Veryo-Signature: sha256=<HMAC-SHA256(секрет, timestamp + "." + тело)>`, `X-Veryo-Timestamp` (unix-секунды), `X-Veryo-Event-Id`. `webhooks.verify` проверяет подпись (сравнение за постоянное время), отклоняет события старше 300 с и возвращает событие.

Передавайте **сырое тело**, как оно пришло, — после `JSON.parse` и обратно подпись не сойдётся.

```ts
// Bun / edge / любой Fetch API
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

Типы событий: `verification.delivered`, `verification.verified`, `verification.failed`, `webhook.test`. При ошибке проверки бросается `VeryoError` со `status: 400` и `code` = `invalid_signature` или `stale_timestamp`. Событие может прийти повторно — отсеивайте дубли по `event.id`.

## Приложение: `@veryo/react-native`

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

`device_id` — случайный UUID, создаётся один раз и хранится в `expo-secure-store` (на вебе SecureStore нет — id живёт до перезагрузки страницы). Пакет не ходит в сеть и не принимает API-ключ.

## Примеры

- [`examples/bun-server`](examples/bun-server/server.ts) — бэкенд на Bun: `POST /start` и `POST /check`.
  ```bash
  pnpm i && pnpm build
  cd examples/bun-server && VERYO_API_KEY=sk_... bun run start
  ```
- [`examples/expo`](examples/expo/App.tsx) — приложение: экран номера → экран кода.
  ```bash
  cd examples/expo && EXPO_PUBLIC_API_URL=http://<IP-вашего-компьютера>:3000 pnpm start
  ```

## Разработка

```bash
pnpm i
pnpm -r build
pnpm -r test
pnpm changeset   # описать изменение для следующего релиза
```
