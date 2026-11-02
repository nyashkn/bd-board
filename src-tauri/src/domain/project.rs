use serde::Serialize;
use serde_json::Value;

#[derive(Serialize)]
pub struct ProjectCounts {
    pub open: i64,
    pub in_progress: i64,
    pub blocked: i64,
    pub closed: i64,
    pub deferred: i64,
    pub total: i64,
    /// total minus closed; the TS board reads this, so the desktop must send it too.
    pub active: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub dir: String,
    pub beads_path: String,
    pub prefix: Option<String>,
    pub external: bool,
    pub missing: bool,
    pub error: Option<String>,
    pub counts: ProjectCounts,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub readonly: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter_label: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BeadsLocation {
    pub beads_path: String,
    pub database_path: String,
    pub prefix: Option<String>,
    pub external: bool,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PathStatus {
    Valid {
        prefix: Option<String>,
        external: bool,
    },
    NeedsInit {
        suggested_prefix: String,
    },
    Invalid {
        reason: String,
    },
}

#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AddProjectOutcome {
    Registered {
        project: Project,
    },
    NeedsInit {
        path: String,
        suggested_prefix: String,
    },
}

#[derive(Serialize, Debug, PartialEq)]
pub struct CommentAuthor {
    pub name: String,
    pub source: Option<String>,
}

pub(crate) fn build_counts_from_groups(rows: &[Value]) -> ProjectCounts {
    let mut counts = ProjectCounts {
        open: 0,
        in_progress: 0,
        blocked: 0,
        closed: 0,
        deferred: 0,
        total: 0,
        active: 0,
    };

    for row in rows {
        let status = row.get("group").and_then(Value::as_str).unwrap_or_default();
        let n = row
            .get("count")
            .and_then(|v| v.as_i64().or_else(|| v.as_u64().map(|n| n as i64)))
            .unwrap_or(0);
        counts.total += n;
        match status {
            "open" => counts.open += n,
            "in_progress" | "hooked" => counts.in_progress += n,
            "blocked" => counts.blocked += n,
            "closed" => counts.closed += n,
            "deferred" => counts.deferred += n,
            _ => {}
        }
    }

    counts.active = counts.total - counts.closed;
    counts
}

/// Mirrors the TS adapter: a bead waiting on an open dependency (as `bd blocked` lists it)
/// moves out of its status bucket into Blocked; status `blocked` is already counted.
pub(crate) fn apply_blocked_to_counts(counts: &mut ProjectCounts, blocked: &[Value]) {
    for row in blocked {
        let bucket = match row
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "blocked" | "closed" => continue,
            "in_progress" | "hooked" => &mut counts.in_progress,
            "deferred" => &mut counts.deferred,
            _ => &mut counts.open,
        };
        if *bucket > 0 {
            *bucket -= 1;
        }
        counts.blocked += 1;
    }
}

