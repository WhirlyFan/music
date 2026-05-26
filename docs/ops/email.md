# Email (Transactional)

What email is for, what's working today, and how to wire a real provider
when you actually need to send mail.

## What email is for in this template

Three flows currently rely on email — none of them work in production
until we wire a provider:

| Flow | Triggered by | Endpoint |
|---|---|---|
| **Password reset** | User clicks "Forgot password?" + submits email | `POST /_allauth/browser/v1/auth/password/request` |
| **Email verification** | New signup (currently `ACCOUNT_EMAIL_VERIFICATION = "optional"`) | Sent automatically by allauth |
| **Future: MFA backup email** | Recovery flow if a user loses TOTP + recovery codes | Not built yet |

The frontend pages (`/account/password/forgot`, `/account/password/reset/key/$key`)
are built and route correctly — only the *delivery* of the link is broken
in prod until a provider is configured.

## Current state — what works where

| Environment | Email backend | What you'll see |
|---|---|---|
| **Local dev** | SMTP → **Mailpit** container at `mailpit:1025` | Emails captured locally; rendered HTML viewable at **http://localhost:8025**. No internet calls. No signup. |
| **Render Phase A** | `smtp.EmailBackend` with no provider configured | Emails fail silently or with stack traces. **Reset flow is dead-on-arrival until configured.** |
| **CI** | Backend tests don't touch real email | Not used |

## Local dev: Mailpit

