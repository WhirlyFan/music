"""Seed the database with reproducible fake data for local development.

Connects via DATABASE_URL — should be the admin (BYPASSRLS) role so inserts
work across owners. The Makefile wires this up automatically.

Two layers of accounts:

1. KNOWN_ACCOUNTS — fixed credentials, always present after seed. Used for
   manual login during dev. Idempotent: passwords + flags are reset on
   every run so docs and reality stay in sync.

2. Fake users (`--fake-users N`, default 5) — anonymous accounts generated
   via UserFactory. They make the DB feel busy + let you visually verify
   RLS isolation in the admin (each fake user owns their own notes).

Every user — known OR fake — gets the same fake data via `seed_user_data()`.
Add new models there once; both account types get them automatically.
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
from apps.notes.models import Note
from apps.notes.tests.factories import NoteFactory
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
    if spec.is_superuser:
        ensure_dev_totp(user)
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


# Fixed dev TOTP secret. Base32-encoded; same across reseeds so local
# devs can keep one authenticator entry. This is checked into the repo
# alongside the seed admin password — both are dev-only artifacts and
# the `handle()` guard refuses to run with DEBUG=False so they can never
# reach prod. Production admins create their own credentials via
# `python manage.py createsuperuser` and enroll TOTP via the UI.
_DEV_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"


def ensure_dev_totp(user) -> None:
    """Idempotently enroll the seeded staff user in TOTP.

    Why: the RequireMfaForStaffMiddleware redirects /admin/ visits to the
    enrollment page until at least one Authenticator exists. Without this,
    every fresh seed leaves admin@example.com unable to reach /admin/.
    """
    from allauth.mfa.models import Authenticator

    Authenticator.objects.update_or_create(
        user=user,
        type=Authenticator.Type.TOTP,
        defaults={"data": {"secret": _DEV_TOTP_SECRET}},
    )


# ---------- Per-user data -------------------------------------------------


def seed_user_data(user, *, notes: int):
    """Populate `user` with the standard fake-data set.

    This is the one place that knows what 'fake data for a user' means.
    When you add a new model, append its factory call here:

        ProjectFactory.create_batch(3, owner=user)
        TaskFactory.create_batch(10, project=user.projects.first())
    """
    NoteFactory.create_batch(notes, owner=user)


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


def seed_catalog() -> int:
    """Create a few sample public playlists (tracks + an active YouTube
    playback source each) so the /playlists UI has content out of the box.

    Network-free: the video ids are fake, so they populate the UI but won't
    actually play. For real, playable data run `ingest_apple` + `match_youtube`.

    Idempotent: skips if any playlist already exists, so re-seeding (without
    --flush) doesn't pile up duplicates.
    """
    if Playlist.objects.exists():
        return 0
    for _ in range(3):
        playlist = PlaylistFactory()
        for position in range(8):
            track = TrackFactory()
            PlaylistTrackFactory(playlist=playlist, track=track, position=position)
            PlaybackSourceFactory(track=track)
    return 3


# ---------- Command -------------------------------------------------------


class Command(BaseCommand):
    help = "Populate the database with reproducible fake data."

    def add_arguments(self, parser):
        parser.add_argument(
            "--notes",
            type=int,
            default=10,
            help="Notes per user (applies to both known + fake users). Default 10.",
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
            help="Delete notes + non-superuser users before seeding.",
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
                "wrong — bakes a known superuser password + TOTP into prod."
            ),
        )

    @transaction.atomic
    def handle(self, *args, **options):
        # Hard guard: this command bakes in fixed credentials (incl. a known
        # superuser password and TOTP secret — see seed.py and .env). Running
        # it against a non-DEBUG environment would create a backdoor superuser
        # in prod. Refuse loudly unless an operator has explicitly opted in.
        if not settings.DEBUG and not options.get("allow_in_prod"):
            raise CommandError(
                "Refusing to seed: DJANGO_DEBUG is False. The seed command bakes "
                "in fixed credentials (including a known admin password and TOTP "
                "secret) and must not run in production. Pass --allow-in-prod if "
                "you really mean it (you almost certainly don't)."
            )

        # Deterministic Faker output across runs.
        factory.random.reseed_random("react-django-template-dev")

        if options["flush"]:
            Note.objects.all().delete()
            Playlist.objects.all().delete()  # cascades PlaylistTrack + SourceLink
            Track.objects.all().delete()  # cascades PlaybackSource
            # Keep superusers so whoever is logged into /admin/ doesn't
            # get booted. Known admin account is recreated below anyway.
            User.objects.filter(is_superuser=False).delete()
            self.stdout.write(self.style.WARNING("Flushed notes, catalog + non-superuser users."))

        notes_per_user = options["notes"]

        # 1. Known accounts — always present, documented credentials.
        for spec in KNOWN_ACCOUNTS:
            user, created = upsert_known_account(spec)
            if created:
                self.stdout.write(self.style.SUCCESS(f"Created account: {spec.email}"))
            seed_user_data(user, notes=notes_per_user)

        # 2. Anonymous fake users — feeds RLS isolation visuals, pagination,
        #    busy lists. Each gets the same per-user data treatment.
        for _ in range(options["fake_users"]):
            user = UserFactory()
            ensure_verified_email(user, user.email)  # mandatory mode requires this
            seed_user_data(user, notes=notes_per_user)

        # 3. Sample catalog (shared, not per-user) — gives the /playlists UI
        #    content out of the box. Idempotent (create-if-empty).
        seed_catalog()

        # 4. Real playlists (Spotify + Apple) into the dev account, so artwork +
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
                f"Seeded: {User.objects.count()} users, {Note.objects.count()} notes, "
                f"{Playlist.objects.count()} playlists."
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
        self.stdout.write(
            "Admin TOTP enrolled with dev secret. Add a new authenticator entry "
            "with secret = " + _DEV_TOTP_SECRET
        )
