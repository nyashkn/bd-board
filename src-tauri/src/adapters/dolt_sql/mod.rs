//! The dolt-sql adapter: reads a project's beads over SQL from a Dolt sql-server, read-only.
//! Writes never come through here; they stay on the bd CLI. One connection per project, kept
//! open, and a snapshot is a single round trip (see `session::tables`), so a remote hub at
//! 290 ms costs about one RTT per refresh plus one per change probe.

mod creds;
mod feed;
mod session;

use crate::adapters::bd_cli;
use crate::domain::bd_json::{map_bead, map_comment};
use crate::domain::bead::RelatedBead;
use crate::domain::dolt::{check_transport, parse_mysql_url, DoltUrl};
use crate::domain::dolt_rows::{
    export_lines, iso_utc, sql_snapshot, CommentRow, DoltTables, IssueRow,
};
use crate::domain::graph::{apply_links, derive_children};
use crate::domain::knowledge::build_project_knowledge;
use crate::domain::CredentialsRef;
use crate::domain::{Bead, BeadDetail, Comment, ProjectKnowledge, ProjectSnapshot};
use crate::ports::BeadSource;
use crate::registry;
use serde_json::Value;
use session::{misconfigured, unavailable, Session, Target};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

pub(crate) use feed::watch_loop;
pub use feed::DoltWatches;

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// One project's connection. Lazily opened, reopened once if it went stale, shared by the
/// snapshot reads and the change probe (so a project holds one connection).
pub(crate) struct DoltSql {
    project_id: String,
    session: Mutex<Option<Open>>,
}

/// A live connection and the registry entry it was opened for: if the entry is edited (sources,
/// credentials, path) the connection is dropped and the next call reconnects with the new one.
struct Open {
    entry: String,
    session: Session,
}

/// Forget a project's adapter (and its connection): it was removed, moved or renamed.
pub(crate) fn forget(project_id: &str) {
    static_handles().remove(project_id);
}

fn static_handles() -> std::sync::MutexGuard<'static, HashMap<String, Arc<DoltSql>>> {
    static HANDLES: OnceLock<Mutex<HashMap<String, Arc<DoltSql>>>> = OnceLock::new();
    lock(HANDLES.get_or_init(Default::default))
}

/// The adapter for a project, created on first use and kept for the session.
pub(crate) fn handle_for(project_id: &str) -> Result<Arc<DoltSql>, String> {
    let mut map = static_handles();
    Ok(map
        .entry(project_id.to_string())
        .or_insert_with(|| {
            Arc::new(DoltSql {
                project_id: project_id.to_string(),
                session: Mutex::new(None),
            })
        })
        .clone())
}

/// Which server, and as whom. An explicit `mysql://` source wins; with no `sources` at all the
/// server is whatever `bd dolt show` reports for a local server-mode project.
fn resolve_target(project_id: &str) -> Result<Target, String> {
    let entry = registry::find(project_id).map_err(|_| unavailable("project is not registered"))?;
    let env = |k: &str| std::env::var(k).ok();
    let read = |p: &std::path::Path| std::fs::read_to_string(p).ok();
    let (url, bd_user, bd_tls, from_bd_probe) =
        if let Some(source) = entry.sources.iter().find(|s| s.starts_with("mysql://")) {
            (
                parse_mysql_url(source).map_err(|e| misconfigured(&e))?,
                None,
                false,
                false,
            )
        } else if entry.sources.is_empty() {
            let probe = bd_cli::probe_dolt_mode(project_id);
            match (probe.embedded, probe.host, probe.port, probe.database) {
                (Some(false), Some(host), Some(port), Some(database)) => (
                    DoltUrl {
                        host,
                        port,
                        database,
                        tls: false,
                    },
                    probe.user,
                    probe.tls.unwrap_or(false),
                    true,
                ),
                _ => return Err(unavailable("project is not in server mode")),
            }
        } else {
            return Err(misconfigured("no mysql:// source is configured"));
        };
    let tls = url.tls || bd_tls || creds::tls_from_env(&env);
    // Before any credential is read: a login must never be sent in clear to another machine.
    check_transport(&url.host, tls).map_err(|e| misconfigured(&e))?;
    let creds = creds::resolve(
        entry
            .credentials_ref
            .as_ref()
            .and_then(CredentialsRef::login),
        &url.host,
        url.port,
        from_bd_probe,
        bd_user.as_deref(),
        &env,
        &read,
    )
    .map_err(|e| misconfigured(&e))?;
    Ok(Target {
        tls,
        host: url.host,
        port: url.port,
        database: url.database,
        user: creds.user,
        password: creds.password,
    })
}

