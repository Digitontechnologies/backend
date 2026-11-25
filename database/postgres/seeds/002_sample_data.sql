-- backend/database/postgres/seeds/002_sample_data.sql
-- Sample data for local development and UI demonstration.
-- Uses CTEs and RETURNING to chain inserts without MySQL-style session variables.
-- Safe to skip if 001_reference_data has not been seeded.
-- Note: users and their roles are inserted by pg_seed.js (bcrypt hashing requires Node.js).

-- ── Helper: look up seeded user IDs ───────────────────────────────────────────
-- These will be referenced via sub-selects throughout this file.

-- ── Courses ───────────────────────────────────────────────────────────────────
INSERT INTO courses (code, name, description, duration_months, base_fee, status) VALUES
  ('FSD', 'Full Stack Development',
   'Comprehensive full-stack web development using React, Node.js and PostgreSQL.', 6, 55000.00, 'active'),
  ('DS',  'Data Science',
   'Python, statistics, machine learning and data visualization.', 4, 48000.00, 'active'),
  ('DM',  'Digital Marketing',
   'SEO, SEM, social media marketing, email campaigns and analytics.', 3, 28000.00, 'active'),
  ('UX',  'UI/UX Design',
   'User research, wireframing, Figma prototyping and usability testing.', 3, 32000.00, 'active')
ON CONFLICT (code) DO NOTHING;

-- ── Fee structures (one per course) ──────────────────────────────────────────
INSERT INTO fee_structures (course_id, name, total_amount, installment_count, installment_gap_days, is_active)
SELECT c.id, 'Standard Plan', c.base_fee, 3, 30, TRUE
FROM courses c
WHERE c.code IN ('FSD','DS','DM','UX')
ON CONFLICT (course_id, name) DO NOTHING;

-- ── Staff ─────────────────────────────────────────────────────────────────────
INSERT INTO staff (staff_no, first_name, last_name, email, phone, designation, department, monthly_salary, join_date, status)
VALUES
  ('STF-2026-0001', 'Priya',  'Sharma',  'priya.sharma@institutepro.local',  '9800000001', 'Senior Instructor', 'Technology',    55000.00, '2024-03-01', 'active'),
  ('STF-2026-0002', 'Arjun',  'Nair',    'arjun.nair@institutepro.local',    '9800000002', 'Instructor',        'Data Science',  48000.00, '2024-07-15', 'active'),
  ('STF-2026-0003', 'Meera',  'Reddy',   'meera.reddy@institutepro.local',   '9800000003', 'Instructor',        'Design',        45000.00, '2025-01-10', 'active')
ON CONFLICT (staff_no) DO NOTHING;

-- ── Batches ───────────────────────────────────────────────────────────────────
INSERT INTO batches (code, course_id, instructor_id, name, start_date, end_date, start_time, end_time, capacity, status)
SELECT 'FSD-MORN-26', c.id, s.id, 'Full Stack - Morning Batch 2026',
       '2026-08-01', '2027-01-31', '09:00', '12:00', 25, 'ongoing'
FROM courses c, staff s WHERE c.code = 'FSD' AND s.staff_no = 'STF-2026-0001'
ON CONFLICT (code) DO NOTHING;

INSERT INTO batches (code, course_id, instructor_id, name, start_date, end_date, start_time, end_time, capacity, status)
SELECT 'DS-EVE-26', c.id, s.id, 'Data Science - Evening Batch 2026',
       '2026-09-01', '2026-12-31', '17:00', '20:00', 20, 'ongoing'
FROM courses c, staff s WHERE c.code = 'DS' AND s.staff_no = 'STF-2026-0002'
ON CONFLICT (code) DO NOTHING;

-- ── Students ──────────────────────────────────────────────────────────────────
INSERT INTO students
  (student_no, first_name, last_name, date_of_birth, gender, phone, email,
   address, parent_name, parent_phone, admission_date, status)
