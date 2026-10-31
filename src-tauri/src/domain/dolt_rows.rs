//! Rows of bd's Dolt tables, and how they become the `bd export` lines the snapshot is built from.
//! Going through the same `build_snapshot` as the bd-cli adapter is what keeps the two equal.

use super::snapshot::{build_snapshot, ProjectSnapshot};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

/// The `schema_migrations` level of the bd release this reader was checked against (bd 1.3.2).
/// Anything else is refused and the project falls back to bd-cli; widen it after re-running the
/// parity test against the newer bd.
pub const SUPPORTED_SCHEMA_VERSIONS: std::ops::RangeInclusive<i64> = 66..=66;

/// Dolt commit hashes are 32 characters of base32 (`0-9a-v`). Checked before one is put in SQL.
pub fn is_dolt_hash(s: &str) -> bool {
    s.len() == 32 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'v'))
}

/// A row of `issues`; empty text and NULL are both `None`.
#[derive(Debug, Default, Clone)]
pub struct IssueRow {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub design: Option<String>,
    pub acceptance_criteria: Option<String>,
    pub notes: Option<String>,
    pub status: String,
    pub priority: i64,
    pub issue_type: String,
    pub assignee: Option<String>,
    pub owner: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub closed_at: Option<String>,
    pub external_ref: Option<String>,
    pub spec_id: Option<String>,
    /// The JSON column as text.
    pub metadata: Option<String>,
}

/// A row of `dependencies`; `to` is the issue, wisp or external target, whichever is set.
#[derive(Debug, Clone)]
pub struct DepRow {
    pub from: String,
    pub to: String,
    pub kind: String,
}

#[derive(Debug, Clone)]
pub struct LabelRow {
    pub issue_id: String,
    pub label: String,
}

#[derive(Debug, Clone)]
pub struct CommentRow {
    pub id: String,
    pub issue_id: String,
    pub author: String,
    pub text: String,
    pub created_at: Option<String>,
}

/// Everything one snapshot reads, in the order the queries return it.
#[derive(Debug, Default)]
pub struct DoltTables {
    pub issues: Vec<IssueRow>,
    pub deps: Vec<DepRow>,
    pub labels: Vec<LabelRow>,
    pub comments: Vec<CommentRow>,
}

/// `2026-10-30 23:45:04` (a DATETIME, always UTC in bd) as `2026-10-30T23:45:04Z`, like export.
pub fn iso_utc(datetime: &str) -> String {
    let t = datetime.trim().replacen(' ', "T", 1);
    if t.ends_with('Z') {
        t
    } else {
        format!("{t}Z")
    }
}

fn put(obj: &mut Map<String, Value>, key: &str, value: &Option<String>) {
    if let Some(v) = value.as_deref().filter(|v| !v.is_empty()) {
        obj.insert(key.into(), json!(v));
    }
}

fn put_time(obj: &mut Map<String, Value>, key: &str, value: &Option<String>) {
    if let Some(v) = value.as_deref().filter(|v| !v.is_empty()) {
        obj.insert(key.into(), json!(iso_utc(v)));
    }
}

fn group<'a, T, K: std::hash::Hash + Eq>(
    rows: &'a [T],
    key: impl Fn(&'a T) -> K,
) -> HashMap<K, Vec<&'a T>> {
    let mut map: HashMap<K, Vec<&T>> = HashMap::new();
    for row in rows {
        map.entry(key(row)).or_default().push(row);
    }
    map
}

