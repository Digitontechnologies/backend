import { query } from '../config/db.js'

/**
 * Record an event in the audit_logs table.
 * Never throws so an audit write failure cannot break the main request.
 */
export async function logAudit({
  userId = null,
  action,
  entityType,
  entityId,
  oldValues = null,
  newValues = null,
  ip = null,
}) {
  try {
    await query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        userId,
        String(action).slice(0, 30),
        String(entityType).slice(0, 60),
        String(entityId ?? '').slice(0, 40),
        oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null,
        ip ? String(ip).slice(0, 45) : null,
      ],
    )
  } catch (err) {
    console.error('[audit] failed to write audit_log:', err.message)
  }
}

/**
 * Express middleware that logs POST/PUT/DELETE mutations on a resource
 * after the response finishes with a 2xx status.
 */
export function auditMutations(entityType) {
  const methodToAction = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' }
  return (req, res, next) => {
    const action = methodToAction[req.method]
    if (!action) return next()

    const origJson = res.json.bind(res)
    let responseBody = null
    res.json = (body) => {
      responseBody = body
      return origJson(body)
    }

    res.on('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return
      const entityId = req.params?.id || responseBody?.id || responseBody?.receiptNo || 'batch'
      // Never log passwords or sensitive secrets
      const sanitized = req.body && typeof req.body === 'object' ? { ...req.body } : null
      if (sanitized) {
        delete sanitized.password
        delete sanitized.currentPassword
        delete sanitized.newPassword
        delete sanitized.photo
      }
      logAudit({
        userId: req.user?.id ?? null,
        action,
        entityType,
        entityId,
        newValues: action === 'delete' ? null : sanitized,
        ip: req.ip || req.socket?.remoteAddress || null,
      })
    })

    next()
  }
}
