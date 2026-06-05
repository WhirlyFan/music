"""Seed the `sources` registry with the platforms we support."""

from django.db import migrations

SOURCES = [
    {
        "code": "SPOTIFY",
        "name": "Spotify",
        "role": "catalog",
        "ingest_method": "api",
        "base_url": "https://open.spotify.com",
        "url_patterns": [r"open\.spotify\.com/(playlist|album|track)/"],
    },
    {
        "code": "APPLE_MUSIC",
        "name": "Apple Music",
        "role": "catalog",
        "ingest_method": "scrape",
        "base_url": "https://music.apple.com",
        "url_patterns": [r"music\.apple\.com/.+/(playlist|album)/"],
    },
    {
        "code": "YOUTUBE",
        "name": "YouTube",
        "role": "both",
        "ingest_method": "yt_dlp",
        "base_url": "https://www.youtube.com",
        "url_patterns": [r"(youtube\.com/watch\?v=|youtu\.be/|youtube\.com/playlist\?list=)"],
    },
    {
        "code": "YOUTUBE_MUSIC",
        "name": "YouTube Music",
        "role": "both",
        "ingest_method": "yt_dlp",
        "base_url": "https://music.youtube.com",
        "url_patterns": [r"music\.youtube\.com/"],
    },
    {
        "code": "UPLOAD",
        "name": "File upload",
        "role": "both",
        "ingest_method": "upload",
        "base_url": "",
        "url_patterns": [],
    },
    {
        "code": "DIRECT_URL",
        "name": "Direct URL",
        "role": "both",
        "ingest_method": "none",
        "base_url": "",
        "url_patterns": [],
    },
]


def seed(apps, schema_editor):
    Source = apps.get_model("catalog", "Source")
    for row in SOURCES:
        Source.objects.update_or_create(code=row["code"], defaults=row)


def unseed(apps, schema_editor):
    Source = apps.get_model("catalog", "Source")
    Source.objects.filter(code__in=[s["code"] for s in SOURCES]).delete()


class Migration(migrations.Migration):
    dependencies = [("catalog", "0001_initial")]
    operations = [migrations.RunPython(seed, unseed)]
