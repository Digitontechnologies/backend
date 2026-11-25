-- Seed 002: SAMPLE DATA for development / demonstration only. Do not load in production.
-- Runs inside one transaction (see src/database/seed.js). Users are created by the seed script
-- first (passwords are bcrypt-hashed in JS), then referenced here by email.

SET @admin_id      = (SELECT id FROM users WHERE email = 'admin@institutepro.local');
SET @accountant_id = (SELECT id FROM users WHERE email = 'accounts@institutepro.local');
SET @teacher_id    = (SELECT id FROM users WHERE email = 'instructor@institutepro.local');

-- Courses and fee plans ---------------------------------------------------------------
INSERT INTO courses (code, name, description, duration_months, base_fee) VALUES
  ('FSD', 'Full Stack Development', 'React, Node.js and MySQL with real projects', 6, 40000.00),
  ('DS',  'Data Science',           'Python, statistics and machine learning',      6, 50000.00),
  ('DM',  'Digital Marketing',      'SEO, ads, social media and analytics',         3, 25000.00),
  ('UX',  'UI/UX Design',           'Research, wireframing and prototyping',        4, 30000.00);

INSERT INTO fee_structures (course_id, name, total_amount, installment_count, installment_gap_days)
SELECT id, 'Standard Plan', base_fee,
       CASE code WHEN 'FSD' THEN 4 WHEN 'DS' THEN 5 WHEN 'DM' THEN 3 ELSE 4 END, 30
FROM courses;

-- Staff ---------------------------------------------------------------------------------
INSERT INTO staff (staff_no, user_id, first_name, last_name, email, phone, designation, department, monthly_salary, join_date) VALUES
  ('STF-2026-0001', @teacher_id,    'Rahul', 'Mehta', 'rahul.mehta@institutepro.local', '9876500001', 'Instructor', 'Technology',     45000.00, '2025-06-01'),
  ('STF-2026-0002', NULL,           'Priya', 'Nair',  'priya.nair@institutepro.local',  '9876500002', 'Instructor', 'Design',         42000.00, '2025-08-15'),
  ('STF-2026-0003', @accountant_id, 'Sneha', 'Iyer',  'sneha.iyer@institutepro.local',  '9876500003', 'Accountant', 'Administration', 35000.00, '2025-01-10');

-- Batches -------------------------------------------------------------------------------
INSERT INTO batches (code, course_id, instructor_id, name, start_date, end_date, start_time, end_time, capacity, status)
SELECT 'FSD-MORN-26', c.id, s.id, 'FSD Morning Batch', '2026-07-01', '2026-12-31', '09:00:00', '11:00:00', 30, 'ongoing'
FROM courses c, staff s WHERE c.code = 'FSD' AND s.staff_no = 'STF-2026-0001';
INSERT INTO batches (code, course_id, instructor_id, name, start_date, end_date, start_time, end_time, capacity, status)
SELECT 'DS-EVE-26', c.id, s.id, 'Data Science Evening Batch', '2026-07-05', '2027-01-05', '17:00:00', '19:00:00', 30, 'ongoing'
FROM courses c, staff s WHERE c.code = 'DS' AND s.staff_no = 'STF-2026-0001';
INSERT INTO batches (code, course_id, instructor_id, name, start_date, end_date, start_time, end_time, capacity, status)
SELECT 'DM-WKND-26', c.id, s.id, 'Digital Marketing Weekend', '2026-08-15', '2026-11-15', '10:00:00', '13:00:00', 25, 'completed'
FROM courses c, staff s WHERE c.code = 'DM' AND s.staff_no = 'STF-2026-0002';
INSERT INTO batches (code, course_id, instructor_id, name, start_date, end_date, start_time, end_time, capacity, status)
SELECT 'UX-MORN-26', c.id, s.id, 'UI/UX Morning Batch', '2026-09-01', '2026-12-31', '09:30:00', '11:30:00', 20, 'ongoing'
FROM courses c, staff s WHERE c.code = 'UX' AND s.staff_no = 'STF-2026-0002';

