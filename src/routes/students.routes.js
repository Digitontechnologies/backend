import crypto from 'node:crypto'
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { query, pool } from '../config/db.js'
import { HttpError } from '../middleware/errorHandler.js'
import { addDays, kolkataToday, syncEnrollmentInvoice } from '../lib/autoInvoices.js'

const router = Router()

// ── helpers ───────────────────────────────────────────────────────────────────
const titleCase = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s
const fmtMethod = (m) => {
  const map = { upi: 'UPI', cash: 'Cash', card: 'Card', bank_transfer: 'Bank Transfer', cheque: 'Cheque', online: 'Online' }
  return map[(m || '').toLowerCase()] ?? titleCase(m?.replace('_', ' '))
}

/** Build the flat student object the frontend expects from a DB row. */
function shape(r) {
  const totalFees = Number(r.total_fee ?? r.base_fee ?? 0)
  const discount = Number(r.discount_amount ?? 0)
  const net = Math.max(0, totalFees - discount)
  const paid = Number(r.total_paid ?? 0)
  const remaining = Math.max(0, net - paid)

  return {
    id: r.student_no,
    name: [r.first_name, r.last_name].filter(Boolean).join(' '),
    dob: r.date_of_birth?.toISOString?.().slice(0, 10) ?? r.date_of_birth ?? '',
    gender: titleCase(r.gender),
    phone: r.phone,
    whatsapp: r.whatsapp || r.phone,
    email: r.email,
    address: r.address,
    parentName: r.parent_name,
    parentPhone: r.parent_phone,
    course: r.course_name ?? '',
    batch: r.batch_name ?? '',
    admissionDate: r.admission_date?.toISOString?.().slice(0, 10) ?? r.admission_date ?? '',
    totalFees,
    discount,
    paid,
    remainingFees: remaining,
    status: titleCase(r.status),
    photo: r.photo_url || undefined,
    _dbId: r.id,                 // internal PG id — never shown to user
    _courseId: r.course_id,
    _batchId: r.batch_id,
    _enrollmentId: r.enrollment_id,
  }
}

const LIST_SQL = `
  SELECT s.*,
         c.name  AS course_name,
         c.id    AS course_id,
         b.name  AS batch_name,
         b.id    AS batch_id,
         e.id    AS enrollment_id,
         e.total_fee,
         e.discount_amount,
         c.base_fee,
         COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.student_id = s.id AND p.status = 'completed'), 0) AS total_paid
    FROM students s
    LEFT JOIN enrollments e ON e.student_id = s.id
                            AND e.status IN ('active','completed')
    LEFT JOIN courses c     ON c.id = e.course_id
    LEFT JOIN batches b     ON b.id = e.batch_id
   WHERE s.deleted_at IS NULL
   ORDER BY s.created_at DESC
`

// ── GET /api/students ─────────────────────────────────────────────────────────
router.get('/', async (_req, res) => {
  const rows = await query(LIST_SQL)
  // De-dupe students who have multiple enrollments: keep latest enrollment
  const seen = new Map()
  for (const r of rows) {
    if (!seen.has(r.student_no)) seen.set(r.student_no, r)
  }
  const students = [...seen.values()].map(shape)
  res.json(students)
})

// ── GET /api/students/:id ─────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const rows = await query(
    LIST_SQL.replace('ORDER BY', 'AND s.student_no = $1 ORDER BY'),
    [req.params.id],
  )
  if (!rows.length) throw new HttpError(404, 'Student not found', 'NOT_FOUND')
  res.json(shape(rows[0]))
})

// ── GET /api/students/:id/payments ────────────────────────────────────────────
router.get('/:id/payments', async (req, res) => {
  const rows = await query(`
    SELECT p.id, p.payment_date, p.amount, p.method, p.reference_no, p.remarks AS note,
           r.receipt_no
      FROM payments p
      JOIN students s ON s.id = p.student_id
      LEFT JOIN receipts r ON r.payment_id = p.id
     WHERE s.student_no = $1 AND p.status = 'completed'
     ORDER BY p.payment_date DESC, p.id DESC
  `, [req.params.id])
  res.json(rows.map((r) => ({
    id: `PAY-${r.id}`,
    date: r.payment_date?.toISOString?.().slice(0, 10) ?? r.payment_date ?? '',
    amount: Number(r.amount),
    method: fmtMethod(r.method),
    referenceNo: r.reference_no || undefined,
    note: r.note || undefined,
    receiptNo: r.receipt_no || undefined,
  })))
})

