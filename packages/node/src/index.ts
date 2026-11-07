export type Channel = 'telegram' | 'whatsapp' | 'sms'

/** Device and network signals for antifraud. Collect device ones with `@veryo/react-native`. */
export interface Signals {
  ip?: string
  device_id?: string
  device_platform?: 'android' | 'ios' | 'web'
  device_model?: string
  os_version?: string
  app_version?: string
  user_agent?: string
  is_trusted_user?: boolean
}

export interface CreateVerificationRequest {
  /** Kazakhstan mobile number, +77XXXXXXXXX. */
  phone: string
  purpose?: 'login' | 'registration'
  signals?: Signals
  options?: {
    locale?: 'ru' | 'kk' | 'en'
    /** 4–8 */
    code_size?: number
    /** 4–8 digits */
    custom_code?: string
    preferred_channel?: Channel
  }
  /** correlation_id ≤ 80 chars, echoed in webhook events. */
  metadata?: { correlation_id?: string }
}

export interface Verification {
  id: string
  status: 'pending'
  expires_at: string
  test?: boolean
}

export interface CheckVerificationRequest {
  id: string
  code: string
}

export interface CheckVerificationResult {
  status: 'verified' | 'pending' | 'failed' | 'expired'
}

export type FraudReason = 'ip_blocked' | 'ip_country' | 'ip_rate' | 'device_rate' | 'ip_numbers'

export type ErrorCode =
  | 'invalid_phone'
  | 'insufficient_balance'
  | 'daily_limit'
  | 'rate_limited'
  | 'phone_blocked'
  | 'fraud_blocked'
  | 'unauthorized'
  | 'invalid_signature'
  | 'stale_timestamp'
  | (string & {})

export type WebhookEventType =
  | 'verification.delivered'
  | 'verification.verified'
  | 'verification.failed'
  | 'webhook.test'

export interface WebhookEvent<T = Record<string, unknown>> {
  id: string
  type: WebhookEventType
  created_at: string
  data: T
}

export type HeadersLike = Headers | Record<string, string | string[] | undefined>

/** API error (`status` = HTTP status) or webhook verification failure (`status` = 400). */
export class VeryoError extends Error {
  readonly status: number
  readonly code: ErrorCode
  readonly reason: FraudReason | (string & {}) | undefined

  constructor(status: number, code: ErrorCode, message: string, reason?: string) {
    super(message)
    this.name = 'VeryoError'
    this.status = status
    this.code = code
    this.reason = reason
  }
}

export interface VeryoOptions {
  apiKey: string
  baseUrl?: string
}

export class Veryo {
  readonly verifications: {
    create(req: CreateVerificationRequest): Promise<Verification>
    check(req: CheckVerificationRequest): Promise<CheckVerificationResult>
  }
  readonly webhooks = { verify: verifyWebhook }

  constructor({ apiKey, baseUrl = 'https://api.veryo.kz' }: VeryoOptions) {
    if (!apiKey) throw new Error('Veryo: apiKey is required')
    const base = baseUrl.replace(/\/+$/, '')
    const post = async <T>(path: string, body: unknown): Promise<T> => {
      const res = await fetch(base + path, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      })
      const text = await res.text()
      let json: any
      try {
        json = text ? JSON.parse(text) : undefined
      } catch {}
      if (!res.ok) {
        throw new VeryoError(
          res.status,
          json?.error ?? 'http_error',
          json?.message ?? `HTTP ${res.status}`,
          json?.reason,
        )
      }
      return json as T
    }
    this.verifications = {
      create: (req) => post('/v1/verify', req),
      check: (req) => post('/v1/verify/check', req),
    }
  }
}

const TOLERANCE_S = 300

/**
 * Verifies `X-Veryo-Signature` (HMAC-SHA256 of `timestamp + "." + rawBody`) and
 * `X-Veryo-Timestamp` (±300 s), then parses the event. Pass the body exactly as received.
 */
export async function verifyWebhook<T = Record<string, unknown>>(
  rawBody: string | Uint8Array,
  headers: HeadersLike,
  secret: string,
): Promise<WebhookEvent<T>> {
  const sig = header(headers, 'x-veryo-signature')
  const ts = header(headers, 'x-veryo-timestamp')
  if (!sig || !ts) throw new VeryoError(400, 'invalid_signature', 'Missing X-Veryo-Signature or X-Veryo-Timestamp')
  if (!/^\d+$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > TOLERANCE_S) {
    throw new VeryoError(400, 'stale_timestamp', 'Webhook timestamp is outside the 300 s tolerance')
  }
  const hex = sig.startsWith('sha256=') ? sig.slice(7) : ''
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new VeryoError(400, 'invalid_signature', 'Malformed X-Veryo-Signature')

  const enc = new TextEncoder()
  const body = typeof rawBody === 'string' ? enc.encode(rawBody) : rawBody
  const signed = new Uint8Array(ts.length + 1 + body.length)
  signed.set(enc.encode(ts + '.'))
  signed.set(body, ts.length + 1)

  // Node 18 has no global crypto. The specifier is a variable so edge/browser bundlers don't try to resolve it.
  const nodeCrypto = 'node:crypto'
  const subtle: SubtleCrypto = globalThis.crypto?.subtle ?? (await import(nodeCrypto)).webcrypto.subtle
  const key = await subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const want = new Uint8Array(32)
  for (let i = 0; i < 32; i++) want[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  // subtle.verify compares in constant time
  if (!(await subtle.verify('HMAC', key, want, signed))) {
    throw new VeryoError(400, 'invalid_signature', 'Webhook signature does not match')
  }

  const event = JSON.parse(new TextDecoder().decode(body))
  return { ...event, id: header(headers, 'x-veryo-event-id') ?? event.id }
}

function header(headers: HeadersLike, name: string): string | undefined {
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) ?? undefined
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) return Array.isArray(v) ? v[0] : v
  }
  return undefined
}
