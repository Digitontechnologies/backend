import { query } from '../config/db.js'

let ensured = false

/**
 * Idempotently extends the `enquiries` table with public registration fields
 * and expands the status CHECK constraint to include interested/approved/rejected.
 */
export async function ensureEnquirySchema() {
  if (ensured) return
  await query(`
    ALTER TABLE enquiries
      ADD COLUMN IF NOT EXISTS father_name VARCHAR(120),
      ADD COLUMN IF NOT EXISTS alt_phone VARCHAR(20),
      ADD COLUMN IF NOT EXISTS gender VARCHAR(20),
      ADD COLUMN IF NOT EXISTS address TEXT,
      ADD COLUMN IF NOT EXISTS qualification VARCHAR(120),
      ADD COLUMN IF NOT EXISTS department VARCHAR(120),
      ADD COLUMN IF NOT EXISTS institution VARCHAR(190),
      ADD COLUMN IF NOT EXISTS year_of_passing VARCHAR(20),
      ADD COLUMN IF NOT EXISTS percentage VARCHAR(20),
      ADD COLUMN IF NOT EXISTS purpose VARCHAR(40),
      ADD COLUMN IF NOT EXISTS course_interest VARCHAR(150),
      ADD COLUMN IF NOT EXISTS current_status VARCHAR(50),
      ADD COLUMN IF NOT EXISTS experience_years VARCHAR(30),
      ADD COLUMN IF NOT EXISTS company_name VARCHAR(150),
      ADD COLUMN IF NOT EXISTS referral_name VARCHAR(120),
      ADD COLUMN IF NOT EXISTS photo_url TEXT,
      ADD COLUMN IF NOT EXISTS declaration_accepted BOOLEAN NOT NULL DEFAULT FALSE
  `)
  await query(`ALTER TABLE enquiries DROP CONSTRAINT IF EXISTS enquiries_status_check`)
  await query(`
    ALTER TABLE enquiries
      ADD CONSTRAINT enquiries_status_check
      CHECK (status IN ('new', 'contacted', 'follow_up', 'interested', 'approved', 'rejected', 'converted', 'lost'))
  `)
  ensured = true
}
