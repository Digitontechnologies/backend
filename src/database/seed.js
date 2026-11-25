import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import { configProblems, describeDb, env } from '../config/env.js'
import { createScriptConnection } from './connection.js'

const seedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../database/seeds')
const referenceOnly = process.argv.includes('--reference-only')

const problems = configProblems()
if (problems.length) { problems.forEach((p) => console.error(`Config problem: ${p}`)); process.exit(1) }
if (env.nodeEnv === 'production' && !referenceOnly) {
  console.error('Refusing to load SAMPLE data when NODE_ENV=production. Use --reference-only.')
  process.exit(1)
}

const sampleUsers = [
  { name: 'Admin User',      email: 'admin@institutepro.local',      role: 'admin' },
  { name: 'Sneha Iyer',      email: 'accounts@institutepro.local',   role: 'accountant' },
  { name: 'Rahul Mehta',     email: 'instructor@institutepro.local', role: 'instructor' },
]

console.log(`Database: ${describeDb()}`)
const conn = await createScriptConnection()
try {
  await conn.query(`CREATE TABLE IF NOT EXISTS seed_history (
    name VARCHAR(100) NOT NULL, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
  const [done] = await conn.query('SELECT name FROM seed_history')
  const applied = new Set(done.map((r) => r.name))

  // Every seed unit is one transaction: all of it is saved, or none of it.
  const runUnit = async (name, work) => {
    if (applied.has(name)) { console.log(`  [skip] ${name} already applied`); return }
    await conn.beginTransaction()
    try {
      await work()
      await conn.query('INSERT INTO seed_history (name) VALUES (?)', [name])
      await conn.commit()
      console.log(`  [done] ${name}`)
    } catch (err) {
      await conn.rollback()
      console.error(`  [rolled back] ${name}`)
      throw err
    }
  }

  await runUnit('001_reference_data', async () => {
    await conn.query(await fs.readFile(path.join(seedDir, '001_reference_data.sql'), 'utf8'))
  })

  if (!referenceOnly) {
    await runUnit('002_sample_data', async () => {
      const password = process.env.SEED_DEFAULT_PASSWORD ?? ''
      if (password.length < 8) throw new Error('Set SEED_DEFAULT_PASSWORD (min 8 characters) in backend/.env before seeding.')
      const hash = await bcrypt.hash(password, 12) // only the hash is stored
      for (const u of sampleUsers) {
        await conn.execute('INSERT INTO users (full_name, email, password_hash) VALUES (?, ?, ?)', [u.name, u.email, hash])
        await conn.execute(
          'INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.email = ? AND r.name = ?',
          [u.email, u.role],
        )
      }
      await conn.query(await fs.readFile(path.join(seedDir, '002_sample_data.sql'), 'utf8'))
    })
  }
  console.log('Seeding finished.')
} catch (err) {
  console.error(`Seed failed: ${err.code || ''} ${err.sqlMessage || err.message}`)
  process.exitCode = 1
} finally {
  await conn.end()
}
