import { NextResponse } from 'next/server'
import { assertLocalRequest } from '@/lib/serverGuard'

const ENVSCALER_URL = process.env.ENVSCALER_URL ?? 'http://localhost:8000'

export async function GET() {
  try {
    const res = await fetch(`${ENVSCALER_URL}/envscaler/health`, {
      signal: AbortSignal.timeout(5_000),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ status: 'unavailable' }, { status: 503 })
  }
}

export async function POST(request: Request) {
  assertLocalRequest(request)

  const body = await request.json()

  let res: Response
  try {
    res = await fetch(`${ENVSCALER_URL}/envscaler/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
    })
  } catch (e) {
    return NextResponse.json(
      { error: 'EnvScaler server unreachable', detail: String(e) },
      { status: 503 }
    )
  }

  if (!res.ok) {
    return NextResponse.json(
      { error: 'EnvScaler server error', detail: await res.text() },
      { status: res.status }
    )
  }

  return NextResponse.json(await res.json())
}
