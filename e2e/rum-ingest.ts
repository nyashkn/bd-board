import { appendFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'

/**
 * A fake OpenObserve RUM intake for tests: listens on 127.0.0.1 (random port), answers CORS
 * preflights, and appends every request to a JSONL file the spec processes read.
 */
export interface Ingest {
  port: number
  logPath: string
  close: () => Promise<void>
}

export function startIngest(logPath: string): Promise<Ingest> {
  writeFileSync(logPath, '')
  const server: Server = createServer((req, res) => {
    const origin = req.headers.origin ?? '*'
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Headers', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Max-Age', '60')
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end()
      return
    }
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      appendFileSync(
        logPath,
        JSON.stringify({
          method: req.method,
          url: req.url,
          origin: req.headers.origin ?? '',
          body: Buffer.concat(chunks).toString('utf8'),
        }) + '\n',
      )
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({
        port,
        logPath,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}
