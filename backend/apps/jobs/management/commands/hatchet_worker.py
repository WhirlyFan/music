"""Run the Hatchet worker that executes registered workflows.

Usage (from a sidecar container in docker-compose):
    python manage.py hatchet_worker

Reads HATCHET_CLIENT_TOKEN / HATCHET_CLIENT_HOST_PORT from the environment
(populated from .env). Workers can be scaled horizontally — Hatchet
distributes work across them automatically.
"""

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Run the Hatchet worker process."

    def add_arguments(self, parser):
        parser.add_argument("--name", default="django-worker")
        parser.add_argument("--max-runs", type=int, default=10)

    def handle(self, *args, **options):
        # Import inside handle() so settings are configured first.
        from apps.jobs.workflows import (
            HelloWorkflow,
            ParallelLLMWorkflow,
            hatchet,
        )

        worker = hatchet.worker(
            name=options["name"],
            max_runs=options["max_runs"],
            workflows=[HelloWorkflow(), ParallelLLMWorkflow()],
        )

        self.stdout.write(
            self.style.SUCCESS(
                f"Starting Hatchet worker '{options['name']}' (max_runs={options['max_runs']})"
            )
        )
        worker.start()
