# StudyHub

Academic collaboration and progress tracking system. Students share study notes and track progress across courses.

**Stack:** Node.js · Express · MySQL (structured data) · MongoDB (unstructured content) · JWT auth · vanilla JS SPA

No build step and no frontend framework — the client is a single self-contained `public/index.html`.


## Features

- **Dashboard** — greeting, streak, today's goal ring, 7-day study chart, upcoming deadlines, course cards
- **Courses** — enroll, create, per-topic progress tracking with completion %
- **Shared notes** — markdown notes with tags, full-text search, upvotes and file attachments (images/PDF, 8 MB each)
- **Flashcards** — decks with a flip animation and Leitner spaced repetition; missed cards resurface first
- **Study timer** — focus/break cycles, presets, audible chime, floating timer pill that follows you across pages, **Stop & log** so partial sessions still count, recent-session history, streak and weekly stats
- **Deadlines** — assignment tracker with overdue/due-today badges
- **Grades** — log marks with weights; weighted per-course averages, letter grades and an overall percentage
- **Leaderboard** — weekly study-minute ranking across everyone on the platform
- **Global search** — one box across courses (MySQL) and notes + decks (MongoDB)
- **Profile** — avatar upload, bio, college, daily study goal, password change, aggregate stats


## Engineering notes

- **Validation layer** (`src/lib/validate.js`) — routes declare a schema instead of hand-rolling `if (!x)` checks, so every endpoint returns the same error shape: `{ error, errors[] }`. Unknown fields are dropped, which stops clients writing columns they shouldn't.
- **Structured logging** (`src/lib/logger.js`) — levelled, single-line in development and JSON in production. Every API request logs method, path, status, duration and user id.
- **Fail-fast config** (`src/config/env.js`) — missing or weak `JWT_SECRET`, a non-numeric port or a malformed Mongo URI stop the process with a readable message instead of a stack trace at first use.
- **Idempotent migrations** (`src/config/initDb.js`) — schema and column migrations run on every boot, so the app never depends on Docker's one-shot init hook.
- **Pure domain logic** — streak calculation (`lib/streak.js`) and grade maths (`lib/marks.js`) are separated from routes so they can be tested without a database.
- **Error handling** — a central handler; 5xx messages are never leaked to clients, unknown `/api/*` paths return JSON rather than the SPA shell.
- **Uploads** — dependency-free base64 handling with a MIME allowlist and an 8 MB cap.

## Tests

```bash
npm test        # node --test, no external test framework
```

29 tests covering the validation layer, streak edge cases (gaps, stale streaks, duplicate days), weighted grade maths, upload MIME/size rejection, and environment validation in isolated processes.

## Architecture

The schema is split across two stores by data shape:

| Store | Data | Why |
|---|---|---|
| **MySQL** | users, courses, enrollments, progress, assignments, study_sessions, grades | Relational integrity (FKs, unique constraints), aggregation for progress %, streaks |
| **MongoDB** | notes (content, tags, upvotes, attachments), flashcard decks | Free-form content, variable-length nested cards, full-text search |

Notes and decks reference MySQL rows by integer id (`courseId`, `authorId`/`ownerId`). The dashboard and profile endpoints do the cross-store join: aggregates from MySQL plus counts from MongoDB aggregations.

```
public/index.html      SPA frontend
src/server.js          Express app entry
src/config/db.js       MySQL pool + Mongo connection
src/middleware/auth.js JWT sign/verify
src/models/Note.js     Mongoose note model
src/config/env.js      environment validation (fail fast)
src/config/initDb.js   applies schema + migrations on every boot
src/config/uploads.js  base64 -> disk file handling
src/lib/               validate.js, logger.js, streak.js, marks.js
tests/                 node:test suites
src/models/            Note.js, Deck.js
src/routes/            auth, profile, courses, progress, notes, decks,
                       assignments, sessions, grades, search, dashboard
db/schema.sql          MySQL DDL (auto-applied by docker compose)
db/seed.sql            Demo data
```

## Run it

Requires Node 18+ and Docker.

```bash
# 1. Start the databases (schema + seed auto-applied on first run)
docker compose up -d

# 2. Configure
cp .env.example .env   # set a real JWT_SECRET

# 3. Install & start
npm install
npm start              # http://localhost:3000
```

Demo login: `vansh@studyhub.dev` / `password123`

## API

All routes except `/api/auth/*` and `/api/health` require `Authorization: Bearer <token>`.

| Method | Route | Purpose |
|---|---|---|
| POST | /api/auth/register | Create account, returns JWT |
| POST | /api/auth/login | Login, returns JWT |
| GET | /api/profile | Profile + cross-store stats |
| PUT | /api/profile | Update name, bio, college, avatar, daily goal |
| PUT | /api/profile/password | Change password |
| GET | /api/courses | All courses + my enrollment flag |
| POST | /api/courses | Create course (auto-enrolls creator) |
| POST | /api/courses/:id/enroll | Enroll in a course |
| GET | /api/progress/:courseId | My topics + statuses |
| POST | /api/progress | Upsert topic status |
| DELETE | /api/progress/:id | Stop tracking a topic |
| GET | /api/notes?courseId=&tag=&search= | Browse/search shared notes |
| POST | /api/notes | Share a note (with attachments) |
| POST | /api/notes/:id/upvote | Toggle upvote |
| DELETE | /api/notes/:id | Delete own note |
| GET | /api/decks?courseId= | Flashcard decks |
| POST | /api/decks | Create deck with cards |
| POST | /api/decks/:id/cards | Add a card |
| POST | /api/decks/:id/review | Grade a card (Leitner box) |
| DELETE | /api/decks/:id | Delete own deck |
| GET | /api/assignments?scope=upcoming | Deadlines |
| POST | /api/assignments | Add a deadline |
| PATCH | /api/assignments/:id | Mark done/pending |
| DELETE | /api/assignments/:id | Delete |
| GET | /api/sessions/stats | Today/week/total minutes, streak, 7-day chart |
| POST | /api/sessions | Log a study session |
| GET | /api/sessions/recent | Last 12 logged sessions |
| GET | /api/sessions/leaderboard | Weekly study ranking |
| GET | /api/grades | Marks grouped by course + weighted averages |
| POST | /api/grades | Add a mark |
| DELETE | /api/grades/:id | Delete a mark |
| GET | /api/search?q= | Search courses, notes and decks |
| GET | /api/dashboard | Per-course progress, notes, decks, deadlines |

`postman_collection.json` imports into Postman; Register/Login save the token automatically.
