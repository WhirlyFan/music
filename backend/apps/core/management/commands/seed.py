"""Seed the database with reproducible fake data for local development.

Connects via DATABASE_URL — should be the admin (BYPASSRLS) role so
inserts work across owners. The Makefile wires this up automatically.

Always creates two known accounts (idempotent — passwords get reset to the
documented values on every run so README + reality stay in sync):
  * dev@example.com / username 'dev' / password 'password1234'  (regular user)
  * admin@example.com / username 'admin' / password 'adminpassword123'
    (is_staff + is_superuser — can sign into /admin/)

Pass --flush to wipe Notes + non-superuser Users first.
"""
from __future__ import annotations

import factory.random
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.notes.models import Note
from apps.notes.tests.factories import NoteFactory
from apps.users.tests.factories import UserFactory

User = UserFactory._meta.model

# Regular dev user.
DEV_EMAIL = "dev@example.com"
DEV_USERNAME = "dev"
# 12+ chars to match the password policy. Still easy to type.
DEV_PASSWORD = "password1234"

# Superuser for /admin/.
ADMIN_EMAIL = "admin@example.com"
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "adminpassword123"


class Command(BaseCommand):
    help = "Populate the database with reproducible fake data."

    def add_arguments(self, parser):
        parser.add_argument("--users", type=int, default=5, help="Number of users to create.")
        parser.add_argument("--notes", type=int, default=10, help="Notes per user.")
        parser.add_argument(
            "--flush",
            action="store_true",
            help="Delete existing notes + non-superuser users before seeding.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        # Deterministic faker output across runs.
        factory.random.reseed_random("react-django-template-dev")

        if options["flush"]:
            Note.objects.all().delete()
            # Deliberately keep superusers — wiping them would lock you out of
            # /admin/ until the next seed. The admin block below resets the
            # admin user's password regardless, so credentials stay current.
            User.objects.filter(is_superuser=False).delete()
            self.stdout.write(self.style.WARNING("Flushed notes + non-superuser users."))

        # --- Dev user --------------------------------------------------------
        dev_user, dev_created = User.objects.get_or_create(
            email=DEV_EMAIL,
            defaults={
                "username": DEV_USERNAME,
                "first_name": "Dev",
                "last_name": "User",
            },
        )
        dev_user.set_password(DEV_PASSWORD)
        dev_user.save()
        if dev_created:
            self.stdout.write(self.style.SUCCESS(f"Created dev user: {DEV_EMAIL}"))

        # --- Admin superuser -------------------------------------------------
        admin_user, admin_created = User.objects.get_or_create(
            email=ADMIN_EMAIL,
            defaults={
                "username": ADMIN_USERNAME,
                "first_name": "Admin",
                "last_name": "User",
            },
        )
        # Force the flags every time — protects against someone accidentally
        # demoting the admin via /admin/ and then forgetting how to fix it.
        admin_user.is_staff = True
        admin_user.is_superuser = True
        admin_user.set_password(ADMIN_PASSWORD)
        admin_user.save()
        if admin_created:
            self.stdout.write(self.style.SUCCESS(f"Created admin superuser: {ADMIN_EMAIL}"))

        # --- Notes for the dev user -----------------------------------------
        for _ in range(options["notes"]):
            NoteFactory(owner=dev_user)

        # --- Additional fake users + notes ----------------------------------
        for _ in range(options["users"]):
            user = UserFactory()
            for _ in range(options["notes"]):
                NoteFactory(owner=user)

        # --- Summary ---------------------------------------------------------
        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded: {User.objects.count()} users, {Note.objects.count()} notes."
            )
        )
        self.stdout.write("")
        self.stdout.write("Login credentials:")
        self.stdout.write(
            f"  dev    → email '{DEV_EMAIL}'  or username '{DEV_USERNAME}'  / {DEV_PASSWORD}"
        )
        self.stdout.write(
            f"  admin  → email '{ADMIN_EMAIL}' or username '{ADMIN_USERNAME}' / "
            f"{ADMIN_PASSWORD}  (superuser, /admin/)"
        )
