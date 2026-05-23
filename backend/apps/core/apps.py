from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.core"
    label = "core"

    def ready(self):
        # Wires up the post_migrate signal that enables RLS on every RLSModel.
        from . import signals  # noqa: F401
