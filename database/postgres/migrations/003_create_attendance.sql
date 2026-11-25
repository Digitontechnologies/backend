-- backend/database/postgres/migrations/003_create_attendance.sql
-- Student and staff daily attendance records.

-- ── student_attendance ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS student_attendance (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id      INTEGER NOT NULL REFERENCES students (id) ON DELETE RESTRICT,
  batch_id        INTEGER NOT NULL REFERENCES batches (id)  ON DELETE RESTRICT,
  attendance_date DATE    NOT NULL,
  status          TEXT    NOT NULL
                    CHECK (status IN ('present', 'absent', 'late', 'leave')),
  remarks         VARCHAR(255),
  marked_by       INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_student_attendance UNIQUE (student_id, batch_id, attendance_date)
);
CREATE INDEX IF NOT EXISTS idx_student_attendance_date
  ON student_attendance (attendance_date);
CREATE INDEX IF NOT EXISTS idx_student_attendance_batch_date
  ON student_attendance (batch_id, attendance_date);
CREATE TRIGGER trg_student_att_updated_at
  BEFORE UPDATE ON student_attendance
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── staff_attendance ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_attendance (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_id        INTEGER NOT NULL REFERENCES staff (id) ON DELETE RESTRICT,
  attendance_date DATE    NOT NULL,
  status          TEXT    NOT NULL
                    CHECK (status IN ('present', 'absent', 'late', 'half_day', 'leave')),
  check_in        TIME,
  check_out       TIME,
  remarks         VARCHAR(255),
  marked_by       INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_staff_attendance UNIQUE (staff_id, attendance_date)
);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_date ON staff_attendance (attendance_date);
CREATE TRIGGER trg_staff_att_updated_at
  BEFORE UPDATE ON staff_attendance
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
