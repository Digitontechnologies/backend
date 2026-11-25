import { Router } from 'express'
import { query, pool } from '../config/db.js'
import { HttpError } from '../middleware/errorHandler.js'

const router = Router()
const titleCase = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s

function shape(r) {
  return {
    id: r.certificate_no,
    student: r.student_name ?? '',
    course: r.course_name ?? '',
    grade: r.grade || '',
    issueDate: r.issue_date?.toISOString?.().slice(0, 10) ?? r.issue_date ?? '',
    status: titleCase(r.status),
    _dbId: r.id,
  }
}

router.get('/', async (_req, res) => {
  const rows = await query(`
    SELECT cert.*,
           TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS student_name,
           c.name AS course_name
      FROM certificates cert
      JOIN students s ON s.id = cert.student_id
      JOIN courses c  ON c.id = cert.course_id
     ORDER BY cert.issue_date DESC
  `)
  res.json(rows.map(shape))
})

router.get('/:id', async (req, res) => {
  const rows = await query(`
    SELECT cert.*,
           TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS student_name,
           c.name AS course_name
      FROM certificates cert
      JOIN students s ON s.id = cert.student_id
      JOIN courses c  ON c.id = cert.course_id
     WHERE cert.certificate_no = $1
  `, [req.params.id])
  if (!rows.length) throw new HttpError(404, 'Certificate not found', 'NOT_FOUND')
  res.json(shape(rows[0]))
})

router.post('/', async (req, res) => {
  const b = req.body
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const year = new Date().getFullYear()
    const seqRow = (await client.query(
      `INSERT INTO document_sequences (prefix, year, next_value)
       VALUES ('CERT', $1, 1)
       ON CONFLICT (prefix, year) DO UPDATE SET next_value = document_sequences.next_value + 1, updated_at = NOW()
       RETURNING next_value`,
      [year],
    )).rows[0]
    const certNo = `CERT-${year}-${seqRow.next_value.toString().padStart(4, '0')}`

    const student = (await client.query(
      `SELECT id FROM students WHERE TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) = $1 AND deleted_at IS NULL LIMIT 1`,
      [b.student],
    )).rows[0]
    if (!student) throw new HttpError(400, `Student "${b.student}" not found`, 'INVALID_STUDENT')

    const course = (await client.query(`SELECT id FROM courses WHERE name = $1 AND deleted_at IS NULL`, [b.course])).rows[0]
    if (!course) throw new HttpError(400, `Course "${b.course}" not found`, 'INVALID_COURSE')

    const row = (await client.query(`
      INSERT INTO certificates (certificate_no, student_id, course_id, issue_date, grade, status)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id
    `, [certNo, student.id, course.id, b.issueDate, b.grade || 'A', (b.status || 'pending').toLowerCase()])).rows[0]

    await client.query('COMMIT')
    res.status(201).json({ id: certNo, _dbId: row.id })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

router.put('/:id', async (req, res) => {
  const b = req.body
  const result = await query(`
    UPDATE certificates SET grade=$1, issue_date=$2, status=$3
     WHERE certificate_no=$4 RETURNING id
  `, [b.grade, b.issueDate, (b.status || 'pending').toLowerCase(), req.params.id])
  if (!result.length) throw new HttpError(404, 'Certificate not found', 'NOT_FOUND')
  res.json({ ok: true })
})

router.delete('/:id', async (req, res) => {
  const result = await query(
    `UPDATE certificates SET status='revoked' WHERE certificate_no=$1 AND status != 'revoked' RETURNING id`,
    [req.params.id],
  )
  if (!result.length) throw new HttpError(404, 'Certificate not found', 'NOT_FOUND')
  res.json({ ok: true })
})

export default router
