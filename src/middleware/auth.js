import { query } from '../config/db.js'
import { verifyJwt } from '../lib/jwt.js'
import { HttpError } from './errorHandler.js'

/**
 * Authenticates the request using `Authorization: Bearer <jwt>`.
 * Always loads the user's current active status and roles from PostgreSQL
 * (never trusts client-supplied role claims).
 */
export async function requireAuth(req, _res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) {
    return next(new HttpError(401, 'Authentication required', 'UNAUTHORIZED'))
  }

  const payload = verifyJwt(token)
  if (!payload || !payload.sub) {
    return next(new HttpError(401, 'Invalid or expired session. Please sign in again.', 'INVALID_TOKEN'))
  }

  try {
    const rows = await query(
      `SELECT u.id, u.full_name, u.email, u.is_active,
              COALESCE(ARRAY_AGG(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r       ON r.id = ur.role_id
        WHERE u.id = $1
        GROUP BY u.id`,
      [payload.sub],
    )

    const user = rows[0]
    if (!user || !user.is_active) {
      return next(new HttpError(401, 'Account is disabled or no longer exists', 'ACCOUNT_DISABLED'))
    }

    req.user = {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      roles: Array.isArray(user.roles) ? user.roles : [],
    }
    next()
  } catch (err) {
    next(err)
  }
}

/**
 * Role-based access control middleware.
 * Must be placed after `requireAuth`.
 * Admin role always has access; otherwise user must hold at least one allowed role.
 */
export function requireRole(...allowedRoles) {
  return (req, _res, next) => {
    const userRoles = req.user?.roles || []
    if (userRoles.includes('admin') || allowedRoles.some((r) => userRoles.includes(r))) {
      return next()
    }
    next(new HttpError(403, 'You do not have permission to perform this action', 'FORBIDDEN'))
  }
}
