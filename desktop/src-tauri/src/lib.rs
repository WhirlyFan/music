//! WhirlyFan desktop shell.
//!
//! The webview loads the embedded SPA from a local reverse-proxy
//! (`http://127.0.0.1:<port>`) that forwards `/api`, `/_allauth`, `/accounts`, and
//! `/ws` to the cloud. Auth is owned by Rust: a native Google sign-in (system
//! browser + PKCE + loopback, RFC 8252) yields an allauth session token, which the
//! proxy injects as the `sessionid` cookie on every upstream request. Because that
//! token *is* the Django session key, the existing cookie + CSRF auth (and the
//! frontend's allauth browser client) work unchanged — the webview is same-origin
//! to the proxy and never handles auth itself. See docs/tauri-migration.md.

use axum::{
    body::Body,
    extract::ws::{Message as AxMsg, WebSocket, WebSocketUpgrade},
    extract::{OriginalUri, Path, State},
    http::{HeaderMap, Request, Response, StatusCode},
    Router,
};
use include_dir::{include_dir, Dir};
use tauri_plugin_shell::ShellExt;

// The built SPA, embedded at compile time. `beforeBuildCommand` builds it first.
static ASSETS: Dir = include_dir!("$CARGO_MANIFEST_DIR/../../frontend/dist");

const UPSTREAM: &str = "https://api.whirlyfan.com";
// Origin/Referer Django trusts for CSRF (and the host allauth pins OAuth to).
const TRUSTED_ORIGIN: &str = "https://music.whirlyfan.com";

// Native Google OAuth. The client id is baked at build time (it's public); the
// loopback redirect uses a FIXED port so it can be registered on the Google client.
const GOOGLE_CLIENT_ID: Option<&str> = option_env!("GOOGLE_OAUTH_CLIENT_ID");
const LOGIN_PORT: u16 = 8765;
const REDIRECT_URI: &str = "http://127.0.0.1:8765";

// OS keychain slot for the session token (so login survives restarts).
const KR_SERVICE: &str = "com.whirlyfan.music";
const KR_USER: &str = "session_token";

type ResolvedCache =
    std::sync::Arc<std::sync::Mutex<std::collections::HashMap<String, (String, std::time::Instant)>>>;

#[derive(Clone)]
struct AppState {
    client: reqwest::Client,
    jar: std::sync::Arc<reqwest::cookie::Jar>,
    // For the local audio engine: run the yt-dlp sidecar + cache resolved URLs.
    app: tauri::AppHandle,
    resolved: ResolvedCache,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Cookie-jar HTTP client. The jar holds the session as a `sessionid`
            // cookie — populated natively by /__login (or restored from the keychain
            // on startup), NOT harvested from a webview.
            let jar = std::sync::Arc::new(reqwest::cookie::Jar::default());
            if let Some(token) = load_token() {
                set_session(&jar, &token);
                log::info!("restored session from keychain");
            }
            let client = reqwest::Client::builder()
                .cookie_provider(jar.clone())
                .build()
                .expect("build reqwest client");
            let state = AppState {
                client,
                jar: jar.clone(),
                app: app.handle().clone(),
                resolved: std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
            };

            // Bind first so we know the port before pointing the window at it.
            let listener = tauri::async_runtime::block_on(async {
                tokio::net::TcpListener::bind("127.0.0.1:0").await
            })
            .expect("bind local proxy");
            let port = listener.local_addr().expect("local_addr").port();
            log::info!("local proxy listening on 127.0.0.1:{port}");

            let router = Router::new()
                .route("/__login", axum::routing::get(login_handler))
                .route("/stream/:video_id", axum::routing::get(stream_handler))
                .route("/ws/*rest", axum::routing::any(ws_handler))
                .fallback(handle)
                .with_state(state);
            tauri::async_runtime::spawn(async move {
                if let Err(e) = axum::serve(listener, router).await {
                    log::error!("local proxy server exited: {e}");
                }
            });

            let url = format!("http://127.0.0.1:{port}/");
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External(url.parse().expect("proxy url")),
            )
            .title("music")
            .inner_size(1280.0, 800.0)
            .min_inner_size(900.0, 600.0)
            .center()
            .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ---------------------------------------------------------------------------
// Auth: native Google sign-in + session token storage
// ---------------------------------------------------------------------------

