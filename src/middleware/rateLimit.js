import { HttpError } from './errorHandler.js'

/**
 * Simple in-memory sliding-window rate limiter keyed by client IP.
 * Suitable for single-instance Express servers (auth brute-force protection).
 */
export function createRateLimiter({ windowMs = 15 * 60 * 1000, max = 15, message = 'Too many attempts. Please try again later.' } = {}) {
  const hits = new Map()

  // Periodic cleanup to avoid unbounded memory growth
  const timer = setInterval(() => {
    const cutoff = Date.now() - windowMs
    for (const [key, timestamps] of hits.entries()) {
      const fresh = timestamps.filter((t) => t > cutoff)
      if (fresh.length === 0) hits.delete(key)
      else hits.set(key, fresh)
    }
  }, Math.min(windowMs, 5 * 60 * 1000))
  timer.unref?.()

  return (req, res, next) => {
    const key = req.ip || req.socket?.remoteAddress || 'unknown'
    const now = Date.now()
    const cutoff = now - windowMs
    const recent = (hits.get(key) || []).filter((t) => t > cutoff)

    if (recent.length >= max) {
      const retryAfterSec = Math.ceil((recent[0] + windowMs - now) / 1000)
      res.setHeader('Retry-After', String(Math.max(1, retryAfterSec)))
      return next(new HttpError(429, message, 'RATE_LIMITED'))
    }

    recent.push(now)
    hits.set(key, recent)
    next()
  }
}
