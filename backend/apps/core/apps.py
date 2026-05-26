from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.core"
    label = "core"

    def ready(self):
        # Wires up the post_migrate signal that enables RLS on every RLSModel.
        # Transparent encryption of sensitive allauth.mfa.Authenticator.data
        # keys (TOTP secrets etc.) via post_init / pre_save signals.
        from . import (
            mfa_encryption,  # noqa: F401
            signals,  # noqa: F401
        )
