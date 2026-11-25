-- Seed 001: reference data required by the application (safe to run in any environment).
-- Uses upserts only - never deletes or overwrites business data.

INSERT INTO roles (name, description) VALUES
  ('admin',        'Full access to every module and setting'),
  ('accountant',   'Fees, billing, payments, receipts and expenses'),
  ('instructor',   'Own batches, attendance and examinations'),
  ('receptionist', 'Enquiries, admissions and student records')
ON DUPLICATE KEY UPDATE description = VALUES(description);
