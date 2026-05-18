import { NextRequest, NextResponse } from 'next/server'
import { assertLocalRequest } from '@/lib/serverGuard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Browser → /api/llm-proxy/<path> → upstream LLM endpoint. Used to bypass CORS
// for providers (OpenAI, DeepSeek, …) that don't set Access-Control-Allow-Origin.
// Target base URL is carried per-request in the `x-llm-baseurl` header so the
// proxy stays provider-agnostic.

const STRIP_REQ = new Set([
  'host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade', 'content-length',
  'x-llm-baseurl', 'origin', 'referer',
])

// content-encoding/length no longer match the (decoded) body returned by
// Node fetch — drop them so the browser doesn't try to decompress twice.
const STRIP_RES = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length',
])

async function handle(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  const guard = assertLocalRequest(req)
  if (guard) return guard

  const baseUrl = req.headers.get('x-llm-baseurl')
  if (!baseUrl) {
    return NextResponse.json({ error: 'Missing x-llm-baseurl header' }, { status: 400 })
  }

  let target: URL
  try {
    const { path } = await ctx.params
    const suffix = (path ?? []).join('/')
    const qs = new URL(req.url).search
    target = new URL(`${baseUrl.replace(/\/$/, '')}/${suffix}${qs}`)
  } catch {
    return NextResponse.json({ error: 'Invalid target URL' }, { status: 400 })
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return NextResponse.json({ error: 'Only http/https targets allowed' }, { status: 400 })
  }

  const fwd = new Headers()
  req.headers.forEach((value, key) => {
    if (!STRIP_REQ.has(key.toLowerCase())) fwd.set(key, value)
  })

  // Buffer the body instead of streaming. Streaming with `duplex: 'half'` is
  // brittle across Node versions; for typical chat-completion / file-upload
  // payloads (<a few MB) buffering is simpler and more reliable.
  const init: RequestInit = {
    method: req.method,
    headers: fwd,
    signal: req.signal,
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.arrayBuffer()
  }

  let upstream: Response
  try {
    upstream = await fetch(target.toString(), init)
  } catch (err) {
    // Node `fetch failed` hides the real reason in err.cause — surface it so
    // the caller sees DNS/TLS/connection-refused/etc instead of a vague string.
    const msg = err instanceof Error ? err.message : String(err)
    const cause = (err as { cause?: unknown })?.cause
    const causeMsg = cause instanceof Error ? cause.message : cause != null ? String(cause) : ''
    const causeCode = (cause as { code?: string } | undefined)?.code ?? ''
    console.error('[llm-proxy] fetch failed →', target.toString(), { msg, causeMsg, causeCode, cause })
    return NextResponse.json(
      {
        error: `Upstream fetch failed: ${msg}${causeMsg ? ` — ${causeMsg}` : ''}${causeCode ? ` (${causeCode})` : ''}`,
        target: target.toString(),
      },
      { status: 502 }
    )
  }

  const resHeaders = new Headers()
  upstream.headers.forEach((value, key) => {
    if (!STRIP_RES.has(key.toLowerCase())) resHeaders.set(key, value)
  })

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: resHeaders,
  })
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
