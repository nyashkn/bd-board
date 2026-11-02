//! Maps `bd --json` values onto the domain types.

use super::bead::{Bead, Comment};
use serde_json::Value;

pub(crate) fn value_str(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

pub(crate) fn value_opt_str(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(|s| s.to_string())
}

pub(crate) fn value_i64(value: &Value, key: &str) -> Option<i64> {
    value
        .get(key)
        .and_then(|v| v.as_i64().or_else(|| v.as_u64().map(|n| n as i64)))
}

pub(crate) fn value_labels(value: &Value) -> Vec<String> {
    value
        .get("labels")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn map_bead(value: &Value) -> Bead {
    Bead {
        id: value_str(value, "id"),
        title: value_str(value, "title"),
        description: value_opt_str(value, "description"),
        acceptance_criteria: value_opt_str(value, "acceptance_criteria"),
        design: value_opt_str(value, "design"),
        notes: value_opt_str(value, "notes"),
        status: value_str(value, "status"),
        priority: value_i64(value, "priority").unwrap_or(2),
        issue_type: value_str(value, "issue_type"),
        assignee: value_opt_str(value, "assignee"),
        owner: value_opt_str(value, "owner"),
        created_at: value_opt_str(value, "created_at"),
        updated_at: value_opt_str(value, "updated_at"),
        closed_at: value_opt_str(value, "closed_at"),
        labels: value_labels(value),
        parent: value_opt_str(value, "parent"),
        spec_id: value_opt_str(value, "spec_id").filter(|s| !s.is_empty()),
        external_ref: value_opt_str(value, "external_ref").filter(|s| !s.is_empty()),
        metadata: value.get("metadata").filter(|m| m.is_object()).cloned(),
        comment_count: value_i64(value, "comment_count"),
        dependency_count: value_i64(value, "dependency_count"),
        dependent_count: value_i64(value, "dependent_count"),
        waiting_on: None,
        ready: None,
        children: None,
        child_beads: None,
        links: None,
    }
}

pub(crate) fn map_comment(value: &Value) -> Comment {
    Comment {
        id: value_str(value, "id"),
        author: value_opt_str(value, "author").or_else(|| value_opt_str(value, "created_by")),
        text: value
            .get("text")
            .or_else(|| value.get("body"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        created_at: value_opt_str(value, "created_at"),
    }
}
