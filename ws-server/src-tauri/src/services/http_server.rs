use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

#[derive(rust_embed::Embed)]
#[folder = "$CARGO_MANIFEST_DIR/web-bundle"]
struct WebAssets;

pub struct HttpServer {
    _stop_tx: oneshot::Sender<()>,
}

impl HttpServer {
    pub fn start(host: &str, port: u16, data_dir: &Path) -> Option<Self> {
        let (stop_tx, stop_rx) = oneshot::channel();
        let bind_addr = format!("{host}:{port}");
        let media_dir = user_media_dir(data_dir);
        let _ = std::fs::create_dir_all(&media_dir);
        tauri::async_runtime::spawn(run(bind_addr, stop_rx, media_dir));
        Some(HttpServer { _stop_tx: stop_tx })
    }
}

fn user_media_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("user-media")
}

async fn run(bind_addr: String, mut stop_rx: oneshot::Receiver<()>, media_dir: PathBuf) {
    let listener = match TcpListener::bind(&bind_addr).await {
        Ok(l) => {
            tracing::info!("http: listening on http://{bind_addr}");
            l
        }
        Err(e) => {
            tracing::error!("http: failed to bind {bind_addr}: {e}");
            return;
        }
    };
    loop {
        tokio::select! {
            _ = &mut stop_rx => break,
            res = listener.accept() => match res {
                Ok((stream, addr)) => {
                    let media_dir = media_dir.clone();
                    tokio::spawn(serve(stream, addr, media_dir));
                }
                Err(e) => tracing::warn!("http: accept error: {e}"),
            }
        }
    }
    tracing::info!("http: server stopped");
}

async fn serve(stream: tokio::net::TcpStream, _addr: SocketAddr, media_dir: PathBuf) {
    let (read_half, mut write_half) = stream.into_split();
    let mut reader = BufReader::new(read_half);

    let mut request_line = String::new();
    if reader.read_line(&mut request_line).await.is_err() { return; }

    let mut headers = HashMap::new();
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line).await {
            Ok(0) | Err(_) => return,
            Ok(_) if line == "\r\n" || line == "\n" => break,
            _ => {
                if let Some((k, v)) = line.split_once(':') {
                    headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
                }
            }
        }
    }

    let mut parts = request_line.split_whitespace();
    let method   = parts.next().unwrap_or("");
    let raw_path = parts.next().unwrap_or("/");

    let path = raw_path.split('?').next().unwrap_or("/");
    let rel  = path.trim_start_matches('/');

    match method {
        "POST" if rel == "upload" => handle_upload(&mut reader, &headers, &media_dir, &mut write_half).await,
        "GET" => handle_get(rel, &media_dir, &mut write_half).await,
        _ => respond_err(&mut write_half, 404).await,
    }
}

async fn handle_get(rel: &str, media_dir: &PathBuf, write_half: &mut tokio::net::tcp::OwnedWriteHalf) {
    if let Some(name) = rel.strip_prefix("user-media/") {
        if name.is_empty() || name.contains("..") || name.contains('/') || name.contains('\\') {
            respond_err(write_half, 403).await;
            return;
        }
        match tokio::fs::read(media_dir.join(name)).await {
            Ok(body) => {
                tracing::debug!("http: 200 /user-media/{name}");
                write_response(write_half, 200, "OK", mime_of(name), &body).await;
            }
            Err(_) => {
                tracing::debug!("http: 404 /user-media/{name}");
                respond_err(write_half, 404).await;
            }
        }
        return;
    }

    let key = if rel.is_empty() { "index.html".into() } else { rel.to_string() };
    let asset = WebAssets::get(&key).or_else(|| WebAssets::get(&format!("{key}/index.html")));
    match asset {
        Some(file) => {
            let body = file.data.as_ref();
            tracing::debug!("http: 200 {rel}");
            write_response(write_half, 200, "OK", mime_of(&key), body).await;
        }
        None => {
            tracing::debug!("http: 404 {rel}");
            respond_err(write_half, 404).await;
        }
    }
}

async fn handle_upload(
    reader: &mut BufReader<tokio::net::tcp::OwnedReadHalf>,
    headers: &HashMap<String, String>,
    media_dir: &PathBuf,
    write_half: &mut tokio::net::tcp::OwnedWriteHalf,
) {
    let content_length: usize = headers
        .get("content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    const MAX_UPLOAD_BYTES: usize = 500 * 1024 * 1024;
    if content_length == 0 || content_length > MAX_UPLOAD_BYTES {
        respond_err(write_half, 413).await;
        return;
    }

    let mut body = vec![0u8; content_length];
    if reader.read_exact(&mut body).await.is_err() {
        respond_err(write_half, 400).await;
        return;
    }

    let ext = headers
        .get("x-filename")
        .and_then(|v| urldecode(v))
        .and_then(|name| name.rsplit('.').next().map(|s| s.to_ascii_lowercase()))
        .filter(|ext| ext.len() <= 5 && ext.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or_else(|| "bin".to_string());

    use rand::Rng;
    let name: String = rand::thread_rng()
        .sample_iter(rand::distributions::Alphanumeric)
        .take(24)
        .map(char::from)
        .collect();
    let filename = format!("{name}.{ext}");

    if tokio::fs::write(media_dir.join(&filename), &body).await.is_err() {
        respond_err(write_half, 500).await;
        return;
    }

    tracing::info!("http: uploaded background -> /user-media/{filename}");
    let json = format!("{{\"url\":\"/user-media/{filename}\"}}");
    write_response(write_half, 200, "OK", "application/json", json.as_bytes()).await;
}

async fn write_response(
    w: &mut tokio::net::tcp::OwnedWriteHalf,
    code: u16,
    text: &str,
    mime: &str,
    body: &[u8],
) {
    let header = format!(
        "HTTP/1.0 {code} {text}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = w.write_all(header.as_bytes()).await;
    let _ = w.write_all(body).await;
}

async fn respond_err(w: &mut tokio::net::tcp::OwnedWriteHalf, code: u16) {
    let (text, body): (&str, &[u8]) = match code {
        400 => ("Bad Request",           b"400 Bad Request"),
        403 => ("Forbidden",             b"403 Forbidden"),
        404 => ("Not Found",             b"404 Not Found"),
        413 => ("Payload Too Large",     b"413 Payload Too Large"),
        500 => ("Internal Server Error", b"500 Internal Server Error"),
        _   => ("Error",                 b"Error"),
    };
    let resp = format!(
        "HTTP/1.0 {code} {text}\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = w.write_all(resp.as_bytes()).await;
    let _ = w.write_all(body).await;
}

fn urldecode(s: &str) -> Option<String> {
    let mut out = Vec::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?;
                out.push(u8::from_str_radix(hex, 16).ok()?);
                i += 3;
            }
            b'+' => { out.push(b' '); i += 1; }
            b => { out.push(b); i += 1; }
        }
    }
    String::from_utf8(out).ok()
}

fn mime_of(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" | "htm" => "text/html; charset=utf-8",
        "css"          => "text/css",
        "js"           => "application/javascript",
        "json"         => "application/json",
        "png"          => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif"          => "image/gif",
        "svg"          => "image/svg+xml",
        "ico"          => "image/x-icon",
        "webp"         => "image/webp",
        "woff"         => "font/woff",
        "woff2"        => "font/woff2",
        "ttf"          => "font/ttf",
        "txt"          => "text/plain; charset=utf-8",
        "mp4"          => "video/mp4",
        "webm"         => "video/webm",
        "ogg" | "ogv"  => "video/ogg",
        _              => "application/octet-stream",
    }
}
