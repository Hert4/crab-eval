import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { FrozenOracleDataset } from '@/types'

const ORACLE_DIR = path.resolve(process.cwd(), 'results', 'oracle-datasets')

function ensureDir() {
  fs.mkdirSync(ORACLE_DIR, { recursive: true })
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const id = req.nextUrl.searchParams.get('id')
    ensureDir()

    if (id) {
      const filepath = path.join(ORACLE_DIR, `${id}.json`)
      if (!fs.existsSync(filepath)) {
        return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
      }
      const data = fs.readFileSync(filepath, 'utf-8')
      return NextResponse.json(JSON.parse(data))
    }

    // List all dataset IDs
    const files = fs.readdirSync(ORACLE_DIR).filter(f => f.endsWith('.json'))
    const datasets = files.map(f => f.replace('.json', ''))
    return NextResponse.json({ datasets })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const dataset = (await req.json()) as FrozenOracleDataset
    if (!dataset?.datasetId) {
      return NextResponse.json({ error: 'Invalid payload: missing datasetId' }, { status: 400 })
    }
    ensureDir()
    const filename = `${dataset.datasetId}.json`
    fs.writeFileSync(
      path.join(ORACLE_DIR, filename),
      JSON.stringify(dataset, null, 2),
      'utf-8'
    )
    return NextResponse.json({ saved: filename, datasetId: dataset.datasetId })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
