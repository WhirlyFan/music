"""Seed a durable bootstrap invite for the admin email.

Guarantees a way back into prod even after a full DB reset: migrations re-run on
a fresh database (the entrypoint runs `migrate` on every boot), so this re-creates
the invite automatically. Idempotent — skips if an invite for the email already
exists (e.g. the one already in prod, or a real one issued later).

The invite only permits SIGNUP for this email (via Google or email/password);
promoting that account to superuser is a separate, deliberate step. Far-future
expiry so it never lapses before it's used. `invite_only` being on is what makes
this the single sanctioned entry point.
"""

import hashlib
from datetime import timedelta

from django.db import migrations
from django.utils import timezone

BOOTSTRAP_EMAIL = "whirlyfan@gmail.com"
# Deterministic, unique token_hash so the reverse migration removes exactly this
# bootstrap row and never a real invite later issued for the same address. The raw
# token is irrelevant — the gate matches on the email, not the link.
_TOKEN_HASH = hashlib.sha256(b"bootstrap-invite:" + BOOTSTRAP_EMAIL.encode()).hexdigest()


def seed_invite(apps, schema_editor):
    Invitation = apps.get_model("users", "Invitation")
    if Invitation.objects.filter(email__iexact=BOOTSTRAP_EMAIL).exists():
        return
    Invitation.objects.create(
        email=BOOTSTRAP_EMAIL,
        token_hash=_TOKEN_HASH,
        expires_at=timezone.now() + timedelta(days=3650),  # ~10 years
    )


def remove_invite(apps, schema_editor):
    Invitation = apps.get_model("users", "Invitation")
    Invitation.objects.filter(email__iexact=BOOTSTRAP_EMAIL, token_hash=_TOKEN_HASH).delete()


class Migration(migrations.Migration):
    dependencies = [("users", "0004_invite_only_switch")]

    operations = [migrations.RunPython(seed_invite, remove_invite)]