-- Students ------------------------------------------------------------------------------
INSERT INTO students (student_no, first_name, last_name, date_of_birth, gender, phone, whatsapp, email, address, parent_name, parent_phone, admission_date, status) VALUES
  ('STU-2026-0001', 'Aarav',  'Sharma', '2003-04-12', 'male',   '9810000001', '9810000001', 'aarav.sharma@example.com',  '12 MG Road, Bengaluru',      'Mr. Sharma', '9910000001', '2026-07-01', 'active'),
  ('STU-2026-0002', 'Diya',   'Patel',  '2002-11-03', 'female', '9810000002', '9810000002', 'diya.patel@example.com',    '45 Indiranagar, Bengaluru',  'Mr. Patel',  '9910000002', '2026-07-05', 'active'),
  ('STU-2026-0003', 'Ishaan', 'Verma',  '2001-08-21', 'male',   '9810000003', NULL,         'ishaan.verma@example.com',  '7 Koramangala, Bengaluru',   'Mrs. Verma', '9910000003', '2026-08-15', 'completed'),
  ('STU-2026-0004', 'Kavya',  'Reddy',  '2004-01-30', 'female', '9810000004', '9810000004', 'kavya.reddy@example.com',   '88 HSR Layout, Bengaluru',   'Mr. Reddy',  '9910000004', '2026-09-01', 'active'),
  ('STU-2026-0005', 'Rohan',  'Singh',  '2003-09-17', 'male',   '9810000005', '9810000005', 'rohan.singh@example.com',   '23 Whitefield, Bengaluru',   'Mr. Singh',  '9910000005', '2026-07-01', 'active'),
  ('STU-2026-0006', 'Meera',  'Nair',   '2002-06-25', 'female', '9810000006', '9810000006', 'meera.nair@example.com',    '9 Jayanagar, Bengaluru',     'Mrs. Nair',  '9910000006', '2026-10-05', 'active');

-- Enrollments (total_fee comes from the fee plan; discounts shown for two students) ------
INSERT INTO enrollments (student_id, course_id, batch_id, fee_structure_id, enrolled_on, total_fee, discount_amount, status)
SELECT s.id, c.id, b.id, f.id, s.admission_date, c.base_fee,
       CASE s.student_no WHEN 'STU-2026-0002' THEN 5000.00 WHEN 'STU-2026-0005' THEN 2000.00 ELSE 0.00 END,
       CASE s.student_no WHEN 'STU-2026-0003' THEN 'completed' ELSE 'active' END
FROM (SELECT 'STU-2026-0001' sn, 'FSD-MORN-26' bc UNION ALL SELECT 'STU-2026-0002','DS-EVE-26'
      UNION ALL SELECT 'STU-2026-0003','DM-WKND-26' UNION ALL SELECT 'STU-2026-0004','UX-MORN-26'
      UNION ALL SELECT 'STU-2026-0005','FSD-MORN-26' UNION ALL SELECT 'STU-2026-0006','DS-EVE-26') m
JOIN students s ON s.student_no = m.sn
JOIN batches b ON b.code = m.bc
JOIN courses c ON c.id = b.course_id
JOIN fee_structures f ON f.course_id = c.id;

SET @s1 = (SELECT id FROM students WHERE student_no = 'STU-2026-0001');
SET @s2 = (SELECT id FROM students WHERE student_no = 'STU-2026-0002');
SET @s3 = (SELECT id FROM students WHERE student_no = 'STU-2026-0003');
SET @s4 = (SELECT id FROM students WHERE student_no = 'STU-2026-0004');
SET @s5 = (SELECT id FROM students WHERE student_no = 'STU-2026-0005');
SET @s6 = (SELECT id FROM students WHERE student_no = 'STU-2026-0006');
SET @e1 = (SELECT id FROM enrollments WHERE student_id = @s1);
SET @e2 = (SELECT id FROM enrollments WHERE student_id = @s2);
SET @e3 = (SELECT id FROM enrollments WHERE student_id = @s3);
SET @e4 = (SELECT id FROM enrollments WHERE student_id = @s4);
SET @e5 = (SELECT id FROM enrollments WHERE student_id = @s5);
SET @e6 = (SELECT id FROM enrollments WHERE student_id = @s6);

