import fs from 'fs'
import path from 'path'

// Minimal local services used when running outside of managed platforms.
// Provides simple storage, vector search, and placeholders for database/KV.

export function getBlobStore() {
  const storageDir = path.resolve(process.cwd(), 'local-storage')
  if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true })

  return {
    async put(name: string, file: File | Buffer | any, opts?: any) {
      const buffer = file?.arrayBuffer
        ? Buffer.from(await file.arrayBuffer())
        : Buffer.from(await Promise.resolve(file))
      const prefix = opts?.prefix ? `${opts.prefix}/` : ''
      const filePath = path.join(storageDir, `${prefix}${name}`)
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
      await fs.promises.writeFile(filePath, buffer)
      return { pathname: filePath }
    },
  }
}

function dot(a: number[], b: number[]) {
  let s = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += (a[i] || 0) * (b[i] || 0)
  return s
}

export function getVectorStore(_namespace?: string) {
  const storeFile = path.resolve(process.cwd(), 'local-storage', 'vectors.json')
  let store: Record<string, { id: string; vector: number[]; metadata?: any }> = {}

  if (fs.existsSync(storeFile)) {
    try {
      store = JSON.parse(fs.readFileSync(storeFile, 'utf-8'))
    }
    catch (e) {
      console.warn('Failed to load vector store:', e)
    }
  }

  const save = () => {
    try {
      fs.writeFileSync(storeFile, JSON.stringify(store))
    }
    catch (e) {
      console.warn('Failed to save vector store:', e)
    }
  }

  return {
    async insert(items: { id: string; values: number[]; namespace?: string; metadata?: any }[]) {
      for (const it of items) store[it.id] = { id: it.id, vector: it.values, metadata: it.metadata }
      save()
      return { success: true }
    },
    async query(vector: number[], opts: any) {
      let results = Object.values(store).map((v) => ({ id: v.id, score: dot(v.vector, vector), metadata: v.metadata }))
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

export function getDatabase() {
  return null
}

export function getKV() {
  return new Map()
}
