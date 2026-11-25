import { Router } from 'express'
import { query } from '../config/db.js'
import { HttpError } from '../middleware/errorHandler.js'

const router = Router()
const titleCase = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s

function shape(r) {
  const mins = Number(r.duration_minutes ?? 120)
  const hrs = mins >= 60 ? `${Math.floor(mins / 60)} hrs` : `${mins} min`
  return {
    id: r.exam_code,
    title: r.title,
    course: r.course_name ?? '',
    date: r.exam_date?.toISOString?.().slice(0, 10) ?? r.exam_date ?? '',
    maxMarks: Number(r.max_marks),
    passMarks: Number(r.pass_marks),
    duration: hrs,
    status: titleCase(r.status),
    _dbId: r.id,
  }
}

router.get('/', async (_req, res) => {
  const rows = await query(`
    SELECT ex.*, c.name AS course_name
      FROM examinations ex
      LEFT JOIN courses c ON c.id = ex.course_id
     ORDER BY ex.exam_date DESC
  `)
  res.json(rows.map(shape))
})

router.get('/:id', async (req, res) => {
  const rows = await query(`
    SELECT ex.*, c.name AS course_name
      FROM examinations ex LEFT JOIN courses c ON c.id = ex.course_id
     WHERE ex.exam_code = $1
  `, [req.params.id])
  if (!rows.length) throw new HttpError(404, 'Exam not found', 'NOT_FOUND')
  res.json(shape(rows[0]))
})

router.post('/', async (req, res) => {
  const b = req.body
  const code = `EXM-${Date.now().toString(36).toUpperCase().slice(-6)}`

  const course = (await query(`SELECT id FROM courses WHERE name = $1 AND deleted_at IS NULL`, [b.course]))[0]
  const courseId = course?.id ?? null

  // Parse duration "2 hrs" -> 120 mins
  const durMatch = (b.duration || '').match(/(\d+)\s*(hr|min)/i)
  const durationMins = durMatch
    ? (durMatch[2].toLowerCase().startsWith('hr') ? Number(durMatch[1]) * 60 : Number(durMatch[1]))
    : 120

  const row = (await query(`
    INSERT INTO examinations (exam_code, course_id, title, exam_date, duration_minutes, max_marks, pass_marks, status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id
  `, [code, courseId, b.title, b.date, durationMins, Number(b.maxMarks || 100), Number(b.passMarks || 40), (b.status || 'scheduled').toLowerCase()]))[0]

  res.status(201).json({ id: code, _dbId: row.id })
})

router.put('/:id', async (req, res) => {
  const b = req.body
  const course = (await query(`SELECT id FROM courses WHERE name = $1 AND deleted_at IS NULL`, [b.course]))[0]
  const durMatch = (b.duration || '').match(/(\d+)\s*(hr|min)/i)
  const durationMins = durMatch
    ? (durMatch[2].toLowerCase().startsWith('hr') ? Number(durMatch[1]) * 60 : Number(durMatch[1]))
    : 120

  const result = await query(`
    UPDATE examinations SET title=$1, course_id=$2, exam_date=$3, duration_minutes=$4,
           max_marks=$5, pass_marks=$6, status=$7
     WHERE exam_code=$8 RETURNING id
  `, [b.title, course?.id ?? null, b.date, durationMins, Number(b.maxMarks || 100), Number(b.passMarks || 40), (b.status || 'scheduled').toLowerCase(), req.params.id])
  if (!result.length) throw new HttpError(404, 'Exam not found', 'NOT_FOUND')
  res.json({ ok: true })
})

router.delete('/:id', async (req, res) => {
  const result = await query(
    `UPDATE examinations SET status='cancelled' WHERE exam_code=$1 AND status != 'cancelled' RETURNING id`,
    [req.params.id],
  )
  if (!result.length) throw new HttpError(404, 'Exam not found', 'NOT_FOUND')
  res.json({ ok: true })
})

export default router
