import * as schema from '../database/schema'

export { sql, eq, and, or } from 'drizzle-orm'

export const tables = schema

// We support two modes:
// - Remote NuxtHub / Cloudflare D1 (default): original drizzle/d1 usage
// - LOCAL=true: use better-sqlite3 with drizzle-orm/better-sqlite3

const LOCAL = process.env.LOCAL === 'true'

let drizzleProvider: null | (() => Promise<any>) = null

if (LOCAL) {
  drizzleProvider = async () => {
    const { drizzle } = await import('drizzle-orm/better-sqlite3')
    const Database = (await import('better-sqlite3')).default || (await import('better-sqlite3'))
    const path = await import('path')
    const fs = await import('fs')

    const dbPath = process.env.SQLITE_PATH || './data/dev.sqlite'
    try {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    }
    catch (e) {
      // ignore
    }
    const conn = new Database(dbPath)

    // Apply SQL migrations found in server/database/migrations if any.
    try {
      const migDir = path.resolve(process.cwd(), 'server', 'database', 'migrations')
      if (fs.existsSync(migDir)) {
        const files = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort()
        for (const file of files) {
          const sql = fs.readFileSync(path.join(migDir, file), 'utf8')
          // drizzle-kit uses a '--> statement-breakpoint' marker between statements
          const parts = sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean)
          for (const stmt of parts) {
            try {
              conn.exec(stmt)
            }
            catch (e) {
              // ignore errors for statements that might already exist
            }
          }
        }
      }
    }
    catch (e) {
      // don't block startup on migration errors; log and continue
      // eslint-disable-next-line no-console
      console.error('Migration apply error:', e && e.message ? e.message : e)
    }

    return drizzle(conn, { schema })
  }
}
else {
  // In non-LOCAL mode prefer the NuxtHub/remote D1 provider. However, if
  // `globalThis.hubDatabase` is not available (for example during some
  // local dev setups or background tasks), fall back to a local sqlite
  // provider so the app remains usable.
  drizzleProvider = async () => {
    // If NuxtHub provided a hubDatabase function, call it and use drizzle-orm/d1
    // only when it returns a real connection object. Some local fallbacks may
    // expose a factory that returns null as a sentinel; guard against that so
    // we don't pass `null` into the D1 provider (which will try to call
    // `.prepare` on the connection and crash).
    // @ts-ignore - globalThis.hubDatabase is provided by NuxtHub in cloud mode
    if (typeof globalThis.hubDatabase === 'function') {
      // call the factory (may return null as a sentinel)
      // @ts-ignore
      const hubDb = globalThis.hubDatabase()
      if (hubDb) {
        const { drizzle } = await import('drizzle-orm/d1')
        return drizzle(hubDb, { schema })
      }
      // otherwise fall through to the local better-sqlite3 fallback below
    }

    // Fallback: use local better-sqlite3 (same as LOCAL branch)
    const { drizzle } = await import('drizzle-orm/better-sqlite3')
    const Database = (await import('better-sqlite3')).default || (await import('better-sqlite3'))
    const path = await import('path')
    const fs = await import('fs')

    const dbPath = process.env.SQLITE_PATH || './data/dev.sqlite'
    try {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    }
    catch (e) {
      // ignore
    }
    const conn = new Database(dbPath)

    // apply migrations as above for fallback path
    try {
      const migDir = path.resolve(process.cwd(), 'server', 'database', 'migrations')
      if (fs.existsSync(migDir)) {
        const files = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort()
        for (const file of files) {
          const sql = fs.readFileSync(path.join(migDir, file), 'utf8')
          const parts = sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean)
          for (const stmt of parts) {
            try {
              conn.exec(stmt)
            }
            catch (e) {
              // ignore
            }
          }
        }
      }
    }
    catch (e) {
      // eslint-disable-next-line no-console
      console.error('Migration apply error:', e && e.message ? e.message : e)
    }

    return drizzle(conn, { schema })
  }
}

export async function useDrizzle() {
  if (!drizzleProvider) throw new Error('Drizzle provider not initialized')
  return await drizzleProvider()
}

export type Document = typeof schema.documents.$inferSelect
export type DocumentChunk = typeof schema.documentChunks.$inferSelect
