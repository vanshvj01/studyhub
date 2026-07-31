-- Demo data. Password for both users: password123
-- (bcrypt hash generated with bcryptjs, cost 10)
INSERT INTO users (name, email, password_hash) VALUES
  ('Vansh',  'vansh@studyhub.dev',  '$2a$10$Otgk3OCsX1AfVg5zM2NoNuLK3ayjEhokH4BbyibnxAoCZfL5e65Su'),
  ('Asha',   'asha@studyhub.dev',   '$2a$10$Otgk3OCsX1AfVg5zM2NoNuLK3ayjEhokH4BbyibnxAoCZfL5e65Su');

INSERT INTO courses (code, title, semester, created_by) VALUES
  ('CS301', 'Database Management Systems', '2026-Fall', 1),
  ('CS302', 'Operating Systems',           '2026-Fall', 1),
  ('CS303', 'Computer Networks',           '2026-Fall', 2);

INSERT INTO enrollments (user_id, course_id) VALUES
  (1, 1), (1, 2), (2, 1), (2, 3);

INSERT INTO progress (user_id, course_id, topic, status) VALUES
  (1, 1, 'ER Modeling',        'completed'),
  (1, 1, 'Normalization',      'completed'),
  (1, 1, 'Transactions',       'in_progress'),
  (1, 1, 'Indexing',           'not_started'),
  (1, 2, 'Process Scheduling', 'in_progress'),
  (2, 1, 'ER Modeling',        'in_progress');
