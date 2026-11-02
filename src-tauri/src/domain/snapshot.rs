//! One project's beads as the UI reads them: with comments and edges, plus bd's ready and
//! blocked answers. Mirrors `ProjectSnapshot` in src/lib/snapshot.ts.

use super::bd_json::{map_bead, map_comment, value_opt_str, value_str};
use super::bead::{Bead, Comment};
use serde::Serialize;
use serde_json::Value;

/// One dependency edge as `bd export` reports it: `from` depends on `to`.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct SnapshotEdge {
    pub from: String,
    pub to: String,
    #[serde(rename = "type")]
    pub kind: String,
}

#[derive(Serialize, Clone)]
pub struct SnapshotBead {
    #[serde(flatten)]
    pub bead: Bead,
    pub comments: Vec<Comment>,
    pub edges: Vec<SnapshotEdge>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct BlockedRow {
    pub id: String,
    pub blocked_by: Vec<String>,
}

#[derive(Serialize, Clone)]
pub struct ProjectSnapshot {
    pub beads: Vec<SnapshotBead>,
    /// Ids from `bd ready`; None when bd could not say.
    pub ready: Option<Vec<String>>,
    /// Rows from `bd blocked`; None when bd could not say.
    pub blocked: Option<Vec<BlockedRow>>,
    /// Content hash of the three bd outputs (the feed seq would cost another bd call); for the
    /// SQL reader, the Dolt head hash.
    pub cursor: String,
    /// The SQL reader had no bd to ask, so `ready` and `blocked` are empty on purpose.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub readiness_unavailable: bool,
}

fn edges_of(raw: &Value) -> Vec<SnapshotEdge> {
    let owner = value_str(raw, "id");
    raw.get("dependencies")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|dep| {
            let to = value_opt_str(dep, "depends_on_id").filter(|s| !s.is_empty())?;
            let from = value_opt_str(dep, "issue_id").unwrap_or_else(|| owner.clone());
            (!from.is_empty()).then(|| SnapshotEdge {
                from,
                to,
                kind: value_opt_str(dep, "type").unwrap_or_else(|| "blocks".to_string()),
            })
        })
        .collect()
}

fn ids(rows: &[Value]) -> Vec<String> {
    rows.iter()
        .filter_map(|r| r.get("id").and_then(Value::as_str).map(str::to_string))
        .collect()
}

fn blocked_rows(rows: &[Value]) -> Vec<BlockedRow> {
    rows.iter()
        .filter_map(|r| {
            Some(BlockedRow {
                id: r.get("id")?.as_str()?.to_string(),
                blocked_by: r
                    .get("blocked_by")
                    .and_then(Value::as_array)
                    .map(|by| {
                        by.iter()
                            .filter_map(|v| v.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default(),
            })
        })
        .collect()
}

/// Maps the parsed `bd export` lines and the optional `ready`/`blocked` rows.
pub(crate) fn build_snapshot(
    export: &[Value],
    ready: Option<&[Value]>,
    blocked: Option<&[Value]>,
    cursor: String,
) -> ProjectSnapshot {
    let beads = export
        .iter()
        .map(|raw| SnapshotBead {
            bead: map_bead(raw),
            comments: raw
                .get("comments")
                .and_then(Value::as_array)
                .map(|items| items.iter().map(map_comment).collect())
                .unwrap_or_default(),
            edges: edges_of(raw),
        })
        .collect();
    ProjectSnapshot {
        beads,
        ready: ready.map(ids),
        blocked: blocked.map(blocked_rows),
        cursor,
        readiness_unavailable: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn export() -> Vec<Value> {
        vec![
            json!({"id":"syn-1","title":"Epic","status":"open","priority":1,"issue_type":"epic",
                   "comments":[]}),
            json!({"id":"syn-1.1","title":"Child","status":"open","issue_type":"task",
                   "labels":["a"],
                   "dependencies":[
                     {"issue_id":"syn-1.1","depends_on_id":"syn-2","type":"blocks"},
                     {"depends_on_id":"syn-1","type":"parent-child"},
                     {"issue_id":"syn-1.1","depends_on_id":"","type":"blocks"}],
                   "comments":[{"id":"c1","author":"A","text":"hello","created_at":"2026-01-01T00:00:00Z"},
                               {"id":"c2","created_by":"B","body":"second"}]}),
        ]
    }

    #[test]
    fn maps_beads_comments_and_edges() {
        let snap = build_snapshot(&export(), None, None, "abc".into());
        assert_eq!(snap.beads.len(), 2);
        let child = &snap.beads[1];
        assert_eq!(child.bead.id, "syn-1.1");
        assert_eq!(child.bead.labels, vec!["a"]);
        assert_eq!(child.comments.len(), 2);
        assert_eq!(child.comments[1].author.as_deref(), Some("B"));
        assert_eq!(child.comments[1].text, "second");
        // The empty target is dropped; a missing issue_id falls back to the owner.
        assert_eq!(
            child.edges,
            vec![
                SnapshotEdge {
                    from: "syn-1.1".into(),
                    to: "syn-2".into(),
                    kind: "blocks".into()
                },
                SnapshotEdge {
                    from: "syn-1.1".into(),
                    to: "syn-1".into(),
                    kind: "parent-child".into()
                },
            ]
        );
        assert_eq!(snap.cursor, "abc");
    }

    #[test]
    fn ready_and_blocked_are_none_when_bd_could_not_say() {
        let snap = build_snapshot(&export(), None, None, String::new());
        assert!(snap.ready.is_none() && snap.blocked.is_none());
        let ready = [json!({"id":"syn-1"})];
        let blocked = [
            json!({"id":"syn-1.1","blocked_by":["syn-2"]}),
            json!({"x":1}),
        ];
        let snap = build_snapshot(&export(), Some(&ready), Some(&blocked), String::new());
        assert_eq!(snap.ready, Some(vec!["syn-1".to_string()]));
        assert_eq!(
            snap.blocked,
            Some(vec![BlockedRow {
                id: "syn-1.1".into(),
                blocked_by: vec!["syn-2".into()]
            }])
        );
    }

    #[test]
    fn serializes_the_wire_shape() {
        let snap = build_snapshot(&export(), None, None, "c".into());
        let v = serde_json::to_value(&snap).unwrap();
        assert_eq!(v["beads"][1]["id"], "syn-1.1");
        assert_eq!(v["beads"][1]["edges"][1]["type"], "parent-child");
        assert_eq!(v["beads"][1]["comments"][0]["text"], "hello");
        assert!(v["ready"].is_null());
        assert_eq!(v["cursor"], "c");
    }
}
