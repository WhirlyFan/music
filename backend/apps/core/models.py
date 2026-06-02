"""Shared abstract base models."""

import uuid

from django.db import models


class BaseModel(models.Model):
    """UUIDv7 primary key + created/updated timestamps for every table.

    UUIDv7 (RFC 9562) is time-ordered — the high 48 bits are a Unix-ms
    timestamp — so primary-key inserts stay near-sequential in the B-tree
    (unlike random UUIDv4, which fragments the index). Requires Python 3.14+
    for the stdlib `uuid.uuid7`.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