-- Installments (amount_paid / status mirror the payments inserted below) -------------------
INSERT INTO student_fee_installments (enrollment_id, installment_no, due_date, amount_due, amount_paid, status) VALUES
  (@e1, 1, '2026-07-01', 10000.00, 10000.00, 'paid'),
  (@e1, 2, '2026-08-01', 10000.00, 10000.00, 'paid'),
  (@e1, 3, '2026-09-01', 10000.00, 10000.00, 'paid'),
  (@e1, 4, '2026-12-01', 10000.00,     0.00, 'pending'),
  (@e2, 1, '2026-07-05',  9000.00,  9000.00, 'paid'),
  (@e2, 2, '2026-08-05',  9000.00,  4000.00, 'partial'),
  (@e2, 3, '2026-09-05',  9000.00,     0.00, 'overdue'),
  (@e2, 4, '2026-10-05',  9000.00,     0.00, 'overdue'),
  (@e2, 5, '2026-12-05',  9000.00,     0.00, 'pending'),
  (@e3, 1, '2026-08-15',  8333.33,  8333.33, 'paid'),
  (@e3, 2, '2026-09-15',  8333.33,     0.00, 'overdue'),
  (@e3, 3, '2026-10-15',  8333.34,     0.00, 'overdue'),
  (@e4, 1, '2026-09-01',  7500.00,  7500.00, 'paid'),
  (@e4, 2, '2026-10-01',  7500.00,  7500.00, 'paid'),
  (@e4, 3, '2026-11-01',  7500.00,     0.00, 'overdue'),
  (@e4, 4, '2026-12-01',  7500.00,     0.00, 'pending'),
  (@e5, 1, '2026-07-01',  9500.00,     0.00, 'overdue'),
  (@e5, 2, '2026-08-01',  9500.00,     0.00, 'overdue'),
  (@e5, 3, '2026-09-01',  9500.00,     0.00, 'overdue'),
  (@e5, 4, '2026-12-01',  9500.00,     0.00, 'pending'),
  (@e6, 1, '2026-10-05', 10000.00, 10000.00, 'paid'),
  (@e6, 2, '2026-11-05', 10000.00,     0.00, 'overdue'),
  (@e6, 3, '2026-12-05', 10000.00,     0.00, 'pending'),
  (@e6, 4, '2027-01-05', 10000.00,     0.00, 'pending'),
  (@e6, 5, '2027-02-05', 10000.00,     0.00, 'pending');

-- Invoices and line items ---------------------------------------------------------------------
INSERT INTO invoices (invoice_no, student_id, enrollment_id, issue_date, due_date, subtotal, total_amount, status, created_by) VALUES
  ('INV-2026-0001', @s1, @e1, '2026-07-01', '2026-09-01', 30000.00, 30000.00, 'paid',    @accountant_id),
  ('INV-2026-0002', @s2, @e2, '2026-07-05', '2026-08-05', 18000.00, 18000.00, 'partial', @accountant_id),
  ('INV-2026-0003', @s5, @e5, '2026-07-01', '2026-07-15',  9500.00,  9500.00, 'overdue', @accountant_id),
  ('INV-2026-0004', @s4, @e4, '2026-09-01', '2026-10-01', 15000.00, 15000.00, 'paid',    @accountant_id);

SET @i1 = (SELECT id FROM invoices WHERE invoice_no = 'INV-2026-0001');
SET @i2 = (SELECT id FROM invoices WHERE invoice_no = 'INV-2026-0002');
SET @i3 = (SELECT id FROM invoices WHERE invoice_no = 'INV-2026-0003');
SET @i4 = (SELECT id FROM invoices WHERE invoice_no = 'INV-2026-0004');

INSERT INTO invoice_items (invoice_id, installment_id, description, quantity, unit_price, line_total)
SELECT @i1, id, CONCAT('Full Stack Development - installment ', installment_no), 1, amount_due, amount_due
  FROM student_fee_installments WHERE enrollment_id = @e1 AND installment_no <= 3;
