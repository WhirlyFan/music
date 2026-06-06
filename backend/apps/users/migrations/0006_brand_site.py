"""Brand the django.contrib.sites Site (id=SITE_ID).

allauth account emails read `current_site.name` / `.domain`; the default Site is
"example.com", which is what showed up in the verification email ("Hello from
example.com!"). Set a real name + domain so every transactional email is branded.
Links are unaffected — they come from HEADLESS_FRONTEND_URLS, not the Site domain.
"""

from django.conf import settings
from django.db import migrations

SITE_NAME = "WhirlyFan"
SITE_DOMAIN = "music.whirlyfan.com"


def brand_site(apps, schema_editor):
    Site = apps.get_model("sites", "Site")
    Site.objects.update_or_create(
        id=settings.SITE_ID,
        defaults={"name": SITE_NAME, "domain": SITE_DOMAIN},
    )


def unbrand_site(apps, schema_editor):
    Site = apps.get_model("sites", "Site")
    Site.objects.filter(id=settings.SITE_ID).update(name="example.com", domain="example.com")


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0005_seed_bootstrap_invite"),
        ("sites", "0002_alter_domain_unique"),
    ]

    operations = [migrations.RunPython(brand_site, unbrand_site)]
