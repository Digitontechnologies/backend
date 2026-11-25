import { Router } from 'express'
import { query } from '../config/db.js'
import { HttpError } from '../middleware/errorHandler.js'

const router = Router()
const titleCase = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s

function fmtTime(t) {
  if (!t) return ''
  // t might be a string like "09:00:00" or a Date
  const s = typeof t === 'string' ? t : t.toISOString?.().slice(11, 16) ?? ''
  return s.slice(0, 5) // "09:00"
}

function shape(r) {
  const start = fmtTime(r.start_time)
  const end = fmtTime(r.end_time)
  return {
    id: r.code,
    name: r.name,
    course: r.course_name ?? '',
    timing: start && end ? `${start} – ${end}` : start || end || '',
    startDate: r.start_date?.toISOString?.().slice(0, 10) ?? r.start_date ?? '',
    capacity: Number(r.capacity),
    enrolled: Number(r.enrolled_count ?? 0),
    status: titleCase(r.status),
    _dbId: r.id,
  }
}

router.get('/', async (_req, res) => {
  const rows = await query(`
    SELECT b.*,
           c.name AS course_name,
           (SELECT COUNT(*) FROM enrollments e WHERE e.batch_id = b.id AND e.status IN ('active','completed'))::int AS enrolled_count
      FROM batches b
      LEFT JOIN courses c ON c.id = b.course_id
     ORDER BY b.start_date DESC
  `)
  res.json(rows.map(shape))
})

router.get('/:id', async (req, res) => {
  const rows = await query(`
    SELECT b.*,
           c.name AS course_name,
           (SELECT COUNT(*) FROM enrollments e WHERE e.batch_id = b.id AND e.status IN ('active','completed'))::int AS enrolled_count
      FROM batches b
      LEFT JOIN courses c ON c.id = b.course_id
     WHERE b.code = $1
  `, [req.params.id])
  if (!rows.length) throw new HttpError(404, 'Batch not found', 'NOT_FOUND')
  res.json(shape(rows[0]))
})

router.post('/', async (req, res) => {
  const b = req.body
  const code = (b.name || 'BAT').replace(/\s+/g, '-').toUpperCase().slice(0, 30) || 'BAT'

  // Find course_id from name
  const course = (await query(`SELECT id FROM courses WHERE name = $1 AND deleted_at IS NULL`, [b.course]))[0]
  if (!course) throw new HttpError(400, `Course "${b.course}" not found`, 'INVALID_COURSE')

  // Parse timing "09:00 – 11:00"
  const timeParts = (b.timing || '').split(/\s*[–-]\s*/)
  const startTime = timeParts[0]?.trim() || null
  const endTime = timeParts[1]?.trim() || null

  const row = (await query(`
    INSERT INTO batches (code, course_id, name, start_date, start_time, end_time, capacity, status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, code
  `, [code, course.id, b.name, b.startDate, startTime, endTime, Number(b.capacity || 30), (b.status || 'upcoming').toLowerCase()]))[0]

  res.status(201).json({ id: row.code, _dbId: row.id })
})

router.put('/:id', async (req, res) => {
  const b = req.body
  const course = (await query(`SELECT id FROM courses WHERE name = $1 AND deleted_at IS NULL`, [b.course]))[0]
  const courseId = course?.id ?? null

  const timeParts = (b.timing || '').split(/\s*[–-]\s*/)
  const startTime = timeParts[0]?.trim() || null
  const endTime = timeParts[1]?.trim() || null

  const result = await query(`
    UPDATE batches SET name=$1, course_id=$2, start_date=$3, start_time=$4, end_time=$5,
           capacity=$6, status=$7
     WHERE code=$8 RETURNING id
  `, [b.name, courseId, b.startDate, startTime, endTime, Number(b.capacity || 30), (b.status || 'upcoming').toLowerCase(), req.params.id])
  if (!result.length) throw new HttpError(404, 'Batch not found', 'NOT_FOUND')
  res.json({ ok: true })
})

router.delete('/:id', async (req, res) => {
  const result = await query(`DELETE FROM batches WHERE code = $1 RETURNING id`, [req.params.id])
  if (!result.length) throw new HttpError(404, 'Batch not found', 'NOT_FOUND')
  res.json({ ok: true })
})

export default router
