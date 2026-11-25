-- 010_add_restrict_fk_payments_receipts.sql   ** DRAFT - NOT EXECUTED **
-- ADDITIVE ONLY (see 009). Run `preflight 010` first.

ALTER TABLE payments
  ADD CONSTRAINT fk_payments_invoice_restrict     FOREIGN KEY (invoice_id)  REFERENCES invoices (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_payments_received_by_restrict FOREIGN KEY (received_by) REFERENCES users (id)    ON DELETE RESTRICT;

ALTER TABLE receipts
  ADD CONSTRAINT fk_receipts_issued_by_restrict FOREIGN KEY (issued_by) REFERENCES users (id) ON DELETE RESTRICT;

-- MANUAL ROLLBACK:
--   ALTER TABLE payments DROP FOREIGN KEY fk_payments_invoice_restrict, DROP FOREIGN KEY fk_payments_received_by_restrict;
--   ALTER TABLE receipts DROP FOREIGN KEY fk_receipts_issued_by_restrict;
