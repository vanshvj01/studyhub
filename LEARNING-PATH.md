# StudyHub, rebuilt from scratch

A course for rebuilding this project yourself, assuming you know some JavaScript and nothing about backends.

**How to use it.** Don't copy from `src/`. Work through a milestone, get stuck, *then* open the matching file to compare. Copying teaches you nothing; comparing after struggling teaches you a lot. Each milestone ends with **Done when** — a concrete thing you can check — and interview questions you should be able to answer before moving on.

Make a new folder (`studyhub-v2`) and build there. Keep the original running next to it to peek at behaviour.

---

## Part 0 — The mental model

Five ideas. Everything else is detail.

**1. A server is a program that waits.** It starts, opens a "port" (a numbered door on your machine, e.g. 3000), and sits in a loop waiting for requests. It doesn't do anything until someone asks. When you run `npm start` and the terminal appears to hang — that's not frozen, that's the server waiting.

**2. A request is text, a response is text.** When your browser loads `localhost:3000/api/courses`, it sends a small text message: a method (`GET`), a path (`/api/courses`), some headers. The server sends text back: a status number (200 = fine, 404 = not found, 500 = I crashed) and a body (usually JSON). Everything in this project is that exchange, repeated.

**3. The frontend and the backend are separate programs that don't trust each other.** The browser runs `public/index.html`. The server runs `src/`. They only communicate through those text messages. The browser can be lied to, modified, or bypassed entirely — so *every* rule that matters (are you logged in? is this your note?) must be enforced on the server. Client-side checks are a convenience for honest users, never a security measure.

**4. A database is another program that waits.** MySQL sits on port 3306, MongoDB on 27017. Your server sends them queries and gets rows back. Your Node code never touches the data files directly — it asks a driver (`mysql2`, `mongoose`) to talk over the network, even when everything is on one laptop.

**5. State lives in the database, not in your program.** If your server restarts, everything in its memory vanishes. Anything that must survive a restart — users, notes, marks — goes to a database. This is why the study timer logs a session to MySQL rather than keeping a counter in a variable.

> **Trace it once before you build.** Open StudyHub, press F12 → Network tab, click "Grades". You'll see a request to `/api/grades` — click it, look at the response JSON, then find `renderGrades()` in `public/index.html` and see that JSON turn into a table. That round trip is the whole project in miniature.

---

## Milestone 1 — A server that says hello

**Goal:** understand what Node and npm actually are.

