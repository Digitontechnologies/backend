-- 003_create_attendance.sql

CREATE TABLE IF NOT EXISTS student_attendance (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  student_id      INT UNSIGNED NOT NULL,
  batch_id        INT UNSIGNED NOT NULL,
  attendance_date DATE NOT NULL,
  status          ENUM('present','absent','late','leave') NOT NULL,
  remarks         VARCHAR(255) NULL,
  marked_by       INT UNSIGNED NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_student_attendance (student_id, batch_id, attendance_date),
  KEY idx_student_attendance_date (attendance_date),
  KEY idx_student_attendance_batch_date (batch_id, attendance_date),
  CONSTRAINT fk_sa_student FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE RESTRICT,
  CONSTRAINT fk_sa_batch FOREIGN KEY (batch_id) REFERENCES batches (id) ON DELETE RESTRICT,
  CONSTRAINT fk_sa_marked_by FOREIGN KEY (marked_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS staff_attendance (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  staff_id        INT UNSIGNED NOT NULL,
  attendance_date DATE NOT NULL,
  status          ENUM('present','absent','late','half_day','leave') NOT NULL,
  check_in        TIME NULL,
  check_out       TIME NULL,
  remarks         VARCHAR(255) NULL,
  marked_by       INT UNSIGNED NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_staff_attendance (staff_id, attendance_date),
  KEY idx_staff_attendance_date (attendance_date),
  CONSTRAINT fk_staffatt_staff FOREIGN KEY (staff_id) REFERENCES staff (id) ON DELETE RESTRICT,
  CONSTRAINT fk_staffatt_marked_by FOREIGN KEY (marked_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
