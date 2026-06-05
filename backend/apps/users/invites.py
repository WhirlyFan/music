"""Invite-only signup: create + email invitations.

Any logged-in member can invite an email; `apps.users.adapter.AccountAdapter` then
gates signup to emails with a pending invitation. The invite email links to the
signup page with the email pre-filled (`/signup?email=…`); the gate itself is
email-based, so the link is a convenience, not the credential.
"""

from __future__ import annotations

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone
from django.utils.http import urlencode

from .models import INVITE_TTL, Invitation, User


class InviteError(Exception):
    """A problem creating an invite (surfaced to the API as a 400)."""


def create_invitation(email: str, *, invited_by) -> Invitation:
    """Create (or refresh + resend) a pending invitation for `email` and email the
    link. Raises InviteError if the email already has an account."""
    email = email.strip().lower()
    if User.objects.filter(email__iexact=email).exists():
        raise InviteError("That email already has an account.")
    inv = Invitation.pending_for(email)
    if inv:  # re-inviting an outstanding email → refresh expiry + inviter, resend
        inv.expires_at = timezone.now() + INVITE_TTL
        inv.invited_by = invited_by
        inv.save(update_fields=["expires_at", "invited_by"])
    else:
        inv = Invitation.objects.create(email=email, invited_by=invited_by)
    _send_invite_email(inv, invited_by)
    return inv


def _send_invite_email(inv: Invitation, invited_by) -> None:
    link = f"{settings.FRONTEND_ORIGIN}/signup?{urlencode({'email': inv.email})}"
    inviter = getattr(invited_by, "display_name", None) or "A member"
    send_mail(
        subject="You're invited",
        message=(
            f"{inviter} invited you to join.\n\n"
            f"Create your account: {link}\n\n"
            "This invite expires in 14 days. If you weren't expecting it, ignore this email."
        ),
        from_email=None,  # falls back to DEFAULT_FROM_EMAIL
        recipient_list=[inv.email],
        fail_silently=False,
    )
