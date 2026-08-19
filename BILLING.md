# Billing — the exam pass

StudyHub sells a **one-off pass**, not a subscription: ₹79 for 30 days, ₹199 for
90. Nothing auto-renews, so there is no mandate to manage, no cancellation flow
and no refund window to police. A pass simply runs out, and the app steps back to
the free tier without hiding anything the student created.

Payments stay dormant until `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are set —
the Exam pass page then says so plainly rather than offering a button that fails.

---

## Set it up in test mode (no business registration needed)

1. Sign up at [razorpay.com](https://razorpay.com) — a test account needs only an email.
2. Keep the dashboard in **Test Mode** (toggle, top of the page).
3. **Settings → API Keys → Generate Test Key.** Copy both halves; the secret is shown once.
4. Add to Railway → Variables:

```
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxx
```

5. **Settings → Webhooks → Add New Webhook**
   - URL: `https://studyhub-production-2c7b.up.railway.app/api/billing/webhook`
   - Secret: invent a long random string
   - Events: `payment.captured` and `payment.failed`
6. Add that same string:

```
RAZORPAY_WEBHOOK_SECRET=the-string-you-invented
```

Test cards: **4111 1111 1111 1111**, any future expiry, any CVV, any name. No money moves.

Going live later means completing Razorpay's KYC against a registered business and
swapping in live keys — no code changes. That part is a legal and tax question, and
not one I can advise on.

---

## How access is decided

One table answers it. An entitlement row says *this user has Pro until this moment,
because of this*:

```
entitlements(user_id, source, plan_code, access_until, granted_by, payment_id, revoked_at)
```

Every product writes the same shape of row. An exam pass writes one for the buyer;
a squad or family plan will write one per member with `granted_by` set to the payer.
So `requirePro()` never needs to know which product paid — it asks whether any row
is still in date.

**Passes stack.** Buying while still covered extends from the existing end date
rather than wasting the overlap, which is what someone buying twice in a term
expects.

## Why payment confirmation is safe to receive twice

Two things confirm a payment: the browser callback (instant, so the UI updates) and
the webhook (authoritative, arrives even if the tab was closed). Both call the same
grant, and the grant is idempotent:

```sql
UPDATE payments SET status='paid' ... WHERE id = ? AND status = 'created'
```

Only the call that flips `created → paid` writes the entitlement. Whichever arrives
second sees `affectedRows = 0` and reports the existing state. A payment can be
confirmed any number of times and still buys exactly one pass.

Signatures are checked before anything is trusted — the checkout callback against
`order_id|payment_id`, the webhook against its **raw body**, which is why the
billing router is mounted ahead of the JSON parser in `server.js`. Both comparisons
are constant-time.

## What a pass unlocks

| | Free | With a pass |
|---|---|---|
| Study plan horizon | 7 days | 60 days |
| Exam portions | 1 exam | every exam |
| Classroom import | manual | automatic in the background |
| Printable schedule | — | yes |

Everything else — courses, syllabus, notes, flashcards, timer, deadlines, grades,
messages, study rooms — is free and stays free. Gating is deliberately limited to
things that cost money to run or save real time near an exam; nothing that makes
the app worth sharing sits behind the paywall.

**Expiry is not deletion.** When a pass runs out the planner shortens back to a
week and background sync stops. Exam portions, syllabus and history remain exactly
as they were.

## Where the offer appears

- **Exams and Study plan** — only when an exam is within 21 days, naming the exam
  and the days left. Contextual, not a permanent banner.
- **Any 402 response** — a gated action returns `402 Payment Required` with
  `{ upgrade: true, feature }`, and the client turns that into the offer instead
  of an error message.
- **Exam pass** in the sidebar — the full catalogue, what stays free, and payment history.

## Testing without touching Razorpay

```bash
npm test        # 150 tests, including signature verification and entitlement stacking
```

The suite covers: a tampered order id, payment id or amount failing verification; a
webhook body altered in transit failing; unsigned requests failing closed; stacking
and extension arithmetic; and revoked or expired rows never granting access.
