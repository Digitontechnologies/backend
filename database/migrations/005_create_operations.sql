-- 005_create_operations.sql
-- Expenses, examinations, results, certificates, enquiries, notifications, audit logs.

CREATE TABLE IF NOT EXISTS expenses (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  title          VARCHAR(150) NOT NULL,
  category       VARCHAR(60)  NOT NULL,
  amount         DECIMAL(12,2) NOT NULL,
  expense_date   DATE NOT NULL,
  payment_method ENUM('cash','upi','card','bank_transfer','cheque') NOT NULL DEFAULT 'cash',
  vendor         VARCHAR(120) NULL,
  status         ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  notes          VARCHAR(500) NULL,
  created_by     INT UNSIGNED NULL,
  approved_by    INT UNSIGNED NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_expenses_date (expense_date),
  KEY idx_expenses_category (category),
  KEY idx_expenses_status (status),
  CONSTRAINT fk_expenses_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_expenses_approved_by FOREIGN KEY (approved_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_expenses_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS examinations (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  exam_code        VARCHAR(30)  NOT NULL,
  course_id        INT UNSIGNED NOT NULL,
  batch_id         INT UNSIGNED NULL,
  title            VARCHAR(150) NOT NULL,
  exam_date        DATE NOT NULL,
  start_time       TIME NULL,
  duration_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 120,
  max_marks        DECIMAL(6,2) NOT NULL DEFAULT 100.00,
  pass_marks       DECIMAL(6,2) NOT NULL DEFAULT 40.00,
  status           ENUM('scheduled','completed','cancelled') NOT NULL DEFAULT 'scheduled',
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_examinations_code (exam_code),
  KEY idx_examinations_course (course_id),
  KEY idx_examinations_batch (batch_id),
  KEY idx_examinations_date (exam_date),
  CONSTRAINT fk_examinations_course FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE RESTRICT,
  CONSTRAINT fk_examinations_batch FOREIGN KEY (batch_id) REFERENCES batches (id) ON DELETE SET NULL,
  CONSTRAINT chk_examinations_marks CHECK (max_marks > 0 AND pass_marks >= 0 AND pass_marks <= max_marks)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS exam_results (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  exam_id        INT UNSIGNED NOT NULL,
  student_id     INT UNSIGNED NOT NULL,
  marks_obtained DECIMAL(6,2) NULL,
  grade          VARCHAR(3) NULL,
  result         ENUM('pass','fail','absent') NOT NULL,
  remarks        VARCHAR(255) NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_exam_results (exam_id, student_id),
  KEY idx_exam_results_student (student_id),
  CONSTRAINT fk_exam_results_exam FOREIGN KEY (exam_id) REFERENCES examinations (id) ON DELETE RESTRICT,
  CONSTRAINT fk_exam_results_student FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE RESTRICT,
  CONSTRAINT chk_exam_results_marks CHECK (marks_obtained IS NULL OR marks_obtained >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS certificates (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  certificate_no  VARCHAR(30) NOT NULL,
  student_id      INT UNSIGNED NOT NULL,
  course_id       INT UNSIGNED NOT NULL,
  enrollment_id   INT UNSIGNED NULL,
  issue_date      DATE NOT NULL,
  grade           VARCHAR(3) NULL,
  status          ENUM('pending','issued','revoked') NOT NULL DEFAULT 'pending',
  issued_by       INT UNSIGNED NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_certificates_no (certificate_no),
  UNIQUE KEY uq_certificates_student_course (student_id, course_id),
  KEY idx_certificates_status (status),
  CONSTRAINT fk_certificates_student FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE RESTRICT,
  CONSTRAINT fk_certificates_course FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE RESTRICT,
  CONSTRAINT fk_certificates_enrollment FOREIGN KEY (enrollment_id) REFERENCES enrollments (id) ON DELETE SET NULL,
  CONSTRAINT fk_certificates_issued_by FOREIGN KEY (issued_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS enquiries (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name                 VARCHAR(120) NOT NULL,
  phone                VARCHAR(20)  NOT NULL,
  email                VARCHAR(190) NULL,
  course_id            INT UNSIGNED NULL,
  source               ENUM('website','walk_in','instagram','referral','google_ads','other') NOT NULL DEFAULT 'other',
  status               ENUM('new','contacted','follow_up','converted','lost') NOT NULL DEFAULT 'new',
  follow_up_date       DATE NULL,
  notes                TEXT NULL,
  assigned_to          INT UNSIGNED NULL,
  converted_student_id INT UNSIGNED NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_enquiries_status (status),
  KEY idx_enquiries_phone (phone),
  KEY idx_enquiries_follow_up (follow_up_date),
  KEY idx_enquiries_course (course_id),
  CONSTRAINT fk_enquiries_course FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE SET NULL,
  CONSTRAINT fk_enquiries_assigned FOREIGN KEY (assigned_to) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_enquiries_student FOREIGN KEY (converted_student_id) REFERENCES students (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED NULL COMMENT 'NULL = broadcast to everyone',
  type        ENUM('fee','enquiry','exam','attendance','system') NOT NULL DEFAULT 'system',
  title       VARCHAR(150) NOT NULL,
  body        VARCHAR(500) NOT NULL,
  link        VARCHAR(255) NULL,
  is_read     TINYINT(1) NOT NULL DEFAULT 0,
  read_at     DATETIME NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notifications_user_read (user_id, is_read, created_at),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED NULL,
  action      VARCHAR(40)  NOT NULL COMMENT 'create | update | delete | login | ...',
  entity_type VARCHAR(60)  NOT NULL,
  entity_id   VARCHAR(40)  NULL,
  old_values  JSON NULL,
  new_values  JSON NULL,
  ip_address  VARCHAR(45) NULL,
  user_agent  VARCHAR(255) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_entity (entity_type, entity_id),
  KEY idx_audit_user (user_id, created_at),
  KEY idx_audit_created (created_at),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
