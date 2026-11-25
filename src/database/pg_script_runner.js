// backend/src/database/pg_script_runner.js
// PostgreSQL single-client for migration and seed scripts.
// Uses DATABASE_URL_DIRECT when available (bypasses Neon connection pooler),
// falls back to DATABASE_URL for environments where only pooled URL is set.
import '../config/env.js'
import pg from 'pg'

const { Client } = pg

/**
 * Create a single dedicated PostgreSQL client for scripts (migrate, seed, verify).
 * Unlike the pool in db.js, this client is not shared and can run DDL/transactions safely.
 */
export function createScriptClient() {
  const connectionString = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL
  if (!connectionString) {
    console.error('FATAL: DATABASE_URL is not set in backend/.env')
    process.exit(1)
  }
  return new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  })
}
