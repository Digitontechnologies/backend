import crypto from 'node:crypto'
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { query, pool } from '../config/db.js'
import { HttpError } from '../middleware/errorHandler.js'

const router = Router()
const titleCase = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s

function mapDesignationToRole(designation) {
  const d = (designation || '').toLowerCase()
  if (d.includes('admin')) return 'admin'
  if (d.includes('accountant')) return 'accountant'
  if (d.includes('instructor') || d.includes('lab')) return 'instructor'
  return 'receptionist'
}

function shape(r) {
  return {
    id: r.staff_no,
    name: [r.first_name, r.last_name].filter(Boolean).join(' '),
    email: r.email,
    phone: r.phone,
    role: titleCase(r.designation?.replace('_', ' ')),
    department: titleCase(r.department),
    salary: Number(r.monthly_salary),
    joinDate: r.join_date?.toISOString?.().slice(0, 10) ?? r.join_date ?? '',
    status: titleCase(r.status?.replace('_', ' ')),
    userId: r.user_id ?? null,
    _dbId: r.id,
  }
}

const LIST_SQL = `
  SELECT * FROM staff WHERE deleted_at IS NULL ORDER BY created_at DESC
`

router.get('/', async (_req, res) => {
  const rows = await query(LIST_SQL)
  res.json(rows.map(shape))
})

router.get('/:id', async (req, res) => {
  const rows = await query(`SELECT * FROM staff WHERE staff_no = $1 AND deleted_at IS NULL`, [req.params.id])
  if (!rows.length) throw new HttpError(404, 'Staff not found', 'NOT_FOUND')
  res.json(shape(rows[0]))
})

router.post('/', async (req, res) => {
  const b = req.body
  const fullName = (b.name || '').trim()
  const parts = fullName.split(/\s+/)
  const firstName = parts[0] || ''
  const lastName = parts.slice(1).join(' ') || null
  const email = (b.email || '').trim().toLowerCase()
  const designation = (b.role || 'instructor').toLowerCase().replace(/\s+/g, '_')
  const status = (b.status || 'active').toLowerCase().replace(/\s+/g, '_')
  const roleName = mapDesignationToRole(b.role)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // 1. Create or find linked user account in `users`
    let userId = null
    const existingUser = (await client.query(`SELECT id FROM users WHERE LOWER(email) = $1`, [email])).rows[0]
    if (existingUser) {
      userId = existingUser.id
    } else {
      const initialPassword = b.password || process.env.SEED_DEFAULT_PASSWORD || crypto.randomBytes(12).toString('hex')
      const hash = await bcrypt.hash(initialPassword, 12)
      const uRow = (await client.query(
        `INSERT INTO users (full_name, email, phone, password_hash, is_active)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [fullName, email, b.phone || null, hash, status !== 'inactive'],
      )).rows[0]
      userId = uRow.id
    }

    // 2. Assign role in `user_roles`
    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, r.id FROM roles r WHERE r.name = $2
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [userId, roleName],
    )

    // 3. Generate staff_no
    const year = new Date().getFullYear()
    const seqRow = (await client.query(
      `INSERT INTO document_sequences (prefix, year, next_value)
       VALUES ('STF', $1, 1)
       ON CONFLICT (prefix, year) DO UPDATE SET next_value = document_sequences.next_value + 1, updated_at = NOW()
       RETURNING next_value`,
      [year],
    )).rows[0]
    const staffNo = `STF-${year}-${seqRow.next_value.toString().padStart(4, '0')}`

    // 4. Insert staff linked to `user_id`
    const row = (await client.query(`
      INSERT INTO staff (staff_no, user_id, first_name, last_name, email, phone, designation, department, monthly_salary, join_date, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING id
    `, [
      staffNo, userId, firstName, lastName,
      email, b.phone, designation,
      (b.department || '').toLowerCase(),
      Number(b.salary || 0),
      b.joinDate, status,
    ])).rows[0]

    await client.query('COMMIT')
    res.status(201).json({ id: staffNo, userId, _dbId: row.id })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

router.put('/:id', async (req, res) => {
  const b = req.body
  const fullName = (b.name || '').trim()
  const parts = fullName.split(/\s+/)
  const firstName = parts[0] || ''
  const lastName = parts.slice(1).join(' ') || null
  const email = (b.email || '').trim().toLowerCase()
  const designation = (b.role || 'instructor').toLowerCase().replace(/\s+/g, '_')
  const status = (b.status || 'active').toLowerCase().replace(/\s+/g, '_')
  const roleName = mapDesignationToRole(b.role)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = (await client.query(`
      UPDATE staff SET first_name=$1, last_name=$2, email=$3, phone=$4,
             designation=$5, department=$6, monthly_salary=$7, join_date=$8, status=$9
       WHERE staff_no=$10 AND deleted_at IS NULL
       RETURNING id, user_id
    `, [
      firstName, lastName, email, b.phone, designation,
      (b.department || '').toLowerCase(),
      Number(b.salary || 0), b.joinDate, status, req.params.id,
    ])).rows

    if (!result.length) {
      await client.query('ROLLBACK')
      throw new HttpError(404, 'Staff not found', 'NOT_FOUND')
    }

    const userId = result[0].user_id
    if (userId) {
      await client.query(
        `UPDATE users SET full_name = $1, email = $2, phone = $3, is_active = $4 WHERE id = $5`,
        [fullName, email, b.phone || null, status !== 'inactive', userId],
      )
      await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [userId])
      await client.query(
        `INSERT INTO user_roles (user_id, role_id)
         SELECT $1, r.id FROM roles r WHERE r.name = $2
         ON CONFLICT DO NOTHING`,
        [userId, roleName],
      )
    }

    await client.query('COMMIT')
    res.json({ ok: true })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

router.delete('/:id', async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = (await client.query(
      `UPDATE staff SET deleted_at = NOW(), status = 'inactive' WHERE staff_no = $1 AND deleted_at IS NULL RETURNING id, user_id`,
      [req.params.id],
    )).rows
    if (!result.length) {
      await client.query('ROLLBACK')
      throw new HttpError(404, 'Staff not found', 'NOT_FOUND')
    }
    if (result[0].user_id) {
      await client.query(`UPDATE users SET is_active = FALSE WHERE id = $1`, [result[0].user_id])
    }
    await client.query('COMMIT')
    res.json({ ok: true })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

export default router