// ── GET /api/students/:id/attendance ──────────────────────────────────────────
router.get('/:id/attendance', async (req, res) => {
  const rows = await query(`
    SELECT a.attendance_date, a.status
      FROM student_attendance a
      JOIN students s ON s.id = a.student_id
     WHERE s.student_no = $1
     ORDER BY a.attendance_date DESC
  `, [req.params.id])
  res.json(rows.map((r) => ({
    date: r.attendance_date?.toISOString?.().slice(0, 10) ?? r.attendance_date ?? '',
    status: titleCase(r.status),
  })))
})

// ── POST /api/students ────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const b = req.body
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Generate student_no
    const year = new Date().getFullYear()
    const seqRow = (await client.query(
      `INSERT INTO document_sequences (prefix, year, next_value)
       VALUES ('STU', $1, 1)
       ON CONFLICT (prefix, year) DO UPDATE SET next_value = document_sequences.next_value + 1, updated_at = NOW()
       RETURNING next_value`,
      [year],
    )).rows[0]
    const studentNo = `STU-${year}-${seqRow.next_value.toString().padStart(4, '0')}`

    // Split name
    const fullName = (b.name || '').trim()
    const parts = fullName.split(/\s+/)
    const firstName = parts[0] || ''
    const lastName = parts.slice(1).join(' ') || null
    const email = (b.email || '').trim().toLowerCase()
    const status = (b.status || 'Active').toLowerCase()

    // Ensure 'student' role exists
    await client.query(
      `INSERT INTO roles (name, description) VALUES ('student', 'Student portal access') ON CONFLICT (name) DO NOTHING`,
    )

    // Create or reuse linked user account in `users`
    let userId = null
    const existingUser = (await client.query(`SELECT id FROM users WHERE LOWER(email) = $1`, [email])).rows[0]
    if (existingUser) {
      userId = existingUser.id
    } else {
      const initialPassword = b.password || process.env.SEED_DEFAULT_PASSWORD || crypto.randomBytes(12).toString('hex')
      const hash = await bcrypt.hash(initialPassword, 12)
      const uRow = (await client.query(
        `INSERT INTO users (full_name, email, phone, password_hash, is_active)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [fullName, email, b.phone || null, hash, status !== 'inactive'],
      )).rows[0]
      userId = uRow.id
    }

    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, r.id FROM roles r WHERE r.name = 'student'
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [userId],
    )

    // Insert student linked to `user_id`
    const sRow = (await client.query(`
      INSERT INTO students (student_no, user_id, first_name, last_name, date_of_birth, gender,
                            phone, whatsapp, email, address, parent_name, parent_phone,
                            photo_url, admission_date, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING id
    `, [
      studentNo, userId, firstName, lastName,
      b.dob, (b.gender || 'male').toLowerCase(),
      b.phone, b.whatsapp || b.phone, email, b.address,
      b.parentName, b.parentPhone,
      b.photo || null,
      b.admissionDate,
      status,
    ])).rows[0]

    const initialPayment = Number(b.initialPayment || 0)
    const initialPaymentDate = b.initialPaymentDate || b.admissionDate || kolkataToday()
    const nextDueDate = addDays(initialPaymentDate, 14)

    // Create enrollment if course+batch provided
    let enrollmentId = null
    if (b.course && b.batch) {
      const course = (await client.query(`SELECT id FROM courses WHERE name = $1 AND deleted_at IS NULL`, [b.course])).rows[0]
      const batch = (await client.query(`SELECT id FROM batches WHERE name = $1`, [b.batch])).rows[0]
      if (course && batch) {
        const eRow = (await client.query(`
          INSERT INTO enrollments (student_id, course_id, batch_id, enrolled_on, total_fee, discount_amount, status)
          VALUES ($1,$2,$3,$4,$5,$6,'active')
          RETURNING id
        `, [sRow.id, course.id, batch.id, b.admissionDate || kolkataToday(), Number(b.totalFees || 0), Number(b.discount || 0)])).rows[0]
        enrollmentId = eRow.id

        // Create installment with due date 14 days after initial payment
        const totalFee = Number(b.totalFees || 0)
        const discount = Number(b.discount || 0)
        const net = Math.max(0, totalFee - discount)
        if (net > 0) {
          await client.query(`
            INSERT INTO student_fee_installments (enrollment_id, installment_no, due_date, amount_due, status)
            VALUES ($1, 1, $2, $3, 'pending')
          `, [enrollmentId, nextDueDate, net])
        }
      }
    }

    // Record initial payment if provided
    if (initialPayment > 0 && enrollmentId) {
      const payRow = (await client.query(`
        INSERT INTO payments (student_id, payment_date, amount, method, remarks, status)
        VALUES ($1, $2, $3, $4, 'Initial payment', 'completed')
        RETURNING id
      `, [sRow.id, initialPaymentDate, initialPayment, (b.paymentMethod || 'cash').toLowerCase().replace(' ', '_')])).rows[0]

      // Allocate to first installment
      const inst = (await client.query(`SELECT id, amount_due FROM student_fee_installments WHERE enrollment_id = $1 ORDER BY installment_no LIMIT 1`, [enrollmentId])).rows[0]
      if (inst) {
        const payAmt = Math.min(initialPayment, Number(inst.amount_due))
        await client.query(`INSERT INTO payment_allocations (payment_id, installment_id, amount) VALUES ($1,$2,$3)`, [payRow.id, inst.id, payAmt])
        const newPaid = payAmt
        const newStatus = newPaid >= Number(inst.amount_due) ? 'paid' : 'partial'
        await client.query(`UPDATE student_fee_installments SET amount_paid = $1, status = $2 WHERE id = $3`, [newPaid, newStatus, inst.id])
      }

      // Generate permanent receipt for initial payment
      const rcpYear = Number(initialPaymentDate.slice(0, 4)) || new Date().getFullYear()
      const rcpSeq = (await client.query(
        `INSERT INTO document_sequences (prefix, year, next_value)
         VALUES ('RCP', $1, 1)
         ON CONFLICT (prefix, year) DO UPDATE SET next_value = document_sequences.next_value + 1, updated_at = NOW()
         RETURNING next_value`,
        [rcpYear],
      )).rows[0]
      const receiptNo = `RCP-${rcpYear}-${rcpSeq.next_value.toString().padStart(6, '0')}`
      await client.query(`
        INSERT INTO receipts (receipt_no, payment_id, student_id, amount, status)
        VALUES ($1, $2, $3, $4, 'issued')
      `, [receiptNo, payRow.id, sRow.id, initialPayment])
    }

    await client.query('COMMIT')
    res.status(201).json({ id: studentNo, _dbId: sRow.id })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

// ── PUT /api/students/:id ─────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const b = req.body
  const fullName = (b.name || '').trim()
  const parts = fullName.split(/\s+/)
  const firstName = parts[0] || ''
  const lastName = parts.slice(1).join(' ') || null
  const email = (b.email || '').trim().toLowerCase()
  const status = (b.status || 'active').toLowerCase()

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = (await client.query(`
      UPDATE students SET first_name = $1, last_name = $2, date_of_birth = $3, gender = $4,
             phone = $5, whatsapp = $6, email = $7, address = $8, parent_name = $9,
             parent_phone = $10, photo_url = $11, status = $12
       WHERE student_no = $13 AND deleted_at IS NULL
       RETURNING id, user_id
    `, [
      firstName, lastName, b.dob, (b.gender || 'male').toLowerCase(),
      b.phone, b.whatsapp || b.phone, email, b.address,
      b.parentName, b.parentPhone, b.photo || null,
      status,
      req.params.id,
    ])).rows
    if (!result.length) throw new HttpError(404, 'Student not found', 'NOT_FOUND')
    const studentDbId = result[0].id

    if (result[0].user_id) {
      await client.query(
        `UPDATE users SET full_name = $1, email = $2, phone = $3, is_active = $4 WHERE id = $5`,
        [fullName, email, b.phone || null, status !== 'inactive', result[0].user_id],
      )
    }

    // Update active enrollment if course, batch, or fees are provided
    if (b.course || b.batch || b.totalFees !== undefined || b.discount !== undefined) {
      const activeEnrollment = (await client.query(
        `SELECT id, total_fee, discount_amount FROM enrollments WHERE student_id = $1 AND status = 'active' ORDER BY id DESC LIMIT 1`,
        [studentDbId],
      )).rows[0]

      let courseId = null
      let batchId = null
      if (b.course) {
        const cRow = (await client.query(`SELECT id FROM courses WHERE name = $1 AND deleted_at IS NULL`, [b.course])).rows[0]
        if (cRow) courseId = cRow.id
      }
      if (b.batch) {
        const bRow = (await client.query(`SELECT id FROM batches WHERE name = $1`, [b.batch])).rows[0]
        if (bRow) batchId = bRow.id
      }

      if (activeEnrollment) {
        const totalFee = b.totalFees !== undefined ? Number(b.totalFees) : Number(activeEnrollment.total_fee)
        const discount = b.discount !== undefined ? Number(b.discount) : Number(activeEnrollment.discount_amount)
        await client.query(`
          UPDATE enrollments
             SET course_id = COALESCE($1, course_id),
                 batch_id = COALESCE($2, batch_id),
                 total_fee = $3,
                 discount_amount = $4
           WHERE id = $5
        `, [courseId, batchId, totalFee, discount, activeEnrollment.id])

        // Update single pending installment if exists
        const installments = (await client.query(
          `SELECT id, amount_due, amount_paid FROM student_fee_installments WHERE enrollment_id = $1 AND status = 'pending'`,
          [activeEnrollment.id],
        )).rows
        if (installments.length === 1 && installments[0].amount_paid == 0) {
          const net = Math.max(0, totalFee - discount)
          await client.query(`UPDATE student_fee_installments SET amount_due = $1 WHERE id = $2`, [net, installments[0].id])
        }
      }
    }

    await client.query('COMMIT')
    res.json({ ok: true })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

// ── POST /api/students/:id/payments ───────────────────────────────────────────
router.post('/:id/payments', async (req, res) => {
  const b = req.body
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const student = (await client.query(`SELECT id FROM students WHERE student_no = $1 AND deleted_at IS NULL`, [req.params.id])).rows[0]
    if (!student) throw new HttpError(404, 'Student not found', 'NOT_FOUND')

    const payRow = (await client.query(`
      INSERT INTO payments (student_id, payment_date, amount, method, remarks, status)
      VALUES ($1, $2, $3, $4, $5, 'completed')
      RETURNING id
    `, [student.id, b.date, Number(b.amount), (b.method || 'cash').toLowerCase().replace(' ', '_'), b.note || null])).rows[0]

    // Auto-allocate to oldest unpaid installments
    let remaining = Number(b.amount)
    const installments = (await client.query(`
      SELECT i.id, i.amount_due, i.amount_paid
        FROM student_fee_installments i
        JOIN enrollments e ON e.id = i.enrollment_id
       WHERE e.student_id = $1 AND i.status IN ('pending','partial','overdue')
       ORDER BY i.due_date, i.installment_no
    `, [student.id])).rows

    for (const inst of installments) {
      if (remaining <= 0) break
      const owed = Number(inst.amount_due) - Number(inst.amount_paid)
      if (owed <= 0) continue
      const alloc = Math.min(remaining, owed)
      await client.query(`INSERT INTO payment_allocations (payment_id, installment_id, amount) VALUES ($1,$2,$3)`, [payRow.id, inst.id, alloc])
      const newPaid = Number(inst.amount_paid) + alloc
      const newStatus = newPaid >= Number(inst.amount_due) ? 'paid' : 'partial'
      await client.query(`UPDATE student_fee_installments SET amount_paid = $1, status = $2 WHERE id = $3`, [newPaid, newStatus, inst.id])
      remaining -= alloc
    }

    // Generate receipt so payment appears in Receipts page
    const year = new Date().getFullYear()
    const seqRow = (await client.query(
      `INSERT INTO document_sequences (prefix, year, next_value)
       VALUES ('RCP', $1, 1)
       ON CONFLICT (prefix, year) DO UPDATE SET next_value = document_sequences.next_value + 1, updated_at = NOW()
       RETURNING next_value`,
      [year],
    )).rows[0]
    const receiptNo = `RCP-${year}-${seqRow.next_value.toString().padStart(6, '0')}`

    await client.query(`
      INSERT INTO receipts (receipt_no, payment_id, student_id, amount, status)
      VALUES ($1, $2, $3, $4, 'issued')
    `, [receiptNo, payRow.id, student.id, Number(b.amount)])

    // Sync any existing invoice for the student's active enrollment
    const activeEnroll = (await client.query(
      `SELECT id FROM enrollments WHERE student_id = $1 AND status = 'active' ORDER BY id DESC LIMIT 1`,
      [student.id],
    )).rows[0]
    if (activeEnroll) await syncEnrollmentInvoice(client, activeEnroll.id)

    await client.query('COMMIT')
    res.status(201).json({ id: `PAY-${payRow.id}`, receiptNo })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

// ── DELETE /api/students/:id ──────────────────────────────────────────────────
// Soft delete only
router.delete('/:id', async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = (await client.query(
      `UPDATE students SET deleted_at = NOW(), status = 'inactive' WHERE student_no = $1 AND deleted_at IS NULL RETURNING id, user_id`,
      [req.params.id],
    )).rows
    if (!result.length) throw new HttpError(404, 'Student not found', 'NOT_FOUND')
    const studentDbId = result[0].id

    if (result[0].user_id) {
      await client.query(`UPDATE users SET is_active = FALSE WHERE id = $1`, [result[0].user_id])
    }
    // Also mark active enrollments as dropped
    await client.query(`UPDATE enrollments SET status = 'dropped' WHERE student_id = $1 AND status = 'active'`, [studentDbId])
    // Also cancel receipts
    await client.query(`UPDATE receipts SET status = 'cancelled' WHERE student_id = $1 AND status != 'cancelled'`, [studentDbId])

    await client.query('COMMIT')
    res.json({ ok: true })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

export default router
