-- 006_add_replacement_indexes.sql   ** DRAFT - NOT EXECUTED **
-- ADDITIVE ONLY. Adds new columns/indexes NEXT TO the existing ones. Nothing is dropped,
-- so every current rule keeps working. The old indexes are removed later by 007, only after
-- these replacements have been verified.
--
-- "Unique among live rows": VIRTUAL generated column = 1 for live rows, NULL otherwise.
-- UNIQUE indexes ignore NULLs, so only rows with 1 compete.

ALTER TABLE enrollments
  MODIFY COLUMN status ENUM('active','completed','dropped','transferred','cancelled') NOT NULL DEFAULT 'active',
  ADD COLUMN active_slot TINYINT UNSIGNED
      GENERATED ALWAYS AS (CASE WHEN status = 'active' THEN 1 ELSE NULL END) VIRTUAL,
  ADD UNIQUE KEY uq_enrollments_one_active (student_id, course_id, active_slot),
  ADD KEY idx_enrollments_student_batch (student_id, batch_id);

ALTER TABLE certificates
  ADD COLUMN active_slot TINYINT UNSIGNED
      GENERATED ALWAYS AS (CASE WHEN status IN ('pending','issued') THEN 1 ELSE NULL END) VIRTUAL,
  ADD UNIQUE KEY uq_certificates_one_live (student_id, course_id, active_slot);

ALTER TABLE students
  ADD COLUMN live_slot TINYINT UNSIGNED
      GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN 1 ELSE NULL END) VIRTUAL,
  ADD UNIQUE KEY uq_students_email_live (email, live_slot),
  ADD UNIQUE KEY uq_students_user_live (user_id, live_slot);

ALTER TABLE staff
  ADD COLUMN live_slot TINYINT UNSIGNED
      GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN 1 ELSE NULL END) VIRTUAL,
  ADD UNIQUE KEY uq_staff_email_live (email, live_slot),
  ADD UNIQUE KEY uq_staff_user_live (user_id, live_slot);

-- MANUAL ROLLBACK (reviewed, run by a person, never by the runner):
--   ALTER TABLE enrollments  DROP INDEX uq_enrollments_one_active, DROP INDEX idx_enrollments_student_batch, DROP COLUMN active_slot,
--     MODIFY COLUMN status ENUM('active','completed','dropped','transferred') NOT NULL DEFAULT 'active';  -- needs no 'cancelled' rows
--   ALTER TABLE certificates DROP INDEX uq_certificates_one_live, DROP COLUMN active_slot;
--   ALTER TABLE students     DROP INDEX uq_students_email_live, DROP INDEX uq_students_user_live, DROP COLUMN live_slot;
--   ALTER TABLE staff        DROP INDEX uq_staff_email_live,    DROP INDEX uq_staff_user_live,    DROP COLUMN live_slot;
