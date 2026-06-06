from django.urls import path

from . import views

app_name = "users"

urlpatterns = [
    path(
        "passkey-credential-ids/",
        views.passkey_credential_ids,
        name="passkey-credential-ids",
    ),
    path("invite/", views.invite, name="invite"),
    path("invite/redeem/", views.redeem_invite, name="redeem-invite"),
    path("username/", views.change_username, name="change-username"),
    path("search/", views.search_users, name="search-users"),
    path("profile/<str:username>/", views.public_profile, name="public-profile"),
]
