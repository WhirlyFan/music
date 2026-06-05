"""Ingest an Apple Music playlist/album/song URL into the catalog (dev/testing).

Usage (admin DB role wires up via the Makefile pattern):
    DATABASE_URL=$ADMIN_URL uv run python manage.py ingest_apple "<apple music url>"
"""

from django.core.management.base import BaseCommand

from apps.catalog.services import ingest_apple


class Command(BaseCommand):
    help = "Ingest an Apple Music playlist/album/song URL into the catalog."

    def add_arguments(self, parser):
        parser.add_argument("url", help="Apple Music playlist/album/song URL")

    def handle(self, *args, **options):
        result = ingest_apple(options["url"])
        self.stdout.write(
            self.style.SUCCESS(
                f"Ingested '{result['title']}' — {len(result['tracks'])} tracks "
                f"→ import {result['import'].id}"
            )
        )
