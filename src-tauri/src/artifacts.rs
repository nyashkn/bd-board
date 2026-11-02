//! Reads project files (docs, images) for the artifact viewer, confined to the project root.

use serde::Serialize;
use std::path::Path;

const ARTIFACT_MAX_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Serialize, Debug)]
pub struct ArtifactFile {
    pub kind: String,
    pub content: String,
    pub bytes: u64,
    pub mtime: i64,
}

fn base64_encode(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let n = chunk
            .iter()
            .enumerate()
            .fold(0u32, |a, (i, b)| a | (*b as u32) << (16 - 8 * i));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(T[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

// (kind, mime for images) by extension; None = not allowed.
fn artifact_type(path: &Path) -> Option<(&'static str, Option<&'static str>)> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "md" => ("markdown", None),
        "html" | "htm" => ("html", None),
        "txt" => ("text", None),
        "json" => ("json", None),
        "png" => ("image", Some("image/png")),
        "jpg" | "jpeg" => ("image", Some("image/jpeg")),
        "gif" => ("image", Some("image/gif")),
        "svg" => ("image", Some("image/svg+xml")),
        _ => return None,
    })
}

/// Reads one artifact from inside `root`; refuses absolute paths, `..`,
/// symlink escapes, other extensions and files over 2 MB.
pub(crate) fn read_artifact_inner(root: &Path, rel: &str) -> Result<ArtifactFile, String> {
    if rel.is_empty() || rel.contains('\0') {
        return Err("Invalid path".into());
    }
    if Path::new(rel).is_absolute() || rel.starts_with('/') || rel.starts_with('\\') {
        return Err("Path must be relative to the project".into());
    }
    artifact_type(Path::new(rel)).ok_or("File type not allowed")?;
    let real_root = root.canonicalize().map_err(|e| e.to_string())?;
    let real = real_root
        .join(rel)
        .canonicalize()
        .map_err(|_| "File not found".to_string())?;
    if !real.starts_with(&real_root) {
        return Err("Path escapes the project".into());
    }
    let (kind, mime) = artifact_type(&real).ok_or("File type not allowed")?;
    let meta = std::fs::metadata(&real).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("Not a file".into());
    }
    if meta.len() > ARTIFACT_MAX_BYTES {
        return Err("File is larger than 2 MB".into());
    }
    let data = std::fs::read(&real).map_err(|e| e.to_string())?;
    let content = match mime {
        Some(m) => format!("data:{};base64,{}", m, base64_encode(&data)),
        None => String::from_utf8_lossy(&data).into_owned(),
    };
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    Ok(ArtifactFile {
        kind: kind.to_string(),
        content,
        bytes: meta.len(),
        mtime,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn artifact_reads_and_confines() {
        let base = std::env::temp_dir().join(format!("bd-art-{}", std::process::id()));
        let root = base.join("proj");
        std::fs::create_dir_all(root.join("docs")).unwrap();
        std::fs::write(root.join("docs/a.png"), [1u8, 2, 3]).unwrap();
        std::fs::write(base.join("secret.md"), "s").unwrap();
        std::fs::write(root.join("docs/run.sh"), "x").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(base.join("secret.md"), root.join("docs/link.md")).unwrap();

        let png = read_artifact_inner(&root, "docs/a.png").unwrap();
        assert_eq!(png.content, "data:image/png;base64,AQID");
        assert!(read_artifact_inner(&root, "../secret.md").is_err());
        assert!(read_artifact_inner(&root, base.join("secret.md").to_str().unwrap()).is_err());
        assert!(read_artifact_inner(&root, "docs/run.sh").is_err());
        #[cfg(unix)]
        assert!(read_artifact_inner(&root, "docs/link.md").is_err());
        std::fs::remove_dir_all(&base).ok();
    }
}
