"""Seed the database with reproducible fake data for local development.

Connects via DATABASE_URL — should be the admin (BYPASSRLS) role so inserts
work across owners. The Makefile wires this up automatically.

Two layers of accounts:

1. KNOWN_ACCOUNTS — fixed credentials, always present after seed. Used for
   manual login during dev. Idempotent: passwords + flags are reset on
   every run so docs and reality stay in sync.

2. Fake users (`--fake-users N`, default 5) — anonymous accounts generated
   via UserFactory. They make the DB feel busy + let you visually verify
   RLS isolation in the admin (each fake user owns their own playlists).
"""

from __future__ import annotations

from dataclasses import dataclass

import factory.random
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.catalog.models import Playlist, Track
from apps.catalog.tests.factories import (
    PlaybackSourceFactory,
    PlaylistFactory,
    PlaylistTrackFactory,
    TrackFactory,
)
from apps.users.tests.factories import UserFactory

User = get_user_model()


# ---------- Known accounts ------------------------------------------------


@dataclass(frozen=True)
class AccountSpec:
    email: str
    username: str
    password: str
    first_name: str = ""
    last_name: str = ""
    is_superuser: bool = False


KNOWN_ACCOUNTS: tuple[AccountSpec, ...] = (
    AccountSpec(
        email="dev@example.com",
        username="dev",
        password="password1234",
        first_name="Dev",
        last_name="User",
    ),
    AccountSpec(
        email="admin@example.com",
        username="admin",
        password="adminpassword123",
        first_name="Admin",
        last_name="User",
        is_superuser=True,
    ),
)


def upsert_known_account(spec: AccountSpec):
    """Create or refresh a known user. Resets password + flags every run."""
    user, created = User.objects.get_or_create(
        email=spec.email,
        defaults={
            "username": spec.username,
            "first_name": spec.first_name,
            "last_name": spec.last_name,
        },
    )
    user.is_staff = spec.is_superuser  # superuser implies staff (/admin/)
    user.is_superuser = spec.is_superuser
    user.set_password(spec.password)
    user.save()
    ensure_verified_email(user, spec.email)
    return user, created


def ensure_verified_email(user, email: str) -> None:
    """Mark the seeded user's email as verified.

    Why: ACCOUNT_EMAIL_VERIFICATION = "mandatory" blocks login until the
    user has clicked a verification link. The seed bakes in known
    credentials so devs can log in without going through email — make the
    EmailAddress row exist and `verified=True` so allauth treats them as
    fully verified.
    """
    from allauth.account.models import EmailAddress

    EmailAddress.objects.update_or_create(
        user=user,
        email=email,
        defaults={"verified": True, "primary": True},
    )


# ---------- Per-user data -------------------------------------------------


def seed_user_data(user, *, playlists: int):
    """Give `user` a few owned playlists (each with sample tracks).

    Playlists are RLS-scoped to their owner, so seeding each fake user with
    their own makes owner-isolation visible in /admin/ and exercises the
    catalog UI. Network-free: the video ids are fake (won't actually play) —
    real, playable playlists are imported into the dev account separately.
    """
    for _ in range(playlists):
        playlist = PlaylistFactory(created_by=user)
        for position in range(8):
            track = TrackFactory()
            PlaylistTrackFactory(playlist=playlist, track=track, position=position)
            PlaybackSourceFactory(track=track)


# Real public playlists ingested into the dev account so artwork + playback can be
# checked against live data. Best-effort (network + scrape dependent).
SEED_PLAYLIST_URLS: tuple[str, ...] = (
    "https://open.spotify.com/playlist/37i9dQZEVXbLRQDuF5jeBp",  # Spotify: Top 50 - USA
    "https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb",  # Apple
)


def seed_real_playlists(user) -> list[tuple[str, int, str | None]]:
    """Import the real playlists above into `user`'s account, saved as Playlists.

    Best-effort: each URL is independent and any failure (offline, scrape change,
    rate limit) is captured and skipped so the seed never breaks. Idempotent by
    title. Returns [(title_or_url, track_count, error_or_None)]."""
    from apps.catalog import services

    out: list[tuple[str, int, str | None]] = []
    for url in SEED_PLAYLIST_URLS:
        try:
            result = services.ingest(url, user=user)
            title = result["title"]
            if not Playlist.objects.filter(created_by=user, title=title).exists():
                services.create_playlist_from_tracks(
                    user=user,
                    title=title,
                    track_ids=[t.id for t in result["tracks"]],
                    artwork_url=result.get("cover", ""),
                )
            out.append((title, len(result["tracks"]), None))
        except Exception as e:  # noqa: BLE001 — best-effort; never fail the seed
            out.append((url, 0, str(e)[:90]))
    return out


