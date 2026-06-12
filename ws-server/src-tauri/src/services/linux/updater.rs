use serde::{Deserialize, Serialize};

const GITHUB_API_URL: &str =
    "https://api.github.com/repos/girlglock/input-overlay/releases/latest";

#[derive(Debug, Serialize, Clone)]
pub struct UpdateInfo {
    pub version: String,
    pub release_url: String,
    pub download_url: String,
    pub body: String,
}

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
    html_url: String,
    body: Option<String>,
}

fn parse_ver(v: &str) -> (u32, u32, u32) {
    let s = v.trim_start_matches('v');
    let mut p = s.splitn(3, '.');
    let n = |x: Option<&str>| x.and_then(|s| s.parse().ok()).unwrap_or(0u32);
    (n(p.next()), n(p.next()), n(p.next()))
}

pub async fn check(current_version: &str, dismissed: &[String]) -> Option<UpdateInfo> {
    let client = reqwest::Client::builder()
        .user_agent("input-overlay-ws")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .ok()?;

    let release: GithubRelease = client
        .get(GITHUB_API_URL)
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json()
        .await
        .ok()?;

    let version = release.tag_name.trim_start_matches('v').to_string();

    if parse_ver(&version) <= parse_ver(current_version) {
        return None;
    }
    if dismissed.iter().any(|d| d == &version) {
        return None;
    }

    Some(UpdateInfo {
        version,
        release_url: release.html_url,
        download_url: String::new(),
        body: release.body.unwrap_or_default(),
    })
}
