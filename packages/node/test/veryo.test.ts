import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Veryo, VeryoError } from '../src/index'

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async (_url: string, _init: RequestInit) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('verifications', () => {
  it('create posts the request with bearer auth', async () => {
    const fetch = mockFetch(201, { id: 'ver_1', status: 'pending', expires_at: '2026-11-07T10:00:00Z' })
    const veryo = new Veryo({ apiKey: 'sk_test_1', baseUrl: 'https://api.example.kz/' })
    const req = {
      phone: '+77011234567',
      purpose: 'login' as const,
      signals: { ip: '1.2.3.4', device_id: 'd1', device_platform: 'ios' as const },
      options: { locale: 'kk' as const, code_size: 6 },
      metadata: { correlation_id: 'c1' },
    }
    const res = await veryo.verifications.create(req)

    expect(res).toEqual({ id: 'ver_1', status: 'pending', expires_at: '2026-11-07T10:00:00Z' })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://api.example.kz/v1/verify')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk_test_1', 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body as string)).toEqual(req)
  })

  it('check posts id and code to the default base URL', async () => {
    const fetch = mockFetch(200, { status: 'verified' })
    const res = await new Veryo({ apiKey: 'k' }).verifications.check({ id: 'ver_1', code: '123456' })

    expect(res).toEqual({ status: 'verified' })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://api.veryo.kz/v1/verify/check')
    expect(JSON.parse(init.body as string)).toEqual({ id: 'ver_1', code: '123456' })
  })
})

describe('VeryoError', () => {
  it('maps fraud_blocked with reason', async () => {
    mockFetch(403, { error: 'fraud_blocked', message: 'Отказ антифрода', reason: 'ip_rate' })
    const err = await new Veryo({ apiKey: 'k' }).verifications.create({ phone: '+77011234567' }).catch((e) => e)
    expect(err).toBeInstanceOf(VeryoError)
    expect(err).toMatchObject({ status: 403, code: 'fraud_blocked', reason: 'ip_rate', message: 'Отказ антифрода' })
  })

  it('maps codes without reason', async () => {
    mockFetch(402, { error: 'insufficient_balance', message: 'Пополните баланс' })
    const err = await new Veryo({ apiKey: 'k' }).verifications.create({ phone: '+77011234567' }).catch((e) => e)
    expect(err).toMatchObject({ status: 402, code: 'insufficient_balance', reason: undefined })
  })

  it('survives a non-JSON error body', async () => {
    mockFetch(502, '<html>Bad Gateway</html>')
    const err = await new Veryo({ apiKey: 'k' }).verifications.check({ id: 'x', code: '1' }).catch((e) => e)
    expect(err).toMatchObject({ status: 502, code: 'http_error', message: 'HTTP 502' })
  })
})

describe('webhooks.verify', () => {
  const secret = 'whsec_test'
  const body = JSON.stringify({
    type: 'verification.verified',
    created_at: '2026-11-07T10:00:00Z',
    data: { verification_id: 'ver_1' },
  })
  const sign = (ts: string, raw = body, key = secret) =>
    'sha256=' + createHmac('sha256', key).update(`${ts}.${raw}`).digest('hex')
  const now = () => String(Math.floor(Date.now() / 1000))
  const veryo = new Veryo({ apiKey: 'k' })

  it('accepts a valid signature (string body, plain headers)', async () => {
    const ts = now()
    const event = await veryo.webhooks.verify(
      body,
      { 'x-veryo-signature': sign(ts), 'x-veryo-timestamp': ts, 'x-veryo-event-id': 'evt_1' },
      secret,
    )
    expect(event).toEqual({
      id: 'evt_1',
      type: 'verification.verified',
      created_at: '2026-11-07T10:00:00Z',
      data: { verification_id: 'ver_1' },
    })
  })

  it('accepts Uint8Array body and Headers', async () => {
    const ts = now()
    const headers = new Headers({ 'X-Veryo-Signature': sign(ts), 'X-Veryo-Timestamp': ts, 'X-Veryo-Event-Id': 'evt_2' })
    const event = await veryo.webhooks.verify(new TextEncoder().encode(body), headers, secret)
    expect(event.id).toBe('evt_2')
  })

  it('rejects a bad signature', async () => {
    const ts = now()
    const tampered = body.replace('ver_1', 'ver_2')
    await expect(
      veryo.webhooks.verify(tampered, { 'X-Veryo-Signature': sign(ts), 'X-Veryo-Timestamp': ts }, secret),
    ).rejects.toMatchObject({ code: 'invalid_signature' })
    await expect(
      veryo.webhooks.verify(body, { 'X-Veryo-Signature': sign(ts, body, 'other'), 'X-Veryo-Timestamp': ts }, secret),
    ).rejects.toMatchObject({ code: 'invalid_signature' })
    await expect(veryo.webhooks.verify(body, {}, secret)).rejects.toMatchObject({ code: 'invalid_signature' })
  })

  it('rejects a stale timestamp', async () => {
    const ts = String(Math.floor(Date.now() / 1000) - 301)
    await expect(
      veryo.webhooks.verify(body, { 'X-Veryo-Signature': sign(ts), 'X-Veryo-Timestamp': ts }, secret),
    ).rejects.toMatchObject({ status: 400, code: 'stale_timestamp' })
  })
})
