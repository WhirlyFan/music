# Bring the Tailscale exit node up/down. `make up` pulls TS_AUTHKEY from Doppler
# (project music, config prd) and hands it to docker compose — no local .env to
# manage, mirroring how the backend gets its secrets. Requires the Doppler CLI,
# logged in with access to prd.
#
# Prefer not to use Doppler on this box? Fall back to a local .env instead:
#   cp .env.example .env   # fill TS_AUTHKEY
#   docker compose up -d
DOPPLER ?= doppler run --project music --config prd --

.PHONY: up down logs
up:
	$(DOPPLER) docker compose up -d
	@echo "Exit node starting. Check Tailscale → Machines for 'music-home-exit'."

down:
	$(DOPPLER) docker compose down

logs:
	$(DOPPLER) docker compose logs -f
