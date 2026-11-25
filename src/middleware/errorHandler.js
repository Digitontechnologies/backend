import { env } from '../config/env.js'

export class HttpError extends Error {
  constructor(status, message, code = 'ERROR') {
    super(message)
    this.status = status
    this.code = code
  }
}

export function notFound(req, _res, next) {
  next(new HttpError(404, `Route not found: ${req.method} ${req.originalUrl}`, 'NOT_FOUND'))
}

// Friendly messages for PostgreSQL / pg driver errors. Never leaks credentials.
const PG_ERRORS = {
  // pg driver error codes (SQLSTATE codes from PostgreSQL)
  '28P01': [503, 'PostgreSQL rejected the credentials. Check DATABASE_URL in backend/.env.'],
  '3D000': [503, 'The PostgreSQL database does not exist. Check DATABASE_URL in backend/.env.'],
  '57P01': [503, 'The PostgreSQL server closed the connection unexpectedly. Try again.'],
  '53300': [503, 'Too many PostgreSQL connections. The connection pool is exhausted.'],
  // Data / constraint errors
  '23505': [409, 'A record with this unique value (such as email or code) already exists.'],
  '23503': [400, 'Referenced record does not exist or cannot be removed while still in use.'],
  '22001': [400, 'One of the entered values is too long for its database field.'],
  // Node.js network errors
  ECONNREFUSED: [503, 'Cannot reach the database server. Check your DATABASE_URL and network.'],
  ENOTFOUND:    [503, 'Database host not found. Check the hostname in DATABASE_URL.'],
  ETIMEDOUT:    [503, 'Connection to the database timed out. Check your DATABASE_URL and firewall.'],
  ECONNRESET:   [503, 'The database connection was reset. Try again.'],
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  let status = err.status || 500
  let message = err.message || 'Internal server error'
  let code = err.code || 'INTERNAL_ERROR'

  // pg errors expose the SQLSTATE in err.code; network errors use Node.js codes
  const known = PG_ERRORS[err.code]
  if (known) { [status, message] = known }

  if (status >= 500) console.error(`[error] ${code}: ${err.message}`)

  res.status(status).json({
    status: 'error',
    code,
    message: status >= 500 && !known && env.nodeEnv === 'production' ? 'Internal server error' : message,
  })
}