fn set_session(jar: &reqwest::cookie::Jar, token: &str) {
    let api: reqwest::Url = "https://api.whirlyfan.com/".parse().unwrap();
    jar.add_cookie_str(&format!("sessionid={token}; Path=/"), &api);
}

fn load_token() -> Option<String> {
    match keyring::Entry::new(KR_SERVICE, KR_USER).and_then(|e| e.get_password()) {
        Ok(t) => Some(t),
        Err(keyring::Error::NoEntry) => None,
        Err(e) => {
            log::error!("keychain load failed: {e}");
            None
        }
    }
}

fn store_token(token: &str) {
    match keyring::Entry::new(KR_SERVICE, KR_USER).and_then(|e| e.set_password(token)) {
        Ok(()) => log::info!("session token saved to keychain"),
        Err(e) => log::error!("keychain store failed: {e}"),
    }
}

fn clear_token() {
    if let Ok(entry) = keyring::Entry::new(KR_SERVICE, KR_USER) {
        let _ = entry.delete_credential();
    }
}

fn b64url(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn rand_b64(n: usize) -> String {
    let mut buf = vec![0u8; n];
    getrandom::getrandom(&mut buf).expect("getrandom");
    b64url(&buf)
}

/// (verifier, S256 challenge) for PKCE.
fn pkce() -> (String, String) {
    use sha2::{Digest, Sha256};
    let verifier = rand_b64(32);
    let challenge = b64url(&Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

/// GET /__login — run Google's auth-code + PKCE flow in the system browser, exchange
/// the code server-side for a session token, store it, and return to the app.
async fn login_handler(State(state): State<AppState>) -> Response<Body> {
    let client_id = match GOOGLE_CLIENT_ID {
        Some(c) if !c.is_empty() => c,
        _ => {
            return text(
                StatusCode::INTERNAL_SERVER_ERROR,
                "This build has no Google client id (set GOOGLE_OAUTH_CLIENT_ID at build time).",
            )
        }
    };
    let (verifier, challenge) = pkce();
    let oauth_state = rand_b64(16);

    let mut auth_url = reqwest::Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
    auth_url
        .query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", REDIRECT_URI)
        .append_pair("response_type", "code")
        .append_pair("scope", "openid email profile")
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &oauth_state)
        .append_pair("prompt", "select_account");

    if let Err(e) = open::that(auth_url.as_str()) {
        return text(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Could not open the browser: {e}"),
        );
    }

    let code = match await_oauth_code(&oauth_state).await {
        Ok(c) => c,
        Err(e) => {
            log::error!("oauth: {e}");
            return redirect("/");
        }
    };

    match exchange_code(&state.client, &code, &verifier).await {
        Some(token) => {
            set_session(&state.jar, &token);
            store_token(&token);
            log::info!("native google login complete");
        }
        None => log::error!("oauth: code exchange failed"),
    }
    redirect("/")
}

/// Exchange the auth code for an allauth session token via the backend (the client
/// secret stays server-side).
async fn exchange_code(client: &reqwest::Client, code: &str, verifier: &str) -> Option<String> {
    let resp = client
        .post(format!("{UPSTREAM}/api/v1/users/auth/desktop/google/"))
        .json(&serde_json::json!({
            "code": code,
            "code_verifier": verifier,
            "redirect_uri": REDIRECT_URI,
        }))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        log::error!("desktop-google exchange status {}", resp.status());
        return None;
    }
    let body: serde_json::Value = resp.json().await.ok()?;
    body.get("session_token")?.as_str().map(str::to_owned)
}

/// One-shot loopback listener that captures Google's redirect (`?code=&state=`).
async fn await_oauth_code(expected_state: &str) -> Result<String, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", LOGIN_PORT))
        .await
        .map_err(|e| format!("loopback bind failed (port {LOGIN_PORT} busy?): {e}"))?;
    let (mut stream, _) =
        tokio::time::timeout(std::time::Duration::from_secs(300), listener.accept())
            .await
            .map_err(|_| "login timed out".to_string())?
            .map_err(|e| format!("accept failed: {e}"))?;

    let mut buf = vec![0u8; 8192];
    let n = stream.read(&mut buf).await.map_err(|e| e.to_string())?;
    let head = String::from_utf8_lossy(&buf[..n]);
    let req_line = head.lines().next().unwrap_or("");
    let path_q = req_line.split_whitespace().nth(1).unwrap_or("/");

    let page = "<!doctype html><html><head><meta charset=utf-8><title>music</title></head>\
<body style=\"margin:0;height:100vh;display:flex;align-items:center;justify-content:center;\
background:#0b0b12;color:#e7e7ee;font:16px/1.5 -apple-system,system-ui,sans-serif\">\
<div style=\"text-align:center;max-width:22rem;padding:2rem\">\
<div style=\"font-size:2rem;font-weight:600;letter-spacing:-.02em;\
background:linear-gradient(90deg,#6366f1,#a78bfa);-webkit-background-clip:text;\
background-clip:text;color:transparent\">music</div>\
<p style=\"margin:1rem 0 .25rem;font-weight:500\">You're signed in.</p>\
<p style=\"margin:0;color:#9a9aa8;font-size:.9rem\">You can close this tab and return to the app.</p>\
</div><script>setTimeout(()=>window.close(),800)</script></body></html>";
    let resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}",
        page.len()
    );
    let _ = stream.write_all(resp.as_bytes()).await;
    let _ = stream.flush().await;

    let parsed = reqwest::Url::parse(&format!("http://127.0.0.1:{LOGIN_PORT}{path_q}"))
        .map_err(|e| e.to_string())?;
    let (mut code, mut state, mut err) = (None, None, None);
    for (k, v) in parsed.query_pairs() {
        match k.as_ref() {
            "code" => code = Some(v.into_owned()),
            "state" => state = Some(v.into_owned()),
            "error" => err = Some(v.into_owned()),
            _ => {}
        }
    }
    if let Some(e) = err {
        return Err(format!("Google returned error: {e}"));
    }
    if state.as_deref() != Some(expected_state) {
        return Err("state mismatch".into());
    }
    code.ok_or_else(|| "no code in redirect".into())
}

