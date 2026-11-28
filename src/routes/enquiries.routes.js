import crypto from 'node:crypto'
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { query, pool } from '../config/db.js'
import { HttpError } from '../middleware/errorHandler.js'
import { ensureEnquirySchema } from '../lib/enquirySchema.js'
import { addDays, kolkataToday } from '../lib/autoInvoices.js'

const router = Router()
const titleCase = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s

const SOURCE_MAP = {
  website: 'Website',
  walk_in: 'Walk-in',
  social_media: 'Social Media',
  instagram: 'Instagram',
  friend: 'Friend',
  referral: 'Referral',
  google_ads: 'Google Ads',
}

const STATUS_MAP = {
  new: 'New',
  contacted: 'Contacted',
  follow_up: 'Follow-up',
  interested: 'Interested',
  approved: 'Approved',
  rejected: 'Rejected',
  converted: 'Converted',
  lost: 'Lost',
}

function shape(r) {
  return {
    id: `ENQ-${r.id}`,
    name: r.name,
    fatherName: r.father_name || '',
    phone: r.phone,
    altPhone: r.alt_phone || '',
    email: r.email || '',
    gender: r.gender || '',
    address: r.address || '',
    qualification: r.qualification || '',
    department: r.department || '',
    institution: r.institution || '',
    yearOfPassing: r.year_of_passing || '',
    percentage: r.percentage || '',
    purpose: r.purpose || '',
    course: r.course_name || r.course_interest || '',
    currentStatus: r.current_status || '',
    experienceYears: r.experience_years || '',
    companyName: r.company_name || '',
    source: SOURCE_MAP[r.source] ?? titleCase(r.source?.replace(/_/g, ' ')),
    referralName: r.referral_name || '',
    date: r.created_at?.toISOString?.().slice(0, 10) ?? '',
    status: STATUS_MAP[r.status] ?? titleCase(r.status?.replace(/_/g, ' ')),
    notes: r.notes || '',
    photo: r.photo_url || '',
    convertedStudentId: r.converted_student_id || null,
    _dbId: r.id,
  }
}

router.get('/', async (_req, res) => {
  await ensureEnquirySchema()
  const rows = await query(`
    SELECT eq.*, c.name AS course_name
      FROM enquiries eq
      LEFT JOIN courses c ON c.id = eq.course_id
     ORDER BY eq.created_at DESC
  `)
  res.json(rows.map(shape))
})

router.get('/:id', async (req, res) => {
  await ensureEnquirySchema()
  const dbId = (req.params.id || '').replace('ENQ-', '')
  const rows = await query(`
    SELECT eq.*, c.name AS course_name
      FROM enquiries eq LEFT JOIN courses c ON c.id = eq.course_id
     WHERE eq.id = $1
  `, [dbId])
  if (!rows.length) throw new HttpError(404, 'Enquiry not found', 'NOT_FOUND')
  res.json(shape(rows[0]))
})

router.post('/', async (req, res) => {
  await ensureEnquirySchema()
  const b = req.body
  const course = (await query(`SELECT id FROM courses WHERE name = $1 AND deleted_at IS NULL`, [b.course]))[0]
  const row = (await query(`
    INSERT INTO enquiries (name, phone, email, course_id, course_interest, source, status, notes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id
  `, [
    b.name, b.phone, b.email || null,
    course?.id ?? null, b.course || null,
    (b.source || 'walk_in').toLowerCase().replace(/[\s-]+/g, '_'),
    (b.status || 'new').toLowerCase().replace(/[\s-]+/g, '_'),
    b.notes || null,
  ]))[0]
  res.status(201).json({ id: `ENQ-${row.id}`, _dbId: row.id })
})

router.put('/:id', async (req, res) => {
  await ensureEnquirySchema()
  const b = req.body
  const dbId = (req.params.id || '').replace('ENQ-', '')
  const course = (await query(`SELECT id FROM courses WHERE name = $1 AND deleted_at IS NULL`, [b.course]))[0]
  const result = await query(`
    UPDATE enquiries
       SET name=$1, phone=$2, email=$3, course_id=$4, course_interest=$5,
           source=$6, status=$7, notes=$8
     WHERE id=$9 RETURNING id
  `, [
    b.name, b.phone, b.email || null, course?.id ?? null, b.course || null,
    (b.source || 'walk_in').toLowerCase().replace(/[\s-]+/g, '_'),
    (b.status || 'new').toLowerCase().replace(/[\s-]+/g, '_'),
    b.notes || null, dbId,
  ])
  if (!result.length) throw new HttpError(404, 'Enquiry not found', 'NOT_FOUND')
  res.json({ ok: true })
})

