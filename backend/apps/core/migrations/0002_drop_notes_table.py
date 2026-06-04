"""Drop the Notes table.

The `notes` app was the template's RLS example; it's been removed now that
RLS lives on `catalog.Playlist`. The app (and its migrations) are deleted, so
we drop the leftover table here — idempotent + reversible-as-noop. CASCADE
clears the RLS policy + any dependent objects with it.
"""

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("core", "0001_encrypt_mfa_secrets")]

    operations = [
        migrations.RunSQL(
            "DROP TABLE IF EXISTS notes_note CASCADE;",
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
