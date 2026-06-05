import hashlib
import secrets
from datetime import timedelta

from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.core.validators import RegexValidator
from django.db import models
from django.utils import timezone

INVITE_TTL = timedelta(days=14)


def _hash_token(raw: str) -> str:
    """SHA-256 of an invite token. The raw token lives only in the emailed link; the DB
    stores only this hash, so a leaked database can't be used to redeem invites (OWASP —
    treat invite tokens like password-reset tokens). The token is high-entropy (256-bit),
    so a plain unsalted hash is sufficient — no per-token salt/stretching needed."""
    return hashlib.sha256(raw.encode()).hexdigest()


def _invite_token_hash() -> str:
    """Field default: a fresh unguessable hash whose raw token is intentionally
    discarded. `Invitation.issue_token()` overrides this when a redeemable link is
    needed; the default just keeps directly-created rows (e.g. in tests) valid + unique."""
    return _hash_token(secrets.token_urlsafe(32))


def _invite_expiry():
    return timezone.now() + INVITE_TTL


# Letters, numbers, underscore, dash. 3-30 chars. Same pattern enforced by
# the frontend Zod schema so client + server agree.
USERNAME_REGEX = r"^[a-zA-Z0-9_-]+$"
USERNAME_VALIDATOR = RegexValidator(
    regex=USERNAME_REGEX,
    message="Username may contain letters, numbers, underscores, and dashes only.",
)


class UserManager(BaseUserManager):
    """Manager for the email/username user model.

    Note: we accept either `email` or `username` as the first positional
    arg via the parent create_user flow, but both fields are required on
    the model. `_create_user` enforces that.
    """

    use_in_migrations = True

    def _create_user(self, email, username, password, **extra_fields):
        if not email:
            raise ValueError("Email is required")
        if not username:
            raise ValueError("Username is required")
        email = self.normalize_email(email)
        username = username.strip()
        user = self.model(email=email, username=username, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, username, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, username, password, **extra_fields)

    def create_superuser(self, email, username, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        if not extra_fields.get("is_staff"):
            raise ValueError("Superuser must have is_staff=True.")
        if not extra_fields.get("is_superuser"):
            raise ValueError("Superuser must have is_superuser=True.")
        return self._create_user(email, username, password, **extra_fields)


class User(AbstractUser):
    """Custom user model.

    Email is the unique sign-in identifier (USERNAME_FIELD). Username is
    a separate required unique field used for display + alternate login
    (allauth's ACCOUNT_LOGIN_METHODS accepts either).

    first_name / last_name are inherited from AbstractUser (blank=True).
    """

    # Override AbstractUser.username (which is unique=True with the default
    # validator) so we can apply our own validator + uniqueness model.
    username = models.CharField(
        max_length=30,
        unique=True,
        db_index=True,
        validators=[USERNAME_VALIDATOR],
        help_text="3-30 chars. Letters, numbers, underscores, dashes.",
    )
    email = models.EmailField(unique=True)

    USERNAME_FIELD = "email"
    # Used by `createsuperuser`. Don't include email/password (handled by
    # Django) — only the *additional* required model fields.
    REQUIRED_FIELDS = ["username"]

    objects = UserManager()

    def __str__(self) -> str:
        return self.username

    @property
    def display_name(self) -> str:
        """Best human-readable label: 'First Last' if both set, else username."""
        full = f"{self.first_name} {self.last_name}".strip()
        return full or self.username


class Invitation(models.Model):
    """An invite to join the platform. Any logged-in member can create one for an email;
    while the `invite_only` waffle switch is on, the custom AccountAdapter lets *only*
    emails with a pending (unaccepted, unexpired) invitation sign up. Marked accepted
    when that email signs up. The first/admin user is bootstrapped via `createsuperuser`,
    which bypasses the signup flow (and thus this gate)."""

    email = models.EmailField(db_index=True)
    # SHA-256 of the invite-link token (the raw token is emailed, never stored). 64 hex
    # chars. The link doesn't expose the email in the URL either.
    token_hash = models.CharField(
        max_length=64, unique=True, default=_invite_token_hash, editable=False
    )
    invited_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sent_invitations",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(default=_invite_expiry)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"invite:{self.email}"

    @property
    def is_pending(self) -> bool:
        return self.accepted_at is None and self.expires_at > timezone.now()

    def issue_token(self) -> str:
        """Mint a fresh raw token, store only its hash on this (unsaved) instance, and
        return the raw token for the emailed link. Re-issuing on resend rotates the
        token, invalidating any older link. The caller must save() afterwards."""
        raw = secrets.token_urlsafe(32)
        self.token_hash = _hash_token(raw)
        return raw

    @classmethod
    def pending_for(cls, email: str):
        """The current pending invitation for `email` (case-insensitive), or None."""
        return (
            cls.objects.filter(
                email__iexact=email.strip(),
                accepted_at__isnull=True,
                expires_at__gt=timezone.now(),
            )
            .order_by("-created_at")
            .first()
        )

    @classmethod
    def pending_by_token(cls, raw_token: str):
        """The pending invitation whose token hashes to `raw_token`, or None. Constant
        work regardless of validity (single indexed hash lookup)."""
        return cls.objects.filter(
            token_hash=_hash_token(raw_token),
            accepted_at__isnull=True,
            expires_at__gt=timezone.now(),
        ).first()
