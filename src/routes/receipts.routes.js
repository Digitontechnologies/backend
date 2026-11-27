import { Router } from 'express'
import { query, pool } from '../config/db.js'
import { HttpError } from '../middleware/errorHandler.js'

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
