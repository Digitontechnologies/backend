import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import '../config/env.js'
import { createScriptClient } from './pg_script_runner.js'

const seedDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../database/postgres/seeds',
)
const referenceOnly = process.argv.includes('--reference-only')

if (process.env.NODE_ENV === 'production' && !referenceOnly) {
  console.error('Refusing to load SAMPLE data when NODE_ENV=production. Use --reference-only.')
  process.exit(1)
}

const sampleUsers = [
  { name: 'Admin User',  email: 'admin@institutepro.local',      role: 'admin' },
  { name: 'Sneha Iyer',  email: 'accounts@institutepro.local',   role: 'accountant' },
  { name: 'Rahul Mehta', email: 'instructor@institutepro.local', role: 'instructor' },
]

const client = createScriptClient()
await client.connect()
console.log('Institute Pro — PostgreSQL Seeder\n')

try {
  // Tracking table: each seed unit runs at most once.
  await client.query(`
    CREATE TABLE IF NOT EXISTS seed_history (
      name       VARCHAR(100) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `)
  const { rows: done } = await client.query('SELECT name FROM seed_history')
  const applied = new Set(done.map((r) => r.name))

  /**
   * Run work() inside a transaction and record it in seed_history.
   * If work() throws, the transaction is rolled back and the error re-thrown.
   */
  async function runUnit(name, work) {
    if (applied.has(name)) { console.log(`  [skip] ${name} — already applied`); return }
    await client.query('BEGIN')
    try {
      await work()
      await client.query('INSERT INTO seed_history (name) VALUES ($1)', [name])
      await client.query('COMMIT')
      console.log(`  [done] ${name}`)
    } catch (err) {
      await client.query('ROLLBACK')
      console.error(`  [rolled back] ${name}`)
      throw err
    }
  }

  // ── 001: roles ────────────────────────────────────────────────────────────
  await runUnit('001_reference_data', async () => {
    const sql = await fs.readFile(path.join(seedDir, '001_reference_data.sql'), 'utf8')
    await client.query(sql)
  })

  if (!referenceOnly) {
    // ── 002: sample users + data ────────────────────────────────────────────
    await runUnit('002_sample_data', async () => {
      const password = process.env.SEED_DEFAULT_PASSWORD ?? ''
      if (password.length < 8) {
        throw new Error(
          'Set SEED_DEFAULT_PASSWORD (min 8 characters) in backend/.env before seeding.',
        )
      }
      const hash = await bcrypt.hash(password, 12)   // only the hash is stored

      for (const u of sampleUsers) {
        const { rows } = await client.query(
          'INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
          [u.name, u.email, hash],
        )
        const userId = rows[0].id
        await client.query(
          `INSERT INTO user_roles (user_id, role_id)
           SELECT $1, r.id FROM roles r WHERE r.name = $2`,
          [userId, u.role],
        )
      }

      const sql = await fs.readFile(path.join(seedDir, '002_sample_data.sql'), 'utf8')
      await client.query(sql)
    })
  }

  console.log('\nSeeding finished.')
} catch (err) {
  console.error(`\nSeed failed: ${err.message}`)
  process.exitCode = 1
} finally {
  await client.end()
}
