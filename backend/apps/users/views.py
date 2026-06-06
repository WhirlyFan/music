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

from allauth.mfa.models import Authenticator
from django.contrib.auth import get_user_model
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import permissions, serializers, status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

from .invites import InviteError, create_invitation, redeem_invitation


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
