import { app } from './app.js'
import { pool } from './config/db.js'
import { configProblems, describeDb, env } from './config/env.js'

const problems = configProblems()
if (problems.length) {
  console.error('Configuration problems detected:')
  problems.forEach((p) => console.error(`  - ${p}`))
  process.exit(1)
}

const server = app.listen(env.port, async () => {
  console.log(`Institute Pro API running at http://localhost:${env.port}`)
  console.log(`  Database: ${describeDb()}`)

  try {
    await pool.query('SELECT 1')
    console.log('  PostgreSQL (Neon) connection: OK')
  } catch (err) {
    console.error(`  PostgreSQL connection: FAILED — ${err.message}`)
  }
})

server.on('error', (err) => {
  console.error(
    err.code === 'EADDRINUSE'
      ? `Port ${env.port} is already in use. Change PORT in backend/.env.`
      : err,
  )
  process.exit(1)
})

async function shutdown(signal) {
  console.log(`\n${signal} received, shutting down gracefully...`)
  server.close(async () => {
    await pool.end().catch(() => {})
    process.exit(0)
  })
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))