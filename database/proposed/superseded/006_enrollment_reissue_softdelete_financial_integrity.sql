-- 006_enrollment_reissue_softdelete_financial_integrity.sql   ** DRAFT FOR REVIEW - NOT EXECUTED **
--
-- migrate:allow drop-index, drop-foreign-key
--   (declares the ONLY two DROP kinds this file uses. Both change rules, never data.
--    The runner refuses every other DROP unless it is declared like this.)
--
-- Additive / constraint-only changes. No table is dropped and no row is deleted or modified.
-- Previously executed migrations (001-005) are not touched.
--
-- Technique: MySQL has no "partial" unique indexes, so "unique among live rows" is done with a
-- VIRTUAL generated column that is 1 for live rows and NULL otherwise. UNIQUE indexes allow many
-- NULLs, so only rows with the value 1 compete for uniqueness.

/* ================================================================================
   1. ENROLLMENT RE-ENROLL
   Before: UNIQUE (student_id, batch_id) -> a dropped/cancelled student could never rejoin the same batch.
   After : at most ONE ACTIVE enrollment per student + course; any number of historical rows.
   ================================================================================ */
ALTER TABLE enrollments
  MODIFY COLUMN status ENUM('active','completed','dropped','transferred','cancelled') NOT NULL DEFAULT 'active',
  ADD COLUMN active_slot TINYINT UNSIGNED
      GENERATED ALWAYS AS (CASE WHEN status = 'active' THEN 1 ELSE NULL END) VIRTUAL,
  ADD UNIQUE KEY uq_enrollments_one_active (student_id, course_id, active_slot),
  ADD KEY idx_enrollments_student_batch (student_id, batch_id),
  DROP INDEX uq_enrollments_student_batch;

/* ================================================================================
   2. CERTIFICATE RE-ISSUE
   Before: UNIQUE (student_id, course_id) -> a revoked certificate could never be re-issued.
   After : one LIVE (pending/issued) certificate per student + course; revoked ones stay as history.
   ================================================================================ */
ALTER TABLE certificates
  ADD COLUMN active_slot TINYINT UNSIGNED
      GENERATED ALWAYS AS (CASE WHEN status IN ('pending','issued') THEN 1 ELSE NULL END) VIRTUAL,
  ADD UNIQUE KEY uq_certificates_one_live (student_id, course_id, active_slot),
  DROP INDEX uq_certificates_student_course;

/* ================================================================================
   3. SOFT DELETE (students, staff, courses)
   - student_no / staff_no / courses.code stay permanently unique (never reused, so old
     receipts and certificates can never point at a "different" person or course).
   - email and user_id become unique among LIVE rows only, so a deleted record no longer
     blocks registering the same email again.
   - Views give list queries a ready-made "not deleted" source. Base tables keep everything.
   ================================================================================ */
ALTER TABLE students
  ADD COLUMN live_slot TINYINT UNSIGNED
      GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN 1 ELSE NULL END) VIRTUAL,
  ADD UNIQUE KEY uq_students_email_live (email, live_slot),
  ADD UNIQUE KEY uq_students_user_live (user_id, live_slot),
  DROP INDEX uq_students_email,
  DROP INDEX uq_students_user;

ALTER TABLE staff
  ADD COLUMN live_slot TINYINT UNSIGNED
      GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN 1 ELSE NULL END) VIRTUAL,
  ADD UNIQUE KEY uq_staff_email_live (email, live_slot),
  ADD UNIQUE KEY uq_staff_user_live (user_id, live_slot),
  DROP INDEX uq_staff_email,
  DROP INDEX uq_staff_user;

-- Re-run CREATE OR REPLACE VIEW in a later migration whenever these tables gain columns.
CREATE OR REPLACE VIEW v_active_students AS SELECT * FROM students WHERE deleted_at IS NULL;
CREATE OR REPLACE VIEW v_active_staff    AS SELECT * FROM staff    WHERE deleted_at IS NULL;
CREATE OR REPLACE VIEW v_active_courses  AS SELECT * FROM courses  WHERE deleted_at IS NULL;

/* ================================================================================
   4. FINANCIAL HISTORY: no cascades, no silent detaching
   Every foreign key that could cascade-delete or SET NULL a financial record (or the
   "who handled it" reference) becomes RESTRICT. Each FK is dropped and re-added with the
   SAME name; all tables are empty today, so there is no data risk.
   ================================================================================ */
