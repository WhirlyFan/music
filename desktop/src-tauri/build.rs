fn main() {
    // The Google OAuth client id is baked at compile time via option_env!. Tell cargo
    // to rebuild when it changes so `doppler run -- pnpm tauri build` re-bakes it.
    println!("cargo:rerun-if-env-changed=GOOGLE_OAUTH_CLIENT_ID");
    tauri_build::build()
}
