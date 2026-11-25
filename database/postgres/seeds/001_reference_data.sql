-- backend/database/postgres/seeds/001_reference_data.sql
-- Four built-in roles. Run with: npm run seed -- --reference-only
-- Uses ON CONFLICT DO NOTHING so it is safe to run more than once.

INSERT INTO roles (name, description) VALUES
  ('admin',       'Full system access'),
  ('accountant',  'Fees, payments and financial reports'),
  ('instructor',  'Batches, attendance and exam results'),
  ('receptionist','Enquiries, student registration and scheduling')
ON CONFLICT (name) DO NOTHING;
