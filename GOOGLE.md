# Google sign-in and Classroom import

Both features share one OAuth client. Until `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` are set they stay dormant: the Google button is hidden and
the Classroom page explains that it is not configured. Nothing else changes.

You create the client yourself — never share a client secret with anyone.

---

## 1. Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com).
2. Project picker (top bar) → **New Project** → name it `StudyHub` → **Create**.

## 2. Enable the Classroom API

**APIs & Services → Library** → search **Google Classroom API** → **Enable**.

(Sign-in alone needs no API enabled; this step is for the import.)

## 3. Configure the consent screen

**APIs & Services → OAuth consent screen**

- User type: **External**
- App name: `StudyHub`, your email as support and developer contact
- **Scopes → Add or remove scopes**, add these four:

```
.../auth/classroom.courses.readonly
.../auth/classroom.coursework.me.readonly
.../auth/classroom.announcements.readonly
.../auth/classroom.course-work.readonly
```

- **Test users →** add every Google account you want to sign in with

While the app is in *Testing*, only those test users can authorise it. That's fine
for a portfolio project. Publishing to everyone requires Google's verification
review, which for Classroom scopes is a lengthy process — not worth it here.

## 4. Create the OAuth client

**APIs & Services → Credentials → Create Credentials → OAuth client ID**

- Application type: **Web application**
- Name: `StudyHub web`
- **Authorised redirect URIs** — add both:

```
https://studyhub-production-2c7b.up.railway.app/api/auth/google/callback
http://localhost:3000/api/auth/google/callback
```

The redirect URI must match **exactly** — scheme, host, path, no trailing slash.
A mismatch is the single most common cause of `redirect_uri_mismatch`.

Copy the **Client ID** and **Client secret**.

## 5. Set the variables

In Railway → your service → **Variables**:

```
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxx
```

`PUBLIC_URL` must already be set — the redirect URI is built from it.

Locally, put the same two lines in `.env`.

---

## What each feature does

**Sign in with Google.** Creates an account on first use, with a username derived
from the email address and no password. If an account with that email already
exists it is linked instead, so you can sign in either way afterwards.

**Classroom import** (`Classroom import` in the sidebar) pulls:

| From Classroom | Becomes in StudyHub |
|---|---|
| Active courses | Courses you're enrolled in |
| Coursework with a due date | Deadlines, which the study planner schedules around |
| Announcements | Notes tagged `classroom` |

Re-importing updates existing items rather than duplicating them — courses and
coursework are matched on their Classroom id.

Access is **read-only**. StudyHub never posts, edits or deletes anything in
Classroom; the scopes requested cannot do so even if the code tried.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `redirect_uri_mismatch` | The URI in Google Cloud doesn't exactly match `PUBLIC_URL` + `/api/auth/google/callback` |
| `access_denied` after choosing an account | The account isn't in the **Test users** list |
| Sign-in works, Classroom import returns 403 | Consent was granted before the Classroom scopes were added — disconnect on the Classroom page and reconnect |
| "Connect Google Classroom first" | The account signed in with Google *before* Classroom was authorised; use the Connect button |
| Google button never appears | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` not set, or the service hasn't redeployed |
