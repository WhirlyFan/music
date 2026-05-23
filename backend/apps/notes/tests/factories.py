import factory

from apps.notes.models import Note
from apps.users.tests.factories import UserFactory


class NoteFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Note

    owner = factory.SubFactory(UserFactory)
    title = factory.Faker("sentence", nb_words=4)
    body = factory.Faker("paragraph", nb_sentences=3)
