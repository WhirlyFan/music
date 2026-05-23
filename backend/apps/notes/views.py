from rest_framework import permissions, viewsets

from .models import Note
from .serializers import NoteSerializer


class NoteViewSet(viewsets.ModelViewSet):
    """CRUD viewset for Notes.

    Notably, `get_queryset` returns `Note.objects.all()` with **no**
    `.filter(owner=self.request.user)`. RLS policies enforce per-user
    isolation at the database. Tests in `tests/test_rls.py` prove that
    forgetting the app-layer filter does not leak rows.
    """

    serializer_class = NoteSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Note.objects.all()

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)
