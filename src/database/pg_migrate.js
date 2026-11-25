import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import '../config/env.js'
import { createScriptClient } from './pg_script_runner.js'

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../database/postgres/migrations',
)
const statusOnly = process.argv.includes('--status')

// Safety net: migrations may only ADD things.
// DROP TABLE, DROP DATABASE, TRUNCATE, DELETE FROM, and RENAME TABLE are refused.
// DROP COLUMN, DROP INDEX and DROP CONSTRAINT are allowed ONLY when the migration
// file contains the declaration:  -- migrate:allow drop-column
//                              or -- migrate:allow drop-index
//                              or -- migrate:allow drop-constraint
// This keeps the guard strict by default while still letting you opt in for
// additive-but-reshaping migrations in a controlled way.
function checkDestructive(rawSql, filename) {
  const declared = new Set(
    [...rawSql.matchAll(/--\s*migrate:allow\s+([\w,-]+)/gi)]
      .flatMap((m) => m[1].split(',').map((s) => s.trim().toLowerCase())),
  )

  // Strip all comments before checking for statements
  const sql = rawSql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '')

  const checks = [
    { pattern: /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i, key: null,
      label: 'DROP TABLE / DATABASE / SCHEMA' },
    { pattern: /\bTRUNCATE\b/i,  key: null, label: 'TRUNCATE' },
    { pattern: /\bDELETE\s+FROM\b/i, key: null, label: 'DELETE FROM' },
    { pattern: /\bRENAME\s+TABLE\b/i, key: null, label: 'RENAME TABLE' },
    { pattern: /\bDROP\s+COLUMN\b/i, key: 'drop-column', label: 'DROP COLUMN' },
    { pattern: /\bDROP\s+(INDEX|CONSTRAINT|FOREIGN\s+KEY)\b/i, key: 'drop-index',
      label: 'DROP INDEX / CONSTRAINT' },
  ]

  for (const { pattern, key, label } of checks) {
    if (pattern.test(sql) && (key === null || !declared.has(key))) {
      throw new Error(
        `${filename} contains "${label}" which is not allowed.\n` +
        (key ? `  To opt in, add this line near the top of the file:\n  -- migrate:allow ${key}` : ''),
      )
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
const client = createScriptClient()
await client.connect()
console.log(`PostgreSQL migration runner`)
console.log(`Database: ${client.connectionParameters?.host || 'Neon'}`)

try {
  // Create the migrations tracking table if it does not exist yet.
  // NOTE: In PostgreSQL, DDL IS transactional. A failed migration is rolled back completely.
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    VARCHAR(10)  NOT NULL,
      name       VARCHAR(150) NOT NULL,
      checksum   CHAR(64)     NOT NULL,
      applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      PRIMARY KEY (version)
    )
  `)

  const { rows: appliedRows } = await client.query(
    'SELECT version, checksum FROM schema_migrations ORDER BY version',
  )
  const applied = new Map(appliedRows.map((r) => [r.version, r.checksum]))

  const files = (await fs.readdir(migrationsDir))
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort()

  let ran = 0
  for (const file of files) {
    const version = file.slice(0, 3)
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8')
    const checksum = crypto.createHash('sha256').update(sql).digest('hex')

    if (applied.has(version)) {
      const unchanged = applied.get(version) === checksum
      console.log(
        `  [skip] ${file} — already applied` +
        (unchanged ? '' : '  ⚠ file changed since it was applied — create a NEW migration instead'),
      )
      continue
    }
    if (statusOnly) { console.log(`  [pending] ${file}`); continue }

    checkDestructive(sql, file)

    console.log(`  [run]  ${file}`)
    // Wrap each migration in a transaction. PostgreSQL supports transactional DDL,
    // so a failure rolls back the whole migration — no partial state left behind.
    await client.query('BEGIN')
    try {
      await client.query(sql)
      await client.query(
        'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
        [version, file, checksum],
      )
      await client.query('COMMIT')
      ran++
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  }

  console.log(
    statusOnly
      ? 'Status check complete.'
      : `Done. ${ran} migration(s) applied, ${files.length - ran} already up to date.`,
  )
} catch (err) {
  console.error(`\nMigration failed: ${err.message}`)
  process.exitCode = 1
} finally {
  await client.end()
}
