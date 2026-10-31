use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone)]
pub struct RegistryEntry {
    pub id: String,
    pub path: String,
    pub label: String,
    /// Optional: bd runs through the read-only shim and the UI blocks writes.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub readonly: bool,
    /// Optional, only honoured together with `readonly`.
    #[serde(
        default,
        rename = "filterLabel",
        skip_serializing_if = "Option::is_none"
    )]
    pub filter_label: Option<String>,
    /// Optional, ordered: connector URLs (`bd:`, `mysql://`, `https://`) tried first to last.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sources: Vec<String>,
    /// Optional: the name of the environment variable that holds an http-snapshot reader token.
    /// The desktop shell does not read it; it is kept so a registry rewrite does not drop it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credentials_ref: Option<String>,
}

/// The URL schemes a `sources` entry may use (see src/lib/connectors/select.ts).
const SOURCE_SCHEMES: [&str; 3] = ["bd:", "mysql://", "https://"];

impl RegistryEntry {
    /// The filter label that applies: only a readonly project is filtered.
    pub fn effective_filter_label(&self) -> Option<String> {
        if self.readonly {
            self.filter_label.clone()
        } else {
            None
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Registry {
    pub version: u32,
    pub projects: Vec<RegistryEntry>,
}

pub fn registry_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "cannot locate home directory".to_string())?;

    Ok(PathBuf::from(home)
        .join(".config")
        .join("bd-board")
        .join("projects.json"))
}

pub fn load() -> Result<Registry, String> {
    let path = registry_path()?;

    if !path.exists() {
        return Ok(Registry {
            version: 1,
            projects: vec![],
        });
    }

    let raw = fs::read_to_string(&path).map_err(|err| format!("failed to read registry: {err}"))?;

    let registry: Registry = serde_json::from_str(&raw).map_err(|err| {
        format!(
            "{} is not valid bd board registry JSON: {err}",
            path.display()
        )
    })?;

    parse_checked(registry)
}

/// Rejects what serde cannot: a blank filterLabel or a source with an unknown scheme. Wrong types already fail in serde.
fn parse_checked(mut registry: Registry) -> Result<Registry, String> {
    if registry.version != 1 {
        return Err(format!(
            "unsupported registry version {}; expected 1",
            registry.version
        ));
    }

    for (i, entry) in registry.projects.iter_mut().enumerate() {
        // Never echo the value: a mysql:// URL can carry credentials.
        if let Some(n) = entry
            .sources
            .iter()
            .position(|s| !SOURCE_SCHEMES.iter().any(|p| s.starts_with(p)))
        {
            return Err(format!(
                "registry project #{}: \"sources\" entry #{} must be a bd:, mysql:// or https:// URL",
                i + 1,
                n + 1
            ));
        }
        // Never echo the value: someone may have pasted the token here.
        if let Some(r) = entry.credentials_ref.as_deref() {
            let mut chars = r.chars();
            let ok = chars
                .next()
                .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
                && chars.all(|c| c.is_ascii_alphanumeric() || c == '_');
            if !ok {
                return Err(format!(
                    "registry project #{}: \"credentials_ref\" must be an environment variable name",
                    i + 1
                ));
            }
        }
        if let Some(label) = entry.filter_label.as_mut() {
            *label = label.trim().to_string();
            if label.is_empty() {
                return Err(format!(
                    "registry project #{}: \"filterLabel\" must be a non-empty string",
                    i + 1
                ));
            }
        }
    }

    Ok(registry)
}

pub fn save(registry: &Registry) -> Result<(), String> {
    let path = registry_path()?;
    let parent = path
        .parent()
        .ok_or_else(|| "registry path has no parent".to_string())?;

    fs::create_dir_all(parent)
        .map_err(|err| format!("failed to create registry directory: {err}"))?;

    let tmp_path = parent.join("projects.json.tmp");
    let json = serde_json::to_string_pretty(registry)
        .map_err(|err| format!("failed to serialize registry: {err}"))?;

    fs::write(&tmp_path, json)
        .map_err(|err| format!("failed to write registry temp file: {err}"))?;

    fs::rename(&tmp_path, &path)
        .map_err(|err| format!("failed to move registry temp file: {err}"))?;

    Ok(())
}

pub fn make_id(label: &str, existing: &[RegistryEntry]) -> String {
    let mut id = label
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'a'..='z' | '0'..='9' | '.' | '_' | '-' => c,
            _ => '-',
        })
        .collect::<String>();

    // Collapse repeated dashes
    while id.contains("--") {
        id = id.replace("--", "-");
    }

    // Trim leading/trailing dashes
    id = id.trim_matches('-').to_string();

    if id.is_empty() {
        id = "project".to_string();
    }

    // Check for collisions and append suffix if needed
    let mut final_id = id.clone();
    let mut counter = 2;
    while existing.iter().any(|e| e.id == final_id) {
        final_id = format!("{}-{}", id, counter);
        counter += 1;
    }

    final_id
}

