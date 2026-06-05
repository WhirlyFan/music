"""Idempotently create/promote a superuser from BOOTSTRAP_ADMIN_* env vars.

For hosts without an interactive shell (e.g. Render's free tier): set the env
vars in the dashboard and the entrypoint runs this on boot. No-ops when the
vars are unset, so it's safe to call on every start.

  BOOTSTRAP_ADMIN_EMAIL     required — the login identifier (USERNAME_FIELD)
  BOOTSTRAP_ADMIN_PASSWORD  required — set only when the user is first created,
                            so a later in-app password change isn't clobbered
  BOOTSTRAP_ADMIN_USERNAME  optional — defaults to "admin"

Also creates a verified primary allauth EmailAddress so email login works with
no verification round-trip. (This is the operator's own admin mailbox on their
own deployment — the standard bootstrap; the "verify only with proof of
control" rule is about other users' addresses.)
"""

import os

from allauth.account.models import EmailAddress
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Create or promote a superuser from BOOTSTRAP_ADMIN_* env vars (idempotent)."

    def handle(self, *args, **options):
        email = os.environ.get("BOOTSTRAP_ADMIN_EMAIL", "").strip()
        password = os.environ.get("BOOTSTRAP_ADMIN_PASSWORD", "")
        username = os.environ.get("BOOTSTRAP_ADMIN_USERNAME", "admin").strip()

        if not email or not password:
            self.stdout.write("BOOTSTRAP_ADMIN_* not set — skipping admin bootstrap.")
            return

        user_model = get_user_model()
        user, created = user_model.objects.get_or_create(
            email=email, defaults={"username": username}
        )
        if created:
            user.set_password(password)  # only on first create — don't clobber later changes
        user.is_staff = True
        user.is_superuser = True
        user.save()

        EmailAddress.objects.update_or_create(
            user=user, email=email, defaults={"primary": True, "verified": True}
        )

        verb = "created" if created else "promoted existing"
        self.stdout.write(self.style.SUCCESS(f"{verb} superuser {email}"))
