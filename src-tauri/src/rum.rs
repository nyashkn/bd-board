//! Opt-in OpenObserve RUM config for the desktop webview: `~/.config/bd-board/rum.json`,
//! written by the owner. The webview validates it; this only reads it, so a missing file is
//! "RUM off" and no network is touched here.

use serde_json::{Map, Value};
use std::fs;
use std::path::PathBuf;

pub fn rum_config_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "cannot locate home directory".to_string())?;
    Ok(PathBuf::from(home)
        .join(".config")
        .join("bd-board")
        .join("rum.json"))
}

/// A JSON object from `raw`, with `userName` filled from `author` when the file has none.
/// Anything that is not a JSON object is an error the caller turns into "off".
pub fn parse_rum_config(raw: &str, author: Option<&str>) -> Result<Value, String> {
    let mut value: Value =
        serde_json::from_str(raw).map_err(|err| format!("rum.json is not valid JSON: {err}"))?;
    let obj: &mut Map<String, Value> = value
        .as_object_mut()
        .ok_or_else(|| "rum.json must be a JSON object".to_string())?;
    let has_user = obj
        .get("userName")
        .and_then(Value::as_str)
        .is_some_and(|s| !s.trim().is_empty());
    if !has_user {
        if let Some(name) = author.map(str::trim).filter(|s| !s.is_empty()) {
            obj.insert("userName".into(), Value::String(name.to_string()));
        }
    }
    Ok(value)
}

/// `null` when there is no file (RUM off); the object otherwise.
pub fn load_rum_config() -> Result<Value, String> {
    let path = rum_config_path()?;
    if !path.exists() {
        return Ok(Value::Null);
    }
    let raw = fs::read_to_string(&path).map_err(|err| format!("failed to read rum.json: {err}"))?;
    parse_rum_config(&raw, std::env::var("BD_BOARD_AUTHOR").ok().as_deref())
}

#[tauri::command]
pub fn rum_config() -> Result<Value, String> {
    load_rum_config()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passes_the_object_through() {
        let v = parse_rum_config(r#"{"enabled":true,"site":"o2.example.com"}"#, None).unwrap();
        assert_eq!(v["enabled"], true);
        assert_eq!(v["site"], "o2.example.com");
        assert!(v.get("userName").is_none());
    }

    #[test]
    fn fills_user_name_from_author_only_when_absent() {
        let v = parse_rum_config(r#"{"enabled":true}"#, Some(" kn ")).unwrap();
        assert_eq!(v["userName"], "kn");
        let v = parse_rum_config(r#"{"userName":"me"}"#, Some("kn")).unwrap();
        assert_eq!(v["userName"], "me");
        let v = parse_rum_config(r#"{}"#, Some("  ")).unwrap();
        assert!(v.get("userName").is_none());
    }

    #[test]
    fn rejects_bad_json_and_non_objects() {
        assert!(parse_rum_config("{nope", None).is_err());
        assert!(parse_rum_config("[1]", None).is_err());
        assert!(parse_rum_config("\"x\"", None).is_err());
    }
}
