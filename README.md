# StudyHub

**Live demo: https://studyhub-production-2c7b.up.railway.app** — sign in with `vansh` / `password123`

Academic collaboration and progress tracking system. Students share study notes and track progress across courses.

**Stack:** Node.js · Express · Socket.IO · MySQL (structured data) · MongoDB (unstructured content) · JWT auth · vanilla JS SPA

No build step and no frontend framework — the client is a single self-contained `public/index.html`.
Theming is pure CSS custom properties: one set of component rules, two palettes.


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
- **Syllabus** — paste a course syllabus and it is split into units and topics; each topic carries a difficulty and a mastery level (new → learning → revised → mastered)
- **Exam portions** — tick which topics are examinable for a given exam; leave it unset and the whole syllabus is planned
- **Study plan** — schedules backwards from every deadline **and topic-by-topic through each exam's portion**, giving harder and less-revised topics more time, respecting your daily goal, and flagging work that cannot fit in the time left
- **Exams** — added by hand or by pasting a timetable in almost any date format; a preview step shows what was parsed before anything is saved
- **Google Classroom import** — read-only sync of courses, coursework deadlines and announcements, running automatically in the background so new assignments appear without anyone pressing import ([setup](GOOGLE.md))
- **Sign in with Google**, or with a username, email address or phone number
- **Messages** — real-time direct messages over Socket.IO, with note sharing and typing indicators
- **Study rooms** — group rooms with live chat and an embedded Jitsi video call (no account or API key needed)
- **Parent accounts** — a student issues a single-use invite code; the parent gets a read-only dashboard of progress, study time, deadlines and grades, and can be revoked at any time
- **Referrals** — every account gets an invite code and link, with attribution and a list of who joined
- **Light and dark themes** — follows the operating system by default, or pin either; the choice persists and every component is themed from one palette, so nothing is hardcoded light
- **Profile** — avatar upload with drag-and-zoom cropping, click-to-enlarge viewer, bio, college, daily study goal, password change, guardian management


## Engineering notes

- **Email delivery** (`src/lib/mailer.js`) — Resend over HTTP when `RESEND_API_KEY` is set, falling back to logging so local development needs no account, no SMTP and no extra dependency. A failed send never fails the signup: the account is created and the user can request a new link.
- **Sessions survive a refresh without exposing the token** (`src/lib/cookies.js`) — the JWT is set as an `httpOnly`, `sameSite=lax`, https-only-in-production cookie, so JavaScript cannot read it and an XSS bug cannot steal a login. The `Authorization: Bearer` header still works for Postman and any API client, and the socket handshake accepts either. On load the client asks `/api/profile` and restores the session; a 401 simply shows the sign-in form.
- **Account security** — unique usernames (case-insensitive), password rules enforced server-side, email verification before first sign-in, and identical responses for wrong-password and unknown-account so the API cannot be used to enumerate users. There is no mail server, so the verification link is written to the log and returned outside production.
- **Roles** — `requireRole` middleware keeps parent accounts to a read-only surface: they can reach their children's summaries and nothing else. The same check runs on the socket handshake, so realtime is not a way around it.
- **Validation layer** (`src/lib/validate.js`) — routes declare a schema instead of hand-rolling `if (!x)` checks, so every endpoint returns the same error shape: `{ error, errors[] }`. Unknown fields are dropped, which stops clients writing columns they shouldn't.
- **Structured logging** (`src/lib/logger.js`) — levelled, single-line in development and JSON in production. Every API request logs method, path, status, duration and user id.
- **Fail-fast config** (`src/config/env.js`) — missing or weak `JWT_SECRET`, a non-numeric port or a malformed Mongo URI stop the process with a readable message instead of a stack trace at first use.
- **Idempotent migrations** (`src/config/initDb.js`) — schema and column migrations run on every boot, so the app never depends on Docker's one-shot init hook.
- **Pure domain logic** — streak calculation (`lib/streak.js`), grade maths (`lib/marks.js`), the study planner (`lib/planner.js`), timetable parsing (`lib/timetable.js`) and phone normalisation (`lib/phone.js`) are all separated from routes, so the rules can be tested without a database or a network.
- **Background work is scheduled, not fire-and-forget** (`src/scheduler.js`) — the Classroom sweep guards against overlapping runs, staggers users by when they were last synced rather than syncing everyone on one tick, isolates per-user failures, and clears stale consent so the UI can prompt a reconnect instead of failing quietly.
- **Optional integrations degrade quietly** — Google and email are read from the environment at request time. Without credentials the Google button is hidden, the Classroom page explains what is missing, and verification links fall back to the log. No integration is a hard dependency.
- **Error handling** — a central handler; 5xx messages are never leaked to clients, unknown `/api/*` paths return JSON rather than the SPA shell.
- **Uploads** — dependency-free base64 handling with a MIME allowlist and an 8 MB cap. Files are stored in MongoDB and served from `/api/files/:id`, because hosting platforms give containers an ephemeral filesystem — anything written to disk disappears on the next deploy.
- **Deployment-ready** — `trust proxy` so generated links use https behind a load balancer, TLS for managed MySQL, configurable CORS origin, a health check endpoint, and a `render.yaml` blueprint.

