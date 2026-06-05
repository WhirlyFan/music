import factory

from apps.catalog.models import PlaybackSource, Playlist, PlaylistTrack, Source, Track
from apps.users.tests.factories import UserFactory


class TrackFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Track

    title = factory.Faker("sentence", nb_words=3)
    primary_artist = factory.Faker("name")
    duration_ms = factory.Faker("random_int", min=120_000, max=300_000)
    match_key = factory.Sequence(lambda n: f"seed-track-{n}")


class PlaylistFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Playlist

    title = factory.Faker("sentence", nb_words=3)
    is_public = True
    created_by = factory.SubFactory(UserFactory)


class PlaylistTrackFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = PlaylistTrack

    playlist = factory.SubFactory(PlaylistFactory)
    track = factory.SubFactory(TrackFactory)
    position = factory.Sequence(lambda n: n)


class PlaybackSourceFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = PlaybackSource

    track = factory.SubFactory(TrackFactory)
    # YOUTUBE is seeded by migration 0002 (present in dev DB + test DB).
    source = factory.LazyFunction(lambda: Source.objects.get(code=Source.YOUTUBE))
    locator_kind = PlaybackSource.LocatorKind.VIDEO_ID
    locator = factory.Faker("lexify", text="???????????")  # 11-char fake video id
    origin = PlaybackSource.Origin.MATCHED_AUTO
    status = PlaybackSource.Status.ACTIVE
    confidence = 0.95
