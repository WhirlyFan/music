"""Invite-only signup: create, email, and redeem invitations.

Any logged-in member can invite an email; `apps.users.adapter.AccountAdapter` gates
signup to emails with a pending invitation. The invite email links to
`/signup?invite=<token>`; opening it `redeem`s the token, which proves the signer
received the email (controls the address) and stashes the email as *verified* for the
imminent signup — so allauth creates the account already-verified and sends no separate
confirmation mail (the Auth0/Clerk "invitation = email verification" pattern).
"""

from __future__ import annotations

from allauth.account.adapter import get_adapter
from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone
from django.utils.http import urlencode

from .models import INVITE_TTL, Invitation, User


class InviteError(Exception):
    """A problem creating/redeeming an invite (surfaced to the API)."""


def create_invitation(email: str, *, invited_by) -> Invitation:
    """Create (or refresh + resend) a pending invitation for `email` and email the
    link. Raises InviteError if the email already has an account."""
    email = email.strip().lower()
    if User.objects.filter(email__iexact=email).exists():
        raise InviteError("That email already has an account.")
    inv = Invitation.pending_for(email)
    if inv:  # re-inviting an outstanding email → refresh expiry + inviter, rotate, resend
        inv.expires_at = timezone.now() + INVITE_TTL
        inv.invited_by = invited_by
        raw = inv.issue_token()  # rotate → the previous link stops working
        inv.save(update_fields=["expires_at", "invited_by", "token_hash"])
    else:
        inv = Invitation(email=email, invited_by=invited_by)
        raw = inv.issue_token()
        inv.save()
    _send_invite_email(inv, invited_by, raw)
    return inv


def redeem_invitation(token: str, request) -> Invitation:
    """Validate an invite token from the signup link and return the invitation. For an
    *anonymous* redeemer (the normal pre-signup case) the email is stashed as *verified*
    so allauth's `unstash_verified_email` creates the new account's EmailAddress
    already-verified, skipping the confirmation mail. Redeeming requires the token from
    the emailed link, which proves the signer controls the address.

    Stash only when anonymous: it's consumed only by signup, which can't happen on an
    authenticated session. So an already-logged-in caller (e.g. the signup page peeking
    at who the invite is for before offering to sign out) gets the email back without
    polluting their session. Raises InviteError if the token is invalid/expired/used."""
    inv = Invitation.pending_by_token(token)
    if inv is None:
        raise InviteError("This invite link is invalid or has expired.")
    if not request.user.is_authenticated:
        get_adapter(request).stash_verified_email(request, inv.email)
    return inv


def _send_invite_email(inv: Invitation, invited_by, raw_token: str) -> None:
    link = f"{settings.FRONTEND_ORIGIN}/signup?{urlencode({'invite': raw_token})}"
    inviter = getattr(invited_by, "display_name", None) or "A member"
    send_mail(
        subject="You're invited",
        message=(
            f"{inviter} invited you to join.\n\n"
            f"Create your account: {link}\n\n"
            f"This invite expires in {INVITE_TTL.days} days. "
            "If you weren't expecting it, ignore this email."
        ),
        from_email=None,  # falls back to DEFAULT_FROM_EMAIL
        recipient_list=[inv.email],
        fail_silently=False,
    )