VALUES
  ('STU-2026-0001','Aarav','Sharma','2002-05-14','male','9900000001','aarav.sharma@example.com',
   '12, MG Road, Bengaluru','Rajesh Sharma','9900000011','2026-08-01','active'),
  ('STU-2026-0002','Diya','Patel','2001-11-22','female','9900000002','diya.patel@example.com',
   '34, HSR Layout, Bengaluru','Suresh Patel','9900000012','2026-08-01','active'),
  ('STU-2026-0003','Rohan','Verma','2000-07-30','male','9900000003','rohan.verma@example.com',
   '56, Koramangala, Bengaluru','Deepak Verma','9900000013','2026-08-01','completed'),
  ('STU-2026-0004','Ananya','Reddy','2003-02-18','female','9900000004','ananya.reddy@example.com',
   '78, Whitefield, Bengaluru','Srikanth Reddy','9900000014','2026-08-01','active'),
  ('STU-2026-0005','Ishaan','Khan','2001-09-05','male','9900000005','ishaan.khan@example.com',
   '90, Indiranagar, Bengaluru','Farhan Khan','9900000015','2026-08-15','active'),
  ('STU-2026-0006','Kavya','Iyer','2002-03-12','female','9900000006','kavya.iyer@example.com',
   '11, Jayanagar, Bengaluru','Krishnan Iyer','9900000016','2026-09-01','active')
ON CONFLICT (student_no) DO NOTHING;

-- ── Enrollments ───────────────────────────────────────────────────────────────
INSERT INTO enrollments (student_id, course_id, batch_id, fee_structure_id, enrolled_on, total_fee, discount_amount, status)
SELECT s.id, b.course_id, b.id, f.id, '2026-08-01', 55000.00, 0.00, 'active'
FROM students s, batches b, fee_structures f
WHERE s.student_no = 'STU-2026-0001' AND b.code = 'FSD-MORN-26'
  AND f.course_id = b.course_id AND f.name = 'Standard Plan'
ON CONFLICT (student_id, batch_id) DO NOTHING;

INSERT INTO enrollments (student_id, course_id, batch_id, fee_structure_id, enrolled_on, total_fee, discount_amount, status)
SELECT s.id, b.course_id, b.id, f.id, '2026-08-01', 55000.00, 2750.00, 'active'
FROM students s, batches b, fee_structures f
WHERE s.student_no = 'STU-2026-0002' AND b.code = 'FSD-MORN-26'
  AND f.course_id = b.course_id AND f.name = 'Standard Plan'
ON CONFLICT (student_id, batch_id) DO NOTHING;

INSERT INTO enrollments (student_id, course_id, batch_id, fee_structure_id, enrolled_on, total_fee, discount_amount, status)
SELECT s.id, b.course_id, b.id, f.id, '2026-08-01', 48000.00, 0.00, 'completed'
FROM students s, batches b, fee_structures f
WHERE s.student_no = 'STU-2026-0003' AND b.code = 'DS-EVE-26'
  AND f.course_id = b.course_id AND f.name = 'Standard Plan'
ON CONFLICT (student_id, batch_id) DO NOTHING;

INSERT INTO enrollments (student_id, course_id, batch_id, fee_structure_id, enrolled_on, total_fee, discount_amount, status)
SELECT s.id, b.course_id, b.id, f.id, '2026-08-01', 48000.00, 0.00, 'active'
FROM students s, batches b, fee_structures f
WHERE s.student_no = 'STU-2026-0004' AND b.code = 'DS-EVE-26'
  AND f.course_id = b.course_id AND f.name = 'Standard Plan'
ON CONFLICT (student_id, batch_id) DO NOTHING;

INSERT INTO enrollments (student_id, course_id, batch_id, fee_structure_id, enrolled_on, total_fee, discount_amount, status)
SELECT s.id, b.course_id, b.id, f.id, '2026-08-15', 55000.00, 5500.00, 'active'
FROM students s, batches b, fee_structures f
WHERE s.student_no = 'STU-2026-0005' AND b.code = 'FSD-MORN-26'
  AND f.course_id = b.course_id AND f.name = 'Standard Plan'
ON CONFLICT (student_id, batch_id) DO NOTHING;

