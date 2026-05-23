from rest_framework import serializers

from .models import WorkflowRun


class WorkflowRunSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkflowRun
        fields = [
            "id",
            "workflow",
            "hatchet_run_id",
            "input",
            "status",
            "error",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "hatchet_run_id",
            "status",
            "error",
            "created_at",
            "updated_at",
        ]


class TriggerWorkflowSerializer(serializers.Serializer):
    workflow = serializers.CharField(max_length=128)
    input = serializers.JSONField(required=False, default=dict)
