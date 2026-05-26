from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.core.validators import RegexValidator
from django.db import models

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