INSERT INTO enrollments (student_id, course_id, batch_id, fee_structure_id, enrolled_on, total_fee, discount_amount, status)
SELECT s.id, b.course_id, b.id, f.id, '2026-09-01', 48000.00, 0.00, 'active'
FROM students s, batches b, fee_structures f
WHERE s.student_no = 'STU-2026-0006' AND b.code = 'DS-EVE-26'
  AND f.course_id = b.course_id AND f.name = 'Standard Plan'
ON CONFLICT (student_id, batch_id) DO NOTHING;

-- ── Fee installments (3 per enrollment) ──────────────────────────────────────
INSERT INTO student_fee_installments
  (enrollment_id, installment_no, due_date, amount_due, amount_paid, status)
SELECT e.id, 1,
       e.enrolled_on,
       ROUND(e.total_fee * 0.40, 2),
       ROUND(e.total_fee * 0.40, 2),
       'paid'
FROM enrollments e
ON CONFLICT (enrollment_id, installment_no) DO NOTHING;

INSERT INTO student_fee_installments
  (enrollment_id, installment_no, due_date, amount_due, amount_paid, status)
SELECT e.id, 2,
       e.enrolled_on + INTERVAL '30 days',
       ROUND(e.total_fee * 0.30, 2),
       CASE WHEN e.status = 'completed' THEN ROUND(e.total_fee * 0.30, 2)
            WHEN e.student_id IN (SELECT id FROM students WHERE student_no IN ('STU-2026-0001','STU-2026-0004')) THEN ROUND(e.total_fee * 0.30, 2)
            ELSE 0.00 END,
       CASE WHEN e.status = 'completed' THEN 'paid'
            WHEN e.student_id IN (SELECT id FROM students WHERE student_no IN ('STU-2026-0001','STU-2026-0004')) THEN 'paid'
            ELSE 'pending' END
FROM enrollments e
ON CONFLICT (enrollment_id, installment_no) DO NOTHING;

INSERT INTO student_fee_installments
  (enrollment_id, installment_no, due_date, amount_due, amount_paid, status)
SELECT e.id, 3,
       e.enrolled_on + INTERVAL '60 days',
       ROUND(e.total_fee * 0.30, 2),
       CASE WHEN e.status = 'completed' THEN ROUND(e.total_fee * 0.30, 2) ELSE 0.00 END,
       CASE WHEN e.status = 'completed' THEN 'paid' ELSE 'pending' END
FROM enrollments e
ON CONFLICT (enrollment_id, installment_no) DO NOTHING;

-- ── Invoices ──────────────────────────────────────────────────────────────────
INSERT INTO invoices (invoice_no, student_id, enrollment_id, issue_date, due_date,
                      subtotal, total_amount, status, created_by)
SELECT
  'INV-2026-' || LPAD(ROW_NUMBER() OVER (ORDER BY s.student_no)::TEXT, 4, '0'),
  s.id, e.id,
  e.enrolled_on,
  e.enrolled_on + INTERVAL '7 days',
  e.total_fee - e.discount_amount,
  e.total_fee - e.discount_amount,
  'paid',
  (SELECT id FROM users WHERE email = 'accounts@institutepro.local' LIMIT 1)
FROM enrollments e
JOIN students s ON s.id = e.student_id
WHERE e.status = 'completed'
ON CONFLICT (invoice_no) DO NOTHING;

-- ── Payments ──────────────────────────────────────────────────────────────────
INSERT INTO payments (student_id, payment_date, amount, method, status, received_by)
SELECT
  s.id,
  e.enrolled_on,
  ROUND((e.total_fee - e.discount_amount) * 0.40, 2),
  'upi',
  'completed',
  (SELECT id FROM users WHERE email = 'accounts@institutepro.local' LIMIT 1)
FROM enrollments e
JOIN students s ON s.id = e.student_id
ON CONFLICT DO NOTHING;

-- ── Document sequences ────────────────────────────────────────────────────────
INSERT INTO document_sequences (prefix, year, next_value) VALUES
  ('STU',  2026, 7),
  ('STF',  2026, 4),
  ('INV',  2026, 5),
  ('RCP',  2026, 9),
  ('CERT', 2026, 3)
