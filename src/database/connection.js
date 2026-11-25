import mysql from 'mysql2/promise'
import { env } from '../config/env.js'

/**
 * A dedicated (non-pooled) connection for migrations and seeds.
 * multipleStatements lets one .sql file contain many statements. It is only enabled
 * here, never on the application pool, so normal API queries stay injection-safe.
 */
export function createScriptConnection() {
  return mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.database,
    multipleStatements: true,
    charset: 'utf8mb4',
    dateStrings: true,
  })
}