impl DoltSql {
    /// Runs `f` on the pooled connection. A connection that fails is dropped and the call is
    /// retried once on a fresh one, so an idle timeout or a server restart is not a failure. A
    /// timeout is not retried: that would double the wait, and the server is not coming back in 2 s.
    fn with_session<T>(&self, f: impl Fn(&mut Session) -> Result<T, String>) -> Result<T, String> {
        let entry = registry::find(&self.project_id)
            .map_err(|_| unavailable("project is not registered"))?;
        let fingerprint = format!(
            "{:?}|{:?}|{:?}",
            entry.path, entry.sources, entry.credentials_ref
        );
        let mut slot = lock(&self.session);
        if slot.as_ref().is_some_and(|o| o.entry != fingerprint) {
            *slot = None;
        }
        if let Some(open) = slot.as_mut() {
            match f(&mut open.session) {
                Ok(v) => return Ok(v),
                Err(e) => {
                    *slot = None;
                    if e.contains("timed out") {
                        return Err(e);
                    }
                }
            }
        }
        let mut session = Session::open(&resolve_target(&self.project_id)?)?;
        let out = f(&mut session);
        if out.is_ok() {
            *slot = Some(Open {
                entry: fingerprint,
                session,
            });
        }
        out
    }

    pub(crate) fn head(&self) -> Result<String, String> {
        self.with_session(Session::head)
    }

    fn delta(&self, from: &str, to: &str) -> Result<session::Delta, String> {
        self.with_session(|s| s.delta(from, to))
    }

    fn tables(&self) -> Result<(String, DoltTables), String> {
        self.with_session(Session::tables)
    }

    /// Ready and blocked stay on bd. Only a project with a local bd (no `sources`, or one listing
    /// `bd:`) is asked; for a remote hub with no ledger nobody can say, and the snapshot is flagged.
    fn readiness(&self, background: bool) -> Option<(Vec<Value>, Vec<Value>)> {
        let entry = registry::find(&self.project_id).ok()?;
        let has_bd = entry.sources.is_empty() || entry.sources.iter().any(|s| s.starts_with("bd:"));
        has_bd
            .then(|| bd_cli::readiness(&self.project_id, background))
            .flatten()
    }

    fn lines(&self) -> Result<Vec<Value>, String> {
        Ok(export_lines(&self.tables()?.1))
    }
}

fn comment_of(c: &CommentRow) -> Comment {
    map_comment(&serde_json::json!({
        "id": c.id, "author": c.author, "text": c.text,
        "created_at": c.created_at.as_deref().map(iso_utc),
    }))
}

impl BeadSource for DoltSql {
    fn list_beads(&self, _project_id: &str) -> Result<Vec<Bead>, String> {
        let raw = self.lines()?;
        let mut beads: Vec<Bead> = raw.iter().map(map_bead).collect();
        apply_links(&mut beads, &raw);
        Ok(derive_children(beads))
    }

    fn bead_detail(&self, _project_id: &str, id: &str) -> Result<BeadDetail, String> {
        let (_, tables) = self.tables()?;
        let raw = export_lines(&tables);
        let line = raw
            .iter()
            .find(|l| l.get("id").and_then(Value::as_str) == Some(id))
            .ok_or_else(|| format!("bead {id} not found"))?;
        let by_id: HashMap<&str, &IssueRow> =
            tables.issues.iter().map(|i| (i.id.as_str(), i)).collect();
        let dependencies = tables
            .deps
            .iter()
            .filter(|d| d.from == id)
            .filter_map(|d| {
                let t = by_id.get(d.to.as_str())?;
                Some(RelatedBead {
                    id: t.id.clone(),
                    title: t.title.clone(),
                    status: t.status.clone(),
                    issue_type: t.issue_type.clone(),
                    dependency_type: d.kind.clone(),
                })
            })
            .collect();
        let comments = tables
            .comments
            .iter()
            .filter(|c| c.issue_id == id)
            .map(comment_of)
            .collect();
        Ok(BeadDetail {
            bead: map_bead(line),
            dependencies,
            comments,
        })
    }

    fn project_knowledge(&self, _project_id: &str) -> Result<ProjectKnowledge, String> {
        Ok(build_project_knowledge(&self.lines()?))
    }

    /// SQL has no queue to yield in; `background` only picks the lane of the bd readiness calls.
    fn snapshot(&self, project_id: &str, background: bool) -> Result<ProjectSnapshot, String> {
        static SLOTS: OnceLock<bd_cli::Slots<ProjectSnapshot>> = OnceLock::new();
        let slots = SLOTS.get_or_init(Default::default);
        bd_cli::coalesced(slots, project_id, || {
            let (sql, readiness) = std::thread::scope(|scope| {
                let readiness = scope.spawn(|| self.readiness(background));
                (self.tables(), readiness.join().ok().flatten())
            });
            let (head, tables) = sql?;
            Ok(sql_snapshot(&tables, head, readiness))
        })
    }

    fn bead_comments(
        &self,
        _project_id: &str,
        id: &str,
        _background: bool,
    ) -> Result<Vec<Comment>, String> {
        Ok(self
            .with_session(|s| s.comments(id))?
            .iter()
            .map(comment_of)
            .collect())
    }
}