INSERT INTO invoice_items (invoice_id, installment_id, description, quantity, unit_price, line_total)
SELECT @i2, id, CONCAT('Data Science - installment ', installment_no), 1, amount_due, amount_due
  FROM student_fee_installments WHERE enrollment_id = @e2 AND installment_no <= 2;
INSERT INTO invoice_items (invoice_id, installment_id, description, quantity, unit_price, line_total)
SELECT @i3, id, 'Full Stack Development - installment 1', 1, amount_due, amount_due
  FROM student_fee_installments WHERE enrollment_id = @e5 AND installment_no = 1;
INSERT INTO invoice_items (invoice_id, installment_id, description, quantity, unit_price, line_total)
SELECT @i4, id, CONCAT('UI/UX Design - installment ', installment_no), 1, amount_due, amount_due
  FROM student_fee_installments WHERE enrollment_id = @e4 AND installment_no <= 2;

-- Payments, allocations, receipts. Partial payment: Diya's 4000 against a 9000 installment.
-- Split payment: Kavya's single 15000 payment is allocated across two installments.
INSERT INTO payments (student_id, invoice_id, payment_date, amount, method, reference_no, received_by) VALUES (@s1, @i1, '2026-07-01', 10000.00, 'cash', NULL, @accountant_id);
SET @p1 = LAST_INSERT_ID();
INSERT INTO payments (student_id, invoice_id, payment_date, amount, method, reference_no, received_by) VALUES (@s1, @i1, '2026-08-01', 10000.00, 'upi', 'UPI-884210', @accountant_id);
SET @p2 = LAST_INSERT_ID();
INSERT INTO payments (student_id, invoice_id, payment_date, amount, method, reference_no, received_by) VALUES (@s1, @i1, '2026-09-01', 10000.00, 'upi', 'UPI-991347', @accountant_id);
SET @p3 = LAST_INSERT_ID();
INSERT INTO payments (student_id, invoice_id, payment_date, amount, method, reference_no, received_by) VALUES (@s2, @i2, '2026-07-05',  9000.00, 'card', 'CARD-5521', @accountant_id);
SET @p4 = LAST_INSERT_ID();
INSERT INTO payments (student_id, invoice_id, payment_date, amount, method, reference_no, received_by, remarks) VALUES (@s2, @i2, '2026-08-10',  4000.00, 'cash', NULL, @accountant_id, 'Partial payment, balance 5000 pending');
SET @p5 = LAST_INSERT_ID();
INSERT INTO payments (student_id, invoice_id, payment_date, amount, method, reference_no, received_by) VALUES (@s3, NULL, '2026-08-15',  8333.33, 'upi', 'UPI-120077', @accountant_id);
SET @p6 = LAST_INSERT_ID();
INSERT INTO payments (student_id, invoice_id, payment_date, amount, method, reference_no, received_by, remarks) VALUES (@s4, @i4, '2026-09-01', 15000.00, 'bank_transfer', 'NEFT-77120', @accountant_id, 'Paid two installments together');
SET @p7 = LAST_INSERT_ID();
INSERT INTO payments (student_id, invoice_id, payment_date, amount, method, reference_no, received_by) VALUES (@s6, NULL, '2026-10-10', 10000.00, 'cash', NULL, @accountant_id);
SET @p8 = LAST_INSERT_ID();

