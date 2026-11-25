-- 004_create_fees_billing.sql
-- Installments, invoices, payments (with allocations for partial / split payments) and receipts.
-- Payment history = rows in payments + payment_allocations; nothing is overwritten.

CREATE TABLE IF NOT EXISTS student_fee_installments (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  enrollment_id     INT UNSIGNED NOT NULL,
  installment_no    TINYINT UNSIGNED NOT NULL,
  due_date          DATE NOT NULL,
  amount_due        DECIMAL(12,2) NOT NULL,
  amount_paid       DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  status            ENUM('pending','partial','paid','overdue','waived') NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_installment_no (enrollment_id, installment_no),
  KEY idx_installments_due (due_date, status),
  KEY idx_installments_status (status),
  CONSTRAINT fk_installments_enrollment FOREIGN KEY (enrollment_id) REFERENCES enrollments (id) ON DELETE RESTRICT,
  CONSTRAINT chk_installments_amounts CHECK (amount_due >= 0 AND amount_paid >= 0 AND amount_paid <= amount_due)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoices (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  invoice_no      VARCHAR(30) NOT NULL,
  student_id      INT UNSIGNED NOT NULL,
  enrollment_id   INT UNSIGNED NULL,
  issue_date      DATE NOT NULL,
  due_date        DATE NOT NULL,
  subtotal        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  tax_amount      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  total_amount    DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  status          ENUM('draft','issued','partial','paid','overdue','cancelled') NOT NULL DEFAULT 'issued',
  notes           VARCHAR(500) NULL,
  created_by      INT UNSIGNED NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invoices_no (invoice_no),
  KEY idx_invoices_student (student_id),
  KEY idx_invoices_enrollment (enrollment_id),
  KEY idx_invoices_status_due (status, due_date),
  CONSTRAINT fk_invoices_student FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE RESTRICT,
  CONSTRAINT fk_invoices_enrollment FOREIGN KEY (enrollment_id) REFERENCES enrollments (id) ON DELETE SET NULL,
  CONSTRAINT fk_invoices_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_invoices_amounts CHECK (subtotal >= 0 AND discount_amount >= 0 AND tax_amount >= 0 AND total_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoice_items (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  invoice_id     INT UNSIGNED NOT NULL,
  installment_id INT UNSIGNED NULL,
  description    VARCHAR(255) NOT NULL,
  quantity       DECIMAL(8,2)  NOT NULL DEFAULT 1.00,
  unit_price     DECIMAL(12,2) NOT NULL,
  tax_rate       DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
  line_total     DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_invoice_items_invoice (invoice_id),
  KEY idx_invoice_items_installment (installment_id),
  CONSTRAINT fk_invoice_items_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE CASCADE,
  CONSTRAINT fk_invoice_items_installment FOREIGN KEY (installment_id) REFERENCES student_fee_installments (id) ON DELETE SET NULL,
  CONSTRAINT chk_invoice_items_amounts CHECK (quantity > 0 AND unit_price >= 0 AND tax_rate >= 0 AND line_total >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  student_id    INT UNSIGNED NOT NULL,
  invoice_id    INT UNSIGNED NULL,
  payment_date  DATE NOT NULL,
  amount        DECIMAL(12,2) NOT NULL,
  method        ENUM('cash','upi','card','bank_transfer','cheque','online') NOT NULL,
  reference_no  VARCHAR(80) NULL COMMENT 'UPI/cheque/transaction reference',
  status        ENUM('completed','pending','failed','refunded') NOT NULL DEFAULT 'completed',
  received_by   INT UNSIGNED NULL,
  remarks       VARCHAR(255) NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payments_student_date (student_id, payment_date),
  KEY idx_payments_invoice (invoice_id),
  KEY idx_payments_date (payment_date),
  KEY idx_payments_status (status),
  KEY idx_payments_reference (reference_no),
  CONSTRAINT fk_payments_student FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE RESTRICT,
  CONSTRAINT fk_payments_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE SET NULL,
  CONSTRAINT fk_payments_received_by FOREIGN KEY (received_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_payments_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- How much of a payment was applied to which installment (enables partial + split payments).
CREATE TABLE IF NOT EXISTS payment_allocations (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  payment_id     BIGINT UNSIGNED NOT NULL,
  installment_id INT UNSIGNED NOT NULL,
  amount         DECIMAL(12,2) NOT NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_allocation (payment_id, installment_id),
  KEY idx_allocations_installment (installment_id),
  CONSTRAINT fk_allocations_payment FOREIGN KEY (payment_id) REFERENCES payments (id) ON DELETE RESTRICT,
  CONSTRAINT fk_allocations_installment FOREIGN KEY (installment_id) REFERENCES student_fee_installments (id) ON DELETE RESTRICT,
  CONSTRAINT chk_allocations_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS receipts (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  receipt_no  VARCHAR(30) NOT NULL,
  payment_id  BIGINT UNSIGNED NOT NULL,
  student_id  INT UNSIGNED NOT NULL,
  amount      DECIMAL(12,2) NOT NULL,
  issued_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  issued_by   INT UNSIGNED NULL,
  status      ENUM('issued','cancelled') NOT NULL DEFAULT 'issued',
  PRIMARY KEY (id),
  UNIQUE KEY uq_receipts_no (receipt_no),
  UNIQUE KEY uq_receipts_payment (payment_id),
  KEY idx_receipts_student (student_id),
  CONSTRAINT fk_receipts_payment FOREIGN KEY (payment_id) REFERENCES payments (id) ON DELETE RESTRICT,
  CONSTRAINT fk_receipts_student FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE RESTRICT,
  CONSTRAINT fk_receipts_issued_by FOREIGN KEY (issued_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_receipts_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