[Mailpit](https://mailpit.axllent.org/) is a tiny SMTP catch-all + web UI.
Captures every outgoing email locally and renders the HTML the way a real
client would. No signup, no rate limits, no internet calls. Runs as a
~25 MB Docker container.

Already wired into `docker-compose.yml`:

```yaml
mailpit:
  image: axllent/mailpit:v1.20.7
  ports:
    - "8025:8025"   # web UI
    - "1025:1025"   # SMTP listener
```

And referenced in `config/settings/dev.py`:

```python
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = "mailpit"
EMAIL_PORT = 1025
```

**Workflow:**

1. `docker compose up -d`
2. Trigger any email flow — sign up, password reset, etc.
3. Open **http://localhost:8025** — every email appears in the inbox
4. Click an email → see rendered HTML, raw source, headers, attachments
5. Mailpit clears its inbox on container restart (it's in-memory by default)

**Why not the console backend?**
The previous default — `django.core.mail.backends.console.EmailBackend` —
prints email text to `docker compose logs backend`. That works for
"does the link exist", but you can't see how the HTML actually renders,
and `docker compose logs` interleaves everything else. Mailpit gives you
a real inbox UI for ~25 MB of disk.

**Switching back to console backend** (rare):
Set `EMAIL_BACKEND=django.core.mail.backends.console.EmailBackend` in
your local `.env` to override.

## Provider options

Pick one. All five work fine with `django-anymail` (already in our deps).

| Provider | Free tier | Paid starts | Best for | Notes |
|---|---|---|---|---|
| **[Resend](https://resend.com)** | 100/day, 3K/mo | $20/mo (50K) | Solo dev, modern dashboard, hobby projects | Cleanest API, great DX. Recommended for this template. |
| **[Postmark](https://postmarkapp.com)** | None (paid only) | $15/mo (10K) | Production B2B SaaS — fastest, most reliable | Strict policy (transactional only, no marketing) |
| **[Mailgun](https://mailgun.com)** | None since 2024 | $35/mo (50K) | Mid/large scale | Older, more features |
| **[SendGrid](https://sendgrid.com)** | 100/day | $20/mo | Large scale, marketing + transactional | Owned by Twilio, sometimes flaky for transactional reputation |
| **[AWS SES](https://aws.amazon.com/ses/)** | 62K/mo from EC2 | $0.10/1K | Highest volume, cheapest at scale | Most setup; need DKIM, sandbox-exit, IAM |

**My recommendation for this template:** Resend.
- Generous free tier covers a hobby/template app forever
- 5-minute setup (no DNS unless you want a custom domain)
- Honest pricing if you scale ($0.40/1K vs SendGrid's similar pricing but more friction)

## Production: wiring Resend (recommended)

Free tier: **3,000 emails/month, 100/day, no credit card**. Generous
enough that a template-scale app will likely never exceed it.

The steps below take ~10 minutes if you skip the custom domain, or
~30 minutes including DNS verification for prod-grade deliverability.

### Step 1: Sign up at [resend.com](https://resend.com)

No card required. Skip the optional onboarding survey if you want.

### Step 2: Decide on a sender

| Option | What you get | When to use |
|---|---|---|
| **Shared sender** `onboarding@resend.dev` | Works instantly. From: address shows `resend.dev`. | Quick prototype, internal dev, staging |
| **Your own domain** (e.g. `noreply@yourdomain.com`) | Looks legit, much better deliverability | Production-facing app |

**To use your own domain:**
1. Resend dashboard → Domains → Add Domain → enter `yourdomain.com`
2. Resend gives you 3 DNS records (DKIM + SPF + MX-style)
3. Add them in your DNS provider (Cloudflare, Namecheap, Route 53, etc.)
4. Resend dashboard verifies within ~5 minutes (often instant)

### Step 3: Get an API key

Resend dashboard → API Keys → "Create API Key"
- Name it (e.g. `react-django-template-prod`)
- Permission: **Sending access** (don't grant full access)
- Copy the key — it starts with `re_`. You can't see it again.

### Step 4: Update `prod.py`

```python
# backend/config/settings/prod.py
from .base import *  # noqa: F401,F403
from .base import env

# ...existing prod settings...

# Replace the default SMTP backend with Anymail's Resend backend.
EMAIL_BACKEND = "anymail.backends.resend.EmailBackend"

ANYMAIL = {
    "RESEND_API_KEY": env("RESEND_API_KEY"),
}

# This is the From: address allauth uses for password reset, email
# verification, etc. Must match a verified sender on Resend OR be a
# domain you've verified DKIM/SPF for above.
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="onboarding@resend.dev")
SERVER_EMAIL = DEFAULT_FROM_EMAIL  # used by Django for error emails to admins
```

### Step 5: Add the env vars to Render

Render dashboard → backend service → Environment → Add Environment Variable:

| Key | Value | Notes |
|---|---|---|
| `RESEND_API_KEY` | the `re_...` key from step 3 | **Mark as Secret.** Never paste API keys into `render.yaml`. |
| `DEFAULT_FROM_EMAIL` | `noreply@yourdomain.com` or `onboarding@resend.dev` | Match whatever you set up in step 2. |

Save → Render redeploys the backend with the new env vars.

### Step 6: Verify

Trigger a password reset against the real prod URL:

```sh
# Replace with your actual Render URL
FRONTEND=https://react-django-template-frontend.onrender.com
curl -c /tmp/cookies.txt $FRONTEND/_allauth/browser/v1/config > /dev/null
CSRF=$(grep csrftoken /tmp/cookies.txt | awk '{print $NF}')
curl -b /tmp/cookies.txt \
  -H "X-CSRFToken: $CSRF" -H "Content-Type: application/json" \
  -H "X-Requested-With: XMLHttpRequest" \
  -X POST $FRONTEND/_allauth/browser/v1/auth/password/request \
  -d '{"email":"you@yourdomain.com"}'
```

Check **Resend dashboard → Emails** — the delivery record appears with
status `delivered` (or `bounced`, `complained`, etc. if there's a problem).

Check your inbox. Click the link. Confirm it lands on the frontend's
`/account/password/reset/key/<key>` route and works end-to-end.

### Step 7: confirm `FRONTEND_ORIGIN` is set

The reset link URL is built from `HEADLESS_FRONTEND_URLS` in
`config/settings/base.py`, which is already env-driven via `FRONTEND_ORIGIN`.

`render.yaml` sets this for the backend service automatically. If you
deploy somewhere else (k8s, GCP, etc.), make sure `FRONTEND_ORIGIN` is
set to your user-facing frontend URL — otherwise emails contain
`http://localhost/...` links.

### Alternative providers (same shape, different settings)

Pick a different provider? Swap step 4's `EMAIL_BACKEND` and `ANYMAIL`
config. The rest stays identical.

| Provider | EMAIL_BACKEND | ANYMAIL key | Free tier |
|---|---|---|---|
| **Resend** | `anymail.backends.resend.EmailBackend` | `RESEND_API_KEY` | 3K/mo ✅ |
| Postmark | `anymail.backends.postmark.EmailBackend` | `POSTMARK_SERVER_TOKEN` | None |
| Mailgun | `anymail.backends.mailgun.EmailBackend` | `MAILGUN_API_KEY` + `MAILGUN_SENDER_DOMAIN` | None since 2024 |
| SendGrid | `anymail.backends.sendgrid.EmailBackend` | `SENDGRID_API_KEY` | 100/day |
| AWS SES | `anymail.backends.amazon_ses.EmailBackend` | `AMAZON_SES_CLIENT_PARAMS` + IAM | 62K/mo (from EC2 only) |

## Deliverability (the part nobody talks about)

A wired-up provider isn't enough to make sure emails *land in inboxes*. The
big variables:

| Factor | Why it matters | Fix |
|---|---|---|
| **DKIM** | Cryptographically signs each email so receivers can verify it came from your domain | Add the TXT records the provider gives you |
| **SPF** | Tells receivers which servers are allowed to send from your domain | TXT record listing your provider's IPs |
| **DMARC** | Policy on what receivers should do if SPF/DKIM fail | Start with `p=none` (monitor), upgrade to `p=quarantine` once clean |
| **From: address** | Must match domain that DKIM+SPF cover | Use `noreply@yourdomain.com` if domain is verified |
| **Sender reputation** | Built over time. New domains have ~0 reputation, sometimes land in spam initially | Send sparingly at first; avoid marketing-style content in transactional emails |
| **Content** | Heuristics catch spammy phrases ("FREE!!", excessive caps, etc.) | Templates already err on the safe side |

For a hobby/template app: use the provider's shared sender to skip all of
this. For a real product: invest 30 min in DKIM + SPF before launch.

## Cost calibration

For *this* template at hobby scale:
- ~10-50 emails/day (signups, occasional resets) = **free forever on Resend**
- 1000 users with average 0.5 emails/user/month = 500/mo = **free**
- 10,000 active users + occasional broadcasts = $20-50/mo

For comparison: SendGrid's free tier handles ~3,000 emails/mo; Resend's
covers 3,000 (100/day × 30). Postmark has no free tier and starts at $15.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Reset email never arrives | EMAIL_BACKEND still `smtp` with no SMTP_HOST | Switch backend in prod.py, set provider env vars |
| Goes to spam | No DKIM/SPF on the From: domain | Verify domain in provider dashboard, add DNS records |
| "Sender not verified" error from provider | DEFAULT_FROM_EMAIL doesn't match a verified sender | Use the shared sender, or verify the domain |
| Email arrives but reset link is `http://localhost/...` | `HEADLESS_FRONTEND_URLS` points at localhost | Update the URLs in settings to your real domain |
| Rate-limited by provider | First-time sender hitting too many addresses | Send slowly; warm up the IP/domain |

**The localhost URL footgun** — historically this bit everyone on first
prod deploy. We now derive `HEADLESS_FRONTEND_URLS` from a single
`FRONTEND_ORIGIN` env var in `config/settings/base.py`. `render.yaml`
sets it; just don't forget to set it on any non-Render deploy too.

## See also

- [auth.md](../auth.md) — where these flows live in code
- [django-anymail docs](https://anymail.dev/) — provider-specific configs
- [Resend Django guide](https://resend.com/docs/send-with-django) — provider-specific walkthrough
