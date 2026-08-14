# Deploying StudyHub

**Live: https://studyhub-production-2c7b.up.railway.app** — Railway, deployed from `main`.

StudyHub is a long-running Express server with two databases and WebSocket traffic.
That rules out serverless hosts: Vercel and Netlify give you no persistent process,
and they rebuild the MySQL pool on every invocation until the database runs out of
connections. Railway provisions both databases in the same project and keeps the
process alive, so it fits.

---

## Shipping an update (the normal case)

```bash
git add .
git commit -m "what changed"
git push
```

Railway builds, health-checks `/api/health`, and keeps the old container serving
traffic until the new one passes. Schema changes ride along: `initDb` adds new
tables, columns and indexes at boot and skips anything already applied, so a
deploy never needs a manual migration step.

A healthy boot looks like this in **Deployments → Logs**:

```json
{"level":"info","msg":"MySQL connected"}
{"level":"info","msg":"MongoDB connected"}
{"level":"info","msg":"schema migration applied","column":"users.username"}
{"level":"info","msg":"backfilled accounts","rows":2}
{"level":"info","msg":"StudyHub listening on port 3000","env":"production"}
```

---

## One-time setup

### 1. Create the project

1. Sign in at [railway.app](https://railway.app) with GitHub.
2. **New Project → Deploy from GitHub repo → `vanshvj01/studyhub`.**
3. Railway builds from the `Dockerfile` and reads `railway.json` for the start
   command and healthcheck. The first build **will fail** — the database variables
   don't exist yet. That's expected.

### 2. Add the databases

On the project canvas: **New → Database → Add MySQL**, then again for **MongoDB**.
Both join the project's private network, so the app reaches them over internal DNS
with no public egress and no TLS setup.

### 3. Set the environment variables

On the **StudyHub service → Variables → Raw Editor**:

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

JWT_SECRET=<paste your own — generate with: openssl rand -hex 32>
JWT_EXPIRES_IN=7d

PUBLIC_URL=https://studyhub-production-2c7b.up.railway.app
CORS_ORIGIN=https://studyhub-production-2c7b.up.railway.app
```

- The `${{MySQL.*}}` forms are Railway **variable references**: they resolve to the
  live credentials, so rotating a database password doesn't break the app. Match the
  service names shown on your canvas.
- **`JWT_SECRET` never belongs in this file or any committed file.** Anyone holding
  it can forge a login for any account. Generate it, paste it into Railway only.
  Changing it later logs everyone out, which is exactly what you want after a leak.
- `PUBLIC_URL` is what verification and referral links are built from. Without it
  they point at whatever `Host` header arrived with the request.
- `CORS_ORIGIN` locks both the REST API and the Socket.IO handshake to your domain.

### 4. Generate a public URL

**Settings → Networking → Generate Domain.** Railway injects `PORT` and the app reads it.

---

## After each deploy, check

1. `/api/health` returns `{"status":"ok"}`
2. Sign in with `vansh` / `password123` (seeded accounts are pre-verified)
3. Register a new account, find `verification link issued` in the logs, open that URL
4. Open the site in two browsers and send a chat message — it should arrive instantly
5. Create a study room and confirm the video call loads

---

## Known limits of this deployment

- **Verification "emails" are log lines.** There is no mail server, so a new user
  cannot verify without someone reading the logs. Wiring up Resend or Postmark is a
  small change and a sensible next commit.
- **Video runs on the public Jitsi service**, so visitors must allow camera and
  microphone access, and that feature needs internet even if the rest is reachable.
- **Attachments and avatars live in MongoDB**, not on disk. No volume to mount, and
  nothing is lost on redeploy — container filesystems are rebuilt from the image on
  every push.
- **Demo data ships with the app.** Change or delete `vansh@studyhub.dev` before
  sharing the URL widely.

---

## Costs

Railway's trial credit covers a project this size to start. After that it is
usage-based and lands around **$5/month** for the app plus both databases at low
traffic.

---

## Troubleshooting

| Symptom in the logs | Cause |
|---|---|
| `JWT_SECRET is too weak for production` | Secret missing or under 32 characters in Railway's variables |
| `Startup failed — are MySQL and MongoDB running?` | A `${{...}}` reference doesn't match the service names on the canvas |
| `MONGO_URI must start with mongodb://` | The MongoDB reference didn't resolve — the variable is empty |
| Verification links point at `localhost` | `PUBLIC_URL` is not set |
| Chat is slow or silent, no socket connection | `CORS_ORIGIN` doesn't match the site's own URL |
| `ER_NOT_SUPPORTED_AUTH_MODE` or TLS errors | Only on non-Railway MySQL — set `MYSQL_SSL=true` |
| Healthcheck timeouts on deploy | The app can't reach a database, so the deploy correctly refuses to go live |

---

## If you move off Railway later

The app takes plain `MYSQL_*` and `MONGO_URI` variables, so it runs anywhere that
gives it a Node process. Set `MYSQL_SSL=true` for any managed MySQL that requires
TLS (Aiven, PlanetScale, RDS). Uploads need no special handling — they're in
MongoDB, so there is no disk to provision.

See **[CHANGES.md](CHANGES.md)** for the day-to-day guide: adding endpoints, adding
database columns, rolling back, and reading production logs.