fn redirect(location: &str) -> Response<Body> {
    Response::builder()
        .status(StatusCode::FOUND)
        .header("location", location)
        .body(Body::empty())
        .unwrap()
}

// ---------------------------------------------------------------------------
// Reverse proxy
// ---------------------------------------------------------------------------

async fn handle(State(state): State<AppState>, req: Request<Body>) -> Response<Body> {
    let path = req.uri().path().to_owned();
    if path.starts_with("/api") || path.starts_with("/_allauth") || path.starts_with("/accounts") {
        proxy(state, req).await
    } else {
        serve_static(&path)
    }
}

/// Forward an API/auth request to the cloud through the cookie-jar client.
async fn proxy(state: AppState, req: Request<Body>) -> Response<Body> {
    let (parts, body) = req.into_parts();
    let method = parts.method.clone();
    let path = parts.uri.path().to_owned();
    let pq = parts
        .uri
        .path_and_query()
        .map(|x| x.as_str())
        .unwrap_or("/")
        .to_owned();
    let url = format!("{UPSTREAM}{pq}");

    let body_bytes = match axum::body::to_bytes(body, 16 * 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return text(StatusCode::BAD_REQUEST, "request body too large"),
    };

    let mut rb = state.client.request(method.clone(), &url);
    for (k, v) in parts.headers.iter() {
        let kn = k.as_str().to_ascii_lowercase();
        // Skip hop-by-hop + identity headers; let reqwest/the jar own host, cookies,
        // and content-length. Strip accept-encoding so upstream returns identity.
        if matches!(
            kn.as_str(),
            "host" | "origin" | "referer" | "content-length" | "connection" | "accept-encoding" | "cookie"
        ) {
            continue;
        }
        rb = rb.header(k.as_str(), v.as_bytes());
    }
    rb = rb
        .header("Origin", TRUSTED_ORIGIN)
        .header("Referer", format!("{TRUSTED_ORIGIN}/"));
    if !body_bytes.is_empty() {
        rb = rb.body(body_bytes.to_vec());
    }

    let upstream = match rb.send().await {
        Ok(r) => r,
        Err(e) => return text(StatusCode::BAD_GATEWAY, &format!("upstream error: {e}")),
    };

    let status = upstream.status().as_u16();
    // The frontend's own logout (DELETE the allauth session) clears the server
    // session + the jar (via Set-Cookie); also drop the keychain copy so it doesn't
    // get restored on the next launch.
    if method == reqwest::Method::DELETE
        && path == "/_allauth/browser/v1/auth/session"
        && (200..400).contains(&status)
    {
        clear_token();
    }

    let mut builder = Response::builder().status(status);
    for (k, v) in upstream.headers().iter() {
        let kn = k.as_str().to_ascii_lowercase();
        if matches!(
            kn.as_str(),
            "transfer-encoding" | "connection" | "content-length" | "content-encoding"
        ) {
            continue;
        }
        if kn == "set-cookie" {
            if let Ok(s) = v.to_str() {
                builder = builder.header("set-cookie", rewrite_set_cookie(s));
            }
            continue;
        }
        builder = builder.header(k.as_str(), v.as_bytes());
    }
    let bytes = upstream.bytes().await.unwrap_or_default();
    builder
        .body(Body::from(bytes))
        .unwrap_or_else(|_| text(StatusCode::INTERNAL_SERVER_ERROR, "response build failed"))
}

