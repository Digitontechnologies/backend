import { Router } from 'express'
import { query, pool } from '../config/db.js'
import { HttpError } from '../middleware/errorHandler.js'
import { getAppSettings } from '../lib/settings.js'

const router = Router()
const titleCase = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s
const fmtMethod = (m) => {
  const map = { upi: 'UPI', cash: 'Cash', card: 'Card', bank_transfer: 'Bank Transfer', cheque: 'Cheque', online: 'Online' }
  return map[(m || '').toLowerCase()] ?? titleCase(m?.replace('_', ' '))
}

function shape(r) {
  return {
    id: r.receipt_no,
    student: r.student_name ?? '',
    invoice: r.invoice_no ?? '',
    amount: Number(r.amount),
    method: fmtMethod(r.method),
    date: r.payment_date?.toISOString?.().slice(0, 10) ?? r.issued_at?.toISOString?.().slice(0, 10) ?? '',
    status: titleCase(r.receipt_status),
    _dbId: r.receipt_id,
  }
}

router.get('/', async (_req, res) => {
  const rows = await query(`
    SELECT r.id AS receipt_id, r.receipt_no, r.amount, r.status AS receipt_status, r.issued_at,
           p.method, p.payment_date,
           TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS student_name,
           inv.invoice_no
      FROM receipts r
      JOIN payments p  ON p.id = r.payment_id
      JOIN students s  ON s.id = r.student_id
      LEFT JOIN invoices inv ON inv.id = p.invoice_id
     WHERE s.deleted_at IS NULL
     ORDER BY r.issued_at DESC
  `)
  res.json(rows.map(shape))
})

