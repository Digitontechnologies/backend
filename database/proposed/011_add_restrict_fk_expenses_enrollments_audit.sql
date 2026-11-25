-- 011_add_restrict_fk_expenses_enrollments_audit.sql   ** DRAFT - NOT EXECUTED **
-- ADDITIVE ONLY (see 009). Run `preflight 011` first.

ALTER TABLE expenses
  ADD CONSTRAINT fk_expenses_created_by_restrict  FOREIGN KEY (created_by)  REFERENCES users (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_expenses_approved_by_restrict FOREIGN KEY (approved_by) REFERENCES users (id) ON DELETE RESTRICT;

ALTER TABLE enrollments
  ADD CONSTRAINT fk_enrollments_fee_structure_restrict FOREIGN KEY (fee_structure_id) REFERENCES fee_structures (id) ON DELETE RESTRICT;

ALTER TABLE audit_logs
  ADD CONSTRAINT fk_audit_user_restrict FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT;

-- MANUAL ROLLBACK:
--   ALTER TABLE expenses    DROP FOREIGN KEY fk_expenses_created_by_restrict, DROP FOREIGN KEY fk_expenses_approved_by_restrict;
--   ALTER TABLE enrollments DROP FOREIGN KEY fk_enrollments_fee_structure_restrict;
--   ALTER TABLE audit_logs  DROP FOREIGN KEY fk_audit_user_restrict;
