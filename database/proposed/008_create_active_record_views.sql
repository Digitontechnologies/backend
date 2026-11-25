-- 008_create_active_record_views.sql   ** DRAFT - NOT EXISTS-SAFE, NOT EXECUTED **
-- Read-only views that hide soft-deleted rows. Base tables are untouched; use the base tables
-- when you need history. CREATE OR REPLACE makes this file safe to re-run.
-- Requires 006 (students/staff have the live_slot column; the views simply expose it).

CREATE OR REPLACE VIEW v_active_students AS SELECT * FROM students WHERE deleted_at IS NULL;
CREATE OR REPLACE VIEW v_active_staff    AS SELECT * FROM staff    WHERE deleted_at IS NULL;
CREATE OR REPLACE VIEW v_active_courses  AS SELECT * FROM courses  WHERE deleted_at IS NULL;

-- MANUAL ROLLBACK:  DROP VIEW v_active_students, v_active_staff, v_active_courses;  (no data involved)