pub fn add(path: &std::path::Path, label: Option<String>) -> Result<RegistryEntry, String> {
    let canonical_path = std::fs::canonicalize(path)
        .map_err(|err| format!("failed to resolve path: {err}"))?
        .to_string_lossy()
        .to_string();

    let mut registry = load()?;

    // Check if entry with same canonical path already exists
    if let Some(existing) = registry.projects.iter().find(|e| e.path == canonical_path) {
        return Ok(existing.clone());
    }

    let folder_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("project");

    let final_label = label.unwrap_or_else(|| folder_name.to_string());
    let id = make_id(&final_label, &registry.projects);

    let entry = RegistryEntry {
        id,
        path: canonical_path,
        label: final_label,
        readonly: false,
        filter_label: None,
        sources: vec![],
        credentials_ref: None,
    };

    registry.projects.push(entry.clone());
    save(&registry)?;

    Ok(entry)
}

pub fn remove(id: &str) -> Result<(), String> {
    let mut registry = load()?;
    let initial_len = registry.projects.len();

    registry.projects.retain(|e| e.id != id);

    if registry.projects.len() == initial_len {
        return Err(format!("unknown project id: {id}"));
    }

    save(&registry)?;
    Ok(())
}

pub fn rename(id: &str, new_label: String) -> Result<RegistryEntry, String> {
    let mut registry = load()?;

    // Find and update the project
    for entry in &mut registry.projects {
        if entry.id == id {
            entry.label = new_label;
            let result = entry.clone();
            save(&registry)?;
            return Ok(result);
        }
    }

    Err(format!("unknown project id: {id}"))
}

pub fn relocate(id: &str, new_path: String) -> Result<RegistryEntry, String> {
    let canonical_path = std::fs::canonicalize(&new_path)
        .map_err(|err| format!("failed to resolve path: {err}"))?
        .to_string_lossy()
        .to_string();

    let mut registry = load()?;

    // Find and update the project path
    for entry in &mut registry.projects {
        if entry.id == id {
            entry.path = canonical_path;
            let result = entry.clone();
            save(&registry)?;
            return Ok(result);
        }
    }

    Err(format!("unknown project id: {id}"))
}

pub fn find(id: &str) -> Result<RegistryEntry, String> {
    let registry = load()?;
    registry
        .projects
        .iter()
        .find(|e| e.id == id)
        .cloned()
        .ok_or_else(|| format!("unknown project id: {id}"))
}

pub(crate) fn resolve_dir(project_id: &str) -> Result<PathBuf, String> {
    let entry = find(project_id)?;
    let path = PathBuf::from(&entry.path);
    if !path.exists() {
        return Err(format!(
            "project directory no longer exists: {}",
            entry.path
        ));
    }
    Ok(path)
}

/// Defence in depth: every write goes through here, so a readonly project refuses before any process runs.
pub(crate) fn resolve_writable_dir(project_id: &str) -> Result<PathBuf, String> {
    check_writable(&find(project_id)?)?;
    resolve_dir(project_id)
}

