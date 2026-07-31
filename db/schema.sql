-- StudyHub relational schema (MySQL 8)
-- Structured coursework data lives here; unstructured note content lives in MongoDB.

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100)  NOT NULL,
  email         VARCHAR(255)  NOT NULL UNIQUE,
  password_hash VARCHAR(255)  NOT NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS courses (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code       VARCHAR(20)   NOT NULL UNIQUE,   -- e.g. CS301
  title      VARCHAR(200)  NOT NULL,
  semester   VARCHAR(20)   NOT NULL,          -- e.g. 2026-Fall
  created_by INT UNSIGNED  NOT NULL,
  created_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_courses_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS enrollments (
  user_id     INT UNSIGNED NOT NULL,
  course_id   INT UNSIGNED NOT NULL,
  enrolled_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, course_id),
  CONSTRAINT fk_enroll_user   FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
  CONSTRAINT fk_enroll_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- One row per (user, course, topic). Status drives per-course completion %.
CREATE TABLE IF NOT EXISTS progress (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  course_id  INT UNSIGNED NOT NULL,
  topic      VARCHAR(200) NOT NULL,
  status     ENUM('not_started','in_progress','completed') NOT NULL DEFAULT 'not_started',
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_progress (user_id, course_id, topic),
  CONSTRAINT fk_prog_user   FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
  CONSTRAINT fk_prog_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
) ENGINE=InnoDB;
-- Note: the uq_progress unique key already indexes (user_id, course_id, topic),
-- and its leftmost prefix covers lookups by (user_id, course_id).

-- ---------------------------------------------------------------------------
-- Assignments / deadlines
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assignments (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  course_id  INT UNSIGNED NOT NULL,
  title      VARCHAR(200) NOT NULL,
  due_date   DATE         NOT NULL,
  status     ENUM('pending','done') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_asg_user   FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
  CONSTRAINT fk_asg_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Study sessions (drives the timer stats + daily streak)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS study_sessions (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  course_id  INT UNSIGNED NULL,
  minutes    SMALLINT UNSIGNED NOT NULL,
  studied_on DATE         NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sess_user   FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
  CONSTRAINT fk_sess_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Marks / grades. Weighted average per course is computed from these rows.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grades (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NOT NULL,
  course_id   INT UNSIGNED NOT NULL,
  title       VARCHAR(160)  NOT NULL,      -- e.g. "Mid-sem", "Lab 3"
  score       DECIMAL(7,2)  NOT NULL,
  max_score   DECIMAL(7,2)  NOT NULL,
  weight      DECIMAL(5,2)  NOT NULL DEFAULT 1,  -- relative weight in the course
  recorded_on DATE          NOT NULL,
  CONSTRAINT fk_grade_user   FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
  CONSTRAINT fk_grade_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
) ENGINE=InnoDB;
