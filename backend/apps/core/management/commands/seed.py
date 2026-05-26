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
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
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
    return user, created


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

    @transaction.atomic
    def handle(self, *args, **options):
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
