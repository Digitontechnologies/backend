import { Router } from 'express'
import { query } from '../config/db.js'
import { HttpError } from '../middleware/errorHandler.js'

const router = Router()
const titleCase = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s

const SOURCE_MAP = {
  website: 'Website',
  walk_in: 'Walk-in',
  instagram: 'Instagram',
  referral: 'Referral',
  google_ads: 'Google Ads',
}

const STATUS_MAP = {
  new: 'New',
  contacted: 'Contacted',
  follow_up: 'Follow-up',
  converted: 'Converted',
  lost: 'Lost',
}

function shape(r) {
  return {
    id: `ENQ-${r.id}`,
    name: r.name,
    phone: r.phone,
    course: r.course_name ?? '',
    source: SOURCE_MAP[r.source] ?? titleCase(r.source?.replace(/_/g, ' ')),
    date: r.created_at?.toISOString?.().slice(0, 10) ?? '',
    status: STATUS_MAP[r.status] ?? titleCase(r.status?.replace(/_/g, ' ')),
    notes: r.notes || '',
    _dbId: r.id,
  }
}

router.get('/', async (_req, res) => {
  const rows = await query(`
    SELECT eq.*, c.name AS course_name
      FROM enquiries eq
      LEFT JOIN courses c ON c.id = eq.course_id
     ORDER BY eq.created_at DESC
  `)
  res.json(rows.map(shape))
})

router.get('/:id', async (req, res) => {
  const dbId = (req.params.id || '').replace('ENQ-', '')
  const rows = await query(`
    SELECT eq.*, c.name AS course_name
      FROM enquiries eq LEFT JOIN courses c ON c.id = eq.course_id
     WHERE eq.id = $1
  `, [dbId])
  if (!rows.length) throw new HttpError(404, 'Enquiry not found', 'NOT_FOUND')
  res.json(shape(rows[0]))
})

router.post('/', async (req, res) => {
  const b = req.body
  const course = (await query(`SELECT id FROM courses WHERE name = $1 AND deleted_at IS NULL`, [b.course]))[0]
  const row = (await query(`
    INSERT INTO enquiries (name, phone, course_id, source, status, notes)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING id
  `, [
    b.name, b.phone,
    course?.id ?? null,
    (b.source || 'walk_in').toLowerCase().replace(' ', '_').replace('-', '_'),
    (b.status || 'new').toLowerCase().replace(' ', '_').replace('-', '_'),
    b.notes || null,
  ]))[0]
  res.status(201).json({ id: `ENQ-${row.id}`, _dbId: row.id })
})

router.put('/:id', async (req, res) => {
  const b = req.body
  const dbId = (req.params.id || '').replace('ENQ-', '')
  const course = (await query(`SELECT id FROM courses WHERE name = $1 AND deleted_at IS NULL`, [b.course]))[0]
  const result = await query(`
    UPDATE enquiries SET name=$1, phone=$2, course_id=$3, source=$4, status=$5, notes=$6
     WHERE id=$7 RETURNING id
  `, [
    b.name, b.phone, course?.id ?? null,
    (b.source || 'walk_in').toLowerCase().replace(' ', '_').replace('-', '_'),
    (b.status || 'new').toLowerCase().replace(' ', '_').replace('-', '_'),
    b.notes || null, dbId,
  ])
  if (!result.length) throw new HttpError(404, 'Enquiry not found', 'NOT_FOUND')
  res.json({ ok: true })
})

router.delete('/:id', async (req, res) => {
  const dbId = (req.params.id || '').replace('ENQ-', '')
  const result = await query(`DELETE FROM enquiries WHERE id = $1 RETURNING id`, [dbId])
  if (!result.length) throw new HttpError(404, 'Enquiry not found', 'NOT_FOUND')
  res.json({ ok: true })
})

export default router
