-- backend/database/postgres/migrations/002_create_academics.sql
-- Courses, fee plans, staff, batches, students and enrollments.
-- Records are soft-deleted (deleted_at IS NOT NULL) — nothing is physically removed.

-- ── courses ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS courses (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code            VARCHAR(20)   NOT NULL,
  name            VARCHAR(150)  NOT NULL,
  description     TEXT,
  duration_months SMALLINT      NOT NULL CHECK (duration_months > 0),
  base_fee        NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (base_fee >= 0),
  status          TEXT          NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'inactive')),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  CONSTRAINT uq_courses_code UNIQUE (code)
);
CREATE INDEX IF NOT EXISTS idx_courses_status ON courses (status);
CREATE TRIGGER trg_courses_updated_at
  BEFORE UPDATE ON courses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── fee_structures ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fee_structures (
  id                   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id            INTEGER NOT NULL REFERENCES courses (id) ON DELETE RESTRICT,
  name                 VARCHAR(120)  NOT NULL,
  total_amount         NUMERIC(14,2) NOT NULL CHECK (total_amount >= 0),
  installment_count    SMALLINT      NOT NULL DEFAULT 1 CHECK (installment_count >= 1),
  installment_gap_days INTEGER       NOT NULL DEFAULT 30,
  is_active            BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_fee_structures_course_name UNIQUE (course_id, name)
);
CREATE TRIGGER trg_fee_structures_updated_at
  BEFORE UPDATE ON fee_structures
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── staff ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_no        VARCHAR(20)   NOT NULL,
  user_id         INTEGER REFERENCES users (id) ON DELETE SET NULL,
  first_name      VARCHAR(80)   NOT NULL,
  last_name       VARCHAR(80),
  email           VARCHAR(190)  NOT NULL,
  phone           VARCHAR(20)   NOT NULL,
  designation     VARCHAR(80)   NOT NULL,
  department      VARCHAR(80),
  monthly_salary  NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (monthly_salary >= 0),
  join_date       DATE          NOT NULL,
  status          TEXT          NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'on_leave', 'inactive')),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  CONSTRAINT uq_staff_no    UNIQUE (staff_no),
  CONSTRAINT uq_staff_email UNIQUE (email),
  CONSTRAINT uq_staff_user  UNIQUE (user_id)
);
CREATE INDEX IF NOT EXISTS idx_staff_status ON staff (status);
CREATE INDEX IF NOT EXISTS idx_staff_name   ON staff (first_name, last_name);
CREATE TRIGGER trg_staff_updated_at
  BEFORE UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── batches ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS batches (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code          VARCHAR(30)  NOT NULL,
  course_id     INTEGER NOT NULL REFERENCES courses (id) ON DELETE RESTRICT,
  instructor_id INTEGER REFERENCES staff (id) ON DELETE SET NULL,
  name          VARCHAR(120) NOT NULL,
  start_date    DATE NOT NULL,
  end_date      DATE CHECK (end_date IS NULL OR end_date >= start_date),
  start_time    TIME,
  end_time      TIME,
  capacity      INTEGER NOT NULL DEFAULT 30,
  status        TEXT NOT NULL DEFAULT 'upcoming'
                  CHECK (status IN ('upcoming', 'ongoing', 'completed', 'cancelled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_batches_code UNIQUE (code)
);
CREATE INDEX IF NOT EXISTS idx_batches_course     ON batches (course_id);
CREATE INDEX IF NOT EXISTS idx_batches_instructor ON batches (instructor_id);
CREATE INDEX IF NOT EXISTS idx_batches_status     ON batches (status);
CREATE TRIGGER trg_batches_updated_at
  BEFORE UPDATE ON batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── students ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS students (
  id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_no     VARCHAR(20)  NOT NULL,
  user_id        INTEGER REFERENCES users (id) ON DELETE SET NULL,
  first_name     VARCHAR(80)  NOT NULL,
  last_name      VARCHAR(80),
  date_of_birth  DATE         NOT NULL,
  gender         TEXT         NOT NULL CHECK (gender IN ('male', 'female', 'other')),
  phone          VARCHAR(20)  NOT NULL,
  whatsapp       VARCHAR(20),
  email          VARCHAR(190) NOT NULL,
  address        TEXT         NOT NULL,
  parent_name    VARCHAR(120) NOT NULL,
  parent_phone   VARCHAR(20)  NOT NULL,
  photo_url      VARCHAR(255),
  admission_date DATE         NOT NULL,
  status         TEXT         NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'inactive', 'completed', 'dropped')),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ,
  CONSTRAINT uq_students_no    UNIQUE (student_no),
  CONSTRAINT uq_students_email UNIQUE (email),
  CONSTRAINT uq_students_user  UNIQUE (user_id)
);
CREATE INDEX IF NOT EXISTS idx_students_status    ON students (status);
CREATE INDEX IF NOT EXISTS idx_students_phone     ON students (phone);
CREATE INDEX IF NOT EXISTS idx_students_name      ON students (first_name, last_name);
CREATE INDEX IF NOT EXISTS idx_students_admission ON students (admission_date);
CREATE TRIGGER trg_students_updated_at
  BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── enrollments ───────────────────────────────────────────────────────────────
-- The unique key is (student_id, batch_id), not (student_id, course_id),
-- so a student can re-enroll in the same course in a different batch after
-- a previous enrollment is cancelled or dropped.
CREATE TABLE IF NOT EXISTS enrollments (
  id               INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id       INTEGER NOT NULL REFERENCES students (id)      ON DELETE RESTRICT,
  course_id        INTEGER NOT NULL REFERENCES courses (id)       ON DELETE RESTRICT,
  batch_id         INTEGER NOT NULL REFERENCES batches (id)       ON DELETE RESTRICT,
  fee_structure_id INTEGER REFERENCES fee_structures (id)         ON DELETE SET NULL,
  enrolled_on      DATE    NOT NULL,
  total_fee        NUMERIC(14,2) NOT NULL CHECK (total_fee >= 0),
  discount_amount  NUMERIC(14,2) NOT NULL DEFAULT 0.00
                     CHECK (discount_amount >= 0 AND discount_amount <= total_fee),
  status           TEXT    NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'completed', 'dropped', 'transferred')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_enrollments_student_batch UNIQUE (student_id, batch_id)
);
CREATE INDEX IF NOT EXISTS idx_enrollments_course  ON enrollments (course_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_batch   ON enrollments (batch_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_status  ON enrollments (status);
CREATE TRIGGER trg_enrollments_updated_at
  BEFORE UPDATE ON enrollments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