## Tests

```bash
npm test        # node --test, no external test framework
```

107 tests covering the study planner (capacity limits, deadline ordering, topic effort by difficulty and mastery, impossible workloads), syllabus parsing (units, roman numerals, bullets, inline topic lists), timetable parsing across six date formats, phone normalisation, account rules, email templating and transport selection, (usernames, emails, passwords, invite-code alphabet), the validation layer, streak edge cases (gaps, stale streaks, duplicate days), weighted grade maths, upload MIME/size rejection, and environment validation in isolated processes.

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

Demo login: `vansh@studyhub.dev` (or username `vansh`) / `password123`. Seeded accounts are pre-verified;
new accounts must click the verification link, which is printed in the server log.

## Deploying

Deployed on Railway; see **[DEPLOY.md](DEPLOY.md)** for the environment variables and the
post-deploy checklist. Schema migrations run automatically at boot, so shipping an update is `git push`.

## Deploy

See [DEPLOY.md](DEPLOY.md) for the full walkthrough. Short version — StudyHub needs a
long-running Node process, MySQL, MongoDB and a persistent disk, so it deploys to
Railway rather than a serverless host like Vercel or Netlify.

| Variable | Production value |
|---|---|
| `NODE_ENV` | `production` |
| `UPLOAD_DIR` | `/data/uploads` — **must** point at a mounted volume, or redeploys erase uploads |
| `MYSQL_SSL` | `false` on Railway; `true` for managed MySQL that requires TLS |
| `JWT_SECRET` | 32+ random characters; the app refuses to boot in production without one |

`initDb` applies `db/schema.sql` and the column migrations on every boot and is
idempotent, so deploying is just a push — there is no separate migration step.

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
| POST | /api/auth/forgot | Request a password reset link |
| POST | /api/auth/reset | Set a new password from a reset token |
| POST | /api/auth/logout | Clear the session cookie |
| GET | /api/auth/providers | Which sign-in options this deployment has |
| GET | /api/auth/google | Start Google OAuth (mode=signin or classroom) |
| GET | /api/exams | Upcoming exams |
| POST | /api/exams/preview | Parse a pasted timetable without saving |
| POST | /api/exams/import | Save selected parsed exams |
| GET | /api/plan?days= | Day-by-day study schedule, topic by topic |
| GET | /api/syllabus?courseId= | Topics grouped by unit, with coverage |
| POST | /api/syllabus/preview | Parse a pasted syllabus without saving |
| POST | /api/syllabus/import | Add parsed topics to a course |
| PATCH | /api/syllabus/:id | Change mastery, difficulty, title or unit |
| GET | /api/exams/:id/topics | Syllabus flagged with what is in the portion |
| PUT | /api/exams/:id/topics | Set the portion for an exam |
| GET | /api/classroom/status | Connection state and import counts |
| POST | /api/classroom/sync | Import from Google Classroom now |
| PATCH | /api/classroom/settings | Turn automatic importing on or off |
| GET | /api/dashboard | Per-course progress, notes, decks, deadlines |
| GET | /api/auth/available?username= | Live username availability |
| GET | /api/auth/verify?token= | Confirm an email address |
| POST | /api/auth/resend | Re-issue a verification link |
| GET | /api/profile/guardians | Linked parents and open invite codes |
| POST | /api/profile/guardians/invite | Issue a single-use invite code |
| DELETE | /api/profile/guardians/:parentId | Revoke a parent's access |
| GET | /api/parents/children | Parent: linked students with summaries |
| GET | /api/parents/children/:id | Parent: one student in detail |
| POST | /api/parents/link | Redeem an invite code |
| GET | /api/referrals | My code, link and who joined |
| GET | /api/chat/people | Students I can message |
| GET | /api/chat/conversations | Recent conversations |
| GET/POST | /api/chat/dm/:userId | Conversation history / send |
| GET/POST | /api/chat/rooms | List / create study rooms |
| GET | /api/chat/rooms/:id | Room, members and messages |
| POST | /api/chat/rooms/:id/join | Join a room |

### Realtime events (Socket.IO)

The handshake carries the same JWT as the REST API. Clients emit `dm:send`, `room:join`, `room:send` and `typing`;
the server emits `message`, `presence`, `typing` and `room:joined`.

`postman_collection.json` imports into Postman; Register/Login save the token automatically.
