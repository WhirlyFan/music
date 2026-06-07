//! WhirlyFan desktop shell.
//!
//! The webview can't talk to the cloud directly: loaded from a custom origin it
//! would be cross-origin to api.whirlyfan.com, so the session cookie + CSRF flow
//! (django-allauth browser mode + DRF SessionAuthentication) can't work. Instead
//! we run a tiny local reverse-proxy: it serves the embedded SPA AND forwards
//! /api, /_allauth, /accounts to the cloud through a server-side cookie jar. From
//! the webview everything is same-origin (http://127.0.0.1:<port>), so the
//! existing cookie+CSRF auth works UNCHANGED and no backend changes are needed.
//! See docs/tauri-migration.md (Phase E).

use axum::{
    body::Body,
    extract::ws::{Message as AxMsg, WebSocket, WebSocketUpgrade},
    extract::{OriginalUri, State},
    http::{Request, Response, StatusCode},
    Router,
};
use include_dir::{include_dir, Dir};

// The built SPA, embedded at compile time. `beforeBuildCommand` builds it first.
static ASSETS: Dir = include_dir!("$CARGO_MANIFEST_DIR/../../frontend/dist");

const UPSTREAM: &str = "https://api.whirlyfan.com";
// Origin/Referer Django trusts for CSRF (and the host allauth pins OAuth to). The
// webview's real origin is http://127.0.0.1:<port>, which Django would reject, so
// we present a trusted one on every forwarded request.
const TRUSTED_ORIGIN: &str = "https://music.whirlyfan.com";

#[derive(Clone)]
struct AppState {
    client: reqwest::Client,
    jar: std::sync::Arc<reqwest::cookie::Jar>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            // Cookie-jar HTTP client = the server-side session for the proxied API.
            // We keep an explicit jar so the OAuth harvest (below) can inject the
            // session cookie obtained by logging in against prod in the webview.
            let jar = std::sync::Arc::new(reqwest::cookie::Jar::default());
            let client = reqwest::Client::builder()
                .cookie_provider(jar.clone())
                .build()
                .expect("build reqwest client");
            let state = AppState {
                client,
                jar: jar.clone(),
            };

            // Bind first so we know the port before pointing the window at it.
            let listener = tauri::async_runtime::block_on(async {
                tokio::net::TcpListener::bind("127.0.0.1:0").await
            })
            .expect("bind local proxy");
            let port = listener.local_addr().expect("local_addr").port();
            log::info!("local proxy listening on 127.0.0.1:{port}");

            let router = Router::new()
                .route("/ws/*rest", axum::routing::any(ws_handler))
                .fallback(handle)
                .with_state(state);
            tauri::async_runtime::spawn(async move {
                if let Err(e) = axum::serve(listener, router).await {
                    log::error!("local proxy server exited: {e}");
                }
            });

            let url = format!("http://127.0.0.1:{port}/");
            let webview = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External(url.parse().expect("proxy url")),
            )
            .title("WhirlyFan")
            .inner_size(1280.0, 800.0)
            .min_inner_size(900.0, 600.0)
            .center()
            .build()?;

            // OAuth harvest (background poll). Google login can't complete through
            // the proxy (the bounce to Google + back to the prod callback bypasses
            // it), so the desktop "sign in" sends the webview to the prod site where
            // the full flow works. Tauri's page-load events don't fire reliably
            // across that cross-origin redirect chain, so instead we POLL the
            // webview's prod cookies: the moment a `sessionid` appears we lift it
            // into the proxy jar and, if the webview is still on prod, bring it home
            // — now authenticated, with no backend change.
            let harvest_jar = jar.clone();
            tauri::async_runtime::spawn(async move {
                let api: reqwest::Url = "https://api.whirlyfan.com/".parse().unwrap();
                let local: tauri::Url = format!("http://127.0.0.1:{port}/").parse().unwrap();
                let mut have_session = false;
                loop {
                    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                    // cookies() returns ALL cookies (incl. HttpOnly/secure) across URLs;
                    // cookies_for_url's URL filter returns empty for the prod domain here.
                    let cookies = match webview.cookies() {
                        Ok(c) => c,
                        Err(e) => {
                            log::error!("[harvest] cookies() failed: {e}");
                            continue;
                        }
                    };
                    let Some(sess) = cookies.iter().find(|c| c.name() == "sessionid") else {
                        have_session = false;
                        continue;
                    };
                    harvest_jar
                        .add_cookie_str(&format!("sessionid={}; Path=/", sess.value()), &api);
                    if !have_session {
                        have_session = true;
                        log::info!("[harvest] sessionid found → injected into proxy jar");
                    }
                    if let Ok(cur) = webview.url() {
                        if cur.host_str() == Some("music.whirlyfan.com") {
                            log::info!("[harvest] returning webview to local app");
                            let _ = webview.navigate(local.clone());
                        }
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

async fn handle(State(state): State<AppState>, req: Request<Body>) -> Response<Body> {
    let path = req.uri().path().to_owned();
    if path.starts_with("/api") || path.starts_with("/_allauth") || path.starts_with("/accounts") {
        proxy(state, req).await
    } else if path.starts_with("/ws") {
        // TODO(Phase E): WebSocket proxy for jam/playlist/notification sockets.
        // Until then fail cleanly so the socket hooks just retry/ignore (the app
        // works over HTTP; only live updates are missing).
        text(StatusCode::SERVICE_UNAVAILABLE, "ws proxy not implemented yet")
    } else {
        serve_static(&path)
    }
}

/// Forward an API/auth request to the cloud through the cookie-jar client.
async fn proxy(state: AppState, req: Request<Body>) -> Response<Body> {
    let (parts, body) = req.into_parts();
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

    let mut rb = state.client.request(parts.method.clone(), &url);
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
    builder.body(Body::from(bytes)).unwrap_or_else(|_| {
        text(StatusCode::INTERNAL_SERVER_ERROR, "response build failed")
    })
}

/// Make a cookie set by api.whirlyfan.com apply to the local http origin: drop
/// Domain (host-only on localhost), Secure (we're http), and SameSite. The
/// csrftoken cookie must reach the webview so the SPA can echo it as X-CSRFToken;
/// the session cookie is harmless here (the jar is the real source of truth).
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
    // Guess the content-type from the file actually served, not the request path
    // (root "/" serves index.html → must be text/html, not octet-stream).
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

/// Upgrade a webview WebSocket and bridge it to the cloud's wss:// endpoint,
/// forwarding the proxy jar's session cookie + a trusted Origin so Channels
/// authenticates the connection. Used for jam/playlist/notification sockets.
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
