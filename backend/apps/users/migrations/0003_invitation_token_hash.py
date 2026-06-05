import hashlib

from django.db import migrations, models

import apps.users.models


def hash_existing_tokens(apps_registry, schema_editor):
    """Preserve any outstanding invites: hash their raw `token` into `token_hash` so the
    already-emailed links still redeem after the raw column is dropped."""
    Invitation = apps_registry.get_model("users", "Invitation")
    for inv in Invitation.objects.all():
        inv.token_hash = hashlib.sha256(inv.token.encode()).hexdigest()
        inv.save(update_fields=["token_hash"])


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0002_invitation"),
    ]

    operations = [
        # 1. Add the hash column nullable + non-unique so existing rows can be populated.
        migrations.AddField(
            model_name="invitation",
            name="token_hash",
            field=models.CharField(editable=False, max_length=64, null=True),
        ),
        # 2. Backfill from the raw token (no-op reverse — we can't recover raw from hash).
        migrations.RunPython(hash_existing_tokens, migrations.RunPython.noop),
        # 3. Drop the raw token; the DB no longer stores anything redeemable.
        migrations.RemoveField(
            model_name="invitation",
            name="token",
        ),
        # 4. Lock down the final shape: unique, defaulted, non-null.
        migrations.AlterField(
            model_name="invitation",
            name="token_hash",
            field=models.CharField(
                default=apps.users.models._invite_token_hash,
                editable=False,
                max_length=64,
                unique=True,
            ),
        ),
    ]