/// Mirrors resolveCommentAuthor in src/lib/comment-author.ts (bd's actor order).
pub(crate) fn resolve_comment_author(
    env_value: &dyn Fn(&str) -> Option<String>,
    config_actor: &str,
    git_name: &str,
) -> CommentAuthor {
    let clean = |v: Option<String>| v.unwrap_or_default().trim().to_string();
    let chain: [(&str, String); 6] = [
        ("BD_BOARD_AUTHOR", clean(env_value("BD_BOARD_AUTHOR"))),
        ("BD_ACTOR", clean(env_value("BD_ACTOR"))),
        ("BEADS_ACTOR", clean(env_value("BEADS_ACTOR"))),
        ("bd config actor", config_actor.trim().to_string()),
        ("git user.name", git_name.trim().to_string()),
        ("USER", clean(env_value("USER"))),
    ];
    match chain.into_iter().find(|(_, v)| !v.is_empty()) {
        Some((source, name)) => CommentAuthor {
            name,
            source: Some(source.to_string()),
        },
        None => CommentAuthor {
            name: String::new(),
            source: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn build_counts_from_groups_maps_bd_count_by_status_groups() {
        let rows = vec![
            json!({"group": "open", "count": 16}),
            json!({"group": "blocked", "count": 9}),
        ];
        let counts = build_counts_from_groups(&rows);
        assert_eq!(counts.open, 16);
        assert_eq!(counts.blocked, 9);
        assert_eq!(counts.in_progress, 0);
        assert_eq!(counts.closed, 0);
        assert_eq!(counts.deferred, 0);
        assert_eq!(counts.total, 25);
    }

    #[test]
    fn blocked_rows_move_beads_into_blocked_without_double_counting() {
        let mut counts = build_counts_from_groups(&[
            json!({"group": "open", "count": 10}),
            json!({"group": "in_progress", "count": 2}),
            json!({"group": "deferred", "count": 1}),
            json!({"group": "blocked", "count": 1}),
        ]);
        let rows = vec![
            json!({"id": "a", "status": "open"}),
            json!({"id": "b", "status": "open"}),
            json!({"id": "c", "status": "in_progress"}),
            json!({"id": "d", "status": "deferred"}),
            json!({"id": "e", "status": "blocked"}),
        ];
        apply_blocked_to_counts(&mut counts, &rows);
        assert_eq!(
            (
                counts.open,
                counts.in_progress,
                counts.deferred,
                counts.blocked
            ),
            (8, 1, 0, 5)
        );
        assert_eq!(counts.total, 14);
    }

    #[test]
    fn build_counts_from_groups_active_excludes_closed_and_serializes() {
        let counts = build_counts_from_groups(&[
            json!({"group": "open", "count": 4}),
            json!({"group": "closed", "count": 6}),
        ]);
        assert_eq!(counts.active, 4);
        assert_eq!(serde_json::to_value(&counts).unwrap()["active"], 4);
    }

    #[test]
    fn build_counts_from_groups_handles_empty_groups() {
        let counts = build_counts_from_groups(&[]);
        assert_eq!(counts.total, 0);
        assert_eq!(counts.open, 0);
    }

    #[test]
    fn build_counts_from_groups_folds_hooked_into_in_progress() {
        let rows = vec![json!({"group": "hooked", "count": 3})];
        let counts = build_counts_from_groups(&rows);
        assert_eq!(counts.in_progress, 3);
        assert_eq!(counts.total, 3);
    }

    #[test]
    fn project_serializes_readonly_and_filter_label_only_when_set() {
        let mut p = Project {
            id: "p".into(),
            name: "P".into(),
            dir: "/p".into(),
            beads_path: String::new(),
            prefix: None,
            external: false,
            missing: false,
            error: None,
            counts: build_counts_from_groups(&[]),
            readonly: false,
            filter_label: None,
        };
        let v = serde_json::to_value(&p).unwrap();
        assert!(v.get("readonly").is_none() && v.get("filterLabel").is_none());
        p.readonly = true;
        p.filter_label = Some("wo".into());
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["readonly"], true);
        assert_eq!(v["filterLabel"], "wo");
    }

    #[test]
    fn comment_author_follows_bd_order() {
        let env_of = |pairs: &'static [(&'static str, &'static str)]| {
            move |k: &str| {
                pairs
                    .iter()
                    .find(|(name, _)| *name == k)
                    .map(|(_, v)| v.to_string())
            }
        };
        let a = resolve_comment_author(
            &env_of(&[("BD_BOARD_AUTHOR", "owner"), ("USER", "u")]),
            "c",
            "g",
        );
        assert_eq!(a.name, "owner");
        assert_eq!(a.source.as_deref(), Some("BD_BOARD_AUTHOR"));
        let b = resolve_comment_author(&env_of(&[("USER", "u")]), "", "KN");
        assert_eq!(b.source.as_deref(), Some("git user.name"));
        let c = resolve_comment_author(&env_of(&[]), "", "");
        assert_eq!(c.source, None);
    }

    #[test]
    fn add_project_outcome_needs_init_serializes_with_camel_case_kind() {
        let outcome = AddProjectOutcome::NeedsInit {
            path: "/Users/jeanpfs/Code/bd-board".to_string(),
            suggested_prefix: "bd-board".to_string(),
        };
        let value = serde_json::to_value(&outcome).unwrap();
        assert_eq!(
            value,
            json!({
                "kind": "needsInit",
                "path": "/Users/jeanpfs/Code/bd-board",
                "suggestedPrefix": "bd-board",
            })
        );
    }

    #[test]
    fn add_project_outcome_registered_serializes_with_project_payload() {
        let outcome = AddProjectOutcome::Registered {
            project: Project {
                id: "bd-board".to_string(),
                name: "bd-board".to_string(),
                dir: "/Users/jeanpfs/Code/bd-board".to_string(),
                beads_path: "/Users/jeanpfs/Code/jeanpfs-ai/beads/bd-board/.beads".to_string(),
                prefix: Some("bd-board".to_string()),
                external: true,
                missing: false,
                error: None,
                counts: build_counts_from_groups(&[]),
                readonly: false,
                filter_label: None,
            },
        };
        let value = serde_json::to_value(&outcome).unwrap();
        assert_eq!(
            value.get("kind").and_then(|v| v.as_str()),
            Some("registered")
        );
        assert!(value.get("project").and_then(|v| v.as_object()).is_some());
    }
}
