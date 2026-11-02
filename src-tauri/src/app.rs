//! Connector selection. Commands call in here; this picks the adapter behind each port.
//! The snapshot store itself lives in the client; the adapter coalesces concurrent `snapshot` calls.
//!
//! Which source a project reads from is decided by the client's router (explicit `sources`, then a
//! probe, then fallback); the SQL reader has its own commands, so `source_for` stays bd-cli.

use crate::adapters::bd_cli::BdCli;
use crate::ports::{BeadSink, BeadSource, ProjectAdmin};
use crate::registry;
use std::sync::Arc;

/// `bd` binary candidates, for the desktop probe in lib.rs.
pub(crate) use crate::adapters::bd_cli::bd_candidates;
/// Managed Tauri state for the live change feeds.
pub use crate::adapters::bd_cli::FeedWatches;
/// Managed Tauri state for the SQL change probes.
pub use crate::adapters::dolt_sql::DoltWatches;

pub(crate) fn source_for(_project_id: &str) -> Arc<dyn BeadSource> {
    Arc::new(BdCli)
}

/// The SQL reader: one adapter (and one pooled connection) per project.
#[cfg(feature = "dolt-sql")]
pub(crate) fn sql_source_for(project_id: &str) -> Result<Arc<dyn BeadSource>, String> {
    Ok(crate::adapters::dolt_sql::handle_for(project_id)?)
}

#[cfg(not(feature = "dolt-sql"))]
pub(crate) fn sql_source_for(_project_id: &str) -> Result<Arc<dyn BeadSource>, String> {
    Err("source unavailable (dolt-sql): not built into this app".to_string())
}

/// Drops what a project's adapters hold (the SQL connection) when it is removed, moved or renamed.
pub(crate) fn forget_project(project_id: &str) {
    #[cfg(feature = "dolt-sql")]
    crate::adapters::dolt_sql::forget(project_id);
    #[cfg(not(feature = "dolt-sql"))]
    let _ = project_id;
}

/// The only way to a sink: a read-only project is refused here, so a new write operation cannot
/// forget the check.
pub(crate) fn sink_for(project_id: &str) -> Result<&'static dyn BeadSink, String> {
    registry::check_writable(&registry::find(project_id)?)?;
    Ok(&BdCli)
}

pub(crate) fn admin() -> &'static dyn ProjectAdmin {
    &BdCli
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// HOME is process-wide: one test at a time may point it elsewhere.
    static HOME_LOCK: Mutex<()> = Mutex::new(());

    fn with_registry<T>(json: &str, f: impl FnOnce() -> T) -> T {
        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = std::env::temp_dir().join(format!("bdb-app-{}", std::process::id()));
        std::fs::create_dir_all(home.join(".config/bd-board")).unwrap();
        std::fs::write(home.join(".config/bd-board/projects.json"), json).unwrap();
        let old = std::env::var_os("HOME");
        std::env::set_var("HOME", &home);
        let out = f();
        match old {
            Some(v) => std::env::set_var("HOME", v),
            None => std::env::remove_var("HOME"),
        }
        let _ = std::fs::remove_dir_all(&home);
        out
    }

    #[test]
    fn a_readonly_project_never_yields_a_sink() {
        let json = r#"{"version":1,"projects":[
            {"id":"ro","path":"/nowhere","label":"RO","readonly":true},
            {"id":"hub","path":"/nowhere","label":"Hub","sources":["mysql://dolt-hub.example:3306/mydb"]},
            {"id":"rw","path":"/nowhere","label":"RW"},
            {"id":"mixed","path":"/nowhere","label":"Mixed","sources":["mysql://dolt-hub.example:3306/mydb","bd:"]}]}"#;
        with_registry(json, || {
            for id in ["ro", "hub"] {
                let err = sink_for(id).err().expect(id);
                assert!(err.contains("read-only"), "{id}: {err}");
            }
            assert!(sink_for("rw").is_ok() && sink_for("mixed").is_ok());
            assert!(sink_for("missing").is_err());
        });
    }
}
