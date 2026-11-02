//! One MySQL connection to a Dolt server: opened read-only, with 2 s timeouts, queried in bulk.
//! Every error leaves here as a short fixed phrase: the driver's own text can carry the host, the
//! user name or a SQL fragment, and none of that may reach the UI, RUM or logs.

use crate::domain::dolt_rows::{
    is_dolt_hash, CommentRow, DepRow, DoltTables, IssueRow, LabelRow, SUPPORTED_SCHEMA_VERSIONS,
};
use mysql::prelude::Queryable;
use mysql::{Conn, OptsBuilder, Row, SslOpts};
use std::time::Duration;

/// Connect, read and write timeout. A hub that is off-network must fail fast so the next source runs.
pub(super) const TIMEOUT: Duration = Duration::from_secs(2);

/// The source cannot be reached right now. The TS router reads this prefix, and only this one, as
/// "try the next source".
pub(super) const UNAVAILABLE: &str = "source unavailable (dolt-sql)";

/// The source answered but cannot be used as configured (bad login, unknown schema, a config
/// error). These must surface to the user, not silently fall back to another source.
pub(super) const MISCONFIGURED: &str = "source misconfigured (dolt-sql)";

pub(super) fn unavailable(why: &str) -> String {
    format!("{UNAVAILABLE}: {why}")
}

pub(super) fn misconfigured(why: &str) -> String {
    format!("{MISCONFIGURED}: {why}")
}

// Every statement this adapter sends outside the snapshot, as constants so the test can read them.
const INIT_SQL: &str = "SET SESSION TRANSACTION READ ONLY";
const READ_ONLY_CHECK_SQL: &str = "SELECT @@session.transaction_read_only";
const SCHEMA_SQL: &str = "SELECT MAX(version) FROM schema_migrations";
const HEAD_SQL: &str = "SELECT HASHOF('HEAD')";

/// What to connect to. The password is never printed (see `Debug`).
pub(super) struct Target {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub user: String,
    pub password: String,
    pub tls: bool,
}

impl std::fmt::Debug for Target {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Target").finish_non_exhaustive()
    }
}

fn io_why(kind: std::io::ErrorKind) -> &'static str {
    use std::io::ErrorKind::*;
    match kind {
        ConnectionRefused => "connection refused",
        TimedOut | WouldBlock => "connection timed out",
        ConnectionReset | ConnectionAborted | BrokenPipe | UnexpectedEof => "connection reset",
        _ => "network error",
    }
}

fn scrub(e: &mysql::Error) -> String {
    use mysql::DriverError::{ConnectTimeout, CouldNotConnect};
    use mysql::Error::*;
    let why = match e {
        IoError(io) => io_why(io.kind()),
        CodecError(c) => std::error::Error::source(c)
            .and_then(|s| s.downcast_ref::<std::io::Error>())
            .map_or("protocol error", |io| io_why(io.kind())),
        DriverError(CouldNotConnect(Some((_, _, kind)))) => io_why(*kind),
        DriverError(CouldNotConnect(None)) => "network error",
        DriverError(ConnectTimeout) => "connection timed out",
        TlsError(_) => "tls handshake failed",
        MySqlError(m) if m.code == 1045 => return misconfigured("authentication failed"),
        MySqlError(m) if matches!(m.code, 1044 | 1142 | 1143 | 1227) => {
            return misconfigured("access denied")
        }
        MySqlError(_) => "the server refused the query",
        DriverError(_) | UrlError(_) => "protocol error",
        _ => "unexpected reply",
    };
    unavailable(why)
}

fn run<T>(r: Result<T, mysql::Error>) -> Result<T, String> {
    r.map_err(|e| scrub(&e))
}

fn text(row: &mut Row, i: usize) -> Option<String> {
    row.take::<Option<String>, _>(i).flatten()
}

fn req(row: &mut Row, i: usize) -> String {
    text(row, i).unwrap_or_default()
}

/// The whole project in one round trip. Everything this adapter sends is a SELECT or the
/// transaction brackets around one (see the `only_reads` test): Dolt's READ ONLY transaction
/// stops INSERT/UPDATE/DELETE but not DDL or CALL, so the real guarantee is that no such
/// statement is ever built here, plus the SELECT-only database user the docs ask for.
const SNAPSHOT_SQL: &str = "START TRANSACTION READ ONLY;\
    SELECT HASHOF('HEAD');\
    SELECT id, title, description, design, acceptance_criteria, notes, status, priority, \
      issue_type, assignee, owner, created_at, updated_at, closed_at, external_ref, spec_id, \
      metadata FROM issues;\
    SELECT issue_id, COALESCE(depends_on_issue_id, depends_on_wisp_id, depends_on_external), \
      type FROM dependencies ORDER BY issue_id, 2, type;\
    SELECT issue_id, label FROM labels ORDER BY issue_id, label;\
    SELECT id, issue_id, author, text, created_at FROM comments \
      ORDER BY issue_id, created_at, id;\
    COMMIT";

