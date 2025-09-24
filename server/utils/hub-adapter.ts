import fs from 'fs'
import path from 'path'

// Minimal adapter that returns local fallbacks. We no longer rely on
// NuxtHub / Cloudflare Hub at runtime — local adapters are the default.
const LOCAL = true // always prefer local adapters

// --- Local blob implementation (store files under ./local-storage) ---
function localHubBlob() {
  const storageDir = path.resolve(process.cwd(), 'local-storage')
  if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true })

  return {
    async put(name: string, file: File | Buffer | any, opts?: any) {
      // support File-like with arrayBuffer
      const buffer = file?.arrayBuffer ? Buffer.from(await file.arrayBuffer()) : Buffer.from(await Promise.resolve(file))
      const filePath = path.join(storageDir, name)
      await fs.promises.writeFile(filePath, buffer)
      return { pathname: filePath }
    },
  }
}

// --- Local AI implementation (optional OpenAI fallback) ---
async function localHubAI() {
  const openaiKey = process.env.OPENAI_API_KEY
  if (openaiKey) {
    // lazy import to avoid adding dependency during analysis
    const OpenAI = await import('openai').then(m => m.default || m)
    const client = new OpenAI({ apiKey: openaiKey })

    return {
      async run(modelOrId: string, opts: any) {
        // If `messages` present, call chat completions
        if (opts?.messages) {
          const response = await client.chat.completions.create({ model: 'gpt-4o-mini', messages: opts.messages })
          return { response: response.choices?.[0]?.message?.content ?? '' }
        }
        if (opts?.text) {
          // embeddings or text->embedding like behavior
          const text = Array.isArray(opts.text) ? opts.text.join('\n') : opts.text
          const resp = await client.embeddings.create({ model: 'text-embedding-3-large', input: text })
          return { data: resp.data.map(d => d.embedding) }
        }
        return { response: 'ok' }
      },
    }
  }

  // Fallback: simple echo implementation for testing
  return {
    async run(modelOrId: string, opts: any) {
      if (opts?.messages) {
        const last = opts.messages[opts.messages.length - 1]
        return { response: `ECHO: ${last?.content ?? 'hello'}` }
      }
      if (opts?.text) {
        return { data: opts.text.map((t: string) => Array.from({ length: 8 }).map(() => Math.random())) }
      }
      return { response: 'ok' }
    },
  }
}

// --- Local vectorize stub ---
function localHubVectorize(_namespace?: string) {
  // A minimal in-memory vector store for dev (no real ANN search)
  const storeFile = path.resolve(process.cwd(), 'local-storage', 'vectors.json')
  let store: Record<string, { id: string; vector: number[]; metadata?: any }> = {}

  // Load from file if exists
  if (fs.existsSync(storeFile)) {
    try {
      store = JSON.parse(fs.readFileSync(storeFile, 'utf-8'))
    } catch (e) {
      console.warn('Failed to load vector store:', e)
    }
  }

  // Save to file
  const save = () => {
    try {
      fs.writeFileSync(storeFile, JSON.stringify(store))
    } catch (e) {
      console.warn('Failed to save vector store:', e)
    }
  }

  return {
    async insert(items: { id: string; values: number[]; namespace?: string; metadata?: any }[]) {
      for (const it of items) store[it.id] = { id: it.id, vector: it.values, metadata: it.metadata }
      save()
      return { success: true }
    },
    async query(_vector: number[], opts: any) {
      // naive dot-product ranking
      let results = Object.values(store).map((v) => ({ id: v.id, score: dot(v.vector, _vector), metadata: v.metadata }))
      // Apply filter if provided
      if (opts?.filter) {
        results = results.filter(r => {
          for (const [key, value] of Object.entries(opts.filter)) {
            if (r.metadata?.[key] !== value) return false
          }
          return true
        })
      }
      results = results.sort((a, b) => b.score - a.score).slice(0, opts?.topK || 5)
      return { matches: results.map(r => ({ id: r.id, score: r.score, metadata: r.metadata })) }
    },
  }
}

function dot(a: number[], b: number[]) {
  let s = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += (a[i] || 0) * (b[i] || 0)
  return s
}

// --- Local hubDatabase placeholder (for drizzle) ---
function localHubDatabase() {
  // For local mode we don't expose a NuxtHub-style `hubDatabase` global.
  // `server/utils/drizzle.ts` now prefers local better-sqlite3 when the
  // global is not present. Returning null here is a harmless sentinel.
  return null
}

// Exported factory
export async function hubBlob() {
  return localHubBlob()
}

export async function hubAI() {
  // If GEMINI usage is requested via env, try to create the Gemini adapter.
  const useGemini = !!(process.env.USE_GEMINI || process.env.GEMINI_MODEL)
  if (useGemini) {
    try {
      // dynamic import to keep dependency optional
      const { default: createGeminiAdapter, createGeminiAdapter: namedCreate } = await import('./gemini-adapter') as any
      const factory = createGeminiAdapter || namedCreate
      if (typeof factory === 'function') {
        const gemini = await factory()
        return gemini
      }
    } catch (err: any) {
      // if Gemini can't be created (missing creds or SDK), log and fall back
      // eslint-disable-next-line no-console
      console.warn('Gemini adapter unavailable, falling back to local AI:', err?.message || err)
    }
  }

  return await localHubAI()
}

export function hubVectorize(namespace?: string) {
  return localHubVectorize(namespace)
}

export function hubDatabase() {
  return localHubDatabase()
}

export function hubKV() {
  return new Map()
}

// If LOCAL mode is enabled, set globalThis.* so existing code calling hubAI(), hubBlob() etc works
// Ensure globalThis.hub* exist so any code that calls the global helpers
// (leftover from NuxtHub expectations) still works. They point to local
// implementations — we never call cloud NuxtHub.
// @ts-ignore
globalThis.hubBlob = localHubBlob
// @ts-ignore
globalThis.hubAI = async () => await localHubAI()
// @ts-ignore
globalThis.hubVectorize = (ns: string) => localHubVectorize(ns)
// @ts-ignore
globalThis.hubDatabase = () => localHubDatabase()
// @ts-ignore
globalThis.hubKV = () => new Map()

// Defensive: If some other code replaced hubKV with a non-function, overwrite
// it with a callable that returns a Map so callers don't crash.
// @ts-ignore
if (typeof globalThis.hubKV !== 'function') globalThis.hubKV = () => new Map()
