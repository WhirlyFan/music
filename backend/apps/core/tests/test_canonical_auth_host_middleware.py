"""Tests for CanonicalAuthHostMiddleware.

No DB needed — the middleware only rewrites request.META on auth paths. We
inspect the host header the downstream handler would see, rather than calling
get_host() (which would couple the test to ALLOWED_HOSTS).
"""

from __future__ import annotations

from django.test import RequestFactory, override_settings

from apps.core.middleware import CanonicalAuthHostMiddleware

_ONRENDER = "music-backend-ll7r.onrender.com"
_PUBLIC = "music.whirlyfan.com"


def _capture(request) -> dict:
    seen: dict = {}

    def get_response(req):
        seen["host"] = req.META.get("HTTP_HOST")
        seen["xfh"] = req.META.get("HTTP_X_FORWARDED_HOST")
        return "ok"

    CanonicalAuthHostMiddleware(get_response)(request)
    return seen


@override_settings(OAUTH_CALLBACK_HOST=_PUBLIC)
def test_pins_host_on_oauth_callback_path():
    req = RequestFactory().get(
        "/accounts/google/login/callback/",
        HTTP_HOST=_ONRENDER,
        HTTP_X_FORWARDED_HOST=_ONRENDER,
    )
    seen = _capture(req)
    assert seen["host"] == _PUBLIC
    assert seen["xfh"] is None  # dropped so it can't win over the pinned host


@override_settings(OAUTH_CALLBACK_HOST=_PUBLIC)
def test_pins_host_on_allauth_redirect_path():
    req = RequestFactory().post("/_allauth/browser/v1/auth/provider/redirect", HTTP_HOST=_ONRENDER)
    assert _capture(req)["host"] == _PUBLIC


@override_settings(OAUTH_CALLBACK_HOST=_PUBLIC)
def test_non_auth_path_untouched():
    req = RequestFactory().get("/api/songs/", HTTP_HOST=_ONRENDER)
    assert _capture(req)["host"] == _ONRENDER


@override_settings(OAUTH_CALLBACK_HOST="")
def test_noop_when_unset_keeps_dev_localhost_flow():
    req = RequestFactory().get("/accounts/google/login/callback/", HTTP_HOST="localhost:8000")
    assert _capture(req)["host"] == "localhost:8000"
