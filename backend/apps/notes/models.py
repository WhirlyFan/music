from django.conf import settings
from django.db import models
from django_rls import RLSModel
from django_rls.policies import UserPolicy


class Note(RLSModel):
    """A user-owned note.

    RLS is enforced at the database layer: even if a viewset forgets to filter
    by owner, the `owner_isolation` policy ensures app_user can only see rows
    where `owner_id = current_setting('rls.user_id')`.
    """

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notes",
    )
    title = models.CharField(max_length=200)
    body = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        rls_policies = [
            UserPolicy(name="owner_isolation", user_field="owner"),
        ]

    def __str__(self) -> str:
        return self.title
