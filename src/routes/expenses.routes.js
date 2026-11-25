import { Router } from 'express'
import { query } from '../config/db.js'
import { HttpError } from '../middleware/errorHandler.js'

const router = Router()
const titleCase = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s
const fmtMethod = (m) => {
  const map = { upi: 'UPI', cash: 'Cash', card: 'Card', bank_transfer: 'Bank Transfer', cheque: 'Cheque', online: 'Online' }
  return map[(m || '').toLowerCase()] ?? titleCase(m?.replace('_', ' '))
}

function shape(r) {
  return {
    id: `EXP-${r.id}`,
    title: r.title,
    category: titleCase(r.category),
    amount: Number(r.amount),
    date: r.expense_date?.toISOString?.().slice(0, 10) ?? r.expense_date ?? '',
    method: fmtMethod(r.payment_method),
    status: titleCase(r.status),
    _dbId: r.id,
  }
}

router.get('/', async (_req, res) => {
  const rows = await query(`SELECT * FROM expenses ORDER BY expense_date DESC`)
  res.json(rows.map(shape))
})

router.get('/:id', async (req, res) => {
  const dbId = (req.params.id || '').replace('EXP-', '')
  const rows = await query(`SELECT * FROM expenses WHERE id = $1`, [dbId])
  if (!rows.length) throw new HttpError(404, 'Expense not found', 'NOT_FOUND')
  res.json(shape(rows[0]))
})

router.post('/', async (req, res) => {
  const b = req.body
  const row = (await query(`
    INSERT INTO expenses (title, category, amount, expense_date, payment_method, status)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING id
  `, [
    b.title,
    (b.category || 'other').toLowerCase(),
    Number(b.amount || 0),
    b.date,
    (b.method || 'cash').toLowerCase().replace(' ', '_'),
    (b.status || 'pending').toLowerCase(),
  ]))[0]
  res.status(201).json({ id: `EXP-${row.id}`, _dbId: row.id })
})

router.put('/:id', async (req, res) => {
  const b = req.body
  const dbId = (req.params.id || '').replace('EXP-', '')
  const result = await query(`
    UPDATE expenses SET title=$1, category=$2, amount=$3, expense_date=$4,
           payment_method=$5, status=$6
     WHERE id=$7 RETURNING id
  `, [
    b.title,
    (b.category || 'other').toLowerCase(),
    Number(b.amount || 0),
    b.date,
    (b.method || 'cash').toLowerCase().replace(' ', '_'),
    (b.status || 'pending').toLowerCase(),
    dbId,
  ])
  if (!result.length) throw new HttpError(404, 'Expense not found', 'NOT_FOUND')
  res.json({ ok: true })
})

router.delete('/:id', async (req, res) => {
  const dbId = (req.params.id || '').replace('EXP-', '')
  const result = await query(`DELETE FROM expenses WHERE id = $1 RETURNING id`, [dbId])
  if (!result.length) throw new HttpError(404, 'Expense not found', 'NOT_FOUND')
  res.json({ ok: true })
})

export default router
