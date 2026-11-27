import { Router } from 'express'
import { query, pool } from '../config/db.js'
import { HttpError } from '../middleware/errorHandler.js'

const router = Router()
const titleCase = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s

const normalizeStatus = (s) => {
  const lower = (s || 'issued').toLowerCase()
  if (lower === 'pending') return 'issued'
  if (['draft', 'issued', 'partial', 'paid', 'overdue', 'cancelled'].includes(lower)) return lower
  return 'issued'
}

function shape(r) {
  const subtotal = Number(r.subtotal ?? 0)
  const taxAmt = Number(r.tax_amount ?? 0)
  const taxRate = subtotal > 0 ? Math.round((taxAmt / subtotal) * 100) : 0
  const statusStr = r.status === 'issued' ? 'Pending' : titleCase(r.status)
  return {
    id: r.invoice_no,
    student: r.student_name ?? '',
    description: r.description ?? `${r.course_name ?? 'Course'} – tuition`,
    amount: subtotal,
    tax: taxRate,
    issueDate: r.issue_date?.toISOString?.().slice(0, 10) ?? r.issue_date ?? '',
    status: statusStr,
    _dbId: r.id,
  }
}

router.get('/', async (_req, res) => {
  const rows = await query(`
    SELECT inv.*,
           TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS student_name,
           c.name AS course_name,
           (SELECT ii.description FROM invoice_items ii WHERE ii.invoice_id = inv.id LIMIT 1) AS description
      FROM invoices inv
      JOIN students s ON s.id = inv.student_id
      LEFT JOIN enrollments e ON e.id = inv.enrollment_id
      LEFT JOIN courses c ON c.id = e.course_id
     WHERE s.deleted_at IS NULL
     ORDER BY inv.issue_date DESC
  `)
  res.json(rows.map(shape))
})

router.get('/:id', async (req, res) => {
  const rows = await query(`
    SELECT inv.*,
           TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS student_name,
           c.name AS course_name,
           (SELECT ii.description FROM invoice_items ii WHERE ii.invoice_id = inv.id LIMIT 1) AS description
      FROM invoices inv
      JOIN students s ON s.id = inv.student_id
      LEFT JOIN enrollments e ON e.id = inv.enrollment_id
      LEFT JOIN courses c ON c.id = e.course_id
     WHERE inv.invoice_no = $1
  `, [req.params.id])
  if (!rows.length) throw new HttpError(404, 'Invoice not found', 'NOT_FOUND')
  res.json(shape(rows[0]))
})

router.post('/', async (req, res) => {
  const b = req.body
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Generate invoice_no
    const year = new Date().getFullYear()
    const seqRow = (await client.query(
      `INSERT INTO document_sequences (prefix, year, next_value)
       VALUES ('INV', $1, 1)
       ON CONFLICT (prefix, year) DO UPDATE SET next_value = document_sequences.next_value + 1, updated_at = NOW()
       RETURNING next_value`,
      [year],
    )).rows[0]
    const invoiceNo = `INV-${year}-${seqRow.next_value.toString().padStart(6, '0')}`

    // Find student
    const student = (await client.query(
      `SELECT id FROM students WHERE TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) = $1 AND deleted_at IS NULL LIMIT 1`,
      [b.student],
    )).rows[0]
    if (!student) throw new HttpError(400, `Student "${b.student}" not found`, 'INVALID_STUDENT')

    const subtotal = Number(b.amount || 0)
    const taxRate = Number(b.tax || 0)
    const taxAmount = Math.round(subtotal * taxRate / 100)
    const total = subtotal + taxAmount

    const row = (await client.query(`
      INSERT INTO invoices (invoice_no, student_id, issue_date, due_date, subtotal, tax_amount, total_amount, status)
      VALUES ($1,$2,$3,$3,$4,$5,$6,$7) RETURNING id
    `, [invoiceNo, student.id, b.issueDate || new Date().toISOString().slice(0, 10),
        subtotal, taxAmount, total, normalizeStatus(b.status)])).rows[0]

    // Add invoice item
    await client.query(`
      INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, tax_rate, line_total)
      VALUES ($1, $2, 1, $3, $4, $5)
    `, [row.id, b.description || 'Tuition fee', subtotal, taxRate, total])

    await client.query('COMMIT')
    res.status(201).json({ id: invoiceNo, _dbId: row.id })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

router.put('/:id', async (req, res) => {
  const b = req.body
  const subtotal = Number(b.amount || 0)
  const taxRate = Number(b.tax || 0)
  const taxAmount = Math.round(subtotal * taxRate / 100)
  const total = subtotal + taxAmount

  const result = await query(`
    UPDATE invoices SET issue_date=$1, subtotal=$2, tax_amount=$3, total_amount=$4, status=$5
     WHERE invoice_no=$6 RETURNING id
  `, [b.issueDate, subtotal, taxAmount, total, normalizeStatus(b.status), req.params.id])
  if (!result.length) throw new HttpError(404, 'Invoice not found', 'NOT_FOUND')
  res.json({ ok: true })
})

router.delete('/:id', async (req, res) => {
  const result = await query(
    `UPDATE invoices SET status='cancelled' WHERE invoice_no=$1 AND status != 'cancelled' RETURNING id`,
    [req.params.id],
  )
  if (!result.length) throw new HttpError(404, 'Invoice not found', 'NOT_FOUND')
  res.json({ ok: true })
})

export default router