INSERT INTO payment_allocations (payment_id, installment_id, amount) VALUES
  (@p1, (SELECT id FROM student_fee_installments WHERE enrollment_id = @e1 AND installment_no = 1), 10000.00),
  (@p2, (SELECT id FROM student_fee_installments WHERE enrollment_id = @e1 AND installment_no = 2), 10000.00),
  (@p3, (SELECT id FROM student_fee_installments WHERE enrollment_id = @e1 AND installment_no = 3), 10000.00),
  (@p4, (SELECT id FROM student_fee_installments WHERE enrollment_id = @e2 AND installment_no = 1),  9000.00),
  (@p5, (SELECT id FROM student_fee_installments WHERE enrollment_id = @e2 AND installment_no = 2),  4000.00),
  (@p6, (SELECT id FROM student_fee_installments WHERE enrollment_id = @e3 AND installment_no = 1),  8333.33),
  (@p7, (SELECT id FROM student_fee_installments WHERE enrollment_id = @e4 AND installment_no = 1),  7500.00),
  (@p7, (SELECT id FROM student_fee_installments WHERE enrollment_id = @e4 AND installment_no = 2),  7500.00),
  (@p8, (SELECT id FROM student_fee_installments WHERE enrollment_id = @e6 AND installment_no = 1), 10000.00);

INSERT INTO receipts (receipt_no, payment_id, student_id, amount, issued_at, issued_by)
SELECT CONCAT('RCP-2026-', LPAD(ROW_NUMBER() OVER (ORDER BY p.id), 6, '0')), p.id, p.student_id, p.amount,
       CONCAT(p.payment_date, ' 12:00:00'), @accountant_id
FROM payments p WHERE p.id IN (@p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8);

-- Attendance ------------------------------------------------------------------------------------
INSERT INTO student_attendance (student_id, batch_id, attendance_date, status, marked_by)
SELECT s.id, b.id, d.dt, d.st, @teacher_id
FROM (SELECT '2026-11-09' dt, 'present' st UNION ALL SELECT '2026-11-10','present' UNION ALL SELECT '2026-11-11','late'
      UNION ALL SELECT '2026-11-12','present' UNION ALL SELECT '2026-11-13','absent') d
JOIN students s ON s.student_no = 'STU-2026-0001'
JOIN batches b ON b.code = 'FSD-MORN-26';
INSERT INTO student_attendance (student_id, batch_id, attendance_date, status, marked_by)
SELECT s.id, b.id, d.dt, d.st, @teacher_id
FROM (SELECT '2026-11-09' dt, 'present' st UNION ALL SELECT '2026-11-10','absent' UNION ALL SELECT '2026-11-11','absent'
      UNION ALL SELECT '2026-11-12','leave' UNION ALL SELECT '2026-11-13','present') d
JOIN students s ON s.student_no = 'STU-2026-0005'
JOIN batches b ON b.code = 'FSD-MORN-26';

INSERT INTO staff_attendance (staff_id, attendance_date, status, check_in, check_out, marked_by)
SELECT s.id, d.dt, d.st, d.ci, d.co, @admin_id
FROM (SELECT '2026-11-16' dt, 'present' st, '08:55:00' ci, '17:30:00' co UNION ALL SELECT '2026-11-17','present','09:10:00','17:25:00'
      UNION ALL SELECT '2026-11-18','late','09:45:00','17:30:00') d
JOIN staff s ON s.staff_no IN ('STF-2026-0001', 'STF-2026-0002', 'STF-2026-0003');

-- Operations ------------------------------------------------------------------------------------
INSERT INTO expenses (title, category, amount, expense_date, payment_method, vendor, status, created_by, approved_by) VALUES
  ('November office rent',        'Rent',      60000.00, '2026-11-01', 'bank_transfer', 'City Properties',  'approved', @accountant_id, @admin_id),
  ('Electricity bill - October',  'Utilities',  8200.00, '2026-11-05', 'upi',           'BESCOM',           'approved', @accountant_id, @admin_id),
  ('Instagram ad campaign',       'Marketing', 15000.00, '2026-11-08', 'card',          'Meta Platforms',   'pending',  @accountant_id, NULL),
  ('Lab laptops maintenance',     'Maintenance', 6500.00, '2026-11-12', 'cash',         'TechCare Services','approved', @accountant_id, @admin_id);

