import { Router } from 'express'
import { query } from '../config/db.js'
import { HttpError } from '../middleware/errorHandler.js'
import { ensureEnquirySchema } from '../lib/enquirySchema.js'

const router = Router()

const clean = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

// GET /api/public/courses — public list of active courses for registration dropdown
router.get('/courses', async (_req, res) => {
  const rows = await query(
    `SELECT name, base_fee FROM courses WHERE deleted_at IS NULL AND status = 'active' ORDER BY name`,
  )
  res.json(rows.map((r) => ({ name: r.name, fee: Number(r.base_fee) })))
})

// POST /api/public/enquiries — public student registration & enquiry submission
router.post('/enquiries', async (req, res) => {
  await ensureEnquirySchema()
  const b = req.body || {}

  const name = clean(b.name, 120)
  const fatherName = clean(b.fatherName, 120)
  const phone = clean(b.phone, 20)
  const altPhone = clean(b.altPhone, 20)
  const email = clean(b.email, 190).toLowerCase()
  const gender = clean(b.gender, 20)
  const address = clean(b.address, 500)

  const qualification = clean(b.qualification, 120)
  const department = clean(b.department, 120)
  const institution = clean(b.institution, 190)
  const yearOfPassing = clean(b.yearOfPassing, 20)
  const percentage = clean(b.percentage, 20)

  const purpose = clean(b.purpose, 40)
  const courseInterest = clean(b.course, 150)
  const currentStatus = clean(b.currentStatus, 50)
  const experienceYears = clean(b.experienceYears, 30)
  const companyName = clean(b.companyName, 150)

  const sourceRaw = clean(b.source, 50) || 'website'
  const source = sourceRaw.toLowerCase().replace(/[\s-]+/g, '_')
  const referralName = clean(b.referralName, 120)
  const rawPhoto = typeof b.photo === 'string' && b.photo.startsWith('data:image/') ? b.photo.slice(0, 750000) : ''
  const declarationAccepted = Boolean(b.declarationAccepted)

  if (!name || !phone || !email || !gender || !address || !qualification || !purpose || !courseInterest || !currentStatus) {
    throw new HttpError(400, 'Please fill in all required fields.', 'VALIDATION_ERROR')
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Please enter a valid email address.', 'INVALID_EMAIL')
  }
  if (phone.replace(/\D/g, '').length < 10) {
    throw new HttpError(400, 'Please enter a valid 10-digit mobile number.', 'INVALID_PHONE')
  }
  if (!declarationAccepted) {
    throw new HttpError(400, 'Please accept the declaration before submitting.', 'DECLARATION_REQUIRED')
  }

  // Prevent duplicate active enquiries by phone or email
  const dup = await query(
    `SELECT id FROM enquiries
      WHERE (phone = $1 OR LOWER(email) = $2)
        AND status NOT IN ('rejected', 'lost')
      LIMIT 1`,
    [phone, email],
  )
  if (dup.length > 0) {
    throw new HttpError(409, 'An enquiry with this mobile number or email already exists.', 'DUPLICATE_ENQUIRY')
  }

  const courseRow = (await query(
    `SELECT id FROM courses WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL LIMIT 1`,
    [courseInterest],
  ))[0]

  const row = (await query(`
    INSERT INTO enquiries (
      name, father_name, phone, alt_phone, email, gender, address,
      qualification, department, institution, year_of_passing, percentage,
      purpose, course_id, course_interest, current_status, experience_years, company_name,
      source, referral_name, photo_url, declaration_accepted, status
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,
      $8,$9,$10,$11,$12,
      $13,$14,$15,$16,$17,$18,
      $19,$20,$21,$22,'new'
    )
    RETURNING id
  `, [
    name, fatherName || null, phone, altPhone || null, email, gender, address,
    qualification, department || null, institution || null, yearOfPassing || null, percentage || null,
    purpose, courseRow?.id ?? null, courseInterest, currentStatus, experienceYears || null, companyName || null,
    source, referralName || null, rawPhoto || null, declarationAccepted,
  ]))[0]

  res.status(201).json({
    id: `ENQ-${row.id}`,
    status: 'New',
    message: 'Enquiry submitted successfully',
  })
})

export default router
