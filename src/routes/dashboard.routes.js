import { Router } from 'express'
import { query } from '../config/db.js'
import { addDays, kolkataToday } from '../lib/autoInvoices.js'
import { HttpError } from '../middleware/errorHandler.js'

const router = Router()

function resolveReportRange(rangeParam, fromParam, toParam) {
  const today = kolkataToday()
  const [y, m] = today.split('-').map(Number)
  const monthStart = (offsetMonths) => {
    const dt = new Date(Date.UTC(y, m - 1 + offsetMonths, 1))
    return dt.toISOString().slice(0, 10)
  }

  const r = (rangeParam || 'halfyearly').toLowerCase()
  let start = monthStart(-5)
  let end = today
  let granularity = 'month'

  if (r === 'weekly') {
    start = addDays(today, -6)
    granularity = 'day'
  } else if (r === 'monthly') {
    start = addDays(today, -29)
    granularity = 'day'
  } else if (r === 'quarterly') {
    start = monthStart(-2)
    granularity = 'month'
  } else if (r === 'halfyearly') {
    start = monthStart(-5)
    granularity = 'month'
  } else if (r === 'yearly') {
    start = monthStart(-11)
    granularity = 'month'
  } else if (r === 'custom') {
    if (!fromParam || !toParam || !/^\d{4}-\d{2}-\d{2}$/.test(fromParam) || !/^\d{4}-\d{2}-\d{2}$/.test(toParam)) {
      throw new HttpError(400, 'Valid from and to dates (YYYY-MM-DD) are required for custom range', 'INVALID_RANGE')
    }
    if (fromParam > toParam) {
      throw new HttpError(400, 'From date cannot be after To date', 'INVALID_RANGE')
    }
    start = fromParam
    end = toParam
    const diffDays = Math.round((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000)
    granularity = diffDays <= 45 ? 'day' : 'month'
  }

  return { range: r, start, end, granularity }
}

router.get('/reports', async (req, res) => {
  const { range, start, end, granularity } = resolveReportRange(req.query.range, req.query.from, req.query.to)

  const [
    seriesRows,
    courseDistribution,
    pendingFeesRow,
    enquirySummaryRow,
    expenseCountRow,
  ] = await Promise.all([
    granularity === 'day'
      ? query(`
          WITH days AS (
            SELECT d::date AS day_date, TO_CHAR(d, 'DD Mon') AS label
              FROM generate_series($1::date, $2::date, '1 day') AS d
          )
          SELECT d.label,
                 COALESCE((
                   SELECT SUM(p.amount)::int
                     FROM payments p
                     JOIN students s ON s.id = p.student_id
                    WHERE p.payment_date = d.day_date
                      AND p.status = 'completed'
                      AND s.deleted_at IS NULL
                 ), 0) AS revenue,
                 COALESCE((
                   SELECT SUM(ex.amount)::int
                     FROM expenses ex
                    WHERE ex.expense_date = d.day_date
                 ), 0) AS expenses,
                 COALESCE((
                   SELECT COUNT(*)::int
                     FROM students s
                    WHERE s.admission_date = d.day_date
                      AND s.deleted_at IS NULL
                 ), 0) AS admissions
            FROM days d
           ORDER BY d.day_date
        `, [start, end])
      : query(`
          WITH months AS (
            SELECT DATE_TRUNC('month', d)::date AS m_start,
                   (DATE_TRUNC('month', d) + INTERVAL '1 month' - INTERVAL '1 day')::date AS m_end,
                   TO_CHAR(d, 'Mon YY') AS label
              FROM generate_series(DATE_TRUNC('month', $1::date), DATE_TRUNC('month', $2::date), '1 month') AS d
          )
          SELECT m.label,
                 COALESCE((
                   SELECT SUM(p.amount)::int
                     FROM payments p
                     JOIN students s ON s.id = p.student_id
                    WHERE p.payment_date BETWEEN GREATEST(m.m_start, $1::date) AND LEAST(m.m_end, $2::date)
                      AND p.status = 'completed'
                      AND s.deleted_at IS NULL
                 ), 0) AS revenue,
                 COALESCE((
                   SELECT SUM(ex.amount)::int
                     FROM expenses ex
                    WHERE ex.expense_date BETWEEN GREATEST(m.m_start, $1::date) AND LEAST(m.m_end, $2::date)
                 ), 0) AS expenses,
                 COALESCE((
                   SELECT COUNT(*)::int
                     FROM students s
                    WHERE s.admission_date BETWEEN GREATEST(m.m_start, $1::date) AND LEAST(m.m_end, $2::date)
                      AND s.deleted_at IS NULL
                 ), 0) AS admissions
            FROM months m
           ORDER BY m.m_start
        `, [start, end]),
    query(`
      SELECT c.name,
             COUNT(s.id)::int AS value
        FROM courses c
        LEFT JOIN enrollments e ON e.course_id = c.id
                               AND e.status IN ('active','completed')
                               AND e.enrolled_on BETWEEN $1::date AND $2::date
        LEFT JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
       WHERE c.deleted_at IS NULL
       GROUP BY c.name
       ORDER BY c.name
    `, [start, end]),
    query(`
      SELECT COALESCE(SUM(GREATEST(0, e.total_fee - e.discount_amount) -
             COALESCE((SELECT SUM(amount_paid) FROM student_fee_installments i WHERE i.enrollment_id = e.id), 0)), 0) AS pending
        FROM enrollments e
        JOIN students s ON s.id = e.student_id
       WHERE e.status IN ('active','completed')
         AND s.deleted_at IS NULL
         AND e.enrolled_on BETWEEN $1::date AND $2::date
    `, [start, end]),
    query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status IN ('converted', 'approved'))::int AS converted,
             COUNT(*) FILTER (WHERE status IN ('new', 'contacted', 'follow_up', 'interested'))::int AS open_count
        FROM enquiries
       WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date
    `, [start, end]),
    query(`
      SELECT COUNT(*)::int AS count
        FROM expenses
       WHERE expense_date BETWEEN $1::date AND $2::date
    `, [start, end]),
  ])

  const revenue = seriesRows.reduce((a, r) => a + Number(r.revenue || 0), 0)
  const expenses = seriesRows.reduce((a, r) => a + Number(r.expenses || 0), 0)
  const totalEnquiries = Number(enquirySummaryRow[0]?.total ?? 0)
  const convertedEnquiries = Number(enquirySummaryRow[0]?.converted ?? 0)
  const openEnquiries = Number(enquirySummaryRow[0]?.open_count ?? 0)
  const leadConversion = totalEnquiries > 0 ? Math.round((convertedEnquiries / totalEnquiries) * 100) : 0

  res.json({
    range,
    from: start,
    to: end,
    granularity,
    revenue,
    expenses,
    netProfit: revenue - expenses,
    pendingFees: Number(pendingFeesRow[0]?.pending ?? 0),
    totalEnquiries,
    convertedEnquiries,
    openEnquiries,
    leadConversion,
    expenseCount: Number(expenseCountRow[0]?.count ?? 0),
    series: seriesRows,
    courseDistribution,
  })
})

router.get('/stats', async (_req, res) => {
  // Run all aggregate queries in parallel
  const [
    studentCounts,
    staffCount,
    pendingFees,
    openEnquiries,
    recentStudents,
    courseDistribution,
  ] = await Promise.all([
    query(`
      SELECT COUNT(*) FILTER (WHERE deleted_at IS NULL) AS total,
             COUNT(*) FILTER (WHERE status = 'active' AND deleted_at IS NULL) AS active
        FROM students
    `),
    query(`SELECT COUNT(*) AS count FROM staff WHERE deleted_at IS NULL`),
    query(`
      SELECT COALESCE(SUM(GREATEST(0, e.total_fee - e.discount_amount) -
             COALESCE((SELECT SUM(amount_paid) FROM student_fee_installments i WHERE i.enrollment_id = e.id), 0)), 0) AS pending
        FROM enrollments e
        JOIN students s ON s.id = e.student_id
       WHERE e.status IN ('active','completed') AND s.deleted_at IS NULL
    `),
    query(`SELECT COUNT(*) AS count FROM enquiries WHERE status IN ('new','contacted','follow_up','interested')`),
    query(`
      SELECT s.student_no AS id,
             TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS name,
             c.name AS course, s.admission_date AS "admissionDate", s.status
        FROM students s
        LEFT JOIN enrollments e ON e.student_id = s.id AND e.status IN ('active','completed')
        LEFT JOIN courses c ON c.id = e.course_id
       WHERE s.deleted_at IS NULL
       ORDER BY s.admission_date DESC LIMIT 5
    `),
    query(`
      SELECT c.name,
             COUNT(s.id)::int AS value
        FROM courses c
        LEFT JOIN enrollments e ON e.course_id = c.id AND e.status IN ('active','completed')
        LEFT JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
       WHERE c.deleted_at IS NULL
       GROUP BY c.name ORDER BY c.name
    `),
  ])

  // Revenue/expenses — last 6 months
  const revenueExpenses = await query(`
    WITH months AS (
      SELECT TO_CHAR(d, 'Mon') AS month, d AS start_date,
             (d + INTERVAL '1 month' - INTERVAL '1 day')::date AS end_date
        FROM generate_series(
               DATE_TRUNC('month', NOW()) - INTERVAL '5 months',
               DATE_TRUNC('month', NOW()),
               '1 month'
             ) AS d
    )
    SELECT m.month,
           COALESCE((
             SELECT SUM(p.amount)::int
               FROM payments p
               JOIN students s ON s.id = p.student_id
              WHERE p.payment_date BETWEEN m.start_date AND m.end_date
                AND p.status = 'completed'
                AND s.deleted_at IS NULL
           ), 0) AS revenue,
           COALESCE((
             SELECT SUM(ex.amount)::int
               FROM expenses ex
              WHERE ex.expense_date BETWEEN m.start_date AND m.end_date
           ), 0) AS expenses
      FROM months m ORDER BY m.start_date
  `)

  // Admissions — last 6 months
  const admissions = await query(`
    WITH months AS (
      SELECT TO_CHAR(d, 'Mon') AS month, d AS start_date,
             (d + INTERVAL '1 month' - INTERVAL '1 day')::date AS end_date
        FROM generate_series(
               DATE_TRUNC('month', NOW()) - INTERVAL '5 months',
               DATE_TRUNC('month', NOW()),
               '1 month'
             ) AS d
    )
    SELECT m.month,
           COUNT(s.id)::int AS admissions
      FROM months m
      LEFT JOIN students s ON s.admission_date BETWEEN m.start_date AND m.end_date AND s.deleted_at IS NULL
     GROUP BY m.month, m.start_date ORDER BY m.start_date
  `)

  res.json({
    totalStudents: Number(studentCounts[0]?.total ?? 0),
    activeStudents: Number(studentCounts[0]?.active ?? 0),
    staffMembers: Number(staffCount[0]?.count ?? 0),
    pendingFees: Number(pendingFees[0]?.pending ?? 0),
    openEnquiries: Number(openEnquiries[0]?.count ?? 0),
    recentStudents: recentStudents.map((r) => ({
      id: r.id,
      name: r.name,
      course: r.course ?? '',
      admissionDate: r.admissionDate?.toISOString?.().slice(0, 10) ?? '',
      status: r.status ? r.status.charAt(0).toUpperCase() + r.status.slice(1) : '',
    })),
    courseDistribution,
    revenueMonthly: revenueExpenses,
    admissionsMonthly: admissions,
  })
})

export default router
