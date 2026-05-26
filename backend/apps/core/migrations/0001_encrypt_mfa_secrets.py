"""Encrypt any pre-existing plaintext TOTP secrets in `mfa_authenticator.data`.

Runs once. After this migration:
- Existing rows with `data.secret == "JBSWY..."` (plaintext) → re-stored as
  `data.secret == "enc:gAAAAAB..."` (Fernet ciphertext)
- Idempotent: rows already starting with `enc:` are skipped
- The pre_save signal in `apps.core.mfa_encryption` would handle this on
  any future save, but we run it explicitly here so existing data is
  protected immediately, not lazily on next-touch.

Signals don't reliably fire on historical-model saves during migrations, so
this calls the encrypt helper directly.
"""

from __future__ import annotations

from django.db import migrations


def encrypt_existing(apps, schema_editor):
    from apps.core.encryption import encrypt, is_encrypted

    Authenticator = apps.get_model("mfa", "Authenticator")
    for auth in Authenticator.objects.all():
        if not isinstance(auth.data, dict):
            continue
        secret = auth.data.get("secret")
        if not isinstance(secret, str) or is_encrypted(secret):
            continue
        auth.data["secret"] = encrypt(secret)
        auth.save(update_fields=["data"])


def reverse_noop(apps, schema_editor):
    # Reversing this migration would mean DECRYPTING all secrets back to
    # plaintext — a reverse-direction security regression. Refuse to do it.
    raise NotImplementedError(
        "Cannot reverse mfa secret encryption: rolling back would put "
        "plaintext TOTP secrets back into the DB. Restore from a backup "
        "or re-issue MFA enrollments instead."
    )


class Migration(migrations.Migration):
    dependencies = [
        ("mfa", "0003_authenticator_type_uniq"),
    ]

    operations = [
        migrations.RunPython(encrypt_existing, reverse_noop),
    ]