/// One `bd export` line per issue. Like export, empty fields are left out, and the three counts
/// are always present: `dependency_count` and `dependent_count` count `blocks` edges only
/// (checked against bd 1.3.2: parent-child, related and the other types are not counted).
pub fn export_lines(t: &DoltTables) -> Vec<Value> {
    let deps = group(&t.deps, |d| d.from.as_str());
    let labels = group(&t.labels, |l| l.issue_id.as_str());
    let comments = group(&t.comments, |c| c.issue_id.as_str());
    let mut dependents: HashMap<&str, i64> = HashMap::new();
    for d in t.deps.iter().filter(|d| d.kind == "blocks") {
        *dependents.entry(d.to.as_str()).or_default() += 1;
    }
    t.issues
        .iter()
        .map(|i| {
            let mut o = Map::new();
            o.insert("_type".into(), json!("issue"));
            o.insert("id".into(), json!(i.id));
            o.insert("title".into(), json!(i.title));
            o.insert("status".into(), json!(i.status));
            o.insert("priority".into(), json!(i.priority));
            o.insert("issue_type".into(), json!(i.issue_type));
            put(&mut o, "description", &i.description);
            put(&mut o, "design", &i.design);
            put(&mut o, "acceptance_criteria", &i.acceptance_criteria);
            put(&mut o, "notes", &i.notes);
            put(&mut o, "assignee", &i.assignee);
            put(&mut o, "owner", &i.owner);
            put(&mut o, "external_ref", &i.external_ref);
            put(&mut o, "spec_id", &i.spec_id);
            put_time(&mut o, "created_at", &i.created_at);
            put_time(&mut o, "updated_at", &i.updated_at);
            put_time(&mut o, "closed_at", &i.closed_at);
            let meta = i
                .metadata
                .as_deref()
                .and_then(|m| serde_json::from_str::<Value>(m).ok())
                .filter(|m| m.as_object().is_some_and(|m| !m.is_empty()));
            if let Some(m) = meta {
                o.insert("metadata".into(), m);
            }
            let mine = labels.get(i.id.as_str());
            if let Some(ls) = mine {
                o.insert(
                    "labels".into(),
                    Value::Array(ls.iter().map(|l| json!(l.label)).collect()),
                );
            }
            let outgoing = deps.get(i.id.as_str());
            if let Some(ds) = outgoing {
                o.insert(
                    "dependencies".into(),
                    Value::Array(
                        ds.iter()
                            .map(|d| {
                                json!({"issue_id": d.from, "depends_on_id": d.to, "type": d.kind})
                            })
                            .collect(),
                    ),
                );
            }
            let notes = comments.get(i.id.as_str());
            if let Some(cs) = notes {
                o.insert(
                    "comments".into(),
                    Value::Array(
                        cs.iter()
                            .map(|c| {
                                let mut m = Map::new();
                                m.insert("id".into(), json!(c.id));
                                m.insert("issue_id".into(), json!(c.issue_id));
                                m.insert("author".into(), json!(c.author));
                                m.insert("text".into(), json!(c.text));
                                put_time(&mut m, "created_at", &c.created_at);
                                Value::Object(m)
                            })
                            .collect(),
                    ),
                );
            }
            let blocks = outgoing.map_or(0, |ds| ds.iter().filter(|d| d.kind == "blocks").count());
            o.insert("dependency_count".into(), json!(blocks));
            o.insert(
                "dependent_count".into(),
                json!(dependents.get(i.id.as_str()).copied().unwrap_or(0)),
            );
            o.insert("comment_count".into(), json!(notes.map_or(0, Vec::len)));
            Value::Object(o)
        })
        .collect()
}

