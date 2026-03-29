import { NextResponse } from 'next/server'

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

const SUPPORTED = ['.txt', '.md', '.markdown', '.csv', '.json', '.docx', '.pdf']

function getExt(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot).toLowerCase() : ''
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large (max 10 MB, got ${(file.size / 1024 / 1024).toFixed(1)} MB)` },
        { status: 413 }
      )
    }

    const ext = getExt(file.name)

    if (!SUPPORTED.includes(ext)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${ext || '(none)'}. Supported: ${SUPPORTED.join(', ')}` },
        { status: 415 }
      )
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    let text = ''

    if (ext === '.docx') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mammoth = require('mammoth') as {
        extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }>
      }
      const result = await mammoth.extractRawText({ buffer })
      text = result.value
    } else if (ext === '.pdf') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>
      const result = await pdfParse(buffer)
      text = result.text
    } else if (ext === '.json') {
      // Normalise whitespace by round-tripping through JSON
      try {
        text = JSON.stringify(JSON.parse(buffer.toString('utf-8')), null, 2)
      } catch {
        text = buffer.toString('utf-8')
      }
    } else {
      // .txt .md .markdown .csv
      text = buffer.toString('utf-8')
    }

    // Normalise Windows line endings
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()

    return NextResponse.json({ text, filename: file.name, ext })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    // Give a clear hint if the package is simply not installed yet
    if (msg.includes("Cannot find module 'mammoth'") || msg.includes("Cannot find module 'pdf-parse'")) {
      return NextResponse.json(
        { error: `Missing dependency. Run: npm install mammoth pdf-parse\n\nOriginal error: ${msg}` },
        { status: 500 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
