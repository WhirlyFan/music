"""One-time Spotify authorization → prints a user refresh token.

A *user* token (from any free account) lifts the client-credentials restrictions,
so the API can read full playlists. Run this once with a dedicated account, then
store the printed refresh token in Doppler as SPOTIFY_REFRESH_TOKEN and restart.

    docker compose exec backend doppler run -- \
        /app/.venv/bin/python manage.py spotify_authorize

The SPOTIFY_REDIRECT_URI must be registered in the Spotify app dashboard (Spotify
allows http on 127.0.0.1/localhost). Reading *public* playlists needs no scopes.
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
    help = "One-time: authorize a Spotify account and print its refresh token (→ Doppler)."

    def handle(self, *args, **options):
        cid = settings.SPOTIFY_CLIENT_ID
        secret = settings.SPOTIFY_CLIENT_SECRET
        redirect = settings.SPOTIFY_REDIRECT_URI
        if not (cid and secret):
            raise CommandError("Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET (Doppler) first.")

        auth_url = f"{_AUTH_URL}?" + urllib.parse.urlencode(
            {"client_id": cid, "response_type": "code", "redirect_uri": redirect, "scope": _SCOPE}
        )
        self.stdout.write("")
        self.stdout.write("1) Make sure this redirect URI is registered in your Spotify app:")
        self.stdout.write(self.style.WARNING(f"   {redirect}"))
        self.stdout.write("")
        self.stdout.write("2) Open this URL, log in with the DEDICATED account, and click Agree:")
        self.stdout.write(self.style.HTTP_INFO(auth_url))
        self.stdout.write("")
        self.stdout.write(
            f"3) Your browser lands on {redirect}?code=... (an error/404 page is fine — "
            "the code is in the address bar)."
        )
        redirected = input("4) Paste the FULL URL you were redirected to: ").strip()

        code = urllib.parse.parse_qs(urllib.parse.urlparse(redirected).query).get("code", [None])[0]
        if not code:
            raise CommandError("No ?code= found in that URL — paste the whole redirected URL.")

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
            raise CommandError(f"No refresh_token in Spotify's response: {body}")

        self.stdout.write("")
        self.stdout.write(
            self.style.SUCCESS("✅ Add this to Doppler as SPOTIFY_REFRESH_TOKEN, then restart:")
        )
        self.stdout.write(refresh)
