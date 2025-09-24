import http from 'node:http'
import { listener } from './.output/server/index.mjs'

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000

// Nitro's listener has the signature (req, res) => Promise<void>
// Wrap it in a Node http server and forward requests.
const server = http.createServer(async (req, res) => {
  try {
    // Nitro listener expects Request-like object; the generated listener in .output
    // for node-listener accepts Node req/res directly in many builds, but we'll
    // call it and catch errors.
    await listener(req, res)
  }
  catch (err) {
    console.error('Listener error:', err)
    try {
      res.statusCode = 500
      res.end('Internal Server Error')
    }
    catch {}
  }
})

server.listen(PORT, () => {
  console.log(`Dev Nitro server listening on http://localhost:${PORT}`)
})
