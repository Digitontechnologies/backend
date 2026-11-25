import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { query } from '../config/db.js'
import { signJwt } from '../lib/jwt.js'
import { logAudit } from '../lib/audit.js'
import { requireAuth } from '../middleware/auth.js'
import { createRateLimiter } from '../middleware/rateLimit.js'
import { HttpError } from '../middleware/errorHandler.js'

const router = Router()

const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: 'Too many login attempts. Please wait 15 minutes and try again.',
})

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  const ip = req.ip || req.socket?.remoteAddress || null

  if (!email || !password) {
    throw new HttpError(400, 'Email and password are required', 'VALIDATION_ERROR')
  }

  const rows = await query(
    `SELECT u.id, u.full_name, u.email, u.password_hash, u.is_active,
            COALESCE(ARRAY_AGG(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r       ON r.id = ur.role_id
      WHERE LOWER(u.email) = $1
      GROUP BY u.id`,
    [email],
  )

  const user = rows[0]
  if (!user || !user.is_active) {
    await logAudit({ action: 'login_failed', entityType: 'auth', entityId: email, ip })
    throw new HttpError(401, 'Invalid email or password', 'INVALID_CREDENTIALS')
  }

  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) {
    await logAudit({ userId: user.id, action: 'login_failed', entityType: 'auth', entityId: String(user.id), ip })
    throw new HttpError(401, 'Invalid email or password', 'INVALID_CREDENTIALS')
  }

  await query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id])

  const token = signJwt({ sub: user.id, email: user.email })
  await logAudit({ userId: user.id, action: 'login', entityType: 'auth', entityId: String(user.id), ip })

  res.json({
    token,
    user: {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      roles: Array.isArray(user.roles) ? user.roles : [],
    },
  })
})

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', requireAuth, async (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || null
  await logAudit({ userId: req.user.id, action: 'logout', entityType: 'auth', entityId: String(req.user.id), ip })
  res.json({ ok: true })
})

// ── POST /api/auth/change-password ────────────────────────────────────────────
router.post('/change-password', requireAuth, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '')
  const newPassword = String(req.body?.newPassword || '')

  if (!currentPassword || newPassword.length < 8) {
    throw new HttpError(400, 'Current password and a new password (min 8 chars) are required', 'VALIDATION_ERROR')
  }

  const rows = await query(`SELECT password_hash FROM users WHERE id = $1`, [req.user.id])
  if (!rows.length) throw new HttpError(404, 'User not found', 'NOT_FOUND')

  const valid = await bcrypt.compare(currentPassword, rows[0].password_hash)
  if (!valid) throw new HttpError(401, 'Current password is incorrect', 'INVALID_CREDENTIALS')

  const newHash = await bcrypt.hash(newPassword, 12)
  await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [newHash, req.user.id])

  await logAudit({
    userId: req.user.id,
    action: 'change_password',
    entityType: 'user',
    entityId: String(req.user.id),
    ip: req.ip || req.socket?.remoteAddress || null,
  })

  res.json({ ok: true, message: 'Password updated successfully' })
})

export default router
