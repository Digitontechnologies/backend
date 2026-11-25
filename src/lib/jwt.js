import crypto from 'node:crypto'

// Use JWT_SECRET from env; in development, fall back to a per-process random key so
// there is never a hardcoded secret in source code.
const DEV_FALLBACK = crypto.randomBytes(32).toString('hex')

function getSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16) {
    return process.env.JWT_SECRET
  }
  if ((process.env.NODE_ENV || 'development') === 'production') {
    throw new Error('JWT_SECRET (min 16 chars) must be set in production')
  }
  return DEV_FALLBACK
}

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

const fromB64url = (str) => {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4))
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString('utf8')
}

/**
 * Sign a standard HS256 JWT.
 * @param {Record<string, unknown>} payload
 * @param {number} [expiresInSeconds=28800] default 8 hours
 */
export function signJwt(payload, expiresInSeconds = 8 * 3600) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + expiresInSeconds }))
  const sig = b64url(crypto.createHmac('sha256', getSecret()).update(`${header}.${body}`).digest())
  return `${header}.${body}.${sig}`
}

/**
 * Verify an HS256 JWT and return its decoded payload, or null if invalid/expired.
 */
export function verifyJwt(token) {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, body, sig] = parts

  const expected = b64url(crypto.createHmac('sha256', getSecret()).update(`${header}.${body}`).digest())
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  try {
    const payload = JSON.parse(fromB64url(body))
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
      return null
    }
    return payload
  } catch {
    return null
  }
}
