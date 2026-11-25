import { Router } from 'express'
import { query } from '../config/db.js'
import { HttpError } from '../middleware/errorHandler.js'

const router = Router()

function shape(r) {
  return {
    id: `n${r.id}`,
    title: r.title,
    body: r.body ?? '',
    time: formatTime(r.created_at),
    type: r.type ?? 'system',
    read: r.is_read ?? false,
    _dbId: r.id,
  }
}

function formatTime(ts) {
  if (!ts) return ''
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? 's' : ''} ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Yesterday'
  return `${days} days ago`
}

router.get('/', async (_req, res) => {
  const rows = await query(`SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100`)
  res.json(rows.map(shape))
})

router.put('/:id/read', async (req, res) => {
  const dbId = (req.params.id || '').replace('n', '')
  const result = await query(`UPDATE notifications SET is_read = TRUE WHERE id = $1 RETURNING id`, [dbId])
  if (!result.length) throw new HttpError(404, 'Notification not found', 'NOT_FOUND')
  res.json({ ok: true })
})

router.put('/mark-all-read', async (_req, res) => {
  await query(`UPDATE notifications SET is_read = TRUE WHERE is_read = FALSE`)
  res.json({ ok: true })
})

export default router
