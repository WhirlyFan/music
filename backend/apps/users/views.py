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
from rest_framework import permissions
from rest_framework.decorators import api_view, permission_classes
from rest_framework.request import Request
from rest_framework.response import Response


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def passkey_credential_ids(request: Request) -> Response:
    rows = Authenticator.objects.filter(
        user=request.user,
        type=Authenticator.Type.WEBAUTHN,
    )
    return Response({row.pk: (row.data or {}).get("credential", {}).get("id") for row in rows})
