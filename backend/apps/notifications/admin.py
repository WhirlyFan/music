from django.contrib import admin

from .models import Notification


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ["kind", "recipient", "actor", "read_at", "created_at"]
    list_filter = ["kind"]
    search_fields = ["recipient__username", "actor__username"]
    readonly_fields = ["created_at", "updated_at"]
