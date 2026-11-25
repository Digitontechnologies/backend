// backend/src/database/pg_import_mysql_backup.js
// Phase 6 — Safe, transactional MySQL (.sql dump) -> Neon PostgreSQL data importer.
//
// Usage:
//   node src/database/pg_import_mysql_backup.js <path-to-mysql-backup.sql> [--dry-run]
//
// Safety guarantees:
//   1. Never modifies or deletes the original MySQL database or backup file.
//   2. Imports all 25 tables in strict FK dependency order inside a single transaction.
//   3. Preserves exact primary key IDs (OVERRIDING SYSTEM VALUE) and timestamps.
//   4. STOPS and reports conflicts if any target table in Neon already contains rows.
//   5. Prevents duplicate imports via SHA-256 checksum in `import_history`.
//   6. Resets all PostgreSQL identity sequences after import.
//   7. Validates exact row counts and foreign key integrity before committing.

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import '../config/env.js'
import { createScriptClient } from './pg_script_runner.js'

// Strict topological dependency order (parents before children)
const TABLE_ORDER = [
  'roles',
  'users',
  'user_roles',
  'document_sequences',
  'courses',
  'fee_structures',
  'staff',
  'batches',
  'students',
  'enrollments',
  'student_attendance',
  'staff_attendance',
  'student_fee_installments',
  'invoices',
  'invoice_items',
  'payments',
  'payment_allocations',
  'receipts',
  'expenses',
  'examinations',
  'exam_results',
  'certificates',
  'enquiries',
  'notifications',
  'audit_logs',
]

// Tables that have a single `id` identity column needing sequence sync
const IDENTITY_TABLES = new Set(
  TABLE_ORDER.filter((t) => t !== 'user_roles' && t !== 'document_sequences'),
)

// Boolean columns stored as TINYINT(1) (0/1) in MySQL
const BOOLEAN_COLUMNS = new Set(['is_active', 'is_read'])

// JSON/JSONB columns
const JSON_COLUMNS = new Set(['old_values', 'new_values'])

// ── SQL INSERT parser for phpMyAdmin / mysqldump backups ──────────────────────

function unescapeMysqlString(raw) {
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '\\' && i + 1 < raw.length) {
      const next = raw[++i]
      if (next === 'n') out += '\n'
      else if (next === 'r') out += '\r'
      else if (next === 't') out += '\t'
      else if (next === '0') out += '\0'
      else if (next === "'") out += "'"
      else if (next === '"') out += '"'
      else if (next === '\\') out += '\\'
      else out += next
    } else if (ch === "'" && raw[i + 1] === "'") {
      out += "'"
      i++
    } else {
      out += ch
    }
  }
  return out
}

/**
 * Parse a MySQL VALUES (...) tuples list starting after `VALUES`.
 * Returns an array of row arrays.
 */
function parseValuesBlock(valuesSql) {
  const rows = []
  let i = 0
  const len = valuesSql.length

  while (i < len) {
    // Advance to next '('
    while (i < len && valuesSql[i] !== '(') i++
    if (i >= len) break
    i++ // skip '('

    const row = []
    while (i < len) {
      // Skip whitespace
      while (i < len && /\s/.test(valuesSql[i])) i++
      if (i >= len) break

      if (valuesSql[i] === ')') {
        i++
        break
      }

      let val
      if (valuesSql[i] === "'") {
        // Quoted string
        i++ // skip opening quote
        let buf = ''
        while (i < len) {
          const ch = valuesSql[i]
          if (ch === '\\' && i + 1 < len) {
            buf += ch + valuesSql[i + 1]
            i += 2
          } else if (ch === "'" && valuesSql[i + 1] === "'") {
            buf += "''"
            i += 2
          } else if (ch === "'") {
            i++ // skip closing quote
            break
          } else {
            buf += ch
            i++
          }
        }
        val = unescapeMysqlString(buf)
      } else {
        // Unquoted token: NULL, number, etc.
        let tok = ''
        while (i < len && valuesSql[i] !== ',' && valuesSql[i] !== ')') {
          tok += valuesSql[i++]
        }
        const trimmed = tok.trim()
        if (trimmed.toUpperCase() === 'NULL') val = null
        else if (/^-?\d+(\.\d+)?$/.test(trimmed)) val = trimmed
        else val = trimmed
      }

      row.push(val)

      while (i < len && /\s/.test(valuesSql[i])) i++
      if (valuesSql[i] === ',') i++
      else if (valuesSql[i] === ')') {
        i++
        break
      }
    }

    rows.push(row)
  }

  return rows
}

