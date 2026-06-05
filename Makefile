.PHONY: help bootstrap up down logs ps dev-backend dev-frontend mm migrate seed reset reset-db shell test lint format gen-api

# Use admin role for migrations / seed (host-side, local DB).
ADMIN_URL ?= postgres://app_admin:app_admin@localhost:5432/appdb

help:
	@echo "Targets:"
	@echo "  bootstrap     First-time setup: up db, install deps, migrate, seed"
	@echo "  up            docker compose up -d (passes your Doppler token to the backend)"
	@echo "  down          docker compose down"
	@echo "  logs          tail logs from all services"
	@echo "  ps            show running services"
	@echo ""
	@echo "  dev-backend   run Django dev server locally (outside Docker)"
	@echo "  dev-frontend  run Vite dev server locally"
	@echo ""
	@echo "  mm            makemigrations (as admin role)"
	@echo "  migrate       migrate (as admin role)"
	@echo "  seed          seed dev data (creates dev@example.com / password)"
	@echo "  reset         rebuild backend image + recreate its .venv volume (after"
	@echo "                changing backend deps — a plain 'up' keeps the stale venv)"
	@echo "  reset-db      drop volume + recreate + migrate + seed (DESTRUCTIVE)"
	@echo "  shell         Django shell"
	@echo ""
	@echo "  gen-api       regenerate frontend types from /api/schema/"
	@echo "  test          run pytest"
	@echo "  lint          lint backend + frontend"
	@echo "  format        format backend + frontend"

bootstrap:
	docker compose up -d db
	@echo "Waiting for postgres…"
	@until docker compose exec -T db pg_isready -U postgres -q; do sleep 1; done
	cd backend && uv sync
	$(MAKE) migrate
	$(MAKE) seed
	@echo ""
	@echo "✅ Bootstrap complete. Run 'make up' to start the full stack."
	@echo "   Dev login: dev@example.com / password"

up:
	@command -v doppler >/dev/null 2>&1 || { echo "❌ Doppler CLI required: https://docs.doppler.com/docs/install-cli"; exit 1; }
	@doppler configure get token --plain >/dev/null 2>&1 || { echo "❌ Not logged in — run 'doppler login' (project/config: $$(doppler configure get project --plain 2>/dev/null)/$$(doppler configure get config --plain 2>/dev/null))"; exit 1; }
	@echo "↻ passing Doppler token ($$(doppler configure get project --plain)/$$(doppler configure get config --plain)) to the backend; secrets fetched in-container at startup"
	DOPPLER_TOKEN=$$(doppler configure get token --plain) \
	DOPPLER_PROJECT=$$(doppler configure get project --plain) \
	DOPPLER_CONFIG=$$(doppler configure get config --plain) \
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f --tail=100

ps:
	docker compose ps

dev-backend:
	cd backend && DATABASE_URL=postgres://app_user:app_user@localhost:5432/appdb \
		uv run python manage.py runserver 0.0.0.0:8000

dev-frontend:
	cd frontend && pnpm dev

mm:
	cd backend && DATABASE_URL=$(ADMIN_URL) uv run python manage.py makemigrations

migrate:
	cd backend && DATABASE_URL=$(ADMIN_URL) uv run python manage.py migrate

seed:
	cd backend && DATABASE_URL=$(ADMIN_URL) uv run python manage.py seed

# Rebuild the backend image and recreate its container + the anonymous .venv
# volume. Needed after changing backend Python deps: the .venv lives in a named
# anonymous volume that survives `up`, so a plain `up` keeps using the OLD venv
# and your new/changed deps never appear. (Leaves the DB volume untouched.)
reset:
	docker compose build backend
	docker compose rm -fsv backend
	$(MAKE) up

reset-db:
	docker compose down -v
	docker compose up -d db
	@until docker compose exec -T db pg_isready -U postgres -q; do sleep 1; done
	$(MAKE) migrate
	$(MAKE) seed

shell:
	cd backend && DATABASE_URL=$(ADMIN_URL) uv run python manage.py shell_plus

gen-api:
	cd frontend && pnpm gen:api

test:
	cd backend && DATABASE_URL=$(ADMIN_URL) uv run pytest

lint:
	cd backend && uv run ruff check && uv run ruff format --check
	cd frontend && pnpm lint && pnpm format:check

format:
	cd backend && uv run ruff check --fix && uv run ruff format
	cd frontend && pnpm lint:fix && pnpm format
