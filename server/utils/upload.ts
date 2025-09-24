import { getDocumentProxy, extractText } from 'unpdf'

import { getBlobStore, getVectorStore } from './local-services'
import { vertexAI } from './vertex-ai'

// Simple helper to validate blob/file inputs in LOCAL mode
export function ensureBlob(file: any, opts: { maxSize?: string, types?: string[] } = {}) {
  if (!file) throw new Error('No file')
  if (opts.types && file.type && !opts.types.includes(file.type)) {
    throw createError({ statusCode: 400, message: 'Invalid file type' })
  }
  if (opts.maxSize) {
    // support values like '8MB'
    const max = typeof opts.maxSize === 'string' && opts.maxSize.toUpperCase().endsWith('MB')
      ? parseInt(opts.maxSize) * 1024 * 1024
      : Number(opts.maxSize)
    if (file.size && max && file.size > max) throw createError({ statusCode: 400, message: 'File too large' })
  }
}

export async function extractTextFromPDF(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  const result = await extractText(pdf, { mergePages: true })
  return Array.isArray(result.text) ? result.text.join(' ') : result.text
}

export async function uploadPDF(file: File, sessionId: string): Promise<string> {
  const blobApi = await getBlobStore()
  const blob = await blobApi.put(`${Date.now()}-${file.name}`, file, { prefix: sessionId })
  return blob.pathname
}

export async function insertDocument(file: File, textContent: string, sessionId: string, r2Url: string) {
  const row = {
    name: file.name,
    size: file.size,
    textContent,
    sessionId,
    r2Url,
  }

  const db = await useDrizzle()
  return db.insert(tables.documents).values(row).returning({ insertedId: tables.documents.id })
}

export async function processVectors(
  chunks: string[],
  sessionId: string,
  documentId: string,
  streamResponse: (message: object) => Promise<void>,
) {
  const chunkSize = 10
  let progress = 0
  const ai = await vertexAI()
  const vectorApi = await getVectorStore('documents')

  await Promise.all(
    Array.from({ length: Math.ceil(chunks.length / chunkSize) }, async (_, index) => {
      const start = index * chunkSize
      const chunkBatch = chunks.slice(start, start + chunkSize)

      // Generate embeddings for the current batch
      const embeddingResult = await ai.run(process.env.VERTEX_EMBED_MODEL, {
        text: chunkBatch,
      })
      const embeddingBatch: number[][] = embeddingResult.data

      // Insert chunks into the database
      const db = await useDrizzle()
      const chunkInsertResults: any[] = await db
        .insert(tables.documentChunks)
        .values(
          chunkBatch.map(chunk => ({
            text: chunk,
            sessionId,
            documentId,
          })),
        )
        .returning({ insertedChunkId: tables.documentChunks.id })

      // Extract the inserted chunk IDs
      const chunkIds = chunkInsertResults.map(result => result.insertedChunkId)

      // Insert vectors into the vector store
      await vectorApi.insert(
        embeddingBatch.map((embedding, i) => ({
          id: chunkIds[i],
          values: embedding,
          namespace: 'default',
          metadata: { sessionId, documentId, chunkId: chunkIds[i], text: chunkBatch[i] },
        })),
      )

      progress += (chunkBatch.length / chunks.length) * 100
      await streamResponse({
        message: `Embedding... (${progress.toFixed(2)}%)`,
        progress,
      })
    }),
  )
}