**New concepts**
- **Node.js** — JavaScript outside the browser. Same language, different toolbox: no `document` or `window`, but you get files, networking and processes.
- **npm** — the package installer. `npm init` creates `package.json` (your project's ID card: name, scripts, dependencies). `npm install x` downloads someone else's code into `node_modules/`.
- **Module** — one file. `require('./x')` pulls in another file; `module.exports` decides what that file hands out.

**Build it**
1. `npm init -y`
2. Create `server.js` using Node's built-in `http` module — no Express yet. Listen on 3000, respond `"hello"` to everything.
3. Run `node server.js`, open localhost:3000.
4. Add `"start": "node server.js"` to `scripts` in `package.json` and run `npm start`.

**Done when** you can explain why the terminal doesn't return to a prompt, and what happens if you run `npm start` twice (spoiler: `EADDRINUSE` — two programs cannot hold the same port; you hit this repeatedly while building the real one).

**Interview questions**
- What is `package.json` for? What is `package-lock.json` for, and why is it committed?
- Why is `node_modules/` in `.gitignore`?

---

## Milestone 2 — Express, routes, JSON, static files

**Goal:** replace hand-rolled HTTP with a framework, and serve a page.

**New concepts**
- **Express** — a thin layer over `http`. Instead of one function handling every request, you declare routes: `app.get('/api/health', handler)`.
- **Route** = method + path + handler. `req` is what came in; `res` is how you answer.
- **Middleware** — a function that runs *before* your handler and can modify the request or stop it. `express.json()` reads the raw request body and turns it into `req.body`. Auth checks are middleware too.
- **Static files** — `express.static('public')` serves files off disk. This is how one Express app serves both the API and the frontend.

**Build it**
1. `npm install express`
2. Rewrite `server.js`: `GET /api/health` returning `{ status: 'ok' }`.
3. Add `express.json()` and a `POST /api/echo` that returns whatever JSON you sent it.
4. Create `public/index.html` with an `<h1>`, serve it with `express.static`.
5. From the page, `fetch('/api/health')` and put the result on screen.

**Done when** localhost:3000 shows your HTML *and* localhost:3000/api/health shows JSON, from one server.

**Common mistake:** forgetting `express.json()`, then wondering why `req.body` is `undefined`.

**Interview questions**
- What does middleware mean, and what does `next()` do?
- Why does route order matter in Express?

---

## Milestone 3 — MySQL, Docker, and your first table

**Goal:** store something that survives a restart.

**New concepts**
- **Relational database** — data in tables with fixed columns. A row must fit the shape you declared.
- **Docker** — runs MySQL in a container: a pre-packaged, isolated copy, so you don't install MySQL on your laptop. `docker-compose.yml` describes which containers to run and on which ports.
- **Schema** — the `CREATE TABLE` statements defining your shape. `db/schema.sql`.
- **Primary key** — the unique id of a row. **Foreign key** — a column pointing at another table's primary key, which the database *enforces*: you cannot insert a course owned by user 99 if user 99 doesn't exist.
- **Connection pool** — opening a DB connection is slow, so you keep a handful open and reuse them.

**Build it**
1. Write `docker-compose.yml` with a `mysql:8.0` service, a database name, user and password, ports `3306:3306`. Run `docker compose up -d`.
2. Write `db/schema.sql` with just `users` (id, name, email UNIQUE, password_hash, created_at).
3. `npm install mysql2 dotenv`
4. `src/config/db.js`: create a pool from `.env` values. Add a `.env.example`, and put `.env` in `.gitignore` on day one.
5. Add `GET /api/users` that runs `SELECT id, name, email FROM users`.

**Done when** you can insert a row by hand (`docker compose exec mysql mysql -u studyhub -p`) and see it appear at `/api/users`.

**The trap you'll hit** (I hit it building this): Docker only runs the SQL files in `docker-entrypoint-initdb.d` when the data volume is *brand new*. Change your schema afterwards and nothing happens — silently. That's why the real project applies the schema from Node on every boot instead (`src/config/initDb.js`), using `CREATE TABLE IF NOT EXISTS`. Understand this one properly; it's a genuinely good interview story.

**Interview questions**
- What is a foreign key and what does `ON DELETE CASCADE` do?
- Why a connection pool instead of connecting per request?
- Why must `.env` never be committed, and what does `.env.example` accomplish?

---

## Milestone 4 — Authentication

**Goal:** register, log in, and protect a route. This is the milestone that teaches you the most.

**New concepts**
- **Never store passwords.** Store a **hash**: a one-way scramble. bcrypt is deliberately slow, which makes brute-forcing expensive, and it **salts** each hash so two users with the same password get different hashes.
- **Stateless auth with JWT.** After login the server hands back a signed token containing the user id. The browser sends it on every later request. The signature is what matters: the server can verify it issued the token without storing any session — anyone can *read* a JWT, so never put secrets in one.
- **Auth middleware** — one function that reads the `Authorization: Bearer <token>` header, verifies it, and hangs `req.user` on the request. Every protected route then trusts `req.user.id` and nothing from the request body.

**Build it**
1. `npm install bcryptjs jsonwebtoken`
2. `POST /api/auth/register` — hash with `bcrypt.hash(password, 10)`, insert, return a token.
3. `POST /api/auth/login` — look up by email, `bcrypt.compare`, return a token.
4. `src/middleware/auth.js` — `requireAuth` + `signToken`.
5. Protect `/api/users` with it. Confirm you get 401 without a token.

**Done when** you can register in one request and use the returned token on a protected route — and can explain why you return the same "Invalid credentials" message for a wrong email *and* a wrong password.

**Common mistakes:** trusting a `userId` sent in the request body (a client can claim to be anyone — always use `req.user.id`); putting the password in a URL query string, where it lands in server logs.

**Interview questions**
- Hashing vs encryption — which is this and why?
- What's in a JWT? Why can it be read by anyone but not forged?
- Sessions vs JWT — what does each cost you? (Honest answer: JWTs are hard to revoke. Logout only deletes the client's copy; the token stays valid until it expires.)

---

## Milestone 5 — Courses and enrollments

**Goal:** model a many-to-many relationship and write your first join.

**New concepts**
- **Many-to-many** — a student takes many courses, a course has many students. Neither table can hold that, so you add a **join table**: `enrollments(user_id, course_id)` with a composite primary key, which also prevents duplicate enrolments for free.
- **JOIN** — combining rows across tables in one query.
- **Parameterised queries** — `pool.execute(sql, [values])`, never string concatenation. This is what stops SQL injection: values are sent separately from the SQL, so a value can never become code.

**Build it**
1. Add `courses` and `enrollments` to the schema.
2. `POST /api/courses` (creator auto-enrols), `GET /api/courses`, `POST /api/courses/:id/enroll`.
3. Make `GET /api/courses` flag which courses *I'm* enrolled in — try `EXISTS(SELECT 1 FROM enrollments ...)`.
4. Handle the duplicate-enrolment case gracefully (`INSERT IGNORE`, or catch `ER_DUP_ENTRY`).

**Done when** two different users can enrol in the same course and each sees their own enrolment flags.

**Interview questions**
- Write the SQL for "all courses this user is enrolled in" from memory.
- Show me SQL injection, then show me why parameterised queries stop it.

---

## Milestone 6 — Progress tracking and aggregation

**Goal:** let the database do arithmetic.

**New concepts**
- **Composite unique key** — `UNIQUE (user_id, course_id, topic)` means one row per topic per student, enforced by the database rather than by hopeful application code.
- **Upsert** — `INSERT ... ON DUPLICATE KEY UPDATE`: insert, or update if it's already there. One query, no race condition.
- **Aggregation** — `COUNT`, `SUM`, `GROUP BY`. Completion percentage is computed in SQL, not by fetching every row into Node and looping.

**Build it**
1. `progress(id, user_id, course_id, topic, status ENUM, updated_at)`.
2. `POST /api/progress` as an upsert; `GET /api/progress/:courseId`.
3. `GET /api/dashboard`: per course, total topics and completed topics, via `GROUP BY` and `SUM(status = 'completed')`.

**Done when** changing one topic's status changes the dashboard percentage.

**Interview questions**
- Why compute the percentage in SQL rather than in JavaScript?
- What's the N+1 query problem? (Fetching a list, then firing one query per item. Look at `/api/dashboard` and check whether it does that — it doesn't, and you should be able to say why.)

---

## Milestone 7 — MongoDB for notes

**Goal:** understand *why* a second database, not just how.

**New concepts**
- **Document database** — JSON-ish documents, no fixed columns. A note has a title, free-form markdown, a variable-length tag list, an upvote list and an attachment list. In MySQL that's three extra tables and a pile of joins; in Mongo it's one document.
- **Mongoose** — adds schemas and validation on top of Mongo, so "schema-less" doesn't mean "shapeless".
- **Text index** — `noteSchema.index({ title: 'text', content: 'text' })` makes full-text search fast.
- **Cross-store references** — Mongo documents store `courseId` as a plain integer pointing at a MySQL row. Nothing enforces that link, so the *application* has to check the course exists before inserting.

**Build it**
1. Add a `mongo:7` service to `docker-compose.yml`. `npm install mongoose`.
2. `src/models/Note.js` — the schema, with `timestamps: true`.
3. Notes CRUD, tag filter, `$text` search, an upvote toggle.
4. Before inserting, verify the course exists in MySQL. Ask yourself what happens if a course is deleted afterwards.

**Done when** you can articulate, in one sentence each, why users live in MySQL and notes live in Mongo.

**Interview questions**
- When would you *not* split across two databases? (Strong answer: most of the time. It doubles operational cost; here it's justified by genuinely different data shapes — and it's fair to say a single Postgres with a JSONB column would also have worked.)
- You can't do a foreign key across two databases. What breaks, and how do you cope?

---

## Milestone 8 — The frontend, no framework

**Goal:** build a single-page app with plain JavaScript, so you understand what React does for you later.

**New concepts**
- **fetch + async/await** — how the browser calls your API.
- **Render functions** — each "page" is a function that fetches data and writes HTML into one container. Navigation swaps which function runs; the page never reloads.
- **XSS** — if you inject user text into HTML unescaped, a note titled `<script>...` runs as code. Look at the `esc()` helper and understand exactly what it prevents.
- **Where the token lives** — the real app keeps the JWT in a JavaScript variable, so a refresh logs you out. Understand the trade-off: `localStorage` survives refreshes but is readable by any injected script.

**Build it**
1. Login form → store token → swap to the app shell.
2. An `api(path, opts)` helper that attaches the token and throws on non-2xx responses.
3. `renderDashboard()`, `renderCourses()`, and a `go(view)` router.
4. Escape *everything* user-generated.

**Done when** you can add a new page in under five minutes without touching the others.

**Interview questions**
- What is XSS and where exactly is it prevented in your code?
- Why does a refresh log the user out, and what would you change to fix it?

---

## Milestone 9 — Timer, streaks, and date bugs

**Goal:** dates are harder than they look.

**New concepts**
- **Store facts, derive summaries.** The database stores `(user, minutes, date)` rows. Streaks, weekly totals and charts are *computed* from those. Never store a `streak` column you have to keep in sync.
- **Streak rules are edge cases all the way down.** Does yesterday still count? (Yes, or you'd break a streak at midnight.) Two sessions in one day? (One day.) A gap? (Reset.) That's why `computeStreak` takes `now` as a parameter — so tests can pin the date instead of failing at midnight.

**Build it**
1. `study_sessions(user_id, course_id, minutes, studied_on)`.
2. `POST /api/sessions`, `GET /api/sessions/stats` with today/week totals and a 7-day series.
3. `computeStreak(dates, now)` as a pure function in its own file.
4. Frontend timer with `setInterval`, and a "stop and log" that banks partial time.

**Done when** your streak function handles: no data, today only, yesterday only, a gap, and duplicates in one day. Write those five tests before the code if you can.

**Interview questions**
- Why is `computeStreak` pure and in a separate file?
- Your timer runs on the client. What if the user closes the tab mid-session, or opens two tabs?

---

## Milestone 10 — Grades, flashcards, search

**Goal:** turn requirements into small, testable functions.

- **Weighted average** — `sum(pct × weight) / sum(weight)`. Guard against a zero total weight (divide by zero → `NaN` → a broken page).
- **Leitner boxes** — each card sits in a box 1–5. Right answer moves it up, wrong sends it back to 1, and study order is lowest box first. That's the whole "spaced repetition" algorithm: about six lines.
- **Search across two stores** — `LIKE` in MySQL, a regex or text index in Mongo, results merged in Node. Note that you must escape regex metacharacters from user input.

**Done when** grade maths and card promotion live in files with no `require('express')` in them.

---

## Milestone 11 — The professional layer

This is what separates a course project from a portfolio project.

- **Validation** (`lib/validate.js`) — routes declare a schema; one place produces consistent 400s. Also drops unknown fields, so a client can't smuggle in extra columns.
- **Structured logging** (`lib/logger.js`) — levels, one line per request with status and duration. The 500 error on the dashboard was diagnosed in seconds because the log named the file, line and SQL error. `console.log` scattered through handlers would not have done that.
- **Fail-fast config** (`config/env.js`) — missing `JWT_SECRET` should stop the process at boot with a clear message, not blow up on the first login.
- **Central error handling** — 5xx never leaks internals to the client; unknown `/api/*` returns JSON, not your HTML shell.
- **Tests** (`npm test`) — Node has a built-in runner, no framework needed. Test the pure functions and the edge cases you'd otherwise verify by clicking.

**Done when** `npm test` passes and deleting `JWT_SECRET` from `.env` produces a readable error instead of a stack trace.

---

## Milestone 12 — Ship it

`.gitignore` before the first commit (secrets are hard to remove from history afterwards) → `git init`, commit, push → README that a stranger can follow → optionally deploy with a hosted MySQL and MongoDB Atlas.

A README should answer: what is it, what does it look like (screenshot), how do I run it, and how is it built. Yours does.

---

# Part 2 — Defending it in an interview

Interviewers rarely ask "what does this do". They ask "why did you do it that way", and then push. Prepare the *reasoning*, not a script.

### The one-minute summary

Practise this until it's boring: *"StudyHub is a study-tracking platform for students. Node and Express on the backend, two databases: MySQL for structured coursework data — users, courses, enrolments, progress, grades — where I want foreign keys and SQL aggregation, and MongoDB for notes and flashcard decks, which are free-form and have variable-length nested content. JWT auth, and a vanilla-JS single-page frontend with no build step. Roughly 30 endpoints and a test suite around the domain logic."*

### The questions you will actually get

**"Why two databases? Isn't that over-engineering?"**
The honest, strong answer: it's justified by data shape — progress and grades need relational integrity and aggregation; notes and decks are documents with nested, variable-length content. Then admit the cost: two systems to run, no foreign keys across the boundary, application-level consistency. Add that a single Postgres with JSONB would have been a defensible alternative. Interviewers trust candidates who name their trade-offs.

**"What happens when a course is deleted?"**
MySQL cascades delete enrolments, progress, assignments and grades. Mongo does *not* — orphaned notes remain. Say so plainly, then say the fix: delete them in the same operation, or filter orphans on read. Knowing your own gaps beats pretending there are none.

**"Walk me through what happens when a user logs in."**
Request hits `/api/auth/login` → validation middleware → look up the user by email → `bcrypt.compare` against the stored hash → sign a JWT containing the user id → client stores it in memory → every later request carries `Authorization: Bearer …` → `requireAuth` verifies the signature and sets `req.user`. Emphasise: the server never trusts a user id from the request body.

**"How do you prevent SQL injection / XSS?"**
Parameterised queries everywhere (`pool.execute` with `?`), so values can never become SQL. On the frontend, an `esc()` helper escapes user content before it goes into the DOM. Be ready to *show* the line.

**"Tell me about a bug you had to debug."**
Use the real one: the dashboard returned 500 in production-ish use. The structured log gave file, line and the MySQL error — `ORDER BY` referenced a column not in a `DISTINCT` select list, which MySQL 8's `ONLY_FULL_GROUP_BY` rejects. Ordering by the aliased column fixed it. The point of the story is that you'd invested in logging *before* you needed it.

**"How would you scale this to 10,000 students?"**
Don't bluff. Say: add indexes on the hot query paths, cache the dashboard, paginate list endpoints, move uploads off local disk to object storage, and run several app instances behind a load balancer — which is easy here precisely because JWT auth is stateless. Note the current limits honestly: base64 uploads are memory-hungry, and there's no rate limiting.

**"What would you do differently?"**
Have three ready. Mine: (1) uploads through a streaming multipart parser instead of base64 in JSON; (2) integration tests against a real test database, not only unit tests of pure functions; (3) refresh tokens plus short-lived access tokens, so logout can actually revoke access.

### Questions to have answers for

Auth: hashing vs encryption · what's inside a JWT · why bcrypt is deliberately slow · how you'd do logout properly.
SQL: joins · foreign keys · indexes and when they hurt · transactions · the N+1 problem.
Mongo: documents vs rows · when you'd embed vs reference · what you lose without joins.
API: REST verbs and status codes · idempotency (why enroll uses `INSERT IGNORE`) · where validation belongs.
Engineering: why tests · what you log and what you must never log (passwords, tokens) · why `.env` is not in git.

---

# Part 3 — Honest weaknesses

Know these before someone finds them for you:

1. **No rate limiting** — login can be brute-forced.
2. **Base64 uploads** hold whole files in memory; a streaming parser would be correct.
3. **No refresh tokens** — a stolen JWT is valid until it expires.
4. **Orphaned Mongo documents** when a MySQL course is deleted.
5. **Notes and decks are globally visible**, not scoped to enrolled students.
6. **No pagination** — list endpoints cap with `LIMIT` instead of paging.
7. **Unit tests only** — no integration tests against a real database, so the `ONLY_FULL_GROUP_BY` bug slipped through.

Every one of these is a good answer to "what would you improve", and fixing any of them is a good next commit.
