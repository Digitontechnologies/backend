-- 006_ROLLBACK_DRAFT.sql   ** DRAFT FOR REVIEW - NEVER RUN BY THE MIGRATION RUNNER **
--
-- Manual, reviewed reverse of migration 006. It deliberately uses DROP TRIGGER / DROP VIEW /
-- DROP COLUMN, which the migration runner refuses - so it can only be executed by a person,
-- on purpose, after a fresh backup. It is NOT placed in database/migrations/.
-- After running it, also remove the row for version '006' from schema_migrations (manual step).
--
-- Preconditions (otherwise a step will fail and change nothing):
--   * no enrollments with status 'cancelled'
--   * no two enrollments for the same student+batch
--   * no two certificates for the same student+course
--   * no duplicate emails / user_ids among ALL students and staff (including soft-deleted)

-- 1. Remove triggers
DROP TRIGGER IF EXISTS trg_payments_no_delete;
DROP TRIGGER IF EXISTS trg_receipts_no_delete;
DROP TRIGGER IF EXISTS trg_payment_allocations_no_delete;
DROP TRIGGER IF EXISTS trg_invoices_no_delete;
DROP TRIGGER IF EXISTS trg_invoice_items_no_delete;
DROP TRIGGER IF EXISTS trg_installments_no_delete;
DROP TRIGGER IF EXISTS trg_audit_logs_no_update;
DROP TRIGGER IF EXISTS trg_audit_logs_no_delete;
DROP TRIGGER IF EXISTS trg_students_no_delete;
DROP TRIGGER IF EXISTS trg_staff_no_delete;
DROP TRIGGER IF EXISTS trg_courses_no_delete;
DROP TRIGGER IF EXISTS trg_enrollments_no_delete;

-- 2. Remove views
DROP VIEW IF EXISTS v_active_students;
DROP VIEW IF EXISTS v_active_staff;
DROP VIEW IF EXISTS v_active_courses;

-- 3. Restore original foreign-key actions (WARNING: this re-opens cascade / SET NULL behaviour)
ALTER TABLE invoices DROP FOREIGN KEY fk_invoices_enrollment, DROP FOREIGN KEY fk_invoices_created_by;
ALTER TABLE invoices
  ADD CONSTRAINT fk_invoices_enrollment FOREIGN KEY (enrollment_id) REFERENCES enrollments (id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_invoices_created_by FOREIGN KEY (created_by)    REFERENCES users (id)       ON DELETE SET NULL;
ALTER TABLE invoice_items DROP FOREIGN KEY fk_invoice_items_invoice, DROP FOREIGN KEY fk_invoice_items_installment;
ALTER TABLE invoice_items
  ADD CONSTRAINT fk_invoice_items_invoice     FOREIGN KEY (invoice_id)     REFERENCES invoices (id)                 ON DELETE CASCADE,
  ADD CONSTRAINT fk_invoice_items_installment FOREIGN KEY (installment_id) REFERENCES student_fee_installments (id) ON DELETE SET NULL;
ALTER TABLE payments DROP FOREIGN KEY fk_payments_invoice, DROP FOREIGN KEY fk_payments_received_by;
ALTER TABLE payments
  ADD CONSTRAINT fk_payments_invoice     FOREIGN KEY (invoice_id)  REFERENCES invoices (id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_payments_received_by FOREIGN KEY (received_by) REFERENCES users (id)    ON DELETE SET NULL;
ALTER TABLE receipts DROP FOREIGN KEY fk_receipts_issued_by;
ALTER TABLE receipts ADD CONSTRAINT fk_receipts_issued_by FOREIGN KEY (issued_by) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE expenses DROP FOREIGN KEY fk_expenses_created_by, DROP FOREIGN KEY fk_expenses_approved_by;
ALTER TABLE expenses
  ADD CONSTRAINT fk_expenses_created_by  FOREIGN KEY (created_by)  REFERENCES users (id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_expenses_approved_by FOREIGN KEY (approved_by) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE audit_logs DROP FOREIGN KEY fk_audit_user;
ALTER TABLE audit_logs ADD CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL;

-- 4. Restore original unique indexes and remove the generated columns
ALTER TABLE students
  ADD UNIQUE KEY uq_students_email (email), ADD UNIQUE KEY uq_students_user (user_id),
  DROP INDEX uq_students_email_live, DROP INDEX uq_students_user_live, DROP COLUMN live_slot;
ALTER TABLE staff
  ADD UNIQUE KEY uq_staff_email (email), ADD UNIQUE KEY uq_staff_user (user_id),
  DROP INDEX uq_staff_email_live, DROP INDEX uq_staff_user_live, DROP COLUMN live_slot;
ALTER TABLE certificates
  ADD UNIQUE KEY uq_certificates_student_course (student_id, course_id),
  DROP INDEX uq_certificates_one_live, DROP COLUMN active_slot;
ALTER TABLE enrollments
  MODIFY COLUMN status ENUM('active','completed','dropped','transferred') NOT NULL DEFAULT 'active',
  ADD UNIQUE KEY uq_enrollments_student_batch (student_id, batch_id),
  DROP INDEX uq_enrollments_one_active, DROP INDEX idx_enrollments_student_batch, DROP COLUMN active_slot;
