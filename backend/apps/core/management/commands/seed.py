"""Seed the database with reproducible fake data for local development.

Connects via DATABASE_URL — should be the admin (BYPASSRLS) role so
inserts work across owners. The Makefile wires this up automatically.

Idempotent on default options (always (re)creates dev@example.com).
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

DEV_EMAIL = "dev@example.com"
DEV_PASSWORD = "password"


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
            User.objects.filter(is_superuser=False).delete()
            self.stdout.write(self.style.WARNING("Flushed notes + non-superuser users."))

        # Always ensure the known dev login exists.
        dev_user, created = User.objects.get_or_create(
            email=DEV_EMAIL,
            defaults={"first_name": "Dev", "last_name": "User"},
        )
        if created:
            dev_user.set_password(DEV_PASSWORD)
            dev_user.save()
            self.stdout.write(
                f"Created dev user: {DEV_EMAIL} / {DEV_PASSWORD}"
            )

        # Make sure the dev user has some notes too.
        for _ in range(options["notes"]):
            NoteFactory(owner=dev_user)

        # Create additional fake users + notes.
        for _ in range(options["users"]):
            user = UserFactory()
            for _ in range(options["notes"]):
                NoteFactory(owner=user)

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded: {User.objects.count()} users, {Note.objects.count()} notes."
            )
        )
        self.stdout.write(f"Dev login → {DEV_EMAIL} / {DEV_PASSWORD}")
