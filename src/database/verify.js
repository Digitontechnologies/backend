import { configProblems } from '../config/env.js'
import { createScriptConnection } from './connection.js'

if (configProblems().length) { console.error('Fix backend/.env first.'); process.exit(1) }
const conn = await createScriptConnection()
try {
  const [tables] = await conn.query(
    `SELECT t.TABLE_NAME AS name, t.ENGINE AS engine, t.TABLE_COLLATION AS collation,
            (SELECT COUNT(*) FROM information_schema.COLUMNS c WHERE c.TABLE_SCHEMA=t.TABLE_SCHEMA AND c.TABLE_NAME=t.TABLE_NAME) AS columns_count,
            (SELECT COUNT(DISTINCT s.INDEX_NAME) FROM information_schema.STATISTICS s WHERE s.TABLE_SCHEMA=t.TABLE_SCHEMA AND s.TABLE_NAME=t.TABLE_NAME) AS indexes_count
     FROM information_schema.TABLES t
     WHERE t.TABLE_SCHEMA = DATABASE() AND t.TABLE_TYPE = 'BASE TABLE' ORDER BY t.TABLE_NAME`)
  console.log(`\nTABLES (${tables.length})`)
  console.table(tables)

  const [fks] = await conn.query(
    `SELECT k.TABLE_NAME AS child_table, k.COLUMN_NAME AS column_name, k.REFERENCED_TABLE_NAME AS parent_table,
            k.REFERENCED_COLUMN_NAME AS parent_column, k.CONSTRAINT_NAME AS constraint_name,
            r.DELETE_RULE AS on_delete
     FROM information_schema.KEY_COLUMN_USAGE k
     JOIN information_schema.REFERENTIAL_CONSTRAINTS r
       ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
     WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME`)
  console.log(`\nFOREIGN KEYS (${fks.length})`)
  console.table(fks)

  const [[{ checks }]] = await conn.query(
    `SELECT COUNT(*) AS checks FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'CHECK'`)
  const [[{ uniques }]] = await conn.query(
    `SELECT COUNT(*) AS uniques FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'UNIQUE'`)
  const nonInno = tables.filter((t) => t.engine !== 'InnoDB').map((t) => t.name)
  console.log(`\nSummary: ${tables.length} tables, ${fks.length} foreign keys, ${uniques} unique constraints, ${checks} check constraints.`)
  console.log(nonInno.length ? `NOT InnoDB: ${nonInno.join(', ')}` : 'All tables use InnoDB.')

  const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = "schema_migrations"')
  if (n) { const [m] = await conn.query('SELECT version, name, applied_at FROM schema_migrations ORDER BY version'); console.log('\nAPPLIED MIGRATIONS'); console.table(m) }
} finally {
  await conn.end()
}
