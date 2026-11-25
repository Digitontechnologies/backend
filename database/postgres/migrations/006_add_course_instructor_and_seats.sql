-- backend/database/postgres/migrations/006_add_course_instructor_and_seats.sql
-- Additive migration: store default instructor and total seats directly on courses.
-- Existing course rows are preserved with instructor_id = NULL and total_seats = 30.

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS instructor_id INTEGER REFERENCES staff (id) ON DELETE SET NULL;

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS total_seats INTEGER NOT NULL DEFAULT 30 CHECK (total_seats > 0);

CREATE INDEX IF NOT EXISTS idx_courses_instructor ON courses (instructor_id);
