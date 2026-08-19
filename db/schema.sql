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

-- ---------------------------------------------------------------------------
-- Guardian (parent) access. A student generates an invite code; a parent
-- redeems it, which creates the link. Consent is therefore built into the flow.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS student_invites (
  code       CHAR(8)      NOT NULL PRIMARY KEY,
  student_id INT UNSIGNED NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME     NOT NULL,
  used_by    INT UNSIGNED NULL,
  used_at    DATETIME     NULL,
  CONSTRAINT fk_invite_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_invite_parent  FOREIGN KEY (used_by)    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS guardian_links (
  parent_id  INT UNSIGNED NOT NULL,
  student_id INT UNSIGNED NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (parent_id, student_id),
  CONSTRAINT fk_guard_parent  FOREIGN KEY (parent_id)  REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_guard_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Exams. Together with assignments these are the deadlines the study planner
-- schedules backwards from.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exams (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NOT NULL,
  course_id   INT UNSIGNED NULL,
  title       VARCHAR(160) NOT NULL,
  exam_date   DATE         NOT NULL,
  starts_at   TIME         NULL,
  weight      TINYINT UNSIGNED NOT NULL DEFAULT 3,  -- 1 quiz .. 5 finals
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_exam_user   FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
  CONSTRAINT fk_exam_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Syllabus. One row per topic a student has to learn, grouped into units.
-- This replaces the older flat `progress` table: same idea, but with the unit,
-- ordering, difficulty and mastery the exam planner needs. Existing progress
-- rows are migrated across on first boot.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS syllabus_topics (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NOT NULL,
  course_id   INT UNSIGNED NOT NULL,
  unit        VARCHAR(120)  NULL,           -- "Unit 2", "Module 3", NULL if ungrouped
  title       VARCHAR(200)  NOT NULL,
  order_index SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  difficulty  TINYINT UNSIGNED NOT NULL DEFAULT 3,   -- 1 easy .. 5 hard
  status      ENUM('not_started','learning','revised','mastered') NOT NULL DEFAULT 'not_started',
  notes       VARCHAR(300) NULL,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_topic (user_id, course_id, title),
  CONSTRAINT fk_topic_user   FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
  CONSTRAINT fk_topic_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Indexes live in initDb's INDEX_MIGRATIONS, not here: MySQL has no
-- CREATE INDEX IF NOT EXISTS, and this file is replayed on every boot.

-- Which topics are actually in scope for a given exam ("the portion").
CREATE TABLE IF NOT EXISTS exam_topics (
  exam_id  INT UNSIGNED NOT NULL,
  topic_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (exam_id, topic_id),
  CONSTRAINT fk_et_exam  FOREIGN KEY (exam_id)  REFERENCES exams(id)           ON DELETE CASCADE,
  CONSTRAINT fk_et_topic FOREIGN KEY (topic_id) REFERENCES syllabus_topics(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Billing. An entitlement is "this user has Pro until this moment, because of
-- this". Every product writes the same kind of row: an exam pass writes one for
-- the buyer, a squad or family plan writes one per member. Access is therefore
-- a single question — is any row still in date?
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entitlements (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      INT UNSIGNED NOT NULL,
  source       ENUM('exam_pass','squad','family','tutor','manual') NOT NULL,
  plan_code    VARCHAR(40)  NOT NULL,
  access_until DATETIME     NOT NULL,
  granted_by   INT UNSIGNED NULL,           -- the payer, when someone else paid
  payment_id   INT UNSIGNED NULL,
  revoked_at   DATETIME     NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ent_user  FOREIGN KEY (user_id)    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ent_payer FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payments (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED NOT NULL,
  provider      VARCHAR(20)  NOT NULL DEFAULT 'razorpay',
  order_id      VARCHAR(64)  NOT NULL,
  payment_ref   VARCHAR(64)  NULL,          -- the provider's payment id, once paid
  plan_code     VARCHAR(40)  NOT NULL,
  amount_paise  INT UNSIGNED NOT NULL,
  currency      CHAR(3)      NOT NULL DEFAULT 'INR',
  status        ENUM('created','paid','failed','refunded') NOT NULL DEFAULT 'created',
  notes         TEXT         NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at       DATETIME     NULL,
  UNIQUE KEY uq_payment_order (provider, order_id),
  CONSTRAINT fk_pay_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
