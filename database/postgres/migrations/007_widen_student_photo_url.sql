-- backend/database/postgres/migrations/007_widen_student_photo_url.sql
-- Additive/widening migration: allow base64 data URLs (uploaded student avatars) in students.photo_url.
-- Widening VARCHAR(255) to TEXT in PostgreSQL is metadata-only and preserves all existing data.

ALTER TABLE students
  ALTER COLUMN photo_url TYPE TEXT;
