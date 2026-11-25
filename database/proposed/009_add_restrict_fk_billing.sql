-- 009_add_restrict_fk_billing.sql   ** DRAFT - NOT EXECUTED **
-- ADDITIVE ONLY. Adds RESTRICT foreign keys (new names, suffix _restrict) beside the existing
-- ones. MySQL validates every existing row while adding each key, so a bad row makes that
-- statement fail and change nothing. Old keys are removed later by 012, after verification.
-- Run `preflight 009` first (orphan rows, column-type match, name clashes).

ALTER TABLE invoices
  ADD CONSTRAINT fk_invoices_enrollment_restrict FOREIGN KEY (enrollment_id) REFERENCES enrollments (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_invoices_created_by_restrict FOREIGN KEY (created_by)    REFERENCES users (id)       ON DELETE RESTRICT;

ALTER TABLE invoice_items
  ADD CONSTRAINT fk_invoice_items_invoice_restrict     FOREIGN KEY (invoice_id)     REFERENCES invoices (id)                 ON DELETE RESTRICT,
  ADD CONSTRAINT fk_invoice_items_installment_restrict FOREIGN KEY (installment_id) REFERENCES student_fee_installments (id) ON DELETE RESTRICT;

-- MANUAL ROLLBACK (old keys are still in place until 012):
--   ALTER TABLE invoices      DROP FOREIGN KEY fk_invoices_enrollment_restrict, DROP FOREIGN KEY fk_invoices_created_by_restrict;
--   ALTER TABLE invoice_items DROP FOREIGN KEY fk_invoice_items_invoice_restrict, DROP FOREIGN KEY fk_invoice_items_installment_restrict;
