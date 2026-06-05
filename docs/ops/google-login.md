# Google login ("Continue with Google")

Social login via django-allauth. **Free** (Google OAuth + allauth). Respects
invite-only: a *new* Google user can sign up only if their email holds an
invite (`SocialAccountAdapter.is_open_for_signup`); existing users — matched by
their verified Google email — just log in.

## How it works

1. The frontend "Continue with Google" button (`GoogleButton`, shown only when
   Google is configured) does a real form POST to
   `/_allauth/browser/v1/auth/provider/redirect`.
2. allauth 302s to Google; after consent, Google calls back to
   `/accounts/google/login/callback/` (same-origin via the frontend rewrite, so
   the session cookie lands on the public host).
3. allauth finishes and redirects to `/auth/callback` on the frontend —
   authenticated on success, or `?error=signup_closed` when the invite gate
   rejects a new email. That route refreshes the session and routes the user.

## Google Cloud setup (one-time)

1. [console.cloud.google.com](https://console.cloud.google.com) → create/select a project.
2. **APIs & Services → OAuth consent screen**: External; fill app name, support
   email; add your email as a test user (or publish). Scopes: `email`, `profile`.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - **Authorized redirect URIs**:
     - `https://music.whirlyfan.com/accounts/google/login/callback/`
     - (local dev) `http://localhost/accounts/google/login/callback/`
4. Copy the **Client ID** and **Client secret**.

## Wire the credentials

Never commit these. Set them as env vars:

- **Prod (Render):** dashboard → `music-backend` → Environment →
  `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (both `sync: false` in
  `render.yaml`). Redeploys automatically; the button then appears.
- **Dev:** add the same two keys to Doppler (the dev config). The button shows
  once they're present.

No SocialApp row in the Django admin is needed — allauth reads the credentials
straight from settings (`SOCIALACCOUNT_PROVIDERS["google"]["APPS"]`).

## Notes

- Google asserts emails as verified, so Google users skip the
  verify-email gate. `SOCIALACCOUNT_EMAIL_AUTHENTICATION` auto-connects a Google
  login to an existing local account with the same verified email (no duplicate,
  no unique-email error) — safe precisely because Google verified it.
- To let someone in via Google, invite their Google email first (same invite
  flow as email signup), or flip the `invite_only` switch off in `/admin/`.
