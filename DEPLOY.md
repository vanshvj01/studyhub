# Deploying StudyHub

StudyHub is an Express server with **two** databases (MySQL + MongoDB) and **file
uploads written to disk**. That combination rules out serverless hosts — Vercel and
Netlify give you no long-lived process, no persistent disk, and they rebuild the
MySQL connection pool on every invocation until the database runs out of connections.

These instructions target **Railway**, which provisions MySQL and MongoDB as managed
services in the same project and supports the volume the uploads need.

---

## One-time setup

### 1. Create the project and deploy from GitHub

1. Sign in at [railway.app](https://railway.app) with your GitHub account.
2. **New Project → Deploy from GitHub repo → `vanshvj01/studyhub`.**
3. Railway detects Node from `package.json` and reads `railway.json` for the start
   command and the `/api/health` healthcheck. The first build **will fail** — the
   database variables don't exist yet. That's expected; keep going.

### 2. Add the databases

In the same project canvas: **New → Database → Add MySQL**, then again for **MongoDB**.

Both land in the project's private network, so the app talks to them over internal
DNS. No public egress, no TLS setup needed.

### 3. Add the uploads volume

This is the step that's easy to skip and painful to discover later. Without it every
`git push` wipes every attachment and avatar your users have uploaded, because the
container filesystem is rebuilt from the image on each deploy.

On the **StudyHub service** → **Settings → Volumes → New Volume**:

- **Mount path:** `/data`

### 4. Set the environment variables

On the **StudyHub service** → **Variables → Raw Editor**, paste this in full:

```
NODE_ENV=production
PORT=3000

MYSQL_HOST=${{MySQL.MYSQLHOST}}
MYSQL_PORT=${{MySQL.MYSQLPORT}}
MYSQL_USER=${{MySQL.MYSQLUSER}}
MYSQL_PASSWORD=${{MySQL.MYSQLPASSWORD}}
MYSQL_DATABASE=${{MySQL.MYSQLDATABASE}}
MYSQL_SSL=false

MONGO_URI=${{MongoDB.MONGO_URL}}

JWT_SECRET=8c542893c13dcea29f8d6a58ef354141248286d09b8cf0f497575083c56c5a01
JWT_EXPIRES_IN=7d

UPLOAD_DIR=/data/uploads
```

Notes:

- The `${{MySQL.*}}` and `${{MongoDB.*}}` forms are Railway **variable references** —
  they resolve to the live credentials of those services, so rotating a database
  password doesn't break the app. If your service names differ from `MySQL` and
  `MongoDB`, match the names shown on the canvas.
- `JWT_SECRET` above was generated for this deploy. **Anyone holding it can forge
  logins for any account**, so treat it like a password — it should live only in
  Railway's variables, never in the repo. Regenerate with `openssl rand -hex 32`.
- Changing `JWT_SECRET` later invalidates every issued token and logs everyone out.

### 5. Generate a public URL

**Settings → Networking → Generate Domain.** Railway injects `PORT`; the app already
reads it. You'll get a `*.up.railway.app` URL.

### 6. Confirm the first successful deploy

Watch the deploy logs. A healthy first boot looks like:

```json
{"level":"info","msg":"MongoDB connected"}
{"level":"info","msg":"MySQL connected"}
{"level":"info","msg":"schema migration applied","column":"users.bio"}
{"level":"info","msg":"schema applied, demo data seeded"}
{"level":"info","msg":"StudyHub listening on port 3000","env":"production","uploads":"/data/uploads"}
```

Then check `https://<your-domain>/api/health` → `{"status":"ok","uptime":N}`.

Demo login from the seed data: `vansh@studyhub.dev` / `password123` — change or delete
that account before sharing the URL publicly.

---

## Making changes after deployment

Push to `main`. Railway builds and redeploys automatically, health-checks `/api/health`,
and keeps the old container serving traffic until the new one passes.

```bash
git add -A
git commit -m "your change"
git push
```

**What survives a redeploy:** everything in MySQL and MongoDB, and everything in
`/data/uploads`.

**Schema changes** don't need a migration step, but they do need to go through
`initDb.js` to be applied — editing `db/schema.sql` alone is not enough for a table
that already exists, because `CREATE TABLE IF NOT EXISTS` won't alter it. To add a
column, add a row to `COLUMN_MIGRATIONS` in `src/config/initDb.js`:

```js
['users', 'timezone', "ALTER TABLE users ADD COLUMN timezone VARCHAR(64) NULL"],
```

It checks `information_schema` before applying, so it's safe to run on every boot and
safe to leave in place permanently.

**Test locally before pushing** — a bad `schema.sql` takes down startup, and the
healthcheck will hold the previous version in place rather than serving a broken one:

```bash
docker compose up -d
npm test
npm start
```

---

## Costs

Railway's trial credit covers a project this size to start. After that it's usage-based
and lands around **$5/month** for the app plus both databases at low traffic. The volume
is billed on size provisioned, so keep it small (1 GB is plenty) until you need more.

---

## Troubleshooting

| Symptom in the logs | Cause |
|---|---|
| `JWT_SECRET is too weak for production` | Secret missing or under 32 chars in Railway's variables. |
| `Startup failed — are MySQL and MongoDB running?` | A `${{...}}` reference doesn't match the actual service names on the canvas. |
| `MONGO_URI must start with mongodb://` | `MONGO_URI` is empty — the MongoDB service reference didn't resolve. |
| Uploads 404 after a deploy | Volume not mounted at `/data`, or `UPLOAD_DIR` isn't `/data/uploads`. |
| `ER_NOT_SUPPORTED_AUTH_MODE` or TLS errors | Only on non-Railway MySQL — set `MYSQL_SSL=true`. |
| Healthcheck timeouts on deploy | The app can't reach a database; the deploy correctly refuses to go live. |

---

## If you move off Railway later

The app takes plain `MYSQL_*` / `MONGO_URI` variables, so it runs anywhere that gives
it a Node process and a disk. Two things to carry over: set `MYSQL_SSL=true` for any
managed MySQL that requires TLS (Aiven, PlanetScale, RDS), and point `UPLOAD_DIR` at
whatever persistent storage that host offers. If a host has no persistent disk, uploads
need to move to object storage (S3/R2) — that's a change to `src/config/uploads.js`
only, since every route already goes through `saveDataUrl`.