ALTER TABLE invoices DROP FOREIGN KEY fk_invoices_enrollment, DROP FOREIGN KEY fk_invoices_created_by;
ALTER TABLE invoices
  ADD CONSTRAINT fk_invoices_enrollment FOREIGN KEY (enrollment_id) REFERENCES enrollments (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_invoices_created_by FOREIGN KEY (created_by)    REFERENCES users (id)       ON DELETE RESTRICT;

ALTER TABLE invoice_items DROP FOREIGN KEY fk_invoice_items_invoice, DROP FOREIGN KEY fk_invoice_items_installment;
ALTER TABLE invoice_items
  ADD CONSTRAINT fk_invoice_items_invoice     FOREIGN KEY (invoice_id)     REFERENCES invoices (id)                 ON DELETE RESTRICT,
  ADD CONSTRAINT fk_invoice_items_installment FOREIGN KEY (installment_id) REFERENCES student_fee_installments (id) ON DELETE RESTRICT;

ALTER TABLE payments DROP FOREIGN KEY fk_payments_invoice, DROP FOREIGN KEY fk_payments_received_by;
ALTER TABLE payments
  ADD CONSTRAINT fk_payments_invoice     FOREIGN KEY (invoice_id)  REFERENCES invoices (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_payments_received_by FOREIGN KEY (received_by) REFERENCES users (id)    ON DELETE RESTRICT;

ALTER TABLE receipts DROP FOREIGN KEY fk_receipts_issued_by;
ALTER TABLE receipts
  ADD CONSTRAINT fk_receipts_issued_by FOREIGN KEY (issued_by) REFERENCES users (id) ON DELETE RESTRICT;

ALTER TABLE expenses DROP FOREIGN KEY fk_expenses_created_by, DROP FOREIGN KEY fk_expenses_approved_by;
ALTER TABLE expenses
  ADD CONSTRAINT fk_expenses_created_by  FOREIGN KEY (created_by)  REFERENCES users (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_expenses_approved_by FOREIGN KEY (approved_by) REFERENCES users (id) ON DELETE RESTRICT;

ALTER TABLE enrollments DROP FOREIGN KEY fk_enrollments_fee_structure;
ALTER TABLE enrollments
  ADD CONSTRAINT fk_enrollments_fee_structure FOREIGN KEY (fee_structure_id) REFERENCES fee_structures (id) ON DELETE RESTRICT;

ALTER TABLE audit_logs DROP FOREIGN KEY fk_audit_user;
ALTER TABLE audit_logs
  ADD CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT;

/* ================================================================================
   5. HARD PROTECTION for financial and audit records (triggers)
   Foreign keys only stop deletes of rows that are referenced. These triggers stop ANY
   direct DELETE. Corrections are made through status (cancelled / refunded), never by deleting.
   Single-statement trigger bodies, so no DELIMITER handling is needed.
   ================================================================================ */
CREATE TRIGGER IF NOT EXISTS trg_payments_no_delete BEFORE DELETE ON payments
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Financial records cannot be removed. Set status to refunded or cancelled instead.';
CREATE TRIGGER IF NOT EXISTS trg_receipts_no_delete BEFORE DELETE ON receipts
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Financial records cannot be removed. Set status to cancelled instead.';
CREATE TRIGGER IF NOT EXISTS trg_payment_allocations_no_delete BEFORE DELETE ON payment_allocations
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment allocations are part of the payment history and cannot be removed.';
CREATE TRIGGER IF NOT EXISTS trg_invoices_no_delete BEFORE DELETE ON invoices
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Financial records cannot be removed. Set status to cancelled instead.';
CREATE TRIGGER IF NOT EXISTS trg_invoice_items_no_delete BEFORE DELETE ON invoice_items
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice lines are part of the billing history and cannot be removed.';
CREATE TRIGGER IF NOT EXISTS trg_installments_no_delete BEFORE DELETE ON student_fee_installments
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Fee installments cannot be removed. Set status to waived instead.';

-- Audit trail is append-only.
CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_update BEFORE UPDATE ON audit_logs
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit logs are append-only.';
CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_delete BEFORE DELETE ON audit_logs
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit logs are append-only.';

/* ---- OPTIONAL (section 6): enforce soft delete for people, courses and enrollments ----
   Remove this block if you want to allow hard deletes of records that have no history. */
CREATE TRIGGER IF NOT EXISTS trg_students_no_delete BEFORE DELETE ON students
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Students are soft-deleted. Set deleted_at instead.';
CREATE TRIGGER IF NOT EXISTS trg_staff_no_delete BEFORE DELETE ON staff
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Staff are soft-deleted. Set deleted_at instead.';
CREATE TRIGGER IF NOT EXISTS trg_courses_no_delete BEFORE DELETE ON courses
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Courses are soft-deleted. Set deleted_at instead.';
CREATE TRIGGER IF NOT EXISTS trg_enrollments_no_delete BEFORE DELETE ON enrollments
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Enrollments are kept as history. Set status to cancelled or dropped instead.';

/* audit_logs.entity_id: intentionally unchanged (see review notes). */
