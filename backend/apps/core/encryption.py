"""Symmetric encryption for sensitive auth-layer fields.

Wraps `cryptography.fernet.Fernet` (AES-128-CBC + HMAC-SHA256). Keyed by
`settings.MFA_FIELD_ENCRYPTION_KEY` — a base64url-encoded 32-byte key,
managed in env. Encrypted values are stored with an `enc:` prefix so we
can detect already-encrypted strings and avoid double-encrypting on
idempotent saves.

Key rotation: change MFA_FIELD_ENCRYPTION_KEY in env → all existing
ciphertext fails to decrypt → users re-enroll. There's no built-in
rotation flow because the data being protected (TOTP secrets, etc.) is
cheap to re-issue. If that ever becomes painful, swap `Fernet` for
`MultiFernet` and rotate via a key list.

Used by `apps.core.mfa_encryption` signals to transparently encrypt
`Authenticator.data["secret"]` on save and decrypt on load. Allauth's
upstream code is unmodified — sees the cleartext at runtime, sees the
ciphertext at the DB layer.
"""

from __future__ import annotations

from cryptography.fernet import Fernet
from django.conf import settings

# Prefix added to encrypted values. Lets us round-trip without double-
# encryption: encrypt() is a no-op on already-encrypted input.
_ENC_PREFIX = "enc:"


def _cipher() -> Fernet:
    key = getattr(settings, "MFA_FIELD_ENCRYPTION_KEY", "")
    if not key:
        raise RuntimeError(
            "MFA_FIELD_ENCRYPTION_KEY is not set. Generate one with "
            "`python -c 'from cryptography.fernet import Fernet; "
            "print(Fernet.generate_key().decode())'` and add it to your env."
        )
    if isinstance(key, str):
        key = key.encode()
    return Fernet(key)


def encrypt(value: str) -> str:
    """Encrypt a plaintext string. Idempotent — already-encrypted input
    is returned unchanged (no double-wrapping)."""
    if not value or not isinstance(value, str):
        return value
    if value.startswith(_ENC_PREFIX):
        return value
    return _ENC_PREFIX + _cipher().encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    """Decrypt a previously-encrypted string. Plain values pass through
    unchanged — supports gradual migration of legacy plaintext rows."""
    if not value or not isinstance(value, str):
        return value
    if not value.startswith(_ENC_PREFIX):
        return value
    return _cipher().decrypt(value[len(_ENC_PREFIX) :].encode()).decode()


def is_encrypted(value: str) -> bool:
    return isinstance(value, str) and value.startswith(_ENC_PREFIX)
