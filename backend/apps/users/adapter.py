"""Custom allauth account adapter — enforces invite-only signup.

`clean_email` is allauth's hook for "(dynamically) restrict what email addresses can
be chosen". While the `invite_only` waffle switch is on, a *signup* is allowed only for
an email that has an invitation (see `Invitation.permits_signup` — pending or already
accepted, the latter because allauth re-validates the email *after* save_user marks the
invite accepted); flip the switch off (in /admin/) and signups are open. Either way, an
authenticated user changing their own email is unaffected. On signup we mark the matching
invite accepted. `createsuperuser` bypasses this entirely (it doesn't go through the
signup flow), which bootstraps the first/admin user.
"""

from __future__ import annotations

import logging
import re
import secrets

from allauth.account.adapter import DefaultAccountAdapter
from allauth.account.utils import user_username
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.utils import timezone
from waffle import switch_is_active

from .models import Invitation

logger = logging.getLogger("apps.users.social")


def _unique_handle(first_name: str) -> str:
    """A changeable default username for social signups: the lowercase first name if
    usable, else `user_<rand>`. On collision, append a short random suffix
    (`alex_3f9a`). Not derived from the email (which would leak the local-part)."""
    base = re.sub(r"[^a-z0-9]", "", (first_name or "").strip().lower())[:20]
    user_model = get_user_model()
    if base and not user_model.objects.filter(username__iexact=base).exists():
        return base
    prefix = base or "user"
    for _ in range(6):
        candidate = f"{prefix}_{secrets.token_hex(2)}"
        if not user_model.objects.filter(username__iexact=candidate).exists():
            return candidate
    return f"user_{secrets.token_hex(6)}"


def _accept_invite(email: str) -> None:
    """Consume the matching pending invite so the link can't be reused."""
    Invitation.objects.filter(email__iexact=email, accepted_at__isnull=True).update(
        accepted_at=timezone.now()
    )


class AccountAdapter(DefaultAccountAdapter):
    def clean_email(self, email: str) -> str:
        email = super().clean_email(email)
        request = getattr(self, "request", None)
        # Only gate *signups* (anonymous). An authenticated user changing their email
        # (allauth's add-email flow also calls clean_email) must not need an invite.
        is_signup = not (
            request and getattr(request, "user", None) and request.user.is_authenticated
        )
        if is_signup and switch_is_active("invite_only") and not Invitation.permits_signup(email):
            raise ValidationError(
                "This platform is invite-only — ask a member to send you an invite."
            )
        return email

    def save_user(self, request, user, form, commit=True):
        user = super().save_user(request, user, form, commit=commit)
        _accept_invite(user.email)
        return user


class SocialAccountAdapter(DefaultSocialAccountAdapter):
    """Apply the invite-only gate to social (Google) signups.

    `is_open_for_signup` is only consulted when a social login would CREATE a new
    account — existing users (matched by their verified Google email via
    SOCIALACCOUNT_EMAIL_AUTHENTICATION, or by an existing SocialAccount) log in
    untouched. So while `invite_only` is on, a brand-new Google user can sign up
    only if their email holds an invitation — exactly like email/password signup.
    On signup we consume the invite.
    """

    def is_open_for_signup(self, request, sociallogin) -> bool:
        if not switch_is_active("invite_only"):
            return True
        email = (sociallogin.user.email or "").strip()
        return bool(email) and Invitation.permits_signup(email)

    def populate_user(self, request, sociallogin, data):
        user = super().populate_user(request, sociallogin, data)
        # Google gives us no username; allauth would otherwise derive one from the
        # email. Use the lowercase first name (else user_<rand>), changeable later.
        first = user.first_name or data.get("first_name") or ""
        user_username(user, _unique_handle(first))
        return user

    def save_user(self, request, sociallogin, form=None):
        user = super().save_user(request, sociallogin, form=form)
        _accept_invite(user.email)
        return user

    def on_authentication_error(
        self, request, provider, error=None, exception=None, extra_context=None
    ):
        # allauth otherwise swallows social-login failures into an opaque
        # `?error=unknown` redirect with no server log. Log the real cause so the
        # provider/state/token/adapter failure is diagnosable.
        logger.error(
            "social auth error: provider=%s error=%s exception=%r extra=%s",
            getattr(provider, "id", provider),
            error,
            exception,
            extra_context,
        )
        return super().on_authentication_error(
            request, provider, error=error, exception=exception, extra_context=extra_context
        )
