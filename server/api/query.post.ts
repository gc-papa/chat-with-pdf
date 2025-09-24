// original: https://github.com/RafalWilinski/cloudflare-rag/blob/2f4341bcf462c8f86001b601e59e60c25b1a6ea8/functions/api/stream.ts
import consola from 'consola'
import { z } from 'zod'

import { vertexAI } from '../utils/vertex-ai'

const schema = z.object({
  messages: z.array(
    z.object({
      role: z.union([z.literal('system'), z.literal('user'), z.literal('assistant'), z.literal('tool')]),
      content: z.string(),
    }),
  ),
  sessionId: z.string(),
})

export default defineEventHandler(async (event) => {
  const { messages, sessionId } = await readValidatedBody(event, schema.parse)
  const eventStream = createEventStream(event)
  const streamResponse = (data: object) => eventStream.push(JSON.stringify(data))

  event.waitUntil((async () => {
    try {
      const params = await processUserQuery({ messages, sessionId }, streamResponse)
      const ai = await vertexAI()

      // Request a streaming response when available. Local adapters may
      // return a non-iterable result (synchronous object) — handle both
      // streaming and non-streaming responses gracefully.
  // `ai.run` may return different shapes depending on adapter (streaming
  // AsyncIterable/ReadableStream vs plain object). Treat `result` as any
  // here and perform runtime checks.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = await ai.run(process.env.VERTEX_CHAT_MODEL, { messages: params.messages, stream: true })

  // If result is an async iterable (for-await-able), stream it
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const asyncIter = result && (typeof result[Symbol.asyncIterator] === 'function')
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const hasReader = result && typeof result.getReader === 'function'

      if (asyncIter) {
        try {
          for await (const chunk of result as AsyncIterable<Uint8Array | string | any>) {
            // Send ReadableStream to client using existing stream. Calling sendStream() doesn't work when deployed.
            const chunkBytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk
            const chunkString = new TextDecoder().decode(chunkBytes).replace(/^data:\s*/i, '')
            await eventStream.push(chunkString)
          }
        }
        catch (e) {
          // If the object wasn't truly async-iterable (some adapters return
          // sync objects despite advertising streaming), fallback to
          // non-streaming handling below.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          consola.warn('Streaming iterator failed, falling back to non-streaming response', (e as any)?.message ?? e)
          try {
            const text = result && (result.response || result.text || (Array.isArray(result.data) ? result.data.join('\n') : result.data))
            const out = JSON.stringify({ response: text })
            await eventStream.push(out)
          }
          catch (err) {
            await eventStream.push(JSON.stringify(result))
          }
        }
      }
      else if (hasReader) {
        // Web ReadableStream: use reader to pull chunks
        const reader = (result as ReadableStream).getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunkBytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
          const chunkString = new TextDecoder().decode(chunkBytes).replace(/^data:\s*/i, '')
          await eventStream.push(chunkString)
        }
      }
      else {
        // Non-streaming adapter: send single textual response if present
        try {
          const text = result && (result.response || result.text || (Array.isArray(result.data) ? result.data.join('\n') : result.data))
          const out = JSON.stringify({ response: text })
          await eventStream.push(out)
        }
        catch (e) {
          // Fallback: send the raw result JSON
          await eventStream.push(JSON.stringify(result))
        }
      }
    }
    catch (error) {
      consola.error(error)
      await streamResponse({ error: (error as Error).message })
    }
    finally {
      await eventStream.close()
    }
  })())

  return eventStream.send()
})
