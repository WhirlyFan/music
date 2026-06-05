"""Resolve YouTube playback sources for catalog tracks lacking an active one.

Usage:
    DATABASE_URL=$ADMIN_URL uv run python manage.py match_youtube --limit 5
"""

from django.core.management.base import BaseCommand

from apps.catalog.match import match_track_to_youtube
from apps.catalog.models import PlaybackSource, Track


class Command(BaseCommand):
    help = "Resolve YouTube playback sources for tracks without an active one."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=10)

    def handle(self, *args, **options):
        tracks = Track.objects.exclude(playback_sources__status=PlaybackSource.Status.ACTIVE)[
            : options["limit"]
        ]

        matched = 0
        for track in tracks:
            ps = match_track_to_youtube(track)
            if ps:
                matched += 1
                self.stdout.write(
                    f"  {track.title} — {track.primary_artist} → "
                    f"{ps.locator} (conf {ps.confidence}, Δ{ps.duration_delta_ms}ms)"
                )
        self.stdout.write(self.style.SUCCESS(f"Matched {matched} track(s)."))