pub(crate) fn check_writable(entry: &RegistryEntry) -> Result<(), String> {
    if entry.readonly {
        return Err(format!(
            "project \"{}\" is read-only; writes are refused",
            entry.label
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> Result<Registry, String> {
        serde_json::from_str::<Registry>(json)
            .map_err(|e| e.to_string())
            .and_then(parse_checked)
    }

    #[test]
    fn optional_fields_default_off() {
        let r = parse(r#"{"version":1,"projects":[{"id":"a","path":"/p","label":"A"}]}"#).unwrap();
        assert!(!r.projects[0].readonly);
        assert_eq!(r.projects[0].filter_label, None);
    }

    #[test]
    fn parses_readonly_and_trims_filter_label() {
        let r = parse(
            r#"{"version":1,"projects":[{"id":"a","path":"/p","label":"A","readonly":true,"filterLabel":" wo "}]}"#,
        )
        .unwrap();
        assert!(r.projects[0].readonly);
        assert_eq!(r.projects[0].effective_filter_label(), Some("wo".into()));
    }

    #[test]
    fn credentials_ref_is_kept_and_must_be_a_variable_name() {
        let ok = r#"{"version":1,"projects":[{"id":"a","path":"/p","label":"A","credentials_ref":"SNAP_TOKEN"}]}"#;
        let r = parse(ok).unwrap();
        assert_eq!(r.projects[0].credentials_ref.as_deref(), Some("SNAP_TOKEN"));
        assert!(serde_json::to_string(&r).unwrap().contains("credentials_ref"));
        let bad = r#"{"version":1,"projects":[{"id":"a","path":"/p","label":"A","credentials_ref":"s3cret-token"}]}"#;
        let err = parse(bad).err().unwrap();
        assert!(!err.contains("s3cret"));
    }

    #[test]
    fn filter_label_without_readonly_is_not_effective() {
        let r = parse(
            r#"{"version":1,"projects":[{"id":"a","path":"/p","label":"A","filterLabel":"wo"}]}"#,
        )
        .unwrap();
        assert_eq!(r.projects[0].effective_filter_label(), None);
    }

    #[test]
    fn rejects_wrong_types_and_blank_label() {
        assert!(parse(
            r#"{"version":1,"projects":[{"id":"a","path":"/p","label":"A","readonly":"yes"}]}"#
        )
        .is_err());
        assert!(parse(
            r#"{"version":1,"projects":[{"id":"a","path":"/p","label":"A","filterLabel":3}]}"#
        )
        .is_err());
        assert!(parse(
            r#"{"version":1,"projects":[{"id":"a","path":"/p","label":"A","filterLabel":"  "}]}"#
        )
        .is_err());
    }

    #[test]
    fn roundtrip_keeps_optional_fields_and_omits_defaults() {
        let r = parse(
            r#"{"version":1,"projects":[{"id":"a","path":"/p","label":"A","readonly":true,"filterLabel":"wo"},{"id":"b","path":"/q","label":"B"}]}"#,
        )
        .unwrap();
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["projects"][0]["readonly"], true);
        assert_eq!(v["projects"][0]["filterLabel"], "wo");
        assert!(v["projects"][1].get("readonly").is_none());
        assert!(v["projects"][1].get("filterLabel").is_none());
    }

    #[test]
    fn sources_default_empty_and_round_trip_in_order() {
        let r = parse(r#"{"version":1,"projects":[{"id":"a","path":"/p","label":"A"}]}"#).unwrap();
        assert!(r.projects[0].sources.is_empty());
        assert!(serde_json::to_value(&r).unwrap()["projects"][0]
            .get("sources")
            .is_none());

        let r = parse(
            r#"{"version":1,"projects":[{"id":"a","path":"/p","label":"A","sources":["mysql://127.0.0.1:3307/db","bd:"]}]}"#,
        )
        .unwrap();
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(
            v["projects"][0]["sources"],
            serde_json::json!(["mysql://127.0.0.1:3307/db", "bd:"])
        );
    }

    #[test]
    fn rejects_bad_sources() {
        for bad in [r#"["ftp://x"]"#, r#""bd:""#, r#"[3]"#] {
            let json = format!(
                r#"{{"version":1,"projects":[{{"id":"a","path":"/p","label":"A","sources":{bad}}}]}}"#
            );
            assert!(parse(&json).is_err(), "{bad}");
        }

        let leak = r#"{"version":1,"projects":[{"id":"a","path":"/p","label":"A","sources":["postgres://u:secret@h/d"]}]}"#;
        let err = parse(leak).err().unwrap();
        assert!(err.contains("entry #1") && !err.contains("secret"), "{err}");
    }

    #[test]
    fn writes_are_refused_for_readonly_projects_only() {
        let entry = |readonly| RegistryEntry {
            id: "p".into(),
            path: "/p".into(),
            label: "P".into(),
            readonly,
            filter_label: None,
            sources: vec![],
            credentials_ref: None,
        };
        assert!(check_writable(&entry(false)).is_ok());
        let err = check_writable(&entry(true)).unwrap_err();
        assert!(err.contains("read-only"));
    }
}
