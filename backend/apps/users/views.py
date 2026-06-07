"""User-scoped API endpoints not covered by allauth's headless surface.

`/api/v1/users/passkey-credential-ids/` exposes the WebAuthn credential IDs
the user has enrolled. allauth's headless `/_allauth/.../account/authenticators`
deliberately omits these (security-by-default — don't leak credential bytes
in list responses). We need them for the WebAuthn **Signal API**: when the
user removes a passkey we tell the platform authenticator (Touch ID Keychain,
Windows Hello, etc.) to clean up its local copy via
`PublicKeyCredential.signalUnknownCredential({ credentialId, rpId })`.
Without that signal the device keeps a stale entry the user can't easily
find.

Returns: `{ "<authenticator_pk>": "<base64url credential id>" }`.

Safety:
- IsAuthenticated + the verified-email gate via RequireVerifiedEmailMiddleware
- Returns only the calling user's own credentials (no cross-user lookup)
- The IDs themselves are not secret — they're sent to the relying party on
  every authentication and are visible to anyone who has the user's
  authenticator. The privacy concern they address (don't enumerate via
  unauthenticated listings) doesn't apply here.
"""

from __future__ import annotations

import requests
from allauth.account.adapter import get_adapter as get_account_adapter
from allauth.account.forms import UserTokenForm
from allauth.account.internal.flows import password_reset as password_reset_flows
from allauth.account.models import EmailConfirmationHMAC
from allauth.core.exceptions import SignupClosedException
from allauth.headless.socialaccount.internal import complete_token_login
from allauth.mfa.models import Authenticator
from allauth.socialaccount.adapter import get_adapter as get_socialaccount_adapter
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db.models import Q
from django.shortcuts import get_object_or_404, render
from django.utils.module_loading import import_string
from rest_framework import permissions, serializers, status
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
    throttle_classes,
)
from rest_framework.pagination import PageNumberPagination
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

from apps.notifications.events import nudge

from .invites import InviteError, create_invitation, redeem_invitation
from .models import INVITE_TTL, Invitation


class InviteRateThrottle(UserRateThrottle):
    """Caps how many invites one member can send (keyed on user id). An invite triggers
    an outbound email, so an uncapped endpoint is an email-abuse / quota-burn vector.
    Rate set by DEFAULT_THROTTLE_RATES['invites']."""

    scope = "invites"


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def passkey_credential_ids(request: Request) -> Response:
    rows = Authenticator.objects.filter(
        user=request.user,
        type=Authenticator.Type.WEBAUTHN,
    )
    return Response({row.pk: (row.data or {}).get("credential", {}).get("id") for row in rows})


class _InviteSerializer(serializers.Serializer):
    email = serializers.EmailField()


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
@throttle_classes([InviteRateThrottle])
def invite(request: Request) -> Response:
    """Any logged-in member invites an email to the (invite-only) platform: creates a
    pending invitation and emails the signup link. 400 if the email is already a member."""
    s = _InviteSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    email = s.validated_data["email"]
    try:
        create_invitation(email, invited_by=request.user)
    except InviteError as e:
        return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    return Response({"email": email.strip().lower()}, status=status.HTTP_201_CREATED)


class _RedeemSerializer(serializers.Serializer):
    token = serializers.CharField()


@api_view(["POST"])
@permission_classes([permissions.AllowAny])
def redeem_invite(request: Request) -> Response:
    """Anonymous (pre-signup): the invite link redeems its token here, which stashes
    the email as verified for the imminent signup and returns it for the form to
    pre-fill. 404 if the token is invalid/expired/used (the SPA then falls back to a
    normal signup + email verification)."""
    s = _RedeemSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    try:
        inv = redeem_invitation(s.validated_data["token"], request)
    except InviteError as e:
        return Response({"detail": str(e)}, status=status.HTTP_404_NOT_FOUND)
    return Response({"email": inv.email})


class _DesktopGoogleSerializer(serializers.Serializer):
    code = serializers.CharField()
    code_verifier = serializers.CharField()
    redirect_uri = serializers.CharField()


def _session_token(request: Request) -> str:
    """Mint the allauth headless session token for the (just logged-in) request,
    honoring the configured token strategy (default: the Django session key)."""
    strategy_path = getattr(
        settings,
        "HEADLESS_TOKEN_STRATEGY",
        "allauth.headless.tokens.strategies.sessions.SessionTokenStrategy",
    )
    return import_string(strategy_path)().create_session_token(request)


