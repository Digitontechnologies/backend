import { query } from '../config/db.js'

export const DEFAULT_RECEIPT_TERMS = [
  'Fees once paid are strictly non-refundable.',
  'Course fees must be paid as per the agreed payment schedule.',
  'Students are responsible for clearing all pending fees within the specified due date.',
  'Please retain this receipt for future reference.',
  'For any payment-related queries, contact the institute administration.',
]

export const DEFAULT_BRANCH_NAME = 'Main Branch'

let ensured = false
async function ensureSettingsTable() {
  if (ensured) return
  await query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  ensured = true
}

export async function getAppSettings() {
  await ensureSettingsTable()
  const rows = await query(`SELECT key, value FROM app_settings WHERE key IN ('receipt_terms', 'branch_name')`)
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const receiptTerms = Array.isArray(map.receipt_terms) && map.receipt_terms.length > 0
    ? map.receipt_terms.map((t) => String(t).trim()).filter(Boolean)
    : DEFAULT_RECEIPT_TERMS
  const branchName = typeof map.branch_name === 'string' && map.branch_name.trim()
    ? map.branch_name.trim()
    : DEFAULT_BRANCH_NAME

  return { receiptTerms, branchName }
}

export async function saveAppSettings({ receiptTerms, branchName }) {
  await ensureSettingsTable()
  if (Array.isArray(receiptTerms)) {
    const cleaned = receiptTerms.map((t) => String(t).trim()).filter(Boolean)
    await query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('receipt_terms', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(cleaned.length ? cleaned : DEFAULT_RECEIPT_TERMS)],
    )
  }
  if (typeof branchName === 'string' && branchName.trim()) {
    await query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('branch_name', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(branchName.trim())],
    )
  }
  return getAppSettings()
}
