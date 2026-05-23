from django.contrib import admin

from .models import Note


@admin.register(Note)
class NoteAdmin(admin.ModelAdmin):
    list_display = ("title", "owner", "created_at")
    list_filter = ("owner",)
    search_fields = ("title", "body")
    autocomplete_fields = ("owner",)
