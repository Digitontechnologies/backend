import { Router } from 'express'
import { query, pool } from '../config/db.js'
import { HttpError } from '../middleware/errorHandler.js'

const router = Router()
const titleCase = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s

// ── GET /api/attendance/students?batch=NAME&date=YYYY-MM-DD ───────────────────
// Lists students in a batch with their attendance status for the given date.
router.get('/students', async (req, res) => {
  const { batch, date } = req.query
  let batchFilter = ''
  const params = []

  if (batch) {
    params.push(batch)
    batchFilter = `AND b.name = $${params.length}`
  }

  const targetDate = date || new Date().toISOString().slice(0, 10)

  const rows = await query(`
    SELECT s.student_no AS id,
           TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS name,
           b.name AS sub,
           sa.status AS att_status,
           s.admission_date
      FROM students s
      JOIN enrollments e ON e.student_id = s.id AND e.status IN ('active','completed')
      JOIN batches b     ON b.id = e.batch_id ${batchFilter}
      LEFT JOIN student_attendance sa ON sa.student_id = s.id AND sa.batch_id = b.id
                                     AND sa.attendance_date = $${params.length + 1}
     WHERE s.deleted_at IS NULL
     ORDER BY s.first_name, s.last_name
  `, [...params, targetDate])

  res.json(rows.map((r) => ({
    id: r.id,
    name: r.name,
    sub: r.sub,
    admissionDate: r.admission_date
      ? (r.admission_date instanceof Date ? r.admission_date.toISOString().slice(0, 10) : String(r.admission_date).slice(0, 10))
      : null,
    status: r.att_status ? titleCase(r.att_status) : 'Present',
  })))
})

// ── GET /api/attendance/staff?date=YYYY-MM-DD ─────────────────────────────────
router.get('/staff', async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10)
  const rows = await query(`
    SELECT st.staff_no AS id,
           TRIM(COALESCE(st.first_name,'') || ' ' || COALESCE(st.last_name,'')) AS name,
           st.designation AS sub,
           sa.status AS att_status
      FROM staff st
      LEFT JOIN staff_attendance sa ON sa.staff_id = st.id AND sa.attendance_date = $1
     WHERE st.deleted_at IS NULL
       AND (st.join_date IS NULL OR st.join_date <= $1::date)
     ORDER BY st.first_name, st.last_name
  `, [date])

  res.json(rows.map((r) => ({
    id: r.id,
    name: r.name,
    sub: titleCase(r.sub?.replace('_', ' ')),
    status: r.att_status ? titleCase(r.att_status) : 'Present',
  })))
})

// ── POST /api/attendance/students ─────────────────────────────────────────────
// Body: { date, records: [{ studentNo, batchName, status }] }
router.post('/students', async (req, res) => {
  const { date, records } = req.body
  if (!date || !Array.isArray(records)) throw new HttpError(400, 'date and records[] required', 'INVALID_INPUT')

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    let saved = 0
    for (const r of records) {
      const student = (await client.query(
        `SELECT id FROM students WHERE student_no = $1 AND deleted_at IS NULL AND (admission_date IS NULL OR admission_date <= $2::date)`,
        [r.studentNo, date],
      )).rows[0]
      const batch = (await client.query(`SELECT id FROM batches WHERE name = $1`, [r.batchName])).rows[0]
      if (!student || !batch) continue

      await client.query(`
        INSERT INTO student_attendance (student_id, batch_id, attendance_date, status)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (student_id, batch_id, attendance_date)
        DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()
      `, [student.id, batch.id, date, (r.status || 'present').toLowerCase()])
      saved++
    }
    await client.query('COMMIT')
    res.json({ ok: true, saved })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

// ── POST /api/attendance/staff ────────────────────────────────────────────────
// Body: { date, records: [{ staffNo, status }] }
router.post('/staff', async (req, res) => {
  const { date, records } = req.body
  if (!date || !Array.isArray(records)) throw new HttpError(400, 'date and records[] required', 'INVALID_INPUT')

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    let saved = 0
    for (const r of records) {
      const staff = (await client.query(
        `SELECT id FROM staff WHERE staff_no = $1 AND deleted_at IS NULL AND (join_date IS NULL OR join_date <= $2::date)`,
        [r.staffNo, date],
      )).rows[0]
      if (!staff) continue

      await client.query(`
        INSERT INTO staff_attendance (staff_id, attendance_date, status)
        VALUES ($1, $2, $3)
        ON CONFLICT (staff_id, attendance_date)
        DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()
      `, [staff.id, date, (r.status || 'present').toLowerCase()])
      saved++
    }
    await client.query('COMMIT')
    res.json({ ok: true, saved })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

// ── GET /api/attendance/batches ───────────────────────────────────────────────
// Returns batch names for the filter dropdown.
router.get('/batches', async (_req, res) => {
  const rows = await query(`SELECT name FROM batches ORDER BY name`)
  res.json(rows.map((r) => r.name))
})

export default router
