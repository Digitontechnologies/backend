import { Router } from 'express'
import { query, pool } from '../config/db.js'
import { HttpError } from '../middleware/errorHandler.js'
import { addDays, kolkataToday, syncEnrollmentInvoice } from '../lib/autoInvoices.js'

const router = Router()

/**
 * The frontend Fee shape:
 * { id, student, course, total, paid, due, dueDate, status }
 *
 * We aggregate installments per enrollment to build this.
 */
function shape(r) {
  const total = Number(r.total_fee ?? 0)
  const discount = Number(r.discount_amount ?? 0)
  const net = Math.max(0, total - discount)
  const paid = Number(r.total_paid ?? 0)
  const due = Math.max(0, net - paid)
  const todayStr = new Date().toISOString().slice(0, 10)
  const dueDateStr = r.next_due ? (r.next_due.toISOString?.().slice(0, 10) ?? String(r.next_due).slice(0, 10)) : ''

  let status = 'Paid'
  if (due > 0) {
    if (paid > 0) {
      status = 'Partially Paid'
    } else if (dueDateStr && dueDateStr < todayStr) {
      status = 'Overdue'
    } else {
      status = 'Pending'
    }
  }
  return {
    id: `FEE-${r.enrollment_id}`,
    student: r.student_name,
    course: r.course_name ?? '',
    total: net,
    paid,
    due,
    dueDate: dueDateStr,
    status,
    _enrollmentId: r.enrollment_id,
    _studentId: r.student_id,
  }
}

router.get('/', async (_req, res) => {
  const rows = await query(`
    SELECT e.id AS enrollment_id,
           e.student_id,
           e.total_fee,
           e.discount_amount,
           TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS student_name,
           c.name AS course_name,
           COALESCE(SUM(i.amount_paid), 0) AS total_paid,
           MIN(CASE WHEN i.status IN ('pending','partial','overdue') THEN i.due_date END) AS next_due
      FROM enrollments e
      JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
      JOIN courses c  ON c.id = e.course_id
      LEFT JOIN student_fee_installments i ON i.enrollment_id = e.id
     WHERE e.status IN ('active','completed')
     GROUP BY e.id, e.student_id, e.total_fee, e.discount_amount, s.first_name, s.last_name, c.name
     ORDER BY student_name
  `)
  res.json(rows.map(shape))
})

router.get('/:id', async (req, res) => {
  const enrollmentId = (req.params.id || '').replace('FEE-', '')
  const rows = await query(`
    SELECT e.id AS enrollment_id, e.student_id, e.total_fee, e.discount_amount,
           TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS student_name,
           c.name AS course_name,
           COALESCE(SUM(i.amount_paid), 0) AS total_paid,
           MIN(CASE WHEN i.status IN ('pending','partial','overdue') THEN i.due_date END) AS next_due
      FROM enrollments e
      JOIN students s ON s.id = e.student_id
      JOIN courses c  ON c.id = e.course_id
      LEFT JOIN student_fee_installments i ON i.enrollment_id = e.id
     WHERE e.id = $1
     GROUP BY e.id, e.student_id, e.total_fee, e.discount_amount, s.first_name, s.last_name, c.name
  `, [enrollmentId])
  if (!rows.length) throw new HttpError(404, 'Fee record not found', 'NOT_FOUND')
  res.json(shape(rows[0]))
})

// ── GET /api/fees/:id/history ─────────────────────────────────────────────────
// Returns all payment transactions allocated to this enrollment.
router.get('/:id/history', async (req, res) => {
  const enrollmentId = Number((req.params.id || '').replace('FEE-', ''))
  if (!enrollmentId) throw new HttpError(400, 'Invalid fee ID', 'INVALID_ID')

  const rows = await query(`
    SELECT p.id,
           p.payment_date,
           SUM(pa.amount) AS amount,
           p.method,
           p.reference_no,
           p.remarks,
           p.created_at,
           r.receipt_no
      FROM payment_allocations pa
      JOIN student_fee_installments sfi ON sfi.id = pa.installment_id
      JOIN payments p ON p.id = pa.payment_id
      LEFT JOIN receipts r ON r.payment_id = p.id
     WHERE sfi.enrollment_id = $1
     GROUP BY p.id, p.payment_date, p.method, p.reference_no, p.remarks, p.created_at, r.receipt_no
     ORDER BY p.payment_date DESC, p.id DESC
  `, [enrollmentId])

  res.json(rows.map((r) => ({
    id: `PAY-${r.id}`,
    date: r.payment_date?.toISOString?.().slice(0, 10) ?? String(r.payment_date || '').slice(0, 10),
    amount: Number(r.amount),
    method: r.method,
    referenceNo: r.reference_no || '',
    remarks: r.remarks || '',
    receiptNo: r.receipt_no || '',
  })))
})

