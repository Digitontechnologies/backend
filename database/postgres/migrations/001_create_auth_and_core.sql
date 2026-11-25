-- backend/database/postgres/migrations/001_create_auth_and_core.sql
-- Authentication, authorization and document-number helpers.
-- All timestamps use TIMESTAMPTZ (timezone-aware).
-- updated_at is maintained by the set_updated_at() trigger function.

-- ── Shared trigger function ────────────────────────────────────────────────────
-- Replaces MySQL's ON UPDATE CURRENT_TIMESTAMP.
-- Applied once here; reused by every table that has an updated_at column.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ── roles ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        VARCHAR(50)  NOT NULL,
  description VARCHAR(255),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_roles_name UNIQUE (name)
);

-- ── users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  full_name     VARCHAR(120) NOT NULL,
  email         VARCHAR(190) NOT NULL,
  phone         VARCHAR(20),
  password_hash VARCHAR(255) NOT NULL,       -- bcrypt hash, never plain text
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_users_email UNIQUE (email)
);
CREATE INDEX IF NOT EXISTS idx_users_active ON users (is_active);
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── user_roles ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_roles (
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role_id     INTEGER NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles (role_id);

-- ── document_sequences ────────────────────────────────────────────────────────
-- Per-prefix yearly counters. Use SELECT ... FOR UPDATE inside a transaction
-- to safely generate numbers like STU-2026-0001, RCP-2026-000001, etc.
CREATE TABLE IF NOT EXISTS document_sequences (
  prefix     VARCHAR(10)  NOT NULL,
  year       INTEGER      NOT NULL,
  next_value INTEGER      NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (prefix, year)
);
CREATE TRIGGER trg_docseq_updated_at
  BEFORE UPDATE ON document_sequences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
