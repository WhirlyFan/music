from django.urls import path

from . import views

app_name = "users"

urlpatterns = [
    path(
        "passkey-credential-ids/",
        views.passkey_credential_ids,
        name="passkey-credential-ids",
    ),
]