// ── POST /api/fees/:id/collect ────────────────────────────────────────────────
// Collects a pending fee payment (partial or full) for an enrollment inside a
// transaction: inserts a new payment, allocates to unpaid installments, and issues a receipt.
router.post('/:id/collect', async (req, res) => {
  const enrollmentId = Number((req.params.id || '').replace('FEE-', ''))
  if (!enrollmentId) throw new HttpError(400, 'Invalid fee ID', 'INVALID_ID')

  const method = (req.body?.method || 'cash').toLowerCase().replace(/\s+/g, '_')
  const payDate = req.body?.date || new Date().toISOString().slice(0, 10)
  const referenceNo = req.body?.referenceNo?.trim() || null
  const remarks = req.body?.remarks?.trim() || 'Fee collection'

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const enrollment = (await client.query(
      `SELECT id, student_id, total_fee, discount_amount FROM enrollments WHERE id = $1 FOR UPDATE`,
      [enrollmentId],
    )).rows[0]
    if (!enrollment) throw new HttpError(404, 'Fee record not found', 'NOT_FOUND')

    const installments = (await client.query(`
      SELECT id, amount_due, amount_paid, (amount_due - amount_paid) AS owed
        FROM student_fee_installments
       WHERE enrollment_id = $1 AND status IN ('pending', 'partial', 'overdue')
       ORDER BY due_date, installment_no
       FOR UPDATE
    `, [enrollmentId])).rows

    const paidSumRow = (await client.query(
      `SELECT COALESCE(SUM(amount_paid), 0) AS total_paid FROM student_fee_installments WHERE enrollment_id = $1`,
      [enrollmentId],
    )).rows[0]
    const netFee = Math.max(0, Number(enrollment.total_fee ?? 0) - Number(enrollment.discount_amount ?? 0))
    const alreadyPaid = Number(paidSumRow.total_paid ?? 0)
    const pendingAmount = Math.max(0, netFee - alreadyPaid)

    if (pendingAmount <= 0) {
      await client.query('ROLLBACK')
      return res.json({ ok: true, collected: 0, message: 'Already paid in full' })
    }

    const requestedAmount = req.body?.amount !== undefined ? Number(req.body.amount) : pendingAmount
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      throw new HttpError(400, 'Amount paying must be greater than 0', 'INVALID_AMOUNT')
    }
    if (requestedAmount > pendingAmount) {
      throw new HttpError(400, `Amount paying (${requestedAmount}) cannot exceed pending amount (${pendingAmount})`, 'AMOUNT_EXCEEDS_PENDING')
    }

    const payRow = (await client.query(`
      INSERT INTO payments (student_id, payment_date, amount, method, reference_no, remarks, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'completed')
      RETURNING id
    `, [enrollment.student_id, payDate, requestedAmount, method, referenceNo, remarks])).rows[0]

    let remaining = requestedAmount
    for (const inst of installments) {
      if (remaining <= 0) break
      const owed = Number(inst.owed)
      if (owed <= 0) continue
      const alloc = Math.min(remaining, owed)
      await client.query(
        `INSERT INTO payment_allocations (payment_id, installment_id, amount) VALUES ($1, $2, $3)`,
        [payRow.id, inst.id, alloc],
      )
      await client.query(`
        UPDATE student_fee_installments
           SET amount_paid = amount_paid + $1,
               status = CASE WHEN amount_paid + $1 >= amount_due THEN 'paid' ELSE 'partial' END
         WHERE id = $2
      `, [alloc, inst.id])
      remaining -= alloc
    }

    // Generate receipt
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
    `, [receiptNo, payRow.id, enrollment.student_id, requestedAmount])

    await syncEnrollmentInvoice(client, enrollmentId)

    await client.query('COMMIT')
    const newPaid = alreadyPaid + requestedAmount
    const newPending = Math.max(0, netFee - newPaid)
    const newStatus = newPending === 0 ? 'Paid' : newPaid > 0 ? 'Partially Paid' : 'Pending'
    res.status(201).json({
      ok: true,
      paymentId: `PAY-${payRow.id}`,
      receiptNo,
      collected: requestedAmount,
      totalPaid: newPaid,
      pendingAmount: newPending,
      status: newStatus,
    })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

/**
 * Records a payment of `amount` for `studentId` / `enrollmentId`, allocates it
 * across unpaid installments, and issues a receipt. Must be called inside a DB transaction.
 */
async function recordPaymentAndReceipt(client, { studentId, enrollmentId, amount, payDate, method = 'cash', remarks = 'Fee payment' }) {
  if (amount <= 0) return null

  const payRow = (await client.query(`
    INSERT INTO payments (student_id, payment_date, amount, method, remarks, status)
    VALUES ($1, $2, $3, $4, $5, 'completed')
    RETURNING id
  `, [studentId, payDate, amount, method, remarks])).rows[0]

  const installments = (await client.query(`
    SELECT id, amount_due, amount_paid, (amount_due - amount_paid) AS owed
      FROM student_fee_installments
     WHERE enrollment_id = $1 AND status IN ('pending', 'partial', 'overdue')
     ORDER BY due_date, installment_no
     FOR UPDATE
  `, [enrollmentId])).rows

  let remaining = amount
  for (const inst of installments) {
    if (remaining <= 0) break
    const owed = Number(inst.owed)
    if (owed <= 0) continue
    const alloc = Math.min(remaining, owed)
    await client.query(
      `INSERT INTO payment_allocations (payment_id, installment_id, amount) VALUES ($1, $2, $3)`,
      [payRow.id, inst.id, alloc],
    )
    await client.query(`
      UPDATE student_fee_installments
         SET amount_paid = amount_paid + $1,
             status = CASE WHEN amount_paid + $1 >= amount_due THEN 'paid' ELSE 'partial' END
       WHERE id = $2
    `, [alloc, inst.id])
    remaining -= alloc
  }

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
  `, [receiptNo, payRow.id, studentId, amount])

  return { paymentId: payRow.id, receiptNo }
}