const COMMENTS_SQL: &str = "SELECT id, issue_id, author, text, CAST(created_at AS CHAR) \
    FROM comments WHERE issue_id = ? ORDER BY created_at, id";

pub(super) struct Session {
    conn: Conn,
}

impl Session {
    /// Opens the connection and refuses anything but a read-only session on a known schema.
    pub fn open(t: &Target) -> Result<Session, String> {
        let opts = OptsBuilder::new()
            .ip_or_hostname(Some(t.host.as_str()))
            .tcp_port(t.port)
            .db_name(Some(t.database.as_str()))
            .user(Some(t.user.as_str()))
            .pass((!t.password.is_empty()).then_some(t.password.as_str()))
            .tcp_connect_timeout(Some(TIMEOUT))
            .read_timeout(Some(TIMEOUT))
            .write_timeout(Some(TIMEOUT))
            .tcp_nodelay(true)
            .prefer_socket(false)
            .ssl_opts(t.tls.then(SslOpts::default))
            .init(vec![INIT_SQL]);
        let mut conn = run(Conn::new(opts))?;
        let read_only: Option<i64> = run(conn.query_first(READ_ONLY_CHECK_SQL))?;
        if read_only != Some(1) {
            return Err(misconfigured("could not open a read-only session"));
        }
        let schema: Option<i64> = run(conn.query_first(SCHEMA_SQL))?;
        match schema {
            Some(v) if SUPPORTED_SCHEMA_VERSIONS.contains(&v) => Ok(Session { conn }),
            _ => Err(misconfigured("unsupported bd schema version")),
        }
    }

    /// The change cursor: the commit hash at HEAD.
    pub fn head(&mut self) -> Result<String, String> {
        let head: Option<String> = run(self.conn.query_first(HEAD_SQL))?;
        head.filter(|h| is_dolt_hash(h))
            .ok_or_else(|| unavailable("unexpected reply"))
    }

    /// The whole project in one round trip: head hash, issues, dependencies, labels, comments.
    /// One read-only transaction, so the five answers describe the same state.
    pub fn tables(&mut self) -> Result<(String, DoltTables), String> {
        let mut result = run(self.conn.query_iter(SNAPSHOT_SQL))?;
        let mut sets: Vec<Vec<Row>> = Vec::new();
        while let Some(set) = result.iter() {
            // The transaction statements answer with no columns.
            if set.columns().as_ref().is_empty() {
                continue;
            }
            sets.push(run(set.collect::<Result<Vec<Row>, _>>())?);
        }
        drop(result);
        let [head, issues, deps, labels, comments]: [Vec<Row>; 5] = sets
            .try_into()
            .map_err(|_| unavailable("unexpected reply"))?;
        let head = head
            .into_iter()
            .next()
            .and_then(|mut r| text(&mut r, 0))
            .filter(|h| is_dolt_hash(h))
            .ok_or_else(|| unavailable("unexpected reply"))?;
        let tables = DoltTables {
            issues: issues
                .into_iter()
                .map(|mut r| IssueRow {
                    id: req(&mut r, 0),
                    title: req(&mut r, 1),
                    description: text(&mut r, 2),
                    design: text(&mut r, 3),
                    acceptance_criteria: text(&mut r, 4),
                    notes: text(&mut r, 5),
                    status: req(&mut r, 6),
                    priority: r.take::<i64, _>(7).unwrap_or(2),
                    issue_type: req(&mut r, 8),
                    assignee: text(&mut r, 9),
                    owner: text(&mut r, 10),
                    created_at: text(&mut r, 11),
                    updated_at: text(&mut r, 12),
                    closed_at: text(&mut r, 13),
                    external_ref: text(&mut r, 14),
                    spec_id: text(&mut r, 15),
                    metadata: text(&mut r, 16),
                })
                .collect(),
            deps: deps
                .into_iter()
                .map(|mut r| DepRow {
                    from: req(&mut r, 0),
                    to: req(&mut r, 1),
                    kind: req(&mut r, 2),
                })
                .collect(),
            labels: labels
                .into_iter()
                .map(|mut r| LabelRow {
                    issue_id: req(&mut r, 0),
                    label: req(&mut r, 1),
                })
                .collect(),
            comments: comments
                .into_iter()
                .map(|mut r| CommentRow {
                    id: req(&mut r, 0),
                    issue_id: req(&mut r, 1),
                    author: req(&mut r, 2),
                    text: req(&mut r, 3),
                    created_at: text(&mut r, 4),
                })
                .collect(),
        };
        Ok((head, tables))
    }

    /// One bead's comments, oldest first (a patch after a comment-only change).
    pub fn comments(&mut self, issue_id: &str) -> Result<Vec<CommentRow>, String> {
        let rows: Vec<Row> = run(self.conn.exec(COMMENTS_SQL, (issue_id,)))?;
        Ok(rows
            .into_iter()
            .map(|mut r| CommentRow {
                id: req(&mut r, 0),
                issue_id: req(&mut r, 1),
                author: req(&mut r, 2),
                text: req(&mut r, 3),
                created_at: text(&mut r, 4),
            })
            .collect())
    }

