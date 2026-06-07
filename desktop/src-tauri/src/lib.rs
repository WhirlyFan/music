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
    extract::State,
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
            let state = AppState { client };

            // Bind first so we know the port before pointing the window at it.
            let listener = tauri::async_runtime::block_on(async {
                tokio::net::TcpListener::bind("127.0.0.1:0").await
            })
            .expect("bind local proxy");
            let port = listener.local_addr().expect("local_addr").port();
            log::info!("local proxy listening on 127.0.0.1:{port}");

            let router = Router::new().fallback(handle).with_state(state);
            tauri::async_runtime::spawn(async move {
                if let Err(e) = axum::serve(listener, router).await {
                    log::error!("local proxy server exited: {e}");
                }
            });

            let url = format!("http://127.0.0.1:{port}/");
            let oauth_jar = jar.clone();
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External(url.parse().expect("proxy url")),
            )
            .title("WhirlyFan")
            .inner_size(1280.0, 800.0)
            .min_inner_size(900.0, 600.0)
            .center()
            // OAuth harvest: Google login can't complete through the proxy (the
            // cross-domain bounce to Google + back to the prod callback bypasses
            // it). So the desktop "sign in" sends the webview to the prod site,
            // where the full flow works; when it lands back on an authenticated
            // prod page we lift the `sessionid` cookie into the proxy jar and
            // return to the local app — now authenticated, with no backend change.
            .on_page_load(move |webview, payload| {
                if payload.event() != tauri::webview::PageLoadEvent::Finished {
                    return;
                }
                let u = payload.url();
                if u.host_str() != Some("music.whirlyfan.com") {
                    return;
                }
                let path = u.path();
                // Pre-auth / in-flight pages have no usable session yet.
                if path == "/login"
                    || path == "/signup"
                    || path.starts_with("/account")
                    || path.starts_with("/_allauth")
                    || path.starts_with("/accounts")
                {
                    return;
                }
                let Ok(cookies) = webview.cookies_for_url(u.clone()) else {
                    return;
                };
                let Some(sess) = cookies.iter().find(|c| c.name() == "sessionid") else {
                    return; // not authenticated yet — let the page be
                };
                let api: reqwest::Url = "https://api.whirlyfan.com/".parse().unwrap();
                oauth_jar.add_cookie_str(&format!("sessionid={}; Path=/", sess.value()), &api);
                log::info!("harvested prod session into proxy jar; returning to local app");
                if let Ok(local) = format!("http://127.0.0.1:{port}/").parse() {
                    let _ = webview.navigate(local);
                }
            })
            .build()?;
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
