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
    return user, created


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
            # Keep superusers so whoever is logged into /admin/ doesn't
            # get booted. Known admin account is recreated below anyway.
            User.objects.filter(is_superuser=False).delete()
            self.stdout.write(self.style.WARNING("Flushed notes + non-superuser users."))

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
            seed_user_data(user, notes=notes_per_user)

        # Summary.
        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded: {User.objects.count()} users, {Note.objects.count()} notes."
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