// ── POST /api/enquiries/:id/approve-admit ─────────────────────────────────────
// Converts an enquiry into a full student, enrollment, fee record, and optional initial receipt.
router.post('/:id/approve-admit', async (req, res) => {
  await ensureEnquirySchema()
  const dbId = Number((req.params.id || '').replace('ENQ-', ''))
  if (!dbId) throw new HttpError(400, 'Invalid enquiry ID', 'INVALID_ID')

  const b = req.body || {}
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const eq = (await client.query(`SELECT * FROM enquiries WHERE id = $1 FOR UPDATE`, [dbId])).rows[0]
    if (!eq) throw new HttpError(404, 'Enquiry not found', 'NOT_FOUND')
    if (eq.status === 'approved' || eq.converted_student_id) {
      throw new HttpError(409, 'This enquiry has already been approved and admitted.', 'ALREADY_APPROVED')
    }

    const fullName = (b.name || eq.name || '').trim()
    const phone = (b.phone || eq.phone || '').trim()
    const email = (b.email || eq.email || '').trim().toLowerCase()
    const gender = (b.gender || eq.gender || 'male').toLowerCase()
    const address = (b.address || eq.address || '').trim()
    const paymentDate = b.paymentDate || kolkataToday()
    const totalFee = Math.max(0, Number(b.totalFee || 0))
    const initialPaid = Math.max(0, Number(b.initialPaid || 0))
    const paymentMethod = (b.paymentMethod || 'cash').toLowerCase().replace(/\s+/g, '_')

    if (!fullName || !phone || !email || !b.course || !b.batch || totalFee <= 0) {
      throw new HttpError(400, 'Student details, course, batch, and total fee are required.', 'VALIDATION_ERROR')
    }
    if (initialPaid > totalFee) {
      throw new HttpError(400, 'Initial paid amount cannot exceed total course fee.', 'INVALID_AMOUNT')
    }

    // Prevent duplicate student creation
    const dupStudent = (await client.query(
      `SELECT student_no FROM students WHERE (LOWER(email) = $1 OR phone = $2) AND deleted_at IS NULL LIMIT 1`,
      [email, phone],
    )).rows[0]
    if (dupStudent) {
      throw new HttpError(409, `Student already exists (${dupStudent.student_no}) with this email or mobile.`, 'DUPLICATE_STUDENT')
    }

    const course = (await client.query(
      `SELECT id FROM courses WHERE name = $1 AND deleted_at IS NULL LIMIT 1`,
      [b.course],
    )).rows[0]
    if (!course) throw new HttpError(400, `Course "${b.course}" not found`, 'INVALID_COURSE')

    const batch = (await client.query(
      `SELECT id FROM batches WHERE name = $1 LIMIT 1`,
      [b.batch],
    )).rows[0]
    if (!batch) throw new HttpError(400, `Batch "${b.batch}" not found`, 'INVALID_BATCH')

    // Create/reuse user account for student
    await client.query(
      `INSERT INTO roles (name, description) VALUES ('student', 'Student portal access') ON CONFLICT (name) DO NOTHING`,
    )
    let userId = null
    const existingUser = (await client.query(`SELECT id FROM users WHERE LOWER(email) = $1`, [email])).rows[0]
    if (existingUser) {
      userId = existingUser.id
    } else {
      const hash = await bcrypt.hash(process.env.SEED_DEFAULT_PASSWORD || crypto.randomBytes(12).toString('hex'), 12)
      const uRow = (await client.query(
        `INSERT INTO users (full_name, email, phone, password_hash, is_active) VALUES ($1,$2,$3,$4,TRUE) RETURNING id`,
        [fullName, email, phone, hash],
      )).rows[0]
      userId = uRow.id
    }
    await client.query(
      `INSERT INTO user_roles (user_id, role_id) SELECT $1, r.id FROM roles r WHERE r.name = 'student' ON CONFLICT DO NOTHING`,
      [userId],
    )

    // Generate unique student_no
    const year = Number(paymentDate.slice(0, 4)) || new Date().getFullYear()
    const stuSeq = (await client.query(
      `INSERT INTO document_sequences (prefix, year, next_value)
       VALUES ('STU', $1, 1)
       ON CONFLICT (prefix, year) DO UPDATE SET next_value = document_sequences.next_value + 1, updated_at = NOW()
       RETURNING next_value`,
      [year],
    )).rows[0]
    const studentNo = `STU-${year}-${stuSeq.next_value.toString().padStart(4, '0')}`

    const parts = fullName.split(/\s+/)
    const firstName = parts[0] || fullName
    const lastName = parts.slice(1).join(' ') || null

    const sRow = (await client.query(`
      INSERT INTO students (
        student_no, user_id, first_name, last_name, date_of_birth, gender,
        phone, whatsapp, email, address, parent_name, parent_phone,
        photo_url, admission_date, status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'active')
      RETURNING id
    `, [
      studentNo, userId, firstName, lastName,
      '2000-01-01', ['male', 'female', 'other'].includes(gender) ? gender : 'other',
      phone, eq.alt_phone || phone, email, address || '—',
      eq.father_name || '—', eq.alt_phone || phone,
      eq.photo_url || null,
      paymentDate,
    ])).rows[0]

    // Create enrollment
    const eRow = (await client.query(`
      INSERT INTO enrollments (student_id, course_id, batch_id, enrolled_on, total_fee, discount_amount, status)
      VALUES ($1,$2,$3,$4,$5,0,'active')
      RETURNING id
    `, [sRow.id, course.id, batch.id, paymentDate, totalFee])).rows[0]

    // Create installment (due 14 days after initial payment if pending remains)
    const nextDueDate = initialPaid < totalFee ? addDays(paymentDate, 14) : paymentDate
    const instStatus = initialPaid >= totalFee ? 'paid' : initialPaid > 0 ? 'partial' : 'pending'
    const instRow = (await client.query(`
      INSERT INTO student_fee_installments (enrollment_id, installment_no, due_date, amount_due, amount_paid, status)
      VALUES ($1, 1, $2, $3, $4, $5)
      RETURNING id
    `, [eRow.id, nextDueDate, totalFee, initialPaid, instStatus])).rows[0]

    let receiptNo = null
    if (initialPaid > 0) {
      const payRow = (await client.query(`
        INSERT INTO payments (student_id, payment_date, amount, method, remarks, status)
        VALUES ($1,$2,$3,$4,'Initial admission payment','completed')
        RETURNING id
      `, [sRow.id, paymentDate, initialPaid, paymentMethod])).rows[0]

      await client.query(
        `INSERT INTO payment_allocations (payment_id, installment_id, amount) VALUES ($1,$2,$3)`,
        [payRow.id, instRow.id, initialPaid],
      )

      const rcpSeq = (await client.query(
        `INSERT INTO document_sequences (prefix, year, next_value)
         VALUES ('RCP', $1, 1)
         ON CONFLICT (prefix, year) DO UPDATE SET next_value = document_sequences.next_value + 1, updated_at = NOW()
         RETURNING next_value`,
        [year],
      )).rows[0]
      receiptNo = `RCP-${year}-${rcpSeq.next_value.toString().padStart(6, '0')}`
      await client.query(
        `INSERT INTO receipts (receipt_no, payment_id, student_id, amount, status) VALUES ($1,$2,$3,$4,'issued')`,
        [receiptNo, payRow.id, sRow.id, initialPaid],
      )
    }

    // Mark enquiry approved and link to student (preserve history)
    await client.query(
      `UPDATE enquiries SET status = 'approved', converted_student_id = $1, course_id = $2 WHERE id = $3`,
      [sRow.id, course.id, dbId],
    )

    await client.query('COMMIT')
    res.status(201).json({
      ok: true,
      studentId: studentNo,
      feeId: `FEE-${eRow.id}`,
      receiptNo,
      pendingAmount: Math.max(0, totalFee - initialPaid),
    })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

router.delete('/:id', async (req, res) => {
  const dbId = (req.params.id || '').replace('ENQ-', '')
  const result = await query(`DELETE FROM enquiries WHERE id = $1 RETURNING id`, [dbId])
  if (!result.length) throw new HttpError(404, 'Enquiry not found', 'NOT_FOUND')
  res.json({ ok: true })
})

export default router
