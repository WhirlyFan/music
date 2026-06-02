from django.contrib import admin

from .models import (
    PlaybackSource,
    Playlist,
    PlaylistImport,
    PlaylistTrack,
    Source,
    SourceLink,
    Track,
    Upload,
)


@admin.register(Source)
class SourceAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "role", "ingest_method", "is_active")
    list_filter = ("role", "ingest_method", "is_active")


@admin.register(Track)
class TrackAdmin(admin.ModelAdmin):
    list_display = ("title", "primary_artist", "isrc", "duration_ms")
    search_fields = ("title", "primary_artist", "isrc", "match_key")


@admin.register(SourceLink)
class SourceLinkAdmin(admin.ModelAdmin):
    list_display = ("source", "kind", "external_id", "is_active", "created_at")
    list_filter = ("source", "kind", "is_active")
    search_fields = ("external_id", "url")


@admin.register(PlaybackSource)
class PlaybackSourceAdmin(admin.ModelAdmin):
    list_display = ("track", "source", "locator_kind", "locator", "origin", "status")
    list_filter = ("status", "origin", "source", "locator_kind")
    search_fields = ("locator", "title")


@admin.register(Upload)
class UploadAdmin(admin.ModelAdmin):
    list_display = ("original_filename", "uploaded_by", "status", "size_bytes", "created_at")
    list_filter = ("status",)


class PlaylistTrackInline(admin.TabularInline):
    model = PlaylistTrack
    extra = 0


@admin.register(Playlist)
class PlaylistAdmin(admin.ModelAdmin):
    list_display = ("title", "created_by", "is_public", "created_at")
    list_filter = ("is_public",)
    inlines = [PlaylistTrackInline]


@admin.register(PlaylistImport)
class PlaylistImportAdmin(admin.ModelAdmin):
    list_display = ("playlist", "source", "track_count", "status", "created_at")
    list_filter = ("source", "status")
