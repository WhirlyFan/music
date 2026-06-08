"""PlaylistConsumer: auth gate + group relay of the `playlist.changed` nudge.

(The can't-view → 4403 gate is enforced by RLS, exercised in test_rls.py — the
WebsocketCommunicator tests connect as the BYPASSRLS app_admin role, so RLS doesn't
reject here.)
"""

import pytest
from allauth.account.models import EmailAddress
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.contrib.auth.models import AnonymousUser

from apps.catalog.realtime import playlist_group
from apps.catalog.routing import websocket_urlpatterns
from apps.catalog.tests.factories import PlaylistFactory
from apps.users.tests.factories import UserFactory

app = URLRouter(websocket_urlpatterns)


def _verified(user):
    EmailAddress.objects.update_or_create(
        user=user, email=user.email, defaults={"verified": True, "primary": True}
    )
    return user


def _connect(playlist_id, user):
    comm = WebsocketCommunicator(app, f"/ws/playlists/{playlist_id}/")
    comm.scope["user"] = user  # exercise the consumer's own gate
    return comm


@pytest.mark.django_db(transaction=True)
def test_viewer_connects_and_receives_change_nudge():
    owner = _verified(UserFactory())
    pl = PlaylistFactory(created_by=owner)

    async def scenario():
        comm = _connect(pl.id, owner)
        connected, _ = await comm.connect()
        assert connected
        # An edit elsewhere fans a content-less nudge to the playlist group.
        await get_channel_layer().group_send(playlist_group(pl.id), {"type": "playlist.changed"})
        msg = await comm.receive_json_from()
        assert msg == {"type": "playlist.changed"}
        await comm.disconnect()

    async_to_sync(scenario)()


@pytest.mark.django_db(transaction=True)
def test_anonymous_is_rejected():
    owner = _verified(UserFactory())
    pl = PlaylistFactory(created_by=owner)

    async def scenario():
        comm = _connect(pl.id, AnonymousUser())
        connected, code = await comm.connect()
        assert connected is False
        assert code == 4401

    async_to_sync(scenario)()
