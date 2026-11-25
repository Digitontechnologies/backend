-- 013_financial_and_audit_delete_triggers.sql   ** DRAFT - NOT EXECUTED **
-- Blocks direct DELETE on financial history and makes audit_logs append-only.
-- Triggers only act on FUTURE statements; no existing row is read or changed.
-- CREATE TRIGGER IF NOT EXISTS makes this file safe to re-run.

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
CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_update BEFORE UPDATE ON audit_logs
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit logs are append-only.';
CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_delete BEFORE DELETE ON audit_logs
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit logs are append-only.';

-- MANUAL ROLLBACK:  DROP TRIGGER trg_payments_no_delete;  (repeat for each of the 8 trigger names above)
