import factory
from django.contrib.auth import get_user_model

User = get_user_model()


class UserFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = User
        django_get_or_create = ("email",)

    email = factory.Sequence(lambda n: f"user{n}@example.com")
    # Username matches the email handle by default so test data stays
    # readable. Tests can override per-call: `UserFactory(username="alice")`.
    username = factory.Sequence(lambda n: f"user{n}")
    first_name = factory.Faker("first_name")
    last_name = factory.Faker("last_name")
    is_active = True

    @classmethod
    def _create(cls, model_class, *args, **kwargs):
        # Idempotent: reuse an existing row keyed by email if present.
        # (Overriding _create means we re-implement django_get_or_create ourselves.)
        email = kwargs["email"]
        existing = model_class.objects.filter(email=email).first()
        if existing:
            return existing
        password = kwargs.pop("password", "password")
        return model_class.objects.create_user(password=password, **kwargs)
