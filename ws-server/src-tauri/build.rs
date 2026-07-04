use std::path::Path;

fn main() {
    tauri_build::build();
    stage_web_assets();
}

fn stage_web_assets() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let repo_root = Path::new(&manifest_dir)
        .join("../..")
        .canonicalize()
        .expect("failed to resolve repo root");
    let staging = Path::new(&manifest_dir).join("web-bundle");

    println!(
        "cargo:rerun-if-changed={}",
        repo_root.join("index.html").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        repo_root.join("style.css").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        repo_root.join("scripts").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        repo_root.join("media/favicon.png").display()
    );

    if staging.exists() {
        std::fs::remove_dir_all(&staging).unwrap();
    }
    std::fs::create_dir_all(&staging).unwrap();

    std::fs::copy(repo_root.join("index.html"), staging.join("index.html")).unwrap();
    std::fs::copy(repo_root.join("style.css"), staging.join("style.css")).unwrap();
    copy_dir(&repo_root.join("scripts"), &staging.join("scripts"));

    std::fs::create_dir_all(staging.join("media")).unwrap();
    std::fs::copy(
        repo_root.join("media/favicon.png"),
        staging.join("media/favicon.png"),
    )
    .unwrap();
}

fn copy_dir(src: &Path, dst: &Path) {
    std::fs::create_dir_all(dst).unwrap();
    for entry in std::fs::read_dir(src).unwrap() {
        let entry = entry.unwrap();
        let dst_path = dst.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &dst_path);
        } else {
            std::fs::copy(entry.path(), dst_path).unwrap();
        }
    }
}
