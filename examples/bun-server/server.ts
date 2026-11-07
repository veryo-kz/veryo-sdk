// Customer backend: the API key lives here, never in the app.
// VERYO_API_KEY=sk_... bun run server.ts
import { Veryo, VeryoError } from '@veryo/node'

const veryo = new Veryo({ apiKey: process.env.VERYO_API_KEY!, baseUrl: process.env.VERYO_BASE_URL })

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  async fetch(req, server) {
    const url = new URL(req.url)
    if (req.method !== 'POST') return new Response('Not found', { status: 404 })
    try {
      const body = await req.json()
      if (url.pathname === '/start') {
        // Trust X-Forwarded-For only behind your own proxy; otherwise use the socket address.
        const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || server.requestIP(req)?.address
        // Take only device fields from the client: ip and is_trusted_user are decided by the server.
        const { device_id, device_platform, device_model, os_version, app_version } = body.signals ?? {}
        const v = await veryo.verifications.create({
          phone: body.phone,
          purpose: 'login',
          signals: {
            device_id, device_platform, device_model, os_version, app_version,
            ip,
            user_agent: req.headers.get('user-agent') ?? undefined,
          },
        })
        return Response.json({ id: v.id, expires_at: v.expires_at })
      }
      if (url.pathname === '/check') {
        const { status } = await veryo.verifications.check({ id: body.id, code: body.code })
        // status === 'verified' → sign the user in here
        return Response.json({ status })
      }
      return new Response('Not found', { status: 404 })
    } catch (e) {
      if (e instanceof VeryoError) {
        return Response.json({ error: e.code, reason: e.reason, message: e.message }, { status: e.status })
      }
      throw e
    }
  },
})

console.log(`listening on ${server.url}`)
