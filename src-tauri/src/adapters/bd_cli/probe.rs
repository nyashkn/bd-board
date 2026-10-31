//! `bd where` (registry probe) and `bd dolt show` (connector selection probe).

use super::exec::{apply_probe_concurrency, bd_error_message, exec_bd_prio, run_bd_prio};
use super::queue::Priority;
use crate::domain::{BeadsLocation, DoltProbe};
use crate::registry;
use serde_json::Value;
use std::path::Path;

pub(crate) fn probe_beads_location(dir: &Path) -> Result<BeadsLocation, String> {
    probe_beads_location_prio(dir, Priority::User)
}

pub(crate) fn probe_beads_location_prio(
    dir: &Path,
    priority: Priority,
) -> Result<BeadsLocation, String> {
    let raw = run_bd_prio(dir, &["where", "--json"], priority)?;
    let value: Value = serde_json::from_str(&raw)
        .map_err(|err| format!("failed to parse bd where output: {err}"))?;

    let beads_path = value
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| "bd where returned no beads path".to_string())?
        .to_string();

    let database_path = value
        .get("database_path")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let prefix = value
        .get("prefix")
        .and_then(Value::as_str)
        .map(|s| s.to_string());

    // Determine if beads is external (outside the project folder)
    let expected_beads_path = dir.join(".beads");
    let external = match (
        std::fs::canonicalize(&beads_path),
        std::fs::canonicalize(&expected_beads_path),
    ) {
        (Ok(canonical_beads), Ok(canonical_expected)) => canonical_beads != canonical_expected,
        _ => beads_path != expected_beads_path.to_string_lossy(),
    };

    Ok(BeadsLocation {
        beads_path,
        database_path,
        prefix,
        external,
    })
}

/// Parses `bd dolt show --json` defensively: anything unexpected is an error, never a guess.
pub(crate) fn parse_dolt_show(stdout: &str, sources: Vec<String>) -> DoltProbe {
    let Ok(Value::Object(o)) = serde_json::from_str::<Value>(stdout) else {
        return DoltProbe::error("bd dolt show did not print a JSON object", sources);
    };
    let Some(embedded) = o.get("embedded").and_then(Value::as_bool) else {
        return DoltProbe::error("bd dolt show printed an unexpected shape", sources);
    };
    let text = |k: &str| o.get(k).and_then(Value::as_str).map(String::from);
    DoltProbe {
        embedded: Some(embedded),
        host: text("host"),
        port: o
            .get("port")
            .and_then(Value::as_u64)
            .and_then(|p| u16::try_from(p).ok()),
        database: text("database"),
        connection_ok: o.get("connection_ok").and_then(Value::as_bool),
        schema_version: o.get("schema_version").and_then(Value::as_i64),
        error: None,
        sources,
        user: text("user"),
        tls: o.get("tls").and_then(Value::as_bool),
    }
}
pub(crate) const DOLT_PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

/// Which Dolt mode is this project in (`bd dolt show --json`), plus its registry `sources`.
/// Never fails: an error or a 2 s timeout (queued like any bd call, and the process is killed)
/// comes back in `error`. Not `probe_location` (the registry probe).
pub(crate) fn probe_dolt_mode(project_id: &str) -> DoltProbe {
    let entry = match registry::find(project_id) {
        Ok(entry) => entry,
        Err(err) => return DoltProbe::error(err, vec![]),
    };
    let sources = entry.sources.clone();
    if !sources.is_empty() {
        return DoltProbe::error("not probed: explicit sources", sources);
    }
    let dir = Path::new(&entry.path);
    match exec_bd_prio(
        dir,
        &["dolt", "show", "--json"],
        DOLT_PROBE_TIMEOUT,
        Priority::Background,
    ) {
        Ok(cap) if cap.status.success() => {
            let probe = parse_dolt_show(&cap.stdout, sources);
            if probe.error.is_none() {
                apply_probe_concurrency(dir, probe.embedded, probe.connection_ok);
            }
            probe
        }
        Ok(cap) => DoltProbe::error(
            bd_error_message(&cap.stdout, &cap.stderr, &cap.status),
            sources,
        ),
        Err(err) => DoltProbe::error(err, sources),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_embedded_mode() {
        let p = parse_dolt_show(
            r#"{"backend":"dolt","data_dir":"/d","database":"hq","embedded":true,"schema_version":9}"#,
            vec![],
        );
        assert_eq!(p.embedded, Some(true));
        assert_eq!(p.database.as_deref(), Some("hq"));
        assert_eq!(p.schema_version, Some(9));
        assert_eq!(
            (p.host, p.port, p.connection_ok, p.error),
            (None, None, None, None)
        );
    }

    #[test]
    fn parses_server_mode() {
        let p = parse_dolt_show(
            r#"{"backend":"dolt","connection_ok":true,"database":"hq","embedded":false,"host":"127.0.0.1","port":61687,"schema_version":1,"shared_server":false,"tls":false,"user":"root"}"#,
            vec!["bd:".into()],
        );
        assert_eq!(p.embedded, Some(false));
        assert_eq!(p.host.as_deref(), Some("127.0.0.1"));
        assert_eq!(p.port, Some(61687));
        assert_eq!(p.connection_ok, Some(true));
        assert_eq!(p.sources, vec!["bd:".to_string()]);
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["connectionOk"], true);
        assert!(v.get("error").is_none());
    }

    #[test]
    fn garbage_becomes_an_error_that_keeps_sources() {
        for raw in [
            "",
            "not json",
            "[]",
            r#"{"embedded":"yes"}"#,
            r#"{"host":"x"}"#,
        ] {
            let p = parse_dolt_show(raw, vec!["bd:".into()]);
            assert!(p.error.is_some(), "{raw}");
            assert_eq!(p.embedded, None);
            assert_eq!(p.sources, vec!["bd:".to_string()]);
        }
    }
}