// ── POST /api/fees ────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const b = req.body
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const student = (await client.query(
      `SELECT id FROM students WHERE TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) = $1 AND deleted_at IS NULL LIMIT 1`,
      [b.student],
    )).rows[0]
    if (!student) throw new HttpError(400, `Student "${b.student}" not found`, 'INVALID_STUDENT')

    let courseId = null
    let batchId = null
    if (b.course) {
      const cRow = (await client.query(`SELECT id FROM courses WHERE name = $1 AND deleted_at IS NULL LIMIT 1`, [b.course])).rows[0]
      if (cRow) {
        courseId = cRow.id
        const bRow = (await client.query(`SELECT id FROM batches WHERE course_id = $1 LIMIT 1`, [cRow.id])).rows[0]
        if (bRow) batchId = bRow.id
      }
    }
    if (!courseId) {
      const firstCourse = (await client.query(`SELECT id FROM courses WHERE deleted_at IS NULL LIMIT 1`)).rows[0]
      if (firstCourse) courseId = firstCourse.id
    }
    if (!batchId && courseId) {
      const firstBatch = (await client.query(`SELECT id FROM batches WHERE course_id = $1 LIMIT 1`, [courseId])).rows[0]
      if (firstBatch) batchId = firstBatch.id
    }

    const totalFee = Math.max(0, Number(b.total || 0))
    const paidAmount = Math.max(0, Number(b.paid || 0))
    const todayStr = kolkataToday()
    const dueDate = b.dueDate || (paidAmount > 0 && paidAmount < totalFee ? addDays(todayStr, 14) : todayStr)

    // Check if student already has an active enrollment for this course
    const existingEnrollment = (await client.query(`
      SELECT id FROM enrollments
       WHERE student_id = $1 AND course_id = $2 AND status = 'active'
       ORDER BY id DESC LIMIT 1
    `, [student.id, courseId])).rows[0]

    let enrollmentId
    if (existingEnrollment) {
      enrollmentId = existingEnrollment.id
      await client.query(
        `UPDATE enrollments SET total_fee = $1, discount_amount = 0 WHERE id = $2`,
        [totalFee, enrollmentId],
      )

      // Update the primary installment rather than creating duplicates
      const firstInst = (await client.query(
        `SELECT id, amount_paid FROM student_fee_installments WHERE enrollment_id = $1 ORDER BY installment_no ASC LIMIT 1`,
        [enrollmentId],
      )).rows[0]

      if (firstInst) {
        const instPaid = Number(firstInst.amount_paid || 0)
        const instStatus = instPaid >= totalFee ? 'paid' : instPaid > 0 ? 'partial' : 'pending'
        await client.query(
          `UPDATE student_fee_installments SET amount_due = $1, due_date = $2, status = $3 WHERE id = $4`,
          [totalFee, dueDate, instStatus, firstInst.id],
        )
        // Remove any extra unpaid installments created previously
        await client.query(
          `DELETE FROM student_fee_installments WHERE enrollment_id = $1 AND id != $2 AND amount_paid = 0`,
          [enrollmentId, firstInst.id],
        )
      } else {
        await client.query(`
          INSERT INTO student_fee_installments (enrollment_id, installment_no, due_date, amount_due, status)
          VALUES ($1, 1, $2, $3, 'pending')
        `, [enrollmentId, dueDate, totalFee])
      }

      const paidSumRow = (await client.query(
        `SELECT COALESCE(SUM(amount_paid), 0) AS total_paid FROM student_fee_installments WHERE enrollment_id = $1`,
        [enrollmentId],
      )).rows[0]
      const currentPaid = Number(paidSumRow.total_paid || 0)
      if (paidAmount > currentPaid) {
        await recordPaymentAndReceipt(client, {
          studentId: student.id,
          enrollmentId,
          amount: Math.min(paidAmount - currentPaid, Math.max(0, totalFee - currentPaid)),
          payDate: dueDate,
          remarks: 'Fee payment',
        })
      }
    } else {
      const eRow = (await client.query(`
        INSERT INTO enrollments (student_id, course_id, batch_id, enrolled_on, total_fee, discount_amount, status)
        VALUES ($1, $2, $3, $4, $5, 0, 'active')
        RETURNING id
      `, [student.id, courseId, batchId, dueDate, totalFee])).rows[0]
      enrollmentId = eRow.id

      await client.query(`
        INSERT INTO student_fee_installments (enrollment_id, installment_no, due_date, amount_due, status)
        VALUES ($1, 1, $2, $3, 'pending')
      `, [enrollmentId, dueDate, totalFee])

      if (paidAmount > 0) {
        await recordPaymentAndReceipt(client, {
          studentId: student.id,
          enrollmentId,
          amount: Math.min(paidAmount, totalFee),
          payDate: todayStr,
          remarks: 'Initial fee payment',
        })
      }
    }

    await syncEnrollmentInvoice(client, enrollmentId)

    await client.query('COMMIT')
    res.status(201).json({ id: `FEE-${enrollmentId}`, _enrollmentId: enrollmentId })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

