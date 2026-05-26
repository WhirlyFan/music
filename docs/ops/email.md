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
| **Local dev** | `django.core.mail.backends.console.EmailBackend` (default in dev settings) | Emails print to `docker compose logs backend`. The reset link is right there in stdout — copy + paste to test |
| **Render Phase A** | `smtp.EmailBackend` with no SMTP server configured | Emails fail silently or with stack traces. **Reset flow is dead-on-arrival until configured** |
| **CI** | Same as dev — console backend | Not used (we don't test email flows in CI) |

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

## Wiring Resend (or any provider) — the minimal version

### 1. Sign up + get a domain / sender

- Sign up at the provider
- Either:
  - **Use their shared sender** (e.g. `onboarding@resend.dev`) — works instantly but obviously branded
  - **Verify your own domain** — adds DKIM + SPF DNS records. Takes 10-30 minutes. Required for prod-grade deliverability.

### 2. Get an API key

Most providers give you an API key in their dashboard. Treat it like a secret.

### 3. Backend settings

Add to `config/settings/prod.py` (and `dev.py` if you want to test against a real provider locally):

```python
# Swap the EMAIL_BACKEND that base.py / prod.py sets.
EMAIL_BACKEND = "anymail.backends.resend.EmailBackend"   # or .postmark, .mailgun, .sendgrid, .amazon_ses

ANYMAIL = {
    "RESEND_API_KEY": env("RESEND_API_KEY"),
}

# This is the From: address allauth uses. Must match a verified sender on
# the provider, OR be a domain you've verified DKIM for.
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="noreply@example.com")
SERVER_EMAIL = DEFAULT_FROM_EMAIL  # used by Django for error emails to admins
```

### 4. Env vars

Add to `.env.example` + the deployed environment (Render dashboard):

```
RESEND_API_KEY=re_...
DEFAULT_FROM_EMAIL=noreply@yourdomain.com
```

On Render: backend service → Environment → Add Secret. Don't paste API
keys into `render.yaml` — leak in plaintext on every fork.

### 5. Verify

Locally (with the provider's backend active):

```python
docker compose exec backend python manage.py shell
>>> from django.core.mail import send_mail
>>> send_mail("test", "hello", "noreply@yourdomain.com", ["you@example.com"])
```

Check the provider dashboard for the delivery record.

Or trigger the full allauth flow: hit `POST /_allauth/browser/v1/auth/password/request`
with a known email. Provider dashboard shows the delivery; the inbox
receives the reset link.

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

**The localhost URL footgun** is the one that bites everyone on first
prod deploy. Reset links generated by allauth use `HEADLESS_FRONTEND_URLS`
verbatim. In `config/settings/base.py`:

```python
HEADLESS_FRONTEND_URLS = {
    "account_confirm_email": "http://localhost/account/verify-email/{key}",
    "account_reset_password_from_key": "http://localhost/account/password/reset/key/{key}",
    "account_signup": "http://localhost/signup",
}
```

For prod, override these via env-driven URLs in `prod.py` to use your
real domain. Worth doing in a follow-up PR alongside provider wiring.

## See also

- [auth.md](../auth.md) — where these flows live in code
- [django-anymail docs](https://anymail.dev/) — provider-specific configs
- [Resend Django guide](https://resend.com/docs/send-with-django) — provider-specific walkthrough
