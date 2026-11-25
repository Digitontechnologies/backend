import { Router } from 'express'
import { query } from '../config/db.js'
import { HttpError } from '../middleware/errorHandler.js'

const router = Router()
const titleCase = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s

function shape(r) {
  const dur = Number(r.duration_months)
  return {
    id: r.code,
    name: r.name,
    duration: dur === 1 ? '1 Month' : `${dur} Months`,
    fee: Number(r.base_fee),
    instructor: r.instructor_name ?? '',
    seats: Number(r.total_seats ?? 30),
    status: titleCase(r.status),
    description: r.description || '',
    _dbId: r.id,
  }
}

async function resolveInstructorId(name) {
  const clean = (name || '').trim()
  if (!clean) return null
  const rows = await query(
    `SELECT id FROM staff
      WHERE LOWER(TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,''))) = LOWER($1)
        AND deleted_at IS NULL
      LIMIT 1`,
    [clean],
  )
  return rows[0]?.id ?? null
}

const COURSE_SELECT = `
  SELECT c.*,
         COALESCE(
           NULLIF(TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')), ''),
           (SELECT TRIM(COALESCE(s2.first_name,'') || ' ' || COALESCE(s2.last_name,''))
              FROM batches b2 JOIN staff s2 ON s2.id = b2.instructor_id
             WHERE b2.course_id = c.id AND s2.deleted_at IS NULL
             LIMIT 1)
         ) AS instructor_name
    FROM courses c
    LEFT JOIN staff s ON s.id = c.instructor_id AND s.deleted_at IS NULL
`

router.get('/', async (_req, res) => {
  const rows = await query(`${COURSE_SELECT} WHERE c.deleted_at IS NULL ORDER BY c.name`)
  res.json(rows.map(shape))
})

router.get('/:id', async (req, res) => {
  const rows = await query(`${COURSE_SELECT} WHERE c.code = $1 AND c.deleted_at IS NULL`, [req.params.id])
  if (!rows.length) throw new HttpError(404, 'Course not found', 'NOT_FOUND')
  res.json(shape(rows[0]))
})

router.post('/', async (req, res) => {
  const b = req.body
  const code = (b.name || 'CRS').replace(/\s+/g, '-').toUpperCase().slice(0, 20) || 'CRS'
  const durMatch = (b.duration || '').match(/(\d+)/)
  const durMonths = durMatch ? Number(durMatch[1]) : 3
  const instructorId = await resolveInstructorId(b.instructor)
  const totalSeats = Math.max(1, Number(b.seats || 30))

  const row = (await query(`
    INSERT INTO courses (code, name, description, duration_months, base_fee, status, instructor_id, total_seats)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, code
  `, [code, b.name, b.description || null, durMonths, Number(b.fee || 0), (b.status || 'active').toLowerCase(), instructorId, totalSeats]))[0]

  res.status(201).json({ id: row.code, _dbId: row.id })
})

router.put('/:id', async (req, res) => {
  const b = req.body
  const durMatch = (b.duration || '').match(/(\d+)/)
  const durMonths = durMatch ? Number(durMatch[1]) : 3
  const instructorId = await resolveInstructorId(b.instructor)
  const totalSeats = Math.max(1, Number(b.seats || 30))

  const result = await query(`
    UPDATE courses
       SET name=$1, description=$2, duration_months=$3, base_fee=$4, status=$5,
           instructor_id=$6, total_seats=$7
     WHERE code=$8 AND deleted_at IS NULL RETURNING id
  `, [b.name, b.description || null, durMonths, Number(b.fee || 0), (b.status || 'active').toLowerCase(), instructorId, totalSeats, req.params.id])
  if (!result.length) throw new HttpError(404, 'Course not found', 'NOT_FOUND')
  res.json({ ok: true })
})

router.delete('/:id', async (req, res) => {
  const result = await query(
    `UPDATE courses SET deleted_at = NOW(), status = 'inactive' WHERE code = $1 AND deleted_at IS NULL RETURNING id`,
    [req.params.id],
  )
  if (!result.length) throw new HttpError(404, 'Course not found', 'NOT_FOUND')
  res.json({ ok: true })
})

export default router