// ── PUT /api/fees/:id ─────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const enrollmentId = Number((req.params.id || '').replace('FEE-', ''))
  if (!enrollmentId) throw new HttpError(400, 'Invalid fee ID', 'INVALID_ID')
  const b = req.body

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const enrollment = (await client.query(
      `SELECT id, student_id, total_fee FROM enrollments WHERE id = $1`,
      [enrollmentId],
    )).rows[0]
    if (!enrollment) throw new HttpError(404, 'Fee record not found', 'NOT_FOUND')

    const totalFee = b.total !== undefined ? Math.max(0, Number(b.total)) : Number(enrollment.total_fee)
    const dueDate = b.dueDate

    if (b.total !== undefined) {
      await client.query(`UPDATE enrollments SET total_fee = $1, discount_amount = 0 WHERE id = $2`, [totalFee, enrollmentId])
      const firstInst = (await client.query(
        `SELECT id, amount_paid FROM student_fee_installments WHERE enrollment_id = $1 ORDER BY installment_no ASC LIMIT 1`,
        [enrollmentId],
      )).rows[0]
      if (firstInst) {
        const instPaid = Number(firstInst.amount_paid || 0)
        const instStatus = instPaid >= totalFee ? 'paid' : instPaid > 0 ? 'partial' : 'pending'
        await client.query(
          `UPDATE student_fee_installments SET amount_due = $1, status = $2 WHERE id = $3`,
          [totalFee, instStatus, firstInst.id],
        )
      }
    }
    if (dueDate) {
      await client.query(
        `UPDATE student_fee_installments SET due_date = $1 WHERE enrollment_id = $2 AND status != 'paid'`,
        [dueDate, enrollmentId],
      )
    }

    if (b.paid !== undefined) {
      const paidAmount = Math.max(0, Number(b.paid))
      const paidSumRow = (await client.query(
        `SELECT COALESCE(SUM(amount_paid), 0) AS total_paid FROM student_fee_installments WHERE enrollment_id = $1`,
        [enrollmentId],
      )).rows[0]
      const currentPaid = Number(paidSumRow.total_paid || 0)
      if (paidAmount > currentPaid) {
        await recordPaymentAndReceipt(client, {
          studentId: enrollment.student_id,
          enrollmentId,
          amount: Math.min(paidAmount - currentPaid, Math.max(0, totalFee - currentPaid)),
          payDate: dueDate || new Date().toISOString().slice(0, 10),
          remarks: 'Fee update payment',
        })
      }
    }

    await syncEnrollmentInvoice(client, enrollmentId)

    await client.query('COMMIT')
    res.json({ ok: true })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

// ── DELETE /api/fees/:id ──────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const enrollmentId = Number((req.params.id || '').replace('FEE-', ''))
  if (!enrollmentId) throw new HttpError(400, 'Invalid fee ID', 'INVALID_ID')
  const result = await query(
    `UPDATE enrollments SET status = 'dropped' WHERE id = $1 AND status != 'dropped' RETURNING id`,
    [enrollmentId],
  )
  if (!result.length) throw new HttpError(404, 'Fee record not found', 'NOT_FOUND')
  res.json({ ok: true })
})

export default router
