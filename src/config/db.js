// env.js runs dotenv first — import it before creating the pool.
import './env.js'
import pg from 'pg'

const { Pool } = pg

if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL is not set in backend/.env')
  process.exit(1)
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },   // Neon requires SSL
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
})

pool.on('error', (err) => {
  console.error('[pg pool] unexpected client error:', err.message)
})

/**
 * Run a parameterized PostgreSQL query against the pool.
 * Use $1, $2, $3 ... placeholders in sql; pass values in params array.
 * Returns the rows array directly.
 */
export async function query(sql, params = []) {
  const { rows } = await pool.query(sql, params)
  return rows
}
