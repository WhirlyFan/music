# home-proxy — Tailscale exit node for YouTube

YouTube bot-walls the deployed backend's datacenter IP. This makes a machine you
control (laptop, desktop, a spare box) a **Tailscale exit node**, and the backend
routes *only* its YouTube traffic out through it — so extraction comes from a
**residential IP**. It's **private** (peer-to-peer over your tailnet, nothing
exposed to the public internet) and the address is **stable** (set it in Render
once, never again).

It's just Docker + a `.env`, so you can clone this repo on any machine, drop in
the auth key, and `docker compose up` — that machine becomes the exit node. It
only works while it's running (the trade for a free residential IP).

## One-time setup

1. **Tailscale account** (free) at <https://tailscale.com>. You'll use the *same*
   account for this node and the backend, so they share a tailnet.
2. **Auth key:** <https://login.tailscale.com/admin/settings/keys> → "Generate
   auth key" (Reusable is handy). Copy it.
3. **Config:**
   ```sh
   cd home-proxy
   cp .env.example .env
   # paste TS_AUTHKEY; keep or change TS_HOSTNAME (default: music-home-exit)
   ```

## Bring it up (each time you want playback working)

```sh
cd home-proxy
docker compose up -d
```

Then, the **first time only**, approve it as an exit node:
- Tailscale admin → **Machines** → `music-home-exit` → **Edit route settings** →
  enable **Use as exit node** → Save.

## Point the backend at it (first time only)

In **Render → backend service → Environment**:
- `TS_AUTHKEY` = a Tailscale auth key (same account; can be a separate key)
- `TS_EXIT_NODE` = `music-home-exit` (your `TS_HOSTNAME`)

Save → redeploy. The backend joins the tailnet and routes YouTube traffic through
this node. Verify:
```
https://music.whirlyfan.com/api/v1/catalog/tracks/yt-diag/?v=oFCmz7PN2ls
```
`tv` should report **OK**, and tracks should play.

## Stop / move it

- Stop: `docker compose down` (playback stops working until it's back up).
- Move to another computer: clone the repo there, copy your `.env`, `docker
  compose up -d`. Same hostname → the backend's `TS_EXIT_NODE` still matches; no
  Render change needed.

## Notes

- **Keep `YOUTUBE_COOKIES` set on the backend too.** The exit node clears the
  *IP* wall; the cookies clear the *account* wall.
- Requires `/dev/net/tun` + `NET_ADMIN` (in the compose file) — standard for a
  Tailscale exit node. Works on Docker Desktop and Linux.
- Nothing is exposed publicly: only devices on your tailnet can use this node,
  and the backend authenticates with its own key.