INSERT INTO examinations (exam_code, course_id, batch_id, title, exam_date, start_time, duration_minutes, max_marks, pass_marks, status)
SELECT 'EXM-FSD-MID-26', c.id, b.id, 'Full Stack Development - Mid Term', '2026-10-20', '10:00:00', 120, 100, 40, 'completed'
FROM courses c JOIN batches b ON b.course_id = c.id WHERE c.code = 'FSD';
INSERT INTO examinations (exam_code, course_id, batch_id, title, exam_date, start_time, duration_minutes, max_marks, pass_marks, status)
SELECT 'EXM-DS-MID-26', c.id, b.id, 'Data Science - Mid Term', '2026-12-05', '17:00:00', 180, 100, 40, 'scheduled'
FROM courses c JOIN batches b ON b.course_id = c.id WHERE c.code = 'DS';

INSERT INTO exam_results (exam_id, student_id, marks_obtained, grade, result)
SELECT e.id, @s1, 78.50, 'A',  'pass' FROM examinations e WHERE e.exam_code = 'EXM-FSD-MID-26';
INSERT INTO exam_results (exam_id, student_id, marks_obtained, grade, result)
SELECT e.id, @s5, 35.00, 'F',  'fail' FROM examinations e WHERE e.exam_code = 'EXM-FSD-MID-26';

INSERT INTO certificates (certificate_no, student_id, course_id, enrollment_id, issue_date, grade, status, issued_by)
SELECT 'CERT-2026-0001', @s3, e.course_id, e.id, '2026-11-16', 'A', 'issued', @admin_id FROM enrollments e WHERE e.id = @e3;
INSERT INTO certificates (certificate_no, student_id, course_id, enrollment_id, issue_date, grade, status)
SELECT 'CERT-2026-0002', @s4, e.course_id, e.id, '2026-11-18', 'B+', 'pending' FROM enrollments e WHERE e.id = @e4;

INSERT INTO enquiries (name, phone, email, course_id, source, status, follow_up_date, notes, assigned_to)
SELECT x.name, x.phone, x.email, c.id, x.source, x.status, x.fu, x.notes, @admin_id
FROM (SELECT 'Nikhil Gupta' name, '9700000001' phone, 'nikhil@example.com' email, 'FSD' cc, 'website' source, 'new' status, '2026-11-20' fu, 'Asked about weekend batches' notes
      UNION ALL SELECT 'Pooja Khan', '9700000002', NULL, 'DS', 'instagram', 'follow_up', '2026-11-22', 'Wants EMI options'
      UNION ALL SELECT 'Varun Joshi', '9700000003', 'varun@example.com', 'DM', 'walk_in', 'contacted', '2026-11-19', 'Visited campus'
      UNION ALL SELECT 'Riya Das', '9700000004', 'riya@example.com', 'UX', 'referral', 'lost', NULL, 'Joined another institute') x
JOIN courses c ON c.code = x.cc;

INSERT INTO notifications (user_id, type, title, body, link) VALUES
  (@admin_id,      'fee',     'Overdue installments',  '6 installments are overdue. Review the fees module.', '/fees'),
  (@admin_id,      'enquiry', 'New enquiry',           'Nikhil Gupta enquired about Full Stack Development.', '/enquiries'),
  (@accountant_id, 'fee',     'Payment received',      'Receipt RCP-2026-000008 generated for 10,000.00.',    '/receipts'),
  (NULL,           'system',  'Welcome to Institute Pro', 'Sample data has been loaded for demonstration.',   NULL);

INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values, ip_address) VALUES
  (@admin_id,      'create', 'student', 'STU-2026-0001', JSON_OBJECT('name', 'Aarav Sharma', 'course', 'FSD'), '127.0.0.1'),
  (@accountant_id, 'create', 'payment', CAST(@p5 AS CHAR), JSON_OBJECT('amount', 4000, 'method', 'cash', 'partial', TRUE), '127.0.0.1');

-- Document number counters continue after the seeded numbers.
INSERT INTO document_sequences (prefix, year, next_value) VALUES
  ('STU', 2026, 7), ('STF', 2026, 4), ('INV', 2026, 5), ('RCP', 2026, 9), ('CERT', 2026, 3)
ON DUPLICATE KEY UPDATE next_value = GREATEST(next_value, VALUES(next_value));
