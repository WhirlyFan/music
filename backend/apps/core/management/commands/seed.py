"""Seed the database with reproducible fake data for local development.

Connects via DATABASE_URL — should be the admin (BYPASSRLS) role so inserts
work across owners. The Makefile wires this up automatically.

Two known accounts are always created with the documented credentials
(idempotent — passwords get reset on every run):

  * dev   → dev@example.com   / 'dev'   / password1234
  * admin → admin@example.com / 'admin' / adminpassword123  (superuser → /admin/)

Each known account gets a configurable batch of fake notes. To add filler
data for future models, declare a new factory and append a call to the
per-account loop below — see `apps/<app>/tests/factories.py` for the
pattern (e.g. `NoteFactory`).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import factory.random
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.notes.models import Note
from apps.notes.tests.factories import NoteFactory
from apps.users.tests.factories import UserFactory

User = UserFactory._meta.model


@dataclass(frozen=True)
class AccountSpec:
    email: str
    username: str
    password: str
    first_name: str = ""
    last_name: str = ""
    is_superuser: bool = False
    # Extra attributes future models might want to override per account.
    extra: dict = field(default_factory=dict)


# Single source of truth for known accounts. Add new ones here — the runner
# below upserts them all + their fake data.
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


def upsert_account(spec: AccountSpec):
    """Create or refresh a known user. Always resets the password + flags
    so the docs stay in sync if someone tweaks the account in /admin/."""
    user, created = User.objects.get_or_create(
        email=spec.email,
        defaults={
            "username": spec.username,
            "first_name": spec.first_name,
            "last_name": spec.last_name,
        },
    )
    user.is_staff = spec.is_superuser  # superuser implies staff for /admin/
    user.is_superuser = spec.is_superuser
    user.set_password(spec.password)
    user.save()
    return user, created


class Command(BaseCommand):
    help = "Populate the database with reproducible fake data."

    def add_arguments(self, parser):
        parser.add_argument(
            "--notes",
            type=int,
            default=10,
            help="Fake notes per known account (default: 10).",
        )
        parser.add_argument(
            "--flush",
            action="store_true",
            help="Delete all notes + non-superuser users (and any non-known accounts) before seeding.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        # Deterministic Faker output across runs.
        factory.random.reseed_random("react-django-template-dev")

        if options["flush"]:
            Note.objects.all().delete()
            # Wipe everyone except superusers — protects whoever's currently
            # logged into /admin/. The admin block below also force-creates
            # the documented admin account so credentials stay current.
            User.objects.filter(is_superuser=False).delete()
            self.stdout.write(self.style.WARNING("Flushed notes + non-superuser users."))

        # Upsert known accounts + their filler data.
        for spec in KNOWN_ACCOUNTS:
            user, created = upsert_account(spec)
            if created:
                self.stdout.write(self.style.SUCCESS(f"Created account: {spec.email}"))
            # Per-account fake data. Add new model batches here as you build them:
            #   ProjectFactory.create_batch(3, owner=user)
            #   TaskFactory.create_batch(10, project=...)
            NoteFactory.create_batch(options["notes"], owner=user)

        # Summary.
        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded: {User.objects.count()} users, {Note.objects.count()} notes."
            )
        )
        self.stdout.write("")
        self.stdout.write("Login credentials:")
        for spec in KNOWN_ACCOUNTS:
            role = " (superuser, /admin/)" if spec.is_superuser else ""
            self.stdout.write(
                f"  {spec.username:<6}→ email '{spec.email}' or username '{spec.username}' "
                f"/ {spec.password}{role}"
            )
