"""Create the `invite_only` waffle switch, active by default.

The AccountAdapter consults this switch: while it's on, signups require a pending
invitation; flip it off in /admin/waffle/switch/ to open signups (invitations keep
working as a pre-verified onboarding shortcut). Created here so every environment has
it after migrate — toggle at runtime, no redeploy."""

from django.db import migrations

SWITCH = "invite_only"
NOTE = "When on, account signups require a pending invitation (invite-only platform)."


def create_switch(apps_registry, schema_editor):
    Switch = apps_registry.get_model("waffle", "Switch")
    Switch.objects.update_or_create(name=SWITCH, defaults={"active": True, "note": NOTE})


def remove_switch(apps_registry, schema_editor):
    Switch = apps_registry.get_model("waffle", "Switch")
    Switch.objects.filter(name=SWITCH).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0003_invitation_token_hash"),
        ("waffle", "0001_initial"),
    ]

    operations = [migrations.RunPython(create_switch, remove_switch)]