// ── GET /api/receipts/detail/:id ──────────────────────────────────────────────
// Accepts either a receipt_no (RCP-...) or a payment ID (PAY-18 / 18).
// Guarantees a permanent unique receipt_no in `receipts` and computes full fee breakdown.
router.get('/detail/:id', async (req, res) => {
  const raw = (req.params.id || '').trim()
  const isPayId = raw.toUpperCase().startsWith('PAY-') || /^\d+$/.test(raw)
  const numericPayId = isPayId ? Number(raw.replace(/^PAY-/i, '')) : null

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const payRows = (await client.query(`
      SELECT p.id AS payment_id,
             p.student_id,
             p.payment_date,
             p.amount,
             p.method,
             p.reference_no,
             p.remarks,
             r.receipt_no,
             s.student_no,
             TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS student_name
        FROM payments p
        JOIN students s ON s.id = p.student_id
        LEFT JOIN receipts r ON r.payment_id = p.id
       WHERE ${isPayId ? 'p.id = $1' : 'r.receipt_no = $1'}
         AND s.deleted_at IS NULL
       LIMIT 1
    `, [isPayId ? numericPayId : raw])).rows

    if (!payRows.length) {
      await client.query('ROLLBACK')
      throw new HttpError(404, 'Payment receipt not found', 'NOT_FOUND')
    }

    const p = payRows[0]
    let receiptNo = p.receipt_no

    // Ensure every payment has its own permanent, unique receipt_no
    if (!receiptNo) {
      const year = new Date(p.payment_date || Date.now()).getFullYear() || new Date().getFullYear()
      const seqRow = (await client.query(
        `INSERT INTO document_sequences (prefix, year, next_value)
         VALUES ('RCP', $1, 1)
         ON CONFLICT (prefix, year) DO UPDATE SET next_value = document_sequences.next_value + 1, updated_at = NOW()
         RETURNING next_value`,
        [year],
      )).rows[0]
      receiptNo = `RCP-${year}-${seqRow.next_value.toString().padStart(6, '0')}`
      await client.query(`
        INSERT INTO receipts (receipt_no, payment_id, student_id, amount, status)
        VALUES ($1, $2, $3, $4, 'issued')
      `, [receiptNo, p.payment_id, p.student_id, Number(p.amount)])
    }

    // Fetch enrollment (course, batch, total_fee, discount_amount)
    const enrollRow = (await client.query(`
      SELECT e.total_fee,
             e.discount_amount,
             c.name AS course_name,
             b.name AS batch_name
        FROM enrollments e
        LEFT JOIN courses c ON c.id = e.course_id
        LEFT JOIN batches b ON b.id = e.batch_id
       WHERE e.student_id = $1 AND e.status IN ('active', 'completed')
       ORDER BY e.id DESC
       LIMIT 1
    `, [p.student_id])).rows[0]

    // Sum all completed payments chronologically BEFORE this payment
    const prevRow = (await client.query(`
      SELECT COALESCE(SUM(amount), 0) AS prev_paid
        FROM payments
       WHERE student_id = $1
         AND status = 'completed'
         AND (payment_date < $2::date OR (payment_date = $2::date AND id < $3))
    `, [p.student_id, p.payment_date, p.payment_id])).rows[0]

    await client.query('COMMIT')

    const totalCourseFee = Math.max(0, Number(enrollRow?.total_fee ?? 0) - Number(enrollRow?.discount_amount ?? 0))
    const previousPaidAmount = Number(prevRow?.prev_paid ?? 0)
    const currentPaymentAmount = Number(p.amount)
    const totalPaidTillDate = previousPaidAmount + currentPaymentAmount
    const remainingPendingBalance = Math.max(0, totalCourseFee - totalPaidTillDate)
    const paymentStatus = remainingPendingBalance === 0 ? 'Paid' : totalPaidTillDate > 0 ? 'Partially Paid' : 'Pending'
    const settings = await getAppSettings()

    res.json({
      receiptNo,
      paymentId: `PAY-${p.payment_id}`,
      paymentDate: p.payment_date?.toISOString?.().slice(0, 10) ?? String(p.payment_date || '').slice(0, 10),
      branchName: settings.branchName,
      studentName: p.student_name ?? '',
      studentId: p.student_no ?? '',
      courseName: enrollRow?.course_name ?? '—',
      batchName: enrollRow?.batch_name ?? '—',
      totalCourseFee,
      previousPaidAmount,
      currentPaymentAmount,
      totalPaidTillDate,
      remainingPendingBalance,
      paymentMethod: fmtMethod(p.method),
      transactionId: p.reference_no || '',
      paymentNotes: p.remarks || '',
      paymentStatus,
      termsAndConditions: settings.receiptTerms,
    })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

router.get('/:id', async (req, res) => {
  const rows = await query(`
    SELECT r.id AS receipt_id, r.receipt_no, r.amount, r.status AS receipt_status, r.issued_at,
           p.method, p.payment_date,
           TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS student_name,
           inv.invoice_no
      FROM receipts r
      JOIN payments p  ON p.id = r.payment_id
      JOIN students s  ON s.id = r.student_id
      LEFT JOIN invoices inv ON inv.id = p.invoice_id
     WHERE r.receipt_no = $1
  `, [req.params.id])
  if (!rows.length) throw new HttpError(404, 'Receipt not found', 'NOT_FOUND')
  res.json(shape(rows[0]))
})

router.post('/', async (req, res) => {
  const b = req.body
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Find student
    const student = (await client.query(
      `SELECT id FROM students WHERE TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) = $1 AND deleted_at IS NULL LIMIT 1`,
      [b.student],
    )).rows[0]
    if (!student) throw new HttpError(400, `Student "${b.student}" not found`, 'INVALID_STUDENT')

    // Find invoice if provided
    let invoiceId = null
    if (b.invoice) {
      const inv = (await client.query(`SELECT id FROM invoices WHERE invoice_no = $1`, [b.invoice])).rows[0]
      invoiceId = inv?.id ?? null
    }

    // Create payment
    const payRow = (await client.query(`
      INSERT INTO payments (student_id, invoice_id, payment_date, amount, method, status)
      VALUES ($1,$2,$3,$4,$5,'completed') RETURNING id
    `, [student.id, invoiceId, b.date || new Date().toISOString().slice(0, 10), Number(b.amount),
        (b.method || 'cash').toLowerCase().replace(' ', '_')])).rows[0]

    // Generate receipt_no
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
      VALUES ($1,$2,$3,$4,$5)
    `, [receiptNo, payRow.id, student.id, Number(b.amount), (b.status || 'issued').toLowerCase()])

    await client.query('COMMIT')
    res.status(201).json({ id: receiptNo })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

router.put('/:id', async (req, res) => {
  const result = await query(
    `UPDATE receipts SET status = $1 WHERE receipt_no = $2 RETURNING id`,
    [(req.body.status || 'issued').toLowerCase(), req.params.id],
  )
  if (!result.length) throw new HttpError(404, 'Receipt not found', 'NOT_FOUND')
  res.json({ ok: true })
})

router.delete('/:id', async (req, res) => {
  const result = await query(
    `UPDATE receipts SET status = 'cancelled' WHERE receipt_no = $1 AND status != 'cancelled' RETURNING id`,
    [req.params.id],
  )
  if (!result.length) throw new HttpError(404, 'Receipt not found', 'NOT_FOUND')
  res.json({ ok: true })
})

export default router
