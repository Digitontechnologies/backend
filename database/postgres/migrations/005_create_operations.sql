-- backend/database/postgres/migrations/005_create_operations.sql
-- Expenses, examinations, results, certificates, enquiries, notifications, audit logs.
-- Also creates the schema_migrations tracking table.

-- ── expenses ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expenses (
  id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title          VARCHAR(150)  NOT NULL,
  category       VARCHAR(60)   NOT NULL,
  amount         NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  expense_date   DATE NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash'
                   CHECK (payment_method IN ('cash', 'upi', 'card', 'bank_transfer', 'cheque')),
  vendor         VARCHAR(120),
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'rejected')),
  notes          VARCHAR(500),
  created_by     INTEGER REFERENCES users (id) ON DELETE SET NULL,
  approved_by    INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expenses_date     ON expenses (expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses (category);
CREATE INDEX IF NOT EXISTS idx_expenses_status   ON expenses (status);
CREATE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── examinations ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS examinations (
  id               INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  exam_code        VARCHAR(30) NOT NULL,
  course_id        INTEGER NOT NULL REFERENCES courses (id) ON DELETE RESTRICT,
  batch_id         INTEGER REFERENCES batches (id)          ON DELETE SET NULL,
  title            VARCHAR(150) NOT NULL,
  exam_date        DATE NOT NULL,
  start_time       TIME,
  duration_minutes INTEGER NOT NULL DEFAULT 120,
  max_marks        NUMERIC(6,2) NOT NULL DEFAULT 100.00 CHECK (max_marks > 0),
  pass_marks       NUMERIC(6,2) NOT NULL DEFAULT 40.00
                     CHECK (pass_marks >= 0 AND pass_marks <= max_marks),
  status           TEXT NOT NULL DEFAULT 'scheduled'
                     CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_examinations_code UNIQUE (exam_code)
);
CREATE INDEX IF NOT EXISTS idx_examinations_course ON examinations (course_id);
CREATE INDEX IF NOT EXISTS idx_examinations_batch  ON examinations (batch_id);
CREATE INDEX IF NOT EXISTS idx_examinations_date   ON examinations (exam_date);
CREATE TRIGGER trg_examinations_updated_at
  BEFORE UPDATE ON examinations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── exam_results ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exam_results (
  id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  exam_id        INTEGER NOT NULL REFERENCES examinations (id) ON DELETE RESTRICT,
  student_id     INTEGER NOT NULL REFERENCES students (id)     ON DELETE RESTRICT,
  marks_obtained NUMERIC(6,2) CHECK (marks_obtained IS NULL OR marks_obtained >= 0),
  grade          VARCHAR(3),
  result         TEXT NOT NULL CHECK (result IN ('pass', 'fail', 'absent')),
  remarks        VARCHAR(255),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_exam_results UNIQUE (exam_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_exam_results_student ON exam_results (student_id);
CREATE TRIGGER trg_exam_results_updated_at
  BEFORE UPDATE ON exam_results
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── certificates ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS certificates (
  id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  certificate_no VARCHAR(30) NOT NULL,
  student_id     INTEGER NOT NULL REFERENCES students (id)     ON DELETE RESTRICT,
  course_id      INTEGER NOT NULL REFERENCES courses (id)      ON DELETE RESTRICT,
  enrollment_id  INTEGER REFERENCES enrollments (id)           ON DELETE SET NULL,
  issue_date     DATE NOT NULL,
  grade          VARCHAR(3),
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'issued', 'revoked')),
  issued_by      INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_certificates_no             UNIQUE (certificate_no),
  CONSTRAINT uq_certificates_student_course UNIQUE (student_id, course_id)
);
CREATE INDEX IF NOT EXISTS idx_certificates_status ON certificates (status);
CREATE TRIGGER trg_certificates_updated_at
  BEFORE UPDATE ON certificates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── enquiries ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS enquiries (
  id                   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                 VARCHAR(120) NOT NULL,
  phone                VARCHAR(20)  NOT NULL,
  email                VARCHAR(190),
  course_id            INTEGER REFERENCES courses (id)  ON DELETE SET NULL,
  source               VARCHAR(50)  NOT NULL DEFAULT 'walk_in',
  status               TEXT NOT NULL DEFAULT 'new'
                         CHECK (status IN ('new', 'contacted', 'follow_up', 'converted', 'lost')),
  follow_up_date       DATE,
  notes                TEXT,
  assigned_to          INTEGER REFERENCES users (id)    ON DELETE SET NULL,
  converted_student_id INTEGER REFERENCES students (id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_enquiries_status    ON enquiries (status);
CREATE INDEX IF NOT EXISTS idx_enquiries_follow_up ON enquiries (follow_up_date);
CREATE TRIGGER trg_enquiries_updated_at
  BEFORE UPDATE ON enquiries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── notifications ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    INTEGER REFERENCES users (id) ON DELETE SET NULL,  -- NULL = broadcast
  type       VARCHAR(30)  NOT NULL,
  title      VARCHAR(150) NOT NULL,
  body       TEXT,
  link       VARCHAR(255),
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user   ON notifications (user_id);
-- Partial index: fast lookup of unread notifications per user
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (user_id, is_read) WHERE NOT is_read;

-- ── audit_logs ────────────────────────────────────────────────────────────────
-- Polymorphic reference: entity_type + entity_id identify any record in any table.
-- old_values / new_values stored as JSONB for flexible querying.
CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     INTEGER REFERENCES users (id) ON DELETE SET NULL,
  action      VARCHAR(30) NOT NULL,         -- create | update | delete | login | etc.
  entity_type VARCHAR(60) NOT NULL,         -- e.g. 'student', 'payment', 'enrollment'
  entity_id   VARCHAR(40) NOT NULL,         -- the PK or business number of the record
  old_values  JSONB,
  new_values  JSONB,
  ip_address  VARCHAR(45),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user       ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity     ON audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at);

-- ── schema_migrations ─────────────────────────────────────────────────────────
-- Tracks which migration files have been applied. Created here as a final step
-- so it exists even if the migration runner creates it first (IF NOT EXISTS is safe).
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    VARCHAR(10)  NOT NULL,
  name       VARCHAR(150) NOT NULL,
  checksum   CHAR(64)     NOT NULL,
  applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (version)
);