ON CONFLICT (prefix, year) DO UPDATE
  SET next_value = GREATEST(document_sequences.next_value, EXCLUDED.next_value);

-- ── Expenses ──────────────────────────────────────────────────────────────────
INSERT INTO expenses (title, category, amount, expense_date, payment_method, vendor, status, created_by, approved_by)
SELECT x.title, x.cat, x.amt, x.dt::DATE, x.meth, x.vendor, x.stat,
  (SELECT id FROM users WHERE email = 'accounts@institutepro.local' LIMIT 1),
  CASE WHEN x.stat = 'approved' THEN (SELECT id FROM users WHERE email = 'admin@institutepro.local' LIMIT 1) ELSE NULL END
FROM (VALUES
  ('November office rent',       'Rent',        60000.00, '2026-11-01', 'bank_transfer', 'City Properties',   'approved'),
  ('Electricity bill - October', 'Utilities',    8200.00, '2026-11-05', 'upi',           'BESCOM',            'approved'),
  ('Instagram ad campaign',      'Marketing',   15000.00, '2026-11-08', 'card',          'Meta Platforms',    'pending'),
  ('Lab laptops maintenance',    'Maintenance',  6500.00, '2026-11-12', 'cash',          'TechCare Services', 'approved')
) AS x(title, cat, amt, dt, meth, vendor, stat);

-- ── Enquiries ─────────────────────────────────────────────────────────────────
INSERT INTO enquiries (name, phone, email, course_id, source, status, follow_up_date, notes, assigned_to)
SELECT x.name, x.phone, x.email, c.id, x.source, x.status, x.fu::DATE, x.notes,
  (SELECT id FROM users WHERE email = 'admin@institutepro.local' LIMIT 1)
FROM (VALUES
  ('Nikhil Gupta',  '9700000001', 'nikhil@example.com',  'FSD', 'website',   'new',       '2026-11-20', 'Asked about weekend batches'),
  ('Pooja Khan',    '9700000002', NULL,                   'DS',  'instagram', 'follow_up', '2026-11-22', 'Wants EMI options'),
  ('Varun Joshi',   '9700000003', 'varun@example.com',   'DM',  'walk_in',   'contacted', '2026-11-19', 'Visited campus'),
  ('Riya Das',      '9700000004', 'riya@example.com',    'UX',  'referral',  'lost',      NULL,         'Joined another institute')
) AS x(name, phone, email, cc, source, status, fu, notes)
JOIN courses c ON c.code = x.cc;

-- ── Notifications ─────────────────────────────────────────────────────────────
INSERT INTO notifications (user_id, type, title, body, link) VALUES
  ((SELECT id FROM users WHERE email = 'admin@institutepro.local' LIMIT 1),
   'fee', 'Overdue installments', '6 installments are overdue. Review the fees module.', '/fees'),
  ((SELECT id FROM users WHERE email = 'admin@institutepro.local' LIMIT 1),
   'enquiry', 'New enquiry', 'Nikhil Gupta enquired about Full Stack Development.', '/enquiries'),
  ((SELECT id FROM users WHERE email = 'accounts@institutepro.local' LIMIT 1),
   'fee', 'Payment received', 'Receipt generated for a payment in the system.', '/receipts'),
  (NULL, 'system', 'Welcome to Institute Pro',
   'Sample data has been loaded for demonstration.', NULL);

-- ── Audit log samples ─────────────────────────────────────────────────────────
INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values, ip_address)
SELECT
  (SELECT id FROM users WHERE email = 'admin@institutepro.local' LIMIT 1),
  'create', 'student', 'STU-2026-0001',
  '{"name":"Aarav Sharma","course":"FSD"}'::JSONB,
  '127.0.0.1';

INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values, ip_address)
SELECT
  (SELECT id FROM users WHERE email = 'accounts@institutepro.local' LIMIT 1),
  'create', 'payment', '1',
  '{"amount":4000,"method":"cash","partial":true}'::JSONB,
  '127.0.0.1';
