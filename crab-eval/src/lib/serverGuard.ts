// Lightweight guard for destructive / write API routes.
// The app is intended to run as a local dev tool. In production builds we
// reject any non-loopback request to avoid accidental data loss when the
// server is exposed (e.g. behind a proxy, deployed, or shared on a LAN).

import { NextResponse } from 'next/server'

const LOOPBACK_HOSTS = new Set([
  '127.0.0.1', '::1', 'localhost', '0.0.0.0',
])

function getRemoteHost(req: Request): string {
  // x-forwarded-for lists the original client when behind a proxy.
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  // Fallback to host header (always present per HTTP/1.1).
  return (req.headers.get('host') ?? '').split(':')[0]
}

/**
 * Reject the request unless it originates from the loopback interface.
 * In development (NODE_ENV !== 'production') the guard is a no-op so
 * `npm run dev` and same-host calls keep working without configuration.
 *
 * Returns a 403 NextResponse to short-circuit the handler, or null if OK.
 */
export function assertLocalRequest(req: Request): NextResponse | null {
  if (process.env.NODE_ENV !== 'production') return null
  const host = getRemoteHost(req)
  if (LOOPBACK_HOSTS.has(host)) return null
  return NextResponse.json(
    { error: 'Forbidden: this endpoint only accepts loopback requests in production.' },
    { status: 403 }
  )
}
