import { Router } from 'express'
import { query } from '../config/db.js'

const router = Router()

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
        FROM enrollments e WHERE e.status IN ('active','completed')
    `),
    query(`SELECT COUNT(*) AS count FROM enquiries WHERE status IN ('new','contacted','follow_up')`),
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
             COUNT(e.id)::int AS value
        FROM courses c
        LEFT JOIN enrollments e ON e.course_id = c.id AND e.status IN ('active','completed')
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
           COALESCE((SELECT SUM(amount)::int FROM payments p WHERE p.payment_date BETWEEN m.start_date AND m.end_date AND p.status = 'completed'), 0) AS revenue,
           COALESCE((SELECT SUM(amount)::int FROM expenses ex WHERE ex.expense_date BETWEEN m.start_date AND m.end_date), 0) AS expenses
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
