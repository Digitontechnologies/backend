-- backend/database/postgres/migrations/004_create_fees_billing.sql
-- Installments, invoices, payments (with allocation for partial/split payments) and receipts.
-- Payment history = rows in payments + payment_allocations. Nothing is ever overwritten.

-- ── student_fee_installments ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS student_fee_installments (
  id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  enrollment_id  INTEGER NOT NULL REFERENCES enrollments (id) ON DELETE RESTRICT,
  installment_no SMALLINT NOT NULL,
  due_date       DATE    NOT NULL,
  amount_due     NUMERIC(14,2) NOT NULL CHECK (amount_due >= 0),
  amount_paid    NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (amount_paid >= 0),
  status         TEXT    NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'partial', 'paid', 'overdue', 'waived')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_installment_no    UNIQUE (enrollment_id, installment_no),
  CONSTRAINT chk_installment_paid CHECK (amount_paid <= amount_due)
);
CREATE INDEX IF NOT EXISTS idx_installments_due    ON student_fee_installments (due_date, status);
CREATE INDEX IF NOT EXISTS idx_installments_status ON student_fee_installments (status);
CREATE TRIGGER trg_installments_updated_at
  BEFORE UPDATE ON student_fee_installments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── invoices ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_no      VARCHAR(30)   NOT NULL,
  student_id      INTEGER NOT NULL REFERENCES students (id)   ON DELETE RESTRICT,
  enrollment_id   INTEGER REFERENCES enrollments (id)         ON DELETE SET NULL,
  issue_date      DATE NOT NULL,
  due_date        DATE NOT NULL,
  subtotal        NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (subtotal >= 0),
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (discount_amount >= 0),
  tax_amount      NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (tax_amount >= 0),
  total_amount    NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (total_amount >= 0),
  status          TEXT NOT NULL DEFAULT 'issued'
                    CHECK (status IN ('draft', 'issued', 'partial', 'paid', 'overdue', 'cancelled')),
  notes           VARCHAR(500),
  created_by      INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_invoices_no UNIQUE (invoice_no)
);
CREATE INDEX IF NOT EXISTS idx_invoices_student    ON invoices (student_id);
CREATE INDEX IF NOT EXISTS idx_invoices_enrollment ON invoices (enrollment_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status_due ON invoices (status, due_date);
CREATE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── invoice_items ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_items (
  id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id     INTEGER NOT NULL REFERENCES invoices (id)                ON DELETE CASCADE,
  installment_id INTEGER REFERENCES student_fee_installments (id)         ON DELETE SET NULL,
  description    VARCHAR(255)  NOT NULL,
  quantity       NUMERIC(8,2)  NOT NULL DEFAULT 1.00 CHECK (quantity > 0),
  unit_price     NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  tax_rate       NUMERIC(5,2)  NOT NULL DEFAULT 0.00 CHECK (tax_rate >= 0),
  line_total     NUMERIC(14,2) NOT NULL CHECK (line_total >= 0)
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice     ON invoice_items (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_installment ON invoice_items (installment_id);

-- ── payments ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id   INTEGER NOT NULL REFERENCES students (id) ON DELETE RESTRICT,
  invoice_id   INTEGER REFERENCES invoices (id)          ON DELETE SET NULL,
  payment_date DATE    NOT NULL,
  amount       NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method       TEXT    NOT NULL
                 CHECK (method IN ('cash', 'upi', 'card', 'bank_transfer', 'cheque', 'online')),
  reference_no VARCHAR(80),    -- UPI/cheque/bank transaction reference
  status       TEXT    NOT NULL DEFAULT 'completed'
                 CHECK (status IN ('completed', 'pending', 'failed', 'refunded')),
  received_by  INTEGER REFERENCES users (id) ON DELETE SET NULL,
  remarks      VARCHAR(255),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_student_date ON payments (student_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_invoice      ON payments (invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_date         ON payments (payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_status       ON payments (status);
CREATE INDEX IF NOT EXISTS idx_payments_reference    ON payments (reference_no);
CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── payment_allocations ───────────────────────────────────────────────────────
-- Links each payment to one or more installments (supports partial + split payments).
-- The sum of allocations for a payment should equal payments.amount.
CREATE TABLE IF NOT EXISTS payment_allocations (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id     BIGINT  NOT NULL REFERENCES payments (id)                   ON DELETE RESTRICT,
  installment_id INTEGER NOT NULL REFERENCES student_fee_installments (id)   ON DELETE RESTRICT,
  amount         NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_allocation UNIQUE (payment_id, installment_id)
);
CREATE INDEX IF NOT EXISTS idx_allocations_installment ON payment_allocations (installment_id);

-- ── receipts ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS receipts (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  receipt_no VARCHAR(30) NOT NULL,
  payment_id BIGINT  NOT NULL REFERENCES payments (id)  ON DELETE RESTRICT,
  student_id INTEGER NOT NULL REFERENCES students (id)  ON DELETE RESTRICT,
  amount     NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  issued_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issued_by  INTEGER REFERENCES users (id) ON DELETE SET NULL,
  status     TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'cancelled')),
  CONSTRAINT uq_receipts_no      UNIQUE (receipt_no),
  CONSTRAINT uq_receipts_payment UNIQUE (payment_id)
);
CREATE INDEX IF NOT EXISTS idx_receipts_student ON receipts (student_id);
