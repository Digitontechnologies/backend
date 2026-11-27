import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

// Load backend/.env using an absolute path before any module creates a DB pool.
const here = path.dirname(fileURLToPath(import.meta.url))
export const ENV_PATH = path.resolve(here, '../../.env')
export const envFileFound = fs.existsSync(ENV_PATH)
dotenv.config({ path: ENV_PATH, quiet: true })

export const env = {
  port: Number(process.env.PORT) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || '',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',').map((s) => s.trim()).filter(Boolean),
}

/** Returns a list of configuration problems (empty = OK). Never exposes credentials. */
export function configProblems() {
  const problems = []
  if (!envFileFound && !process.env.DATABASE_URL) {
    problems.push(`DATABASE_URL environment variable is missing (no .env found at ${ENV_PATH})`)
  }
  if (!env.databaseUrl) problems.push('DATABASE_URL is required')
  if (
    env.databaseUrl &&
    !env.databaseUrl.startsWith('postgresql://') &&
    !env.databaseUrl.startsWith('postgres://')
  ) problems.push('DATABASE_URL must start with postgresql:// or postgres://')
  return problems
}

/** Safe-to-log description of the database connection (no credentials). */
export function describeDb() {
  try {
    const url = new URL(env.databaseUrl)
    return `${url.username}@${url.hostname}${url.pathname} (ssl: ${url.searchParams.get('sslmode') || 'default'})`
  } catch {
    return '(invalid DATABASE_URL)'
  }
}
