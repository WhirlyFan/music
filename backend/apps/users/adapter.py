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

from allauth.account.adapter import DefaultAccountAdapter
from django.core.exceptions import ValidationError
from django.utils import timezone
from waffle import switch_is_active

from .models import Invitation


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
        # Consume the invite so the link can't be reused.
        Invitation.objects.filter(email__iexact=user.email, accepted_at__isnull=True).update(
            accepted_at=timezone.now()
        )
        return user
