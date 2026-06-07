# home-proxy

Run a **residential proxy on your own machine** so the deployed backend can extract
YouTube audio through your home IP instead of Render's datacenter IP (which YouTube
bot-walls). Two containers: an authenticated HTTP proxy + an ngrok TCP tunnel that
exposes it publicly. Free — the cost is that it only works while this machine and
these containers are running, and all audio flows through your home upstream.

## One-time setup

1. **ngrok token** — make a free account, copy your authtoken from
   <https://dashboard.ngrok.com/get-started/your-authtoken>.
2. **Config:**
   ```sh
   cd home-proxy
   cp .env.example .env
   # edit .env: set a strong PROXY_PASS and paste NGROK_AUTHTOKEN
   ```

## Each time you want playback working

```sh
cd home-proxy
docker compose up -d        # start proxy + tunnel
./print-proxy-url.sh        # prints the YOUTUBE_PROXY=... line
```

Paste that `YOUTUBE_PROXY=...` value into **Render → backend service → Environment**,
save, and **redeploy**. Then verify:

```
https://music.whirlyfan.com/api/v1/catalog/tracks/yt-diag/?v=oFCmz7PN2ls
```

`tv`/`web_embedded` should now report **OK**, and tracks should play.

To stop: `docker compose down` (playback stops working until you bring it back up).

## Notes

- **The ngrok URL changes every restart** (free tier). After `docker compose up`,
  re-run `./print-proxy-url.sh` and update `YOUTUBE_PROXY` + redeploy. (A paid ngrok
  static TCP address — or a Cloudflare Tunnel — avoids the re-paste; ask and we can
  wire one.)
- **Keep cookies set too.** `YOUTUBE_PROXY` clears the *IP* wall; `YOUTUBE_COOKIES`
  clears the *account* wall. Both together are the most reliable.
- The proxy requires basic-auth (your `PROXY_USER`/`PROXY_PASS`), so the public
  endpoint isn't an open relay.
- ngrok inspector runs at <http://localhost:4040> if you want to watch traffic.
