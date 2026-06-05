from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import Invitation, User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ("email",)
    list_display = ("email", "username", "first_name", "last_name", "is_staff", "is_active")
    search_fields = ("email", "username", "first_name", "last_name")

    fieldsets = (
        (None, {"fields": ("email", "username", "password")}),
        ("Personal info", {"fields": ("first_name", "last_name")}),
        (
            "Permissions",
            {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")},
        ),
        ("Important dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": ("email", "username", "password1", "password2"),
            },
        ),
    )


@admin.register(Invitation)
class InvitationAdmin(admin.ModelAdmin):
    list_display = ("email", "invited_by", "is_pending", "created_at", "accepted_at", "expires_at")
    search_fields = ("email",)
    # token_hash is unguessable and useless without the raw token, but it's not something
    # to edit; show it read-only. The raw token only ever exists in the emailed link.
    readonly_fields = ("token_hash", "created_at")
    # Delete an invite to revoke it: the adapter gate then blocks that email's signup.
