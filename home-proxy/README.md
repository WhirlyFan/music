# home-proxy — Tailscale exit node for YouTube

YouTube bot-walls the deployed backend's datacenter IP. This makes a machine you
control a **Tailscale exit node**, and the backend routes *only* its YouTube
traffic out through it — so extraction comes from a **residential IP**. It's
**private** (peer-to-peer over your tailnet, nothing exposed publicly) and the
address is **stable** (set it in the backend once, never again).

Just Docker, so you can clone this repo on any machine and bring it up. It only
works while it's running (the trade for a free residential IP).

## One-time setup (in Tailscale, you've largely done this)
1. Tailnet ACLs include `tag:music` in `tagOwners` and an `autoApprovers` exit-node
   entry for it (so this node auto-approves — no manual click).
2. An auth key **tagged `tag:music`** lives in Doppler as `TS_AUTHKEY` (config `prd`).

## Bring it up — pulls the key from Doppler (no .env to manage)
```sh
cd home-proxy
make up          # = doppler run --config prd -- docker compose up -d
```
`TS_AUTHKEY` comes from Doppler `prd`, exactly like the backend's secrets. Requires
the Doppler CLI (logged in, with access to `prd`).

Confirm it's live: Tailscale admin → **Machines** → `music-home-exit` with an
**Exit Node** badge (auto-approved via the `tag:music` autoApprover).

- Stop: `make down`
- Tail logs: `make logs`

## No Doppler on this box? Use a local .env instead
```sh
cp .env.example .env     # set TS_AUTHKEY (tagged tag:music), TS_HOSTNAME
docker compose up -d
```

## Backend side (already wired)
The backend reads `TS_AUTHKEY` + `TS_EXIT_NODE=music-home-exit` from Doppler `prd`;
its entrypoint runs `tailscaled` (userspace) and routes YouTube traffic through this
node. After this node is up, redeploy the backend and verify:
```
https://music.whirlyfan.com/api/v1/catalog/tracks/yt-diag/?v=oFCmz7PN2ls
```
`tv` should report **OK**.

## Notes
- Keep `YOUTUBE_COOKIES` in Doppler `prd` too — the exit node clears the *IP* wall;
  cookies clear the *account* wall.
- Move it to another computer: clone the repo there, `make up`. Same hostname →
  the backend's `TS_EXIT_NODE` still matches; no backend change needed.
- Requires `/dev/net/tun` + `NET_ADMIN` (in the compose file) — standard for a
  Tailscale exit node. Works on Docker Desktop and Linux.
