-- 007_drop_replaced_indexes.sql   ** DRAFT - NOT EXECUTED **
-- migrate:allow drop-index
--
-- Removes the 6 OLD unique indexes. Run ONLY after 006 is applied and `preflight 007` passes
-- (it proves each replacement index exists with the right columns and that every foreign key
-- still has a covering index). Drops rules, never rows.

ALTER TABLE enrollments  DROP INDEX uq_enrollments_student_batch;
ALTER TABLE certificates DROP INDEX uq_certificates_student_course;
ALTER TABLE students     DROP INDEX uq_students_email, DROP INDEX uq_students_user;
ALTER TABLE staff        DROP INDEX uq_staff_email,    DROP INDEX uq_staff_user;

-- MANUAL ROLLBACK (needs no data that violates the old rule):
--   ALTER TABLE enrollments  ADD UNIQUE KEY uq_enrollments_student_batch (student_id, batch_id);
--   ALTER TABLE certificates ADD UNIQUE KEY uq_certificates_student_course (student_id, course_id);
--   ALTER TABLE students     ADD UNIQUE KEY uq_students_email (email), ADD UNIQUE KEY uq_students_user (user_id);
--   ALTER TABLE staff        ADD UNIQUE KEY uq_staff_email (email),    ADD UNIQUE KEY uq_staff_user (user_id);