/// Make a cookie set by api.whirlyfan.com apply to the local http origin: drop
/// Domain (host-only on localhost), Secure (we're http), and SameSite. This lets
/// `csrftoken` reach the webview so the SPA can echo it as X-CSRFToken.
fn rewrite_set_cookie(s: &str) -> String {
    s.split(';')
        .map(|p| p.trim())
        .filter(|p| {
            let l = p.to_ascii_lowercase();
            !(l.starts_with("domain=") || l == "secure" || l.starts_with("samesite="))
        })
        .collect::<Vec<_>>()
        .join("; ")
}

/// Serve an embedded SPA asset, falling back to index.html for client routes.
fn serve_static(path: &str) -> Response<Body> {
    let rel = path.trim_start_matches('/');
    let lookup = if rel.is_empty() { "index.html" } else { rel };
    match ASSETS.get_file(lookup) {
        Some(f) => {
            let ct = mime_guess::from_path(lookup).first_or_octet_stream();
            Response::builder()
                .status(200)
                .header("content-type", ct.as_ref())
                .body(Body::from(f.contents().to_vec()))
                .unwrap()
        }
        None => match ASSETS.get_file("index.html") {
            Some(idx) => Response::builder()
                .status(200)
                .header("content-type", "text/html")
                .body(Body::from(idx.contents().to_vec()))
                .unwrap(),
            None => text(StatusCode::NOT_FOUND, "not found"),
        },
    }
}

fn text(status: StatusCode, msg: &str) -> Response<Body> {
    Response::builder()
        .status(status)
        .header("content-type", "text/plain")
        .body(Body::from(msg.to_owned()))
        .unwrap()
}

// ---------------------------------------------------------------------------
// Local audio engine: resolve via the yt-dlp sidecar + proxy the bytes
// ---------------------------------------------------------------------------

const BROWSER_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/// Resolve the direct (progressive m4a, itag 140) audio URL for a YouTube video by
/// running the bundled yt-dlp sidecar — from the user's own residential IP, so no
/// bot wall / cookies / proxy needed (unlike the cloud). Cached in-memory (the URL
/// is IP-locked + time-limited) so Range requests and replays don't re-run yt-dlp.
async fn resolve_audio(state: &AppState, video_id: &str) -> Option<String> {
    if let Ok(cache) = state.resolved.lock() {
        if let Some((url, at)) = cache.get(video_id) {
            if at.elapsed() < std::time::Duration::from_secs(3600) {
                return Some(url.clone());
            }
        }
    }
    let watch = format!("https://www.youtube.com/watch?v={video_id}");
    let output = state
        .app
        .shell()
        .sidecar("yt-dlp")
        .ok()?
        .args([
            "-f",
            "140/bestaudio[ext=m4a]/bestaudio",
            "--no-playlist",
            "--no-warnings",
            "-q",
            "--print",
            "%(url)s",
            &watch,
        ])
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        log::error!(
            "yt-dlp resolve failed for {video_id}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        return None;
    }
    let url = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())?
        .to_string();
    if let Ok(mut cache) = state.resolved.lock() {
        cache.insert(video_id.to_string(), (url.clone(), std::time::Instant::now()));
    }
    Some(url)
}