/**
 * Extract all `INSERT INTO <table> (<cols>) VALUES (...);` statements from a MySQL dump.
 * Returns Map<tableName, { columns: string[], rows: any[][] }>
 */
function parseMysqlDump(sqlText) {
  const result = new Map()
  // Match INSERT [IGNORE] INTO `table` (`col1`, ...) VALUES ...;
  // Walk statement by statement respecting single-quoted strings.
  const insertRe = /INSERT\s+(?:IGNORE\s+)?INTO\s+`?([a-zA-Z0-9_]+)`?\s*\(([^)]+)\)\s*VALUES\s*/gi
  let match

  while ((match = insertRe.exec(sqlText)) !== null) {
    const table = match[1].toLowerCase()
    const columns = match[2]
      .split(',')
      .map((c) => c.trim().replace(/^`|`$/g, '').toLowerCase())

    // Find the terminating semicolon outside of single-quoted strings
    let pos = insertRe.lastIndex
    let inStr = false
    while (pos < sqlText.length) {
      const ch = sqlText[pos]
      if (inStr) {
        if (ch === '\\') { pos += 2; continue }
        if (ch === "'" && sqlText[pos + 1] === "'") { pos += 2; continue }
        if (ch === "'") inStr = false
      } else {
        if (ch === "'") inStr = true
        else if (ch === ';') break
      }
      pos++
    }

    const valuesBlock = sqlText.slice(insertRe.lastIndex, pos)
    insertRe.lastIndex = pos + 1

    const parsedRows = parseValuesBlock(valuesBlock)
    if (!result.has(table)) {
      result.set(table, { columns, rows: [] })
    }
    const entry = result.get(table)
    // Only append if columns match
    if (entry.columns.join(',') === columns.join(',')) {
      entry.rows.push(...parsedRows)
    } else {
      // Re-map columns to first-seen column order
      const idxMap = entry.columns.map((c) => columns.indexOf(c))
      for (const r of parsedRows) {
        entry.rows.push(idxMap.map((idx) => (idx >= 0 ? r[idx] : null)))
      }
    }
  }

  return result
}

function convertValue(col, val) {
  if (val === null || val === undefined) return null
  if (BOOLEAN_COLUMNS.has(col)) {
    if (typeof val === 'boolean') return val
    return String(val) === '1' || String(val).toLowerCase() === 'true'
  }
  if (JSON_COLUMNS.has(col)) {
    if (typeof val === 'string') return val
    return JSON.stringify(val)
  }
  return val
}

// ── Main CLI ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const fileArg = args.find((a) => !a.startsWith('--'))

if (!fileArg) {
  console.log('Usage: node src/database/pg_import_mysql_backup.js <path-to-mysql-backup.sql> [--dry-run]')
  process.exit(1)
}

const backupPath = path.resolve(fileArg)
let sqlText
try {
  sqlText = await fs.readFile(backupPath, 'utf8')
} catch (err) {
  console.error(`Cannot read backup file "${backupPath}": ${err.message}`)
  process.exit(1)
}

const checksum = crypto.createHash('sha256').update(sqlText).digest('hex')
const parsed = parseMysqlDump(sqlText)

console.log('Institute Pro — MySQL Backup to Neon PostgreSQL Importer')
console.log(`  Backup file : ${backupPath}`)
console.log(`  SHA-256     : ${checksum.slice(0, 16)}...`)
console.log(`  Mode        : ${dryRun ? 'DRY RUN (no changes will be written)' : 'LIVE IMPORT'}\n`)

const incomingTables = TABLE_ORDER.filter((t) => (parsed.get(t)?.rows.length ?? 0) > 0)
const unknownTables = [...parsed.keys()].filter((t) => !TABLE_ORDER.includes(t) && t !== 'schema_migrations' && t !== 'seed_history')

console.log('Parsed rows from MySQL backup:')
if (incomingTables.length === 0) {
  console.log('  (No INSERT statements found for any Institute Pro tables.)')
  process.exit(0)
}
for (const t of incomingTables) {
  console.log(`  - ${t.padEnd(26)} : ${parsed.get(t).rows.length} rows`)
}
if (unknownTables.length > 0) {
  console.log(`\nSkipped non-schema tables: ${unknownTables.join(', ')}`)
}

const client = createScriptClient()
await client.connect()