@api_view(["POST"])
@authentication_classes([])  # pre-auth: this endpoint establishes the session
@permission_classes([permissions.AllowAny])
def desktop_google_login(request: Request) -> Response:
    """Native desktop Google sign-in (RFC 8252).

    The Tauri app runs Google's Authorization Code + PKCE flow in the system
    browser (loopback redirect) and POSTs the resulting `code` here. We exchange
    it for an id_token SERVER-SIDE — the OAuth client secret stays in Doppler and
    is never shipped in the desktop binary — then verify + log in via allauth and
    return the headless `session_token`. The app sends that token back as
    `X-Session-Token` (DRF) and on the WS upgrade (Channels), so the desktop
    client needs no cookies. Reuses the existing Google web client (same client_id,
    so the id_token audience matches the configured SocialApp).
    """
    s = _DesktopGoogleSerializer(data=request.data)
    s.is_valid(raise_exception=True)

    app = settings.SOCIALACCOUNT_PROVIDERS["google"]["APPS"][0]
    try:
        token_resp = requests.post(
            "https://oauth2.googleapis.com/token",
            data={
                "grant_type": "authorization_code",
                "code": s.validated_data["code"],
                "code_verifier": s.validated_data["code_verifier"],
                "redirect_uri": s.validated_data["redirect_uri"],
                "client_id": app["client_id"],
                "client_secret": app["secret"],
            },
            timeout=10,
        )
    except requests.RequestException:
        return Response({"detail": "Could not reach Google."}, status=status.HTTP_502_BAD_GATEWAY)
    if token_resp.status_code != 200:
        return Response(
            {"detail": "Authorization code exchange failed."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    id_token = token_resp.json().get("id_token")
    if not id_token:
        return Response(
            {"detail": "No id_token returned by Google."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    provider = get_socialaccount_adapter().get_provider(
        request, "google", client_id=app["client_id"]
    )
    try:
        sociallogin = provider.verify_token(request, {"id_token": id_token})
        complete_token_login(request, sociallogin)
    except SignupClosedException:
        return Response(
            {
                "detail": "That Google account isn’t invited yet — ask a member to invite your email."
            },
            status=status.HTTP_403_FORBIDDEN,
        )
    except ValidationError:
        return Response(
            {"detail": "Google sign-in didn’t complete."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    return Response({"session_token": _session_token(request)})


def verify_email_page(request, key):
    """Backend-rendered email-verification landing page.

    The verification email links here (HEADLESS_FRONTEND_URLS points at the backend),
    so the desktop app doesn't depend on the web frontend for this flow. We confirm
    the key via allauth (marks EmailAddress.verified=True), then push a live nudge over
    the recipient's notifications socket — the desktop app is already authenticated
    (just gated on verification), so it refetches and unblocks itself automatically,
    the same way Google login reflects back. The user just sees a "you're verified,
    return to the app" page in their browser.
    """
    confirmation = EmailConfirmationHMAC.from_key(key)
    email_address = confirmation.confirm(request) if confirmation else None
    if email_address is None:
        return render(request, "account/verify_email_result.html", {"ok": False}, status=400)
    nudge(email_address.user_id, "email_verified")
    return render(request, "account/verify_email_result.html", {"ok": True})


def reset_password_page(request, key):
    """Backend-rendered password-reset page.

    The reset email links here (HEADLESS_FRONTEND_URLS), not the dead web frontend.
    GET shows a "set a new password" form; POST validates the key and sets the
    password. We reuse allauth's own `UserTokenForm` to decode/verify the key (the
    exact validator its headless reset endpoint uses) and its `clean_password` (so
    the breach-list screening + Django validators still apply), then `reset_password`
    + `finalize_password_reset` (which sends the "password changed" notice). The user
    then returns to the desktop app and logs in — we don't log them into a browser
    session here.

    The opaque key is `<uidb36>-<token>`; an invalid/expired/used key renders the
    error state (410). On success the token stops matching (the password hash it's
    derived from changed), so the link can't be replayed.
    """
    uidb36, _, subkey = key.partition("-")
    token_form = UserTokenForm(data={"uidb36": uidb36, "key": subkey})
    user = token_form.reset_user if token_form.is_valid() else None
    if user is None:
        return render(request, "account/password_reset_page.html", {"invalid": True}, status=410)

    if request.method == "POST":
        password = request.POST.get("password", "")
        confirm = request.POST.get("confirm", "")
        errors: list[str] = []
        if not password:
            errors.append("Enter a new password.")
        elif password != confirm:
            errors.append("The two passwords don’t match.")
        else:
            try:
                get_account_adapter(request).clean_password(password, user=user)
            except ValidationError as e:
                errors.extend(e.messages)
        if errors:
            return render(request, "account/password_reset_page.html", {"errors": errors})
        password_reset_flows.reset_password(user, password)
        password_reset_flows.finalize_password_reset(request, user)
        return render(request, "account/password_reset_page.html", {"done": True})

    return render(request, "account/password_reset_page.html", {})


def invite_landing(request, token):
    """Backend-rendered invite landing page.

    The invite email links here. The invitee has no app yet, so this page validates
    the invite, says which email to sign in with, and links to download the desktop
    app — signup happens in-app (invite-gated by email). We don't redeem/stash here:
    the redeem only helps a signup in the *same* browser session, but the invitee
    signs up in the desktop app (a different session), so it'd be a no-op. Google
    sign-in is auto-verified; an in-app email/password signup gets its own (backend-
    rendered) verification mail.
    """
    inv = Invitation.pending_by_token(token)
    if inv is None:
        return render(request, "account/invite_landing.html", {"invalid": True}, status=410)
    inviter = getattr(inv.invited_by, "display_name", None) or "A member"
    return render(
        request,
        "account/invite_landing.html",
        {
            "inviter": inviter,
            "email": inv.email,
            "download_url": settings.DESKTOP_DOWNLOAD_URL,
            "expires_days": INVITE_TTL.days,
        },
    )


class _UsernameSerializer(serializers.Serializer):
    # Mirror the frontend rule: 3–30 chars, letters/digits/_/- .
    username = serializers.RegexField(r"^[a-zA-Z0-9_-]{3,30}$")


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def change_username(request: Request) -> Response:
    """Change the signed-in user's handle. Usernames are case-insensitive
    (ACCOUNT_PRESERVE_USERNAME_CASING is off), so we store it lowercased and reject a
    case-insensitive collision with anyone else."""
    s = _UsernameSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    username = s.validated_data["username"].lower()
    user_model = get_user_model()
    if user_model.objects.exclude(pk=request.user.pk).filter(username__iexact=username).exists():
        return Response({"detail": "That username is taken."}, status=status.HTTP_409_CONFLICT)
    request.user.username = username
    request.user.save(update_fields=["username"])
    return Response({"username": username})


class _UserSearchSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    username = serializers.CharField(read_only=True)
    display_name = serializers.CharField(read_only=True)


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def search_users(request: Request) -> Response:
    """Find people by username (or name) to befriend — `?q=`. Excludes the caller.
    Paginated (25/page) so the client shows the first page and only fetches more on
    scroll — low load by default. The friend-request flow references the picked user
    by id, so this turns a typed handle into an id. Existing friends aren't filtered
    here (keeps users decoupled from the friends app); send_request is idempotent."""
    q = request.query_params.get("q", "").strip()
    if not q:
        return Response({"count": 0, "next": None, "previous": None, "results": []})
    user_model = get_user_model()
    matches = (
        user_model.objects.filter(
            Q(username__icontains=q) | Q(first_name__icontains=q) | Q(last_name__icontains=q),
            is_active=True,
        )
        .exclude(pk=request.user.pk)
        .order_by("username")  # stable ordering across pages
    )
    paginator = PageNumberPagination()
    page = paginator.paginate_queryset(matches, request)
    return paginator.get_paginated_response(_UserSearchSerializer(page, many=True).data)


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def public_profile(request: Request, username: str) -> Response:
    """A user's public profile + the caller's relationship to them, so the profile
    page can show the right control (Add / Requested / Accept / Friends / it's-you).
    The friendship status is computed here (imported lazily to keep users decoupled
    from the friends app at module load)."""
    from apps.friends.models import Friendship  # lazy: avoid a load-time app coupling

    user_model = get_user_model()
    target = get_object_or_404(user_model, username__iexact=username, is_active=True)

    relationship = {"status": "none"}
    if target.id == request.user.id:
        relationship = {"status": "self"}
    else:
        fr = Friendship.objects.filter(
            Q(requester=request.user, addressee=target)
            | Q(requester=target, addressee=request.user)
        ).first()
        if fr is not None:
            if fr.status == Friendship.Status.ACCEPTED:
                relationship = {"status": "friends", "id": str(fr.id)}
            elif fr.requester_id == request.user.id:
                relationship = {"status": "outgoing", "id": str(fr.id)}
            else:
                relationship = {"status": "incoming", "id": str(fr.id)}

    return Response(
        {
            "id": str(target.id),
            "username": target.username,
            "display_name": target.display_name,
            "relationship": relationship,
        }
    )
