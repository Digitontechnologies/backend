import '../config/env.js'
import { createScriptClient } from './pg_script_runner.js'

const client = createScriptClient()
await client.connect()
console.log('Institute Pro — PostgreSQL Schema Verification\n')

try {
  // ── Tables ─────────────────────────────────────────────────────────────────
  const { rows: tables } = await client.query(`
    SELECT
      t.table_name AS name,
      (SELECT COUNT(*) FROM information_schema.columns c
       WHERE c.table_schema = 'public' AND c.table_name = t.table_name) AS columns,
      (SELECT COUNT(*) FROM pg_indexes i
       WHERE i.schemaname = 'public' AND i.tablename = t.table_name) AS indexes
    FROM information_schema.tables t
    WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    ORDER BY t.table_name
  `)
  console.log(`TABLES (${tables.length})`)
  console.table(tables)

  // ── Foreign Keys ───────────────────────────────────────────────────────────
  const { rows: fks } = await client.query(`
    SELECT
      tc.table_name       AS child_table,
      kcu.column_name     AS column_name,
      ccu.table_name      AS parent_table,
      ccu.column_name     AS parent_column,
      tc.constraint_name  AS constraint_name,
      rc.delete_rule      AS on_delete
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = 'public'
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = 'public'
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = 'public'
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    ORDER BY tc.table_name, tc.constraint_name
  `)
  console.log(`\nFOREIGN KEYS (${fks.length})`)
  console.table(fks)

  // ── Unique Constraints ──────────────────────────────────────────────────────
  const { rows: uniques } = await client.query(`
    SELECT table_name, constraint_name
    FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND constraint_type = 'UNIQUE'
    ORDER BY table_name, constraint_name
  `)
  console.log(`\nUNIQUE CONSTRAINTS (${uniques.length})`)
  console.table(uniques)

  // ── Check Constraints ───────────────────────────────────────────────────────
  const { rows: checks } = await client.query(`
    SELECT table_name, constraint_name, check_clause
    FROM information_schema.check_constraints
    JOIN information_schema.table_constraints USING (constraint_name, constraint_schema)
    WHERE constraint_schema = 'public'
    ORDER BY table_name, constraint_name
  `)
  console.log(`\nCHECK CONSTRAINTS (${checks.length})`)
  console.table(checks)

  // ── Applied Migrations ──────────────────────────────────────────────────────
  const { rows: migrations } = await client.query(
    'SELECT version, name, applied_at FROM schema_migrations ORDER BY version',
  ).catch(() => ({ rows: [] }))
  if (migrations.length) {
    console.log('\nAPPLIED MIGRATIONS')
    console.table(migrations)
  } else {
    console.log('\nNo migrations applied yet (schema_migrations table is empty or missing).')
  }

  console.log(
    `\nSummary: ${tables.length} tables, ${fks.length} foreign keys, ` +
    `${uniques.length} unique constraints, ${checks.length} check constraints.`,
  )
} catch (err) {
  console.error(`Verification failed: ${err.message}`)
  process.exitCode = 1
} finally {
  await client.end()
}