/// The snapshot for the SQL tables. Readiness is not in these tables in a form that matches
/// `bd ready` / `bd blocked` (see docs/read-layer.md), so it is left to the caller: `ready` and
/// `blocked` come from bd when it is available, and are empty and flagged when it is not.
pub fn sql_snapshot(
    t: &DoltTables,
    cursor: String,
    readiness: Option<(Vec<Value>, Vec<Value>)>,
) -> ProjectSnapshot {
    let lines = export_lines(t);
    match readiness {
        Some((ready, blocked)) => build_snapshot(&lines, Some(&ready), Some(&blocked), cursor),
        None => {
            let mut snap = build_snapshot(&lines, None, None, cursor);
            snap.readiness_unavailable = true;
            snap
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn issue(id: &str) -> IssueRow {
        IssueRow {
            id: id.into(),
            title: format!("T {id}"),
            status: "open".into(),
            priority: 2,
            issue_type: "task".into(),
            created_at: Some("2026-10-30 23:45:04".into()),
            ..Default::default()
        }
    }

    #[test]
    fn hashes_are_base32_of_32_chars() {
        assert!(is_dolt_hash("bqmdbovnmdja57egp8618vobv3jlnj9s"));
        assert!(is_dolt_hash(&"0".repeat(32)));
        for bad in [
            "",
            "HEAD",
            "bqmdbovnmdja57egp8618vobv3jlnj9",    // 31
            "bqmdbovnmdja57egp8618vobv3jlnj9ss",  // 33
            "bqmdbovnmdja57egp8618vobv3jlnj9w",   // w is outside 0-9a-v
            "bqmdbovnmdja57egp8618vobv3jlnj9S",   // upper case
            "bqmdbovnmdja57egp8618vobv3jlnj9'",   // quote
            "bqmdbovnmdja57egp8618vobv3jlnj9;--", // injection tail
        ] {
            assert!(!is_dolt_hash(bad), "{bad}");
        }
    }

    #[test]
    fn datetimes_become_export_timestamps() {
        assert_eq!(iso_utc("2026-10-30 23:45:04"), "2026-10-30T23:45:04Z");
        assert_eq!(iso_utc("2026-10-30T23:45:04Z"), "2026-10-30T23:45:04Z");
    }

    #[test]
    fn export_lines_leave_out_empty_fields_and_count_blocks_only() {
        let mut a = issue("syn-a");
        a.description = Some(String::new());
        a.assignee = Some("alice".into());
        a.metadata = Some("{}".into());
        let mut b = issue("syn-b");
        b.metadata = Some(r#"{"k": "v"}"#.into());
        b.closed_at = Some("2026-10-31 00:00:00".into());
        let t = DoltTables {
            issues: vec![a, b],
            deps: vec![
                DepRow {
                    from: "syn-b".into(),
                    to: "syn-a".into(),
                    kind: "blocks".into(),
                },
                DepRow {
                    from: "syn-b".into(),
                    to: "syn-a".into(),
                    kind: "related".into(),
                },
            ],
            labels: vec![LabelRow {
                issue_id: "syn-a".into(),
                label: "x".into(),
            }],
            comments: vec![CommentRow {
                id: "c1".into(),
                issue_id: "syn-a".into(),
                author: "me".into(),
                text: "hi".into(),
                created_at: Some("2026-10-30 23:45:05".into()),
            }],
        };
        let lines = export_lines(&t);
        let (a, b) = (&lines[0], &lines[1]);
        assert!(a.get("description").is_none() && a.get("metadata").is_none());
        assert_eq!(a["assignee"], "alice");
        assert_eq!(a["created_at"], "2026-10-30T23:45:04Z");
        assert_eq!(a["labels"], json!(["x"]));
        assert_eq!(a["comment_count"], 1);
        assert_eq!(a["dependent_count"], 1);
        assert_eq!(b["dependency_count"], 1);
        assert_eq!(b["metadata"], json!({"k": "v"}));
        assert_eq!(b["closed_at"], "2026-10-31T00:00:00Z");
        assert_eq!(b["dependencies"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn sql_snapshot_flags_missing_readiness() {
        let t = DoltTables {
            issues: vec![issue("syn-a")],
            ..Default::default()
        };
        let snap = sql_snapshot(&t, "c".into(), None);
        assert!(snap.ready.is_none() && snap.blocked.is_none());
        assert!(snap.readiness_unavailable);
        let snap = sql_snapshot(&t, "c".into(), Some((vec![json!({"id":"syn-a"})], vec![])));
        assert_eq!(snap.ready, Some(vec!["syn-a".to_string()]));
        assert!(!snap.readiness_unavailable);
        let wire = serde_json::to_value(&snap).unwrap();
        assert!(wire.get("readiness_unavailable").is_none());
    }
}
