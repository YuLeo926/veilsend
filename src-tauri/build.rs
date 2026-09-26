fn main() {
    println!("cargo:rerun-if-env-changed=VEILSEND_GIT_SHA");
    println!("cargo:rerun-if-env-changed=VEILSEND_RELEASE_CHANNEL");
    println!(
        "cargo:rustc-env=VEILSEND_GIT_SHA={}",
        std::env::var("VEILSEND_GIT_SHA").unwrap_or_default()
    );
    println!(
        "cargo:rustc-env=VEILSEND_RELEASE_CHANNEL={}",
        std::env::var("VEILSEND_RELEASE_CHANNEL").unwrap_or_default()
    );
    tauri_build::build();
}