/// GET /stream/<video_id> — resolve locally, then proxy the audio bytes (Range-aware)
/// from googlevideo. The <audio> element points here instead of the cloud /stream/.
async fn stream_handler(
    State(state): State<AppState>,
    Path(video_id): Path<String>,
    headers: HeaderMap,
) -> Response<Body> {
    let Some(url) = resolve_audio(&state, &video_id).await else {
        return text(StatusCode::BAD_GATEWAY, "could not resolve audio");
    };
    let mut rb = state.client.get(&url).header("User-Agent", BROWSER_UA);
    if let Some(range) = headers.get(axum::http::header::RANGE) {
        rb = rb.header(reqwest::header::RANGE, range.as_bytes());
    }
    let upstream = match rb.send().await {
        Ok(r) => r,
        Err(e) => return text(StatusCode::BAD_GATEWAY, &format!("audio fetch failed: {e}")),
    };
    let mut builder = Response::builder().status(upstream.status().as_u16());
    for h in ["content-type", "content-length", "content-range", "accept-ranges"] {
        if let Some(v) = upstream.headers().get(h) {
            builder = builder.header(h, v.as_bytes());
        }
    }
    builder
        .body(Body::from_stream(upstream.bytes_stream()))
        .unwrap_or_else(|_| text(StatusCode::INTERNAL_SERVER_ERROR, "stream build failed"))
}

// ---------------------------------------------------------------------------
// WebSocket proxy
// ---------------------------------------------------------------------------

/// Upgrade a webview WebSocket and bridge it to the cloud's wss:// endpoint,
/// forwarding the jar's session cookie + a trusted Origin so Channels authenticates.
async fn ws_handler(
    State(state): State<AppState>,
    OriginalUri(uri): OriginalUri,
    ws: WebSocketUpgrade,
) -> axum::response::Response {
    let pq = uri
        .path_and_query()
        .map(|x| x.as_str())
        .unwrap_or("/")
        .to_owned();
    ws.on_upgrade(move |socket| bridge_ws(socket, pq, state))
}

async fn bridge_ws(client: WebSocket, pq: String, state: AppState) {
    use axum::http::header::{COOKIE, ORIGIN};
    use futures_util::{SinkExt, StreamExt};
    use reqwest::cookie::CookieStore;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use tokio_tungstenite::tungstenite::Message as TgMsg;

    let upstream_url = format!("wss://api.whirlyfan.com{pq}");
    let mut request = match upstream_url.into_client_request() {
        Ok(r) => r,
        Err(e) => {
            log::error!("ws: bad upstream url: {e}");
            return;
        }
    };
    {
        let h = request.headers_mut();
        h.insert(ORIGIN, axum::http::HeaderValue::from_static(TRUSTED_ORIGIN));
        let api: reqwest::Url = "https://api.whirlyfan.com/".parse().unwrap();
        if let Some(cookie) = state.jar.cookies(&api) {
            h.insert(COOKIE, cookie);
        }
    }

    let (upstream, _resp) = match tokio_tungstenite::connect_async(request).await {
        Ok(x) => x,
        Err(e) => {
            log::error!("ws: upstream connect failed: {e}");
            return; // dropping `client` closes the webview socket
        }
    };

    let (mut up_tx, mut up_rx) = upstream.split();
    let (mut cl_tx, mut cl_rx) = client.split();

    // webview → cloud
    let c2u = tokio::spawn(async move {
        while let Some(Ok(msg)) = cl_rx.next().await {
            let out = match msg {
                AxMsg::Text(t) => TgMsg::Text(t.into()),
                AxMsg::Binary(b) => TgMsg::Binary(b.into()),
                AxMsg::Ping(p) => TgMsg::Ping(p.into()),
                AxMsg::Pong(p) => TgMsg::Pong(p.into()),
                AxMsg::Close(_) => {
                    let _ = up_tx.send(TgMsg::Close(None)).await;
                    break;
                }
            };
            if up_tx.send(out).await.is_err() {
                break;
            }
        }
    });

    // cloud → webview
    let u2c = tokio::spawn(async move {
        while let Some(Ok(msg)) = up_rx.next().await {
            let out = match msg {
                TgMsg::Text(t) => AxMsg::Text(t.as_str().to_owned()),
                TgMsg::Binary(b) => AxMsg::Binary(b.to_vec()),
                TgMsg::Ping(p) => AxMsg::Ping(p.to_vec()),
                TgMsg::Pong(p) => AxMsg::Pong(p.to_vec()),
                TgMsg::Close(_) => {
                    let _ = cl_tx.send(AxMsg::Close(None)).await;
                    break;
                }
                TgMsg::Frame(_) => continue,
            };
            if cl_tx.send(out).await.is_err() {
                break;
            }
        }
    });

    let _ = tokio::join!(c2u, u2c);
}
