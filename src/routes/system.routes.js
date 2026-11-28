import { Router } from 'express'
import { query } from '../config/db.js'
import { configProblems, env } from '../config/env.js'
import { HttpError } from '../middleware/errorHandler.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { getAppSettings, saveAppSettings } from '../lib/settings.js'

const router = Router()

// GET /api/health — is the API process alive? (does not touch the database)
router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'institute-pro-api',
    environment: env.nodeEnv,
    database: 'postgresql',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  })
})

// GET /api/db-test — can the API connect to Neon PostgreSQL? (requires auth)
router.get('/db-test', requireAuth, async (_req, res) => {
  const problems = configProblems()
  if (problems.length) {
    throw new HttpError(
      503,
      `Database is not configured: ${problems.join('; ')}. Fix backend/.env and restart.`,
      'DB_NOT_CONFIGURED',
    )
  }
  const rows = await query(
    'SELECT current_database() AS database, version() AS pg_version, NOW() AS server_time',
  )
  const row = rows[0]
  res.json({
    status: 'ok',
    message: 'Connected to Neon PostgreSQL successfully',
    database: row.database,
    postgresVersion: row.pg_version.split(' ').slice(0, 2).join(' '),
    serverTime: row.server_time,
  })
})

// GET /api/settings — fetch editable receipt terms & branch settings (authenticated)
router.get('/settings', requireAuth, async (_req, res) => {
  res.json(await getAppSettings())
})

// PUT /api/settings — update receipt terms & branch settings (admin only)
router.put('/settings', requireAuth, requireRole('admin'), async (req, res) => {
  const { receiptTerms, branchName } = req.body || {}
  res.json(await saveAppSettings({ receiptTerms, branchName }))
})

export default router
