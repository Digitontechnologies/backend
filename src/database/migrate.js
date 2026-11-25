import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { configProblems, describeDb } from '../config/env.js'
import { createScriptConnection } from './connection.js'

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../database/migrations')
const statusOnly = process.argv.includes('--status')

// Safety net: migrations may only ADD things. Anything destructive is refused.
const stripComments = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '')
const DESTRUCTIVE = /\b(DROP\s+(TABLE|DATABASE|SCHEMA|COLUMN|INDEX|FOREIGN)|TRUNCATE|DELETE\s+FROM|RENAME\s+TABLE)\b/i

const problems = configProblems()
if (problems.length) { problems.forEach((p) => console.error(`Config problem: ${p}`)); process.exit(1) }

console.log(`Database: ${describeDb()}`)
const conn = await createScriptConnection()
try {
  await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    VARCHAR(10)  NOT NULL,
    name       VARCHAR(150) NOT NULL,
    checksum   CHAR(64)     NOT NULL,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (version)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

  const [appliedRows] = await conn.query('SELECT version, checksum FROM schema_migrations')
  const applied = new Map(appliedRows.map((r) => [r.version, r.checksum]))
  const files = (await fs.readdir(dir)).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort()

  let ran = 0
  for (const file of files) {
    const version = file.slice(0, 3)
    const sql = await fs.readFile(path.join(dir, file), 'utf8')
    const checksum = crypto.createHash('sha256').update(sql).digest('hex')

    if (applied.has(version)) {
      const same = applied.get(version) === checksum
      console.log(`  [skip] ${file} already applied${same ? '' : '  ! file changed since it was applied - create a NEW migration instead'}`)
      continue
    }
    if (statusOnly) { console.log(`  [pending] ${file}`); continue }
    if (DESTRUCTIVE.test(stripComments(sql))) throw new Error(`${file} contains destructive SQL and was refused`)

    console.log(`  [run]  ${file}`)
    // NOTE: MySQL auto-commits DDL, so a failed migration cannot be rolled back as a whole.
    // Every statement is CREATE TABLE IF NOT EXISTS, so fixing the error and re-running is safe.
    await conn.query(sql)
    await conn.query('INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)', [version, file, checksum])
    ran++
  }
  console.log(statusOnly ? 'Status check complete.' : `Done. ${ran} migration(s) applied, ${files.length - ran} already up to date.`)
} catch (err) {
  console.error(`Migration failed: ${err.code || ''} ${err.sqlMessage || err.message}`)
  process.exitCode = 1
} finally {
  await conn.end()
}
