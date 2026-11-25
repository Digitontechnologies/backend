-- 012_drop_replaced_foreign_keys.sql   ** DRAFT - NOT EXECUTED **
-- migrate:allow drop-foreign-key
--
-- Removes the 11 OLD foreign keys (SET NULL / CASCADE). Run ONLY after 009, 010 and 011 are
-- applied and `preflight 012` passes (it proves all 11 *_restrict replacements exist, are
-- RESTRICT, and that the old keys are the ones being removed). Drops rules, never rows.
-- Each ALTER is a single atomic statement per table.

ALTER TABLE invoices      DROP FOREIGN KEY fk_invoices_enrollment,       DROP FOREIGN KEY fk_invoices_created_by;
ALTER TABLE invoice_items DROP FOREIGN KEY fk_invoice_items_invoice,     DROP FOREIGN KEY fk_invoice_items_installment;
ALTER TABLE payments      DROP FOREIGN KEY fk_payments_invoice,          DROP FOREIGN KEY fk_payments_received_by;
ALTER TABLE receipts      DROP FOREIGN KEY fk_receipts_issued_by;
ALTER TABLE expenses      DROP FOREIGN KEY fk_expenses_created_by,       DROP FOREIGN KEY fk_expenses_approved_by;
ALTER TABLE enrollments   DROP FOREIGN KEY fk_enrollments_fee_structure;
ALTER TABLE audit_logs    DROP FOREIGN KEY fk_audit_user;

-- MANUAL ROLLBACK (re-adds the ORIGINAL, weaker rules - only if you really want them back):
--   ALTER TABLE invoices      ADD CONSTRAINT fk_invoices_enrollment FOREIGN KEY (enrollment_id) REFERENCES enrollments (id) ON DELETE SET NULL,
--                             ADD CONSTRAINT fk_invoices_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL;
--   ALTER TABLE invoice_items ADD CONSTRAINT fk_invoice_items_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE CASCADE,
--                             ADD CONSTRAINT fk_invoice_items_installment FOREIGN KEY (installment_id) REFERENCES student_fee_installments (id) ON DELETE SET NULL;
--   ALTER TABLE payments      ADD CONSTRAINT fk_payments_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE SET NULL,
--                             ADD CONSTRAINT fk_payments_received_by FOREIGN KEY (received_by) REFERENCES users (id) ON DELETE SET NULL;
--   ALTER TABLE receipts      ADD CONSTRAINT fk_receipts_issued_by FOREIGN KEY (issued_by) REFERENCES users (id) ON DELETE SET NULL;
--   ALTER TABLE expenses      ADD CONSTRAINT fk_expenses_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
--                             ADD CONSTRAINT fk_expenses_approved_by FOREIGN KEY (approved_by) REFERENCES users (id) ON DELETE SET NULL;
--   ALTER TABLE enrollments   ADD CONSTRAINT fk_enrollments_fee_structure FOREIGN KEY (fee_structure_id) REFERENCES fee_structures (id) ON DELETE SET NULL;
--   ALTER TABLE audit_logs    ADD CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL;
