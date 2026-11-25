-- 014_soft_delete_enforcement_triggers.sql   ** DRAFT - OPTIONAL - NOT EXECUTED **
-- Enforces soft delete for people, courses and enrollments by blocking hard DELETE.
-- Skip this migration if you want to be able to hard-delete records that have no history.
-- Soft delete (UPDATE deleted_at) is unaffected. Safe to re-run (IF NOT EXISTS).

CREATE TRIGGER IF NOT EXISTS trg_students_no_delete BEFORE DELETE ON students
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Students are soft-deleted. Set deleted_at instead.';
CREATE TRIGGER IF NOT EXISTS trg_staff_no_delete BEFORE DELETE ON staff
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Staff are soft-deleted. Set deleted_at instead.';
CREATE TRIGGER IF NOT EXISTS trg_courses_no_delete BEFORE DELETE ON courses
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Courses are soft-deleted. Set deleted_at instead.';
CREATE TRIGGER IF NOT EXISTS trg_enrollments_no_delete BEFORE DELETE ON enrollments
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Enrollments are kept as history. Set status to cancelled or dropped instead.';

-- MANUAL ROLLBACK:  DROP TRIGGER trg_students_no_delete;  (repeat for staff, courses, enrollments)
