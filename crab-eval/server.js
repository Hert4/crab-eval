// Custom Node server để override timeout mặc định 5 phút của Node 18+.
// EnvScaler pipeline có thể chạy 10-20 phút mỗi batch, nên cần >= 30 phút.
// Tradeoff: mất Turbopack tăng tốc của `next dev`. Đổi lại không bị 503 oan.

const { createServer } = require('http')
const next = require('next')

const port = parseInt(process.env.PORT ?? '3000', 10)
const dev = process.env.NODE_ENV !== 'production'
const app = next({ dev })
const handle = app.getRequestHandler()

const THIRTY_MIN_MS = 30 * 60 * 1000

app.prepare().then(() => {
  const server = createServer((req, res) => handle(req, res))

  server.requestTimeout = THIRTY_MIN_MS
  server.headersTimeout = THIRTY_MIN_MS + 10_000
  server.keepAliveTimeout = THIRTY_MIN_MS
  server.timeout = 0 // disable socket timeout, để requestTimeout chốt

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port} (requestTimeout=${THIRTY_MIN_MS}ms)`)
  })
})
