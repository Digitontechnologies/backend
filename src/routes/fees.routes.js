import { Router } from 'express'
import { query, pool } from '../config/db.js'
import { HttpError } from '../middleware/errorHandler.js'

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
  let status = 'Paid'
  if (due > 0 && paid === 0) status = 'Overdue'
  else if (due > 0) status = 'Partial'
  return {
    id: `FEE-${r.enrollment_id}`,
    student: r.student_name,
    course: r.course_name ?? '',
    total: net,
    paid,
    due,
    dueDate: r.next_due?.toISOString?.().slice(0, 10) ?? r.next_due ?? '',
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

// ── POST /api/fees/:id/collect ────────────────────────────────────────────────
// Collects remaining due (or a specified amount) for an enrollment inside a transaction:
// inserts a payment, allocates to unpaid installments, and issues a receipt.
router.post('/:id/collect', async (req, res) => {
  const enrollmentId = Number((req.params.id || '').replace('FEE-', ''))
  if (!enrollmentId) throw new HttpError(400, 'Invalid fee ID', 'INVALID_ID')

  const method = (req.body?.method || 'cash').toLowerCase().replace(/\s+/g, '_')
  const payDate = req.body?.date || new Date().toISOString().slice(0, 10)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const enrollment = (await client.query(
      `SELECT id, student_id FROM enrollments WHERE id = $1`,
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

    const totalOwed = installments.reduce((sum, i) => sum + Number(i.owed), 0)
    if (totalOwed <= 0) {
      await client.query('ROLLBACK')
      return res.json({ ok: true, collected: 0, message: 'Already paid in full' })
    }

    const collectAmount = req.body?.amount ? Math.min(Number(req.body.amount), totalOwed) : totalOwed
    if (collectAmount <= 0) throw new HttpError(400, 'Collection amount must be > 0', 'INVALID_AMOUNT')

    const payRow = (await client.query(`
      INSERT INTO payments (student_id, payment_date, amount, method, remarks, status)
      VALUES ($1, $2, $3, $4, 'Fee collection', 'completed')
      RETURNING id
    `, [enrollment.student_id, payDate, collectAmount, method])).rows[0]

    let remaining = collectAmount
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
    `, [receiptNo, payRow.id, enrollment.student_id, collectAmount])

    await client.query('COMMIT')
    res.status(201).json({ ok: true, paymentId: `PAY-${payRow.id}`, receiptNo, collected: collectAmount })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

export default router
