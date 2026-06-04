"""One-time Spotify authorization → saves the user refresh token (encrypted) to the DB.

A *user* token (from any free account) lifts the client-credentials restrictions, so
the API can read full playlists. Run this once with a dedicated account; the token is
stored encrypted in the SpotifyAuth row and auto-refreshed thereafter — no restart,
no manual secret to paste.

    docker compose exec -it backend doppler run -- \
        /app/.venv/bin/python manage.py spotify_authorize

SPOTIFY_REDIRECT_URI must be registered in the Spotify app dashboard (Spotify allows
http on 127.0.0.1). Reading *public* playlists needs no scopes.
"""

import base64
import json
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

_AUTH_URL = "https://accounts.spotify.com/authorize"
_TOKEN_URL = "https://accounts.spotify.com/api/token"
_SCOPE = ""  # public playlist reads need no scopes


class Command(BaseCommand):
    help = "One-time: authorize a Spotify account; save its refresh token (encrypted) to the DB."

    def add_arguments(self, parser):
        parser.add_argument(
            "--code-url",
            help="Full URL you were redirected to (contains ?code=). Omit for step 1 (prints the auth URL).",
        )
        parser.add_argument(
            "--redirect-uri",
            help="Override SPOTIFY_REDIRECT_URI for this run (only used during authorize). "
            "Must match the URI registered in the Spotify app, and be the SAME in both steps.",
        )

    def handle(self, *args, **options):
        cid = settings.SPOTIFY_CLIENT_ID
        secret = settings.SPOTIFY_CLIENT_SECRET
        redirect = options.get("redirect_uri") or settings.SPOTIFY_REDIRECT_URI
        if not (cid and secret):
            raise CommandError("Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET (Doppler) first.")

        # Two non-interactive steps (no stdin prompt, so it's scriptable):
        #   step 1 (no --code-url): print the auth URL to open + approve;
        #   step 2 (--code-url "…"): exchange the redirected URL and save the token.
        code_url = options.get("code_url")
        if not code_url:
            auth_url = f"{_AUTH_URL}?" + urllib.parse.urlencode(
                {
                    "client_id": cid,
                    "response_type": "code",
                    "redirect_uri": redirect,
                    "scope": _SCOPE,
                }
            )
            self.stdout.write("")
            self.stdout.write(f"Redirect URI (must be registered in the Spotify app): {redirect}")
            self.stdout.write("")
            self.stdout.write("Open this URL, log in as the DEDICATED account, click Agree:")
            self.stdout.write(self.style.HTTP_INFO(auth_url))
            self.stdout.write("")
            self.stdout.write(
                f"You'll land on {redirect}?code=... (a 404/error page is fine). Then re-run:"
            )
            self.stdout.write(
                '  manage.py spotify_authorize --code-url "<the FULL redirected URL>"'
            )
            return

        code = urllib.parse.parse_qs(urllib.parse.urlparse(code_url).query).get("code", [None])[0]
        if not code:
            raise CommandError("No ?code= found in that URL — pass the whole redirected URL.")

        auth = base64.b64encode(f"{cid}:{secret}".encode()).decode()
        data = urllib.parse.urlencode(
            {"grant_type": "authorization_code", "code": code, "redirect_uri": redirect}
        ).encode()
        req = urllib.request.Request(
            _TOKEN_URL,
            data=data,
            headers={
                "Authorization": f"Basic {auth}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                body = json.loads(r.read())
        except urllib.error.HTTPError as e:
            raise CommandError(
                f"Token exchange failed ({e.code}): {e.read().decode()[:300]}"
            ) from e

        refresh = body.get("refresh_token")
        if not refresh:
            raise CommandError("Spotify's response had no refresh_token.")

        # Save it encrypted to the DB; never print/log the token itself.
        from apps.catalog.models import SpotifyAuth

        SpotifyAuth.set_refresh_token(refresh)

        self.stdout.write("")
        if not settings.SPOTIFY_TOKEN_KEY:
            self.stdout.write(
                self.style.WARNING(
                    "⚠ SPOTIFY_TOKEN_KEY isn't set — the token was stored UNENCRYPTED. "
                    "Set a Fernet key in Doppler and re-run for encryption at rest."
                )
            )
        self.stdout.write(
            self.style.SUCCESS("✅ Authorized and saved. Full playlist reads are now active.")
        )