    /// Which tables changed between two commits, and for comment-only changes which beads.
    /// The hashes go into SQL text (the table functions take literals only), so they are checked
    /// against the base32 alphabet first.
    pub fn delta(&mut self, from: &str, to: &str) -> Result<Delta, String> {
        let (summary, comments) = diff_queries(from, to)?;
        let names: Vec<Option<String>> = run(self.conn.query(summary))?;
        let tables: Vec<String> = names.into_iter().flatten().collect();
        if !comment_only(&tables) {
            return Ok(Delta::Unknown);
        }
        let ids: Vec<Option<String>> = run(self.conn.query(comments))?;
        Ok(Delta::Comments(ids.into_iter().flatten().collect()))
    }
}

/// The two diff queries for a pair of commits. The only place a hash becomes SQL text.
fn diff_queries(from: &str, to: &str) -> Result<(String, String), String> {
    if !is_dolt_hash(from) || !is_dolt_hash(to) {
        return Err(unavailable("unexpected reply"));
    }
    Ok((
        format!(
            "SELECT COALESCE(to_table_name, from_table_name) \
             FROM DOLT_DIFF_SUMMARY('{from}', '{to}')"
        ),
        format!(
            "SELECT DISTINCT COALESCE(to_issue_id, from_issue_id) \
             FROM DOLT_DIFF('{from}', '{to}', 'comments')"
        ),
    ))
}

pub(super) enum Delta {
    /// Only these beads' comments changed.
    Comments(Vec<String>),
    /// Anything else: refresh everything.
    Unknown,
}

/// bd also touches its own bookkeeping tables on every write; those do not count.
pub(super) fn comment_only(tables: &[String]) -> bool {
    const BOOKKEEPING: [&str; 5] = [
        "bd_events_journal",
        "bd_events_seq",
        "events",
        "local_metadata",
        "metadata",
    ];
    let mut real = tables
        .iter()
        .map(String::as_str)
        .filter(|t| !BOOKKEEPING.contains(t));
    real.next() == Some("comments") && real.next().is_none()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn comment_only_ignores_bookkeeping_tables() {
        assert!(comment_only(&names(&["comments"])));
        assert!(comment_only(&names(&[
            "bd_events_journal",
            "comments",
            "bd_events_seq"
        ])));
        assert!(!comment_only(&names(&["comments", "issues"])));
        assert!(!comment_only(&names(&["bd_events_journal"])));
        assert!(!comment_only(&[]));
    }

    #[test]
    fn only_reads_are_ever_sent() {
        let ok = "bqmdbovnmdja57egp8618vobv3jlnj9s";
        let (summary, comments) = diff_queries(ok, ok).unwrap();
        // The very constants the code sends; a new statement has to be added here to be sent.
        let mut statements: Vec<String> = SNAPSHOT_SQL.split(';').map(String::from).collect();
        statements.extend(
            [
                COMMENTS_SQL,
                INIT_SQL,
                READ_ONLY_CHECK_SQL,
                SCHEMA_SQL,
                HEAD_SQL,
            ]
            .map(String::from),
        );
        statements.extend([summary, comments]);
        for s in &statements {
            let s = s.trim().to_ascii_uppercase();
            assert!(
                s.starts_with("SELECT ")
                    || s == "START TRANSACTION READ ONLY"
                    || s == "COMMIT"
                    || s == "SET SESSION TRANSACTION READ ONLY",
                "{s}"
            );
            assert!(
                !s.contains("INSERT ") && !s.contains("UPDATE ") && !s.contains("CALL "),
                "{s}"
            );
        }
    }

    #[test]
    fn diff_sql_is_built_only_from_base32_hashes() {
        let ok = "bqmdbovnmdja57egp8618vobv3jlnj9s";
        let (summary, comments) = diff_queries(ok, ok).unwrap();
        assert!(summary.contains(ok) && comments.contains(ok));
        for bad in ["x'); DROP TABLE issues; --", "HEAD", "", &ok.to_uppercase()] {
            assert!(diff_queries(bad, ok).is_err(), "{bad}");
            assert!(diff_queries(ok, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn errors_are_fixed_phrases_without_host_or_user() {
        let io = |k| mysql::Error::IoError(std::io::Error::new(k, "dolt-hub.example:3306 root"));
        let timed = scrub(&io(std::io::ErrorKind::TimedOut));
        assert_eq!(timed, "source unavailable (dolt-sql): connection timed out");
        let refused = scrub(&io(std::io::ErrorKind::ConnectionRefused));
        assert!(refused.contains("connection refused"));
        for e in [timed, refused, scrub(&io(std::io::ErrorKind::Other))] {
            assert!(!e.contains("dolt-hub") && !e.contains("root"), "{e}");
        }
        let denied = scrub(&mysql::Error::MySqlError(mysql::MySqlError {
            state: "28000".into(),
            message: "Access denied for user 'reader'@'10.0.0.1'".into(),
            code: 1045,
        }));
        assert_eq!(
            denied,
            "source misconfigured (dolt-sql): authentication failed"
        );
    }
}
