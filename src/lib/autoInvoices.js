import { pool } from '../config/db.js'

/** Returns today's YYYY-MM-DD date string in Asia/Kolkata timezone. */
export function kolkataToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** Adds `days` calendar days to a YYYY-MM-DD date string. */
export function addDays(dateStr, days) {
  const base = (dateStr || kolkataToday()).slice(0, 10)
  const [y, m, d] = base.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

/**
 * Synchronizes any existing non-cancelled invoice for `enrollmentId` with
 * the enrollment's current Fees state (single source of truth).
 * - If fully paid (pending === 0): marks invoice `paid` (never deletes).
 * - If partial payment: updates invoice subtotal/total_amount to remaining pending
 *   and sets status to `partial`.
 */
export async function syncEnrollmentInvoice(client, enrollmentId) {
  if (!enrollmentId) return

  const enroll = (await client.query(`
    SELECT e.id,
           GREATEST(0, e.total_fee - e.discount_amount) AS net_fee,
           COALESCE((SELECT SUM(i.amount_paid) FROM student_fee_installments i WHERE i.enrollment_id = e.id), 0) AS total_paid
      FROM enrollments e
     WHERE e.id = $1
  `, [enrollmentId])).rows[0]
  if (!enroll) return

  const netFee = Number(enroll.net_fee || 0)
  const totalPaid = Number(enroll.total_paid || 0)
  const pending = Math.max(0, netFee - totalPaid)

  const invoices = (await client.query(
    `SELECT id, tax_amount, status FROM invoices WHERE enrollment_id = $1 AND status != 'cancelled'`,
    [enrollmentId],
  )).rows

  for (const inv of invoices) {
    if (pending === 0) {
      await client.query(
        `UPDATE invoices SET status = 'paid', updated_at = NOW() WHERE id = $1 AND status != 'paid'`,
        [inv.id],
      )
    } else {
      const taxAmt = Number(inv.tax_amount || 0)
      const totalAmt = pending + taxAmt
      const newStatus = totalPaid > 0 ? 'partial' : inv.status === 'paid' ? 'issued' : inv.status
      await client.query(
        `UPDATE invoices
            SET subtotal = $1,
                total_amount = $2,
                status = $3,
                updated_at = NOW()
          WHERE id = $4`,
        [pending, totalAmt, newStatus, inv.id],
      )
      await client.query(
        `UPDATE invoice_items
            SET unit_price = $1,
                line_total = $2
          WHERE invoice_id = $3`,
        [pending, totalAmt, inv.id],
      )
    }
  }
}

/**
 * Generates automatic invoices for active enrollments whose due date has arrived
 * (<= today in Asia/Kolkata) and still have a remaining pending balance,
 * skipping any enrollment that already has a non-cancelled invoice.
 */
export async function runAutoInvoiceJob() {
  const todayStr = kolkataToday()
  const client = await pool.connect()
  let created = 0
  try {
    await client.query('BEGIN')

    const dueEnrollments = (await client.query(`
      SELECT e.id AS enrollment_id,
             e.student_id,
             c.name AS course_name,
             GREATEST(0, e.total_fee - e.discount_amount) AS net_fee,
             COALESCE(SUM(i.amount_paid), 0) AS total_paid,
             MIN(CASE WHEN i.status IN ('pending', 'partial', 'overdue') THEN i.due_date END) AS next_due
        FROM enrollments e
        JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
        LEFT JOIN courses c ON c.id = e.course_id
        LEFT JOIN student_fee_installments i ON i.enrollment_id = e.id
       WHERE e.status = 'active'
       GROUP BY e.id, e.student_id, c.name, e.total_fee, e.discount_amount
      HAVING GREATEST(0, e.total_fee - e.discount_amount) - COALESCE(SUM(i.amount_paid), 0) > 0
         AND MIN(CASE WHEN i.status IN ('pending', 'partial', 'overdue') THEN i.due_date END) <= $1::date
    `, [todayStr])).rows

    const year = Number(todayStr.slice(0, 4))

    for (const row of dueEnrollments) {
      // Prevent duplicate invoices for the same enrollment
      const existing = (await client.query(
        `SELECT id FROM invoices WHERE enrollment_id = $1 AND status != 'cancelled' LIMIT 1`,
        [row.enrollment_id],
      )).rows[0]

      if (existing) {
        await syncEnrollmentInvoice(client, row.enrollment_id)
        continue
      }

      const pending = Math.max(0, Number(row.net_fee) - Number(row.total_paid))
      if (pending <= 0) continue

      const dueDateStr = row.next_due?.toISOString?.().slice(0, 10) ?? String(row.next_due).slice(0, 10)
      const seqRow = (await client.query(
        `INSERT INTO document_sequences (prefix, year, next_value)
         VALUES ('INV', $1, 1)
         ON CONFLICT (prefix, year) DO UPDATE SET next_value = document_sequences.next_value + 1, updated_at = NOW()
         RETURNING next_value`,
        [year],
      )).rows[0]
      const invoiceNo = `INV-${year}-${seqRow.next_value.toString().padStart(6, '0')}`
      const invStatus = dueDateStr < todayStr ? 'overdue' : 'issued'
      const desc = `${row.course_name || 'Course'} – Pending fee balance`

      const invRow = (await client.query(`
        INSERT INTO invoices (invoice_no, student_id, enrollment_id, issue_date, due_date, subtotal, discount_amount, tax_amount, total_amount, status, notes)
        VALUES ($1, $2, $3, $4, $5, $6, 0, 0, $6, $7, 'Auto-generated on due date')
        RETURNING id
      `, [invoiceNo, row.student_id, row.enrollment_id, todayStr, dueDateStr, pending, invStatus])).rows[0]

      await client.query(`
        INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, tax_rate, line_total)
        VALUES ($1, $2, 1, $3, 0, $3)
      `, [invRow.id, desc, pending])

      created++
    }

    await client.query('COMMIT')
    return { ok: true, created, date: todayStr }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
