"""Transparent encryption of sensitive `allauth.mfa.Authenticator.data` keys.

Hooks into Django's model signals:
- `post_init` → decrypt sensitive keys after a row loads from the DB
- `pre_save` → encrypt sensitive keys before a row writes to the DB

allauth's upstream code reads/writes `authenticator.data["secret"]`
directly. At runtime it sees plaintext (we decrypted on load) and on
save we re-encrypt before the column hits Postgres. allauth code never
needs to know we're doing this.

Sensitive keys (currently just `secret`) live in `_SENSITIVE_KEYS`. If
allauth ever stores additional secrets in `data` — e.g. WebAuthn
private credentials beyond the public key — add them here. Anything
NOT in this list stays plaintext for debuggability (creation
timestamps, last-used markers, etc.).

Wired by `apps.core.apps.CoreConfig.ready()`.
"""

from __future__ import annotations

from django.db.models.signals import post_init, pre_save
from django.dispatch import receiver

from .encryption import decrypt, encrypt, is_encrypted

# JSON keys inside `Authenticator.data` that must be encrypted at rest.
# `secret` is the only field allauth uses for TOTP. WebAuthn stores its
# public key + credential ID, neither of which is secret. Extend this set
# as new MFA types or new sensitive fields appear.
_SENSITIVE_KEYS: tuple[str, ...] = ("secret",)


def _is_authenticator(sender) -> bool:
    """Cheap sender check — post_init fires for EVERY model load."""
    return sender.__name__ == "Authenticator" and sender._meta.app_label == "mfa"


@receiver(post_init)
def _decrypt_after_load(sender, instance, **kwargs) -> None:
    if not _is_authenticator(sender):
        return
    data = instance.data
    if not isinstance(data, dict):
        return
    for key in _SENSITIVE_KEYS:
        value = data.get(key)
        if isinstance(value, str) and is_encrypted(value):
            data[key] = decrypt(value)


@receiver(pre_save)
def _encrypt_before_save(sender, instance, **kwargs) -> None:
    if not _is_authenticator(sender):
        return
    data = instance.data
    if not isinstance(data, dict):
        return
    # Copy so we don't mutate the caller's dict mid-flight.
    new_data = dict(data)
    changed = False
    for key in _SENSITIVE_KEYS:
        value = new_data.get(key)
        if isinstance(value, str) and not is_encrypted(value):
            new_data[key] = encrypt(value)
            changed = True
    if changed:
        instance.data = new_data
