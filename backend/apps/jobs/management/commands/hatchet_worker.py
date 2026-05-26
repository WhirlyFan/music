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
        # `slots` (formerly `max_runs` in pre-1.x SDK) caps how many task runs
        # this worker handles concurrently. Tune based on container CPU/mem.
        parser.add_argument("--slots", type=int, default=10)

    def handle(self, *args, **options):
        # Import inside handle() so Django settings are configured first.
        from apps.jobs.workflows import hatchet, hello_workflow, parallel_llm_workflow

        worker = hatchet.worker(
            name=options["name"],
            slots=options["slots"],
            workflows=[hello_workflow, parallel_llm_workflow],
        )

        self.stdout.write(
            self.style.SUCCESS(
                f"Starting Hatchet worker '{options['name']}' (slots={options['slots']})"
            )
        )
        worker.start()
