# Making changes after deployment

Once StudyHub is live on Railway, the deploy loop is just `git push`. This file
covers that loop, then the specific kinds of change you're likely to make.

---

## The loop

```bash
# 1. Start the local databases
docker compose up -d

# 2. Make your change, then check it locally
npm test
npm start                      # http://localhost:3000

# 3. Ship it
git add -A
git commit -m "add study streak leaderboard"
git push
```

Railway sees the push, builds, waits for `/api/health` to answer, and only then
sends traffic to the new container. **If the new version fails to boot, the old one
keeps serving.** A broken push means your site stalls on the previous version — it
does not go down.

Watch it land: Railway dashboard → your service → **Deployments** → click the running
build for live logs.

### Always test locally first

The healthcheck protects you from *downtime*, but not from wasted time. A syntax
error or a bad `schema.sql` will fail the deploy two minutes after you push, when
`npm start` would have told you in two seconds.

---

## Changing the frontend

The UI is a single file: `public/index.html`. Edit it, reload `localhost:3000`, push.

Static files are served straight from `public/`, so there's no build step and nothing
to compile. Note that a hard refresh (Ctrl+Shift+R) is sometimes needed after a deploy
because the browser caches the old HTML.

---

## Adding an API endpoint

Routes live in `src/routes/` and are mounted in `src/server.js`. To add one:

```js
// src/routes/leaderboard.js
const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT u.name, COUNT(s.id) AS sessions
       FROM users u LEFT JOIN study_sessions s ON s.user_id = u.id
       GROUP BY u.id ORDER BY sessions DESC LIMIT 10`
    );
    res.json(rows);
  } catch (err) {
    next(err);       // let the central error handler format it
  }
});

module.exports = router;
```

Then one line in `src/server.js`, alongside the others:

```js
app.use('/api/leaderboard', require('./routes/leaderboard'));
```

Three conventions worth keeping:

- **`requireAuth`** on anything user-specific. It puts `req.user = { id, email }` on
  the request.
- **`next(err)`, never `res.status(500)`.** The central handler already hides internals
  in production and logs the stack.
- **Parameterised queries** (`?` placeholders) — never string-concatenate user input
  into SQL.

---

## Adding a MySQL column

This is the one place with a real gotcha. `db/schema.sql` uses
`CREATE TABLE IF NOT EXISTS`, which does **nothing** to a table that already exists.
Adding a column there works on your empty local database and silently fails in
production, where the table is already there.

Columns must go in `COLUMN_MIGRATIONS` in `src/config/initDb.js`:

```js
const COLUMN_MIGRATIONS = [
  ['users', 'bio', "ALTER TABLE users ADD COLUMN bio VARCHAR(300) NULL"],
  // ...
  ['users', 'timezone', "ALTER TABLE users ADD COLUMN timezone VARCHAR(64) NULL"],   // new
];
```

It checks `information_schema` before each one, so it is safe on every boot and safe
to leave in the list forever. Add the column to `db/schema.sql` too, so fresh
databases get it directly — but the migration entry is what makes it reach production.

**New tables** are fine in `schema.sql` alone, since `IF NOT EXISTS` creates them.

**Anything else** — renaming a column, changing a type, adding a constraint — needs a
migration entry with its own guard. Test it against a database that already has data,
not just a fresh one.

---

## Changing Mongo data

`src/models/Note.js` is a Mongoose schema, so there is no migration step — add a field
and it starts being written. Two things to remember:

- Existing documents won't have the new field. Give it a `default`, or handle
  `undefined` when reading.
- Adding `index: true` builds the index on next boot. On a small collection that's
  instant; it's worth knowing before the collection is large.

---

## Changing environment variables

Railway → service → **Variables**. Saving a change triggers a redeploy automatically.

- Editing `JWT_SECRET` **logs every user out** — every existing token becomes invalid.
- `UPLOAD_DIR` must keep matching the volume mount path, or previously uploaded files
  stop resolving.
- Add new variables to `.env.example` too, so you don't have to remember them later.

---

## Rolling back

Railway → **Deployments** → find the last good one → **⋯ → Redeploy**. This reverts
the *code* in about a minute.

It does **not** revert database changes. A migration that dropped a column stays
dropped, which is why destructive migrations deserve more care than additive ones —
prefer adding a new column over changing an existing one when you can.

---

## Debugging production

```
Railway → service → Deployments → View Logs
```

Logs are JSON in production (`NODE_ENV=production`), one line per request, including
method, path, status, duration and user id. Errors of 500 and above log the message
and the first stack frame; 4xx responses keep their message.

Reproducing locally with production-style logs:

```bash
NODE_ENV=production JWT_SECRET=$(openssl rand -hex 32) npm start
```

---

## Things that will bite you

| Mistake | What happens |
|---|---|
| Adding a column to `schema.sql` only | Works locally, silently absent in production |
| Committing a `.env` file | Leaks your JWT secret; it's gitignored — keep it that way |
| Changing `UPLOAD_DIR` after launch | Existing uploads 404 — they're still on the old path in the volume |
| Storing anything outside the volume | Erased on the next deploy |
| Editing files in Railway's shell | Overwritten by the next deploy — the repo is the source of truth |
| Letting the volume fill up | Uploads start failing; check usage in the service's Metrics tab |

---

## Adding a domain later

Railway → service → **Settings → Networking → Custom Domain**. Add the name, copy the
CNAME target Railway shows you, and create that record at your registrar. The
certificate is issued automatically within a few minutes.

No code change and no redeploy — the app doesn't know or care what hostname it's
served under.