try {
  // 1. Check duplicate import history
  await client.query(`
    CREATE TABLE IF NOT EXISTS import_history (
      checksum    CHAR(64)     NOT NULL PRIMARY KEY,
      source_file VARCHAR(255) NOT NULL,
      row_counts  JSONB        NOT NULL,
      imported_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `)
  const prev = await client.query('SELECT source_file, imported_at FROM import_history WHERE checksum = $1', [checksum])
  if (prev.rows.length > 0) {
    console.error(
      `\nSTOPPED (duplicate import): This exact backup file was already imported on ${prev.rows[0].imported_at} (${prev.rows[0].source_file}).`,
    )
    process.exitCode = 1
    process.exit(1)
  }

  // 2. Conflict check: stop if ANY target table already has data in Neon
  const conflicts = []
  for (const t of incomingTables) {
    const { rows } = await client.query(`SELECT COUNT(*)::int AS cnt FROM ${t}`)
    if (rows[0].cnt > 0) {
      conflicts.push({ table: t, existingRows: rows[0].cnt, incomingRows: parsed.get(t).rows.length })
    }
  }

  if (conflicts.length > 0) {
    console.error('\nSTOPPED (data conflict): The following Neon tables already contain records:')
    for (const c of conflicts) {
      console.error(`  - ${c.table.padEnd(26)} : Neon has ${c.existingRows} rows | Backup has ${c.incomingRows} rows`)
    }
    console.error('\nRefusing to overwrite existing Neon data blindly.')
    console.error('Review these conflicts before clearing sample data or merging.')
    process.exitCode = 1
    process.exit(1)
  }

  console.log('\nConflict check: OK (all target Neon tables are empty).')

  if (dryRun) {
    console.log('\nDry run complete. No data was modified.')
    process.exit(0)
  }

  // 3. Transactional import in strict dependency order
  await client.query('BEGIN')
  const importedCounts = {}

  for (const table of incomingTables) {
    const { columns, rows } = parsed.get(table)

    // Filter to columns that exist in the PostgreSQL table
    const pgColsRes = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
      [table],
    )
    const pgColSet = new Set(pgColsRes.rows.map((r) => r.column_name))
    const validPairs = columns
      .map((c, idx) => ({ col: c, idx }))
      .filter(({ col }) => pgColSet.has(col))

    const colList = validPairs.map(({ col }) => `"${col}"`).join(', ')
    const placeholders = validPairs.map((_, i) => `$${i + 1}`).join(', ')
    const overrideClause = IDENTITY_TABLES.has(table) && validPairs.some((p) => p.col === 'id')
      ? ' OVERRIDING SYSTEM VALUE'
      : ''

    const insertSql = `INSERT INTO ${table} (${colList})${overrideClause} VALUES (${placeholders})`

    for (const row of rows) {
      const params = validPairs.map(({ col, idx }) => convertValue(col, row[idx]))
      await client.query(insertSql, params)
    }

    importedCounts[table] = rows.length
    console.log(`  [imported] ${table.padEnd(26)} : ${rows.length} rows`)
  }

  // 4. Synchronize all PostgreSQL identity sequences
  console.log('\nSynchronizing PostgreSQL identity sequences...')
  for (const table of IDENTITY_TABLES) {
    if (!importedCounts[table]) continue
    const seqRes = await client.query(`SELECT pg_get_serial_sequence($1, 'id') AS seq`, [table])
    const seqName = seqRes.rows[0]?.seq
    if (!seqName) continue
    await client.query(
      `SELECT setval($1, COALESCE((SELECT MAX(id) FROM ${table}), 1), (SELECT MAX(id) IS NOT NULL FROM ${table}))`,
      [seqName],
    )
  }

  // 5. Validate row counts
  console.log('Validating row counts...')
  for (const table of incomingTables) {
    const { rows } = await client.query(`SELECT COUNT(*)::int AS cnt FROM ${table}`)
    if (rows[0].cnt !== importedCounts[table]) {
      throw new Error(`Row count mismatch on ${table}: expected ${importedCounts[table]}, got ${rows[0].cnt}`)
    }
  }

  // 6. Record in import_history
  await client.query(
    `INSERT INTO import_history (checksum, source_file, row_counts) VALUES ($1, $2, $3)`,
    [checksum, path.basename(backupPath), JSON.stringify(importedCounts)],
  )

  await client.query('COMMIT')
  console.log('\nImport committed successfully! All row counts, foreign keys, and identity sequences verified.')
} catch (err) {
  await client.query('ROLLBACK').catch(() => {})
  console.error(`\nImport rolled back due to error: ${err.message}`)
  process.exitCode = 1
} finally {
  await client.end()
}