# ---------- Command -------------------------------------------------------


class Command(BaseCommand):
    help = "Populate the database with reproducible fake data."

    def add_arguments(self, parser):
        parser.add_argument(
            "--playlists",
            type=int,
            default=2,
            help="Owned playlists per fake user (demonstrates RLS isolation). Default 2.",
        )
        parser.add_argument(
            "--fake-users",
            type=int,
            default=5,
            help="Number of anonymous fake users to generate. Pass 0 to skip. Default 5.",
        )
        parser.add_argument(
            "--flush",
            action="store_true",
            help="Delete the catalog + non-superuser users before seeding.",
        )
        parser.add_argument(
            "--skip-real-playlists",
            action="store_true",
            help="Skip importing the real Spotify/Apple seed playlists (offline-friendly).",
        )
        parser.add_argument(
            "--allow-in-prod",
            action="store_true",
            help=(
                "Force seeding even when DJANGO_DEBUG=False. Almost certainly "
                "wrong — bakes a known superuser password into prod."
            ),
        )

    @transaction.atomic
    def handle(self, *args, **options):
        # Hard guard: this command bakes in fixed credentials (a known superuser
        # password — see seed.py and .env). Running it against a non-DEBUG
        # environment would create a backdoor superuser in prod. Refuse loudly
        # unless an operator has explicitly opted in.
        if not settings.DEBUG and not options.get("allow_in_prod"):
            raise CommandError(
                "Refusing to seed: DJANGO_DEBUG is False. The seed command bakes "
                "in a fixed admin password and must not run in production. Pass "
                "--allow-in-prod if you really mean it (you almost certainly don't)."
            )

        # Deterministic Faker output across runs.
        factory.random.reseed_random("music-dev")

        if options["flush"]:
            Playlist.objects.all().delete()  # cascades PlaylistTrack + SourceLink
            Track.objects.all().delete()  # cascades PlaybackSource
            # Keep superusers so whoever is logged into /admin/ doesn't
            # get booted. Known admin account is recreated below anyway.
            User.objects.filter(is_superuser=False).delete()
            self.stdout.write(self.style.WARNING("Flushed catalog + non-superuser users."))

        playlists_per_user = options["playlists"]

        # 1. Known accounts — always present, documented credentials. The dev
        #    account gets real playlists below; no fake owned data here.
        for spec in KNOWN_ACCOUNTS:
            _, created = upsert_known_account(spec)
            if created:
                self.stdout.write(self.style.SUCCESS(f"Created account: {spec.email}"))

        # 2. Anonymous fake users — each owns their own playlists, so RLS
        #    owner-isolation is visible in /admin/ + lists feel busy.
        for _ in range(options["fake_users"]):
            user = UserFactory()
            ensure_verified_email(user, user.email)  # mandatory mode requires this
            seed_user_data(user, playlists=playlists_per_user)

        # 3. Real playlists (Spotify + Apple) into the dev account, so artwork +
        #    playback can be checked against live data. Best-effort.
        if not options["skip_real_playlists"]:
            dev_user = User.objects.get(email=KNOWN_ACCOUNTS[0].email)
            for title, count, err in seed_real_playlists(dev_user):
                if err:
                    self.stdout.write(self.style.WARNING(f"Skipped playlist {title}: {err}"))
                else:
                    self.stdout.write(self.style.SUCCESS(f"Imported playlist “{title}” ({count} tracks)"))

        # Summary.
        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded: {User.objects.count()} users, {Playlist.objects.count()} playlists."
            )
        )
        self.stdout.write("")
        self.stdout.write("Known logins:")
        for spec in KNOWN_ACCOUNTS:
            role = " (superuser, /admin/)" if spec.is_superuser else ""
            self.stdout.write(
                f"  {spec.username:<6}→ email '{spec.email}' or username '{spec.username}' "
                f"/ {spec.password}{role}"
            )
        self.stdout.write("")
        self.stdout.write("MFA is optional — enroll from Settings if you want it.")
