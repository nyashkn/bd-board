use super::exec::{bd_json, bd_json_array, bd_json_lines};
use crate::domain::bd_json::{map_bead, map_comment, value_str};
use crate::domain::bead::RelatedBead;
use crate::domain::graph::{apply_links, apply_readiness, derive_children};
use crate::domain::knowledge::build_project_knowledge;
use crate::domain::{Bead, BeadDetail, ProjectKnowledge};
use crate::registry::resolve_dir;
use serde_json::Value;

pub(crate) fn list_beads_inner(project_id: &str) -> Result<Vec<Bead>, String> {
    let dir = resolve_dir(project_id)?;
    let raw = bd_json(&dir, &["list", "--all", "--json"])?;
    let raw_beads = raw.as_array().cloned().unwrap_or_default();
    let mut beads: Vec<Bead> = raw_beads.iter().map(map_bead).collect();
    apply_links(&mut beads, &raw_beads);
    let blocked = bd_json_array(&dir, &["blocked", "--json"]);
    let ready = bd_json_array(&dir, &["ready", "--json", "-n", "0"]);
    apply_readiness(&mut beads, blocked.as_deref(), ready.as_deref());
    Ok(derive_children(beads))
}

pub(crate) fn get_bead_detail_inner(project_id: &str, id: &str) -> Result<BeadDetail, String> {
    let dir = resolve_dir(project_id)?;
    let raw_arr = bd_json(&dir, &["show", id, "--json"])?;
    let raw = raw_arr
        .as_array()
        .and_then(|arr| arr.first())
        .cloned()
        .unwrap_or(Value::Object(Default::default()));
    let bead = map_bead(&raw);
    // show first: its comment_count says whether `bd comments` is worth a process. The
    // per-project queue runs one bd at a time anyway, so overlapping them gains nothing.
    let raw_comments = if bead.comment_count == Some(0) {
        None
    } else {
        bd_json(&dir, &["comments", id, "--json"]).ok()
    };
    let raw_deps = raw
        .get("dependencies")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let dependencies = raw_deps
        .into_iter()
        .map(|d| RelatedBead {
            id: value_str(&d, "id"),
            title: value_str(&d, "title"),
            status: value_str(&d, "status"),
            issue_type: value_str(&d, "issue_type"),
            dependency_type: value_str(&d, "dependency_type"),
        })
        .collect();

    let comments = match raw_comments {
        Some(Value::Array(items)) => items.into_iter().map(|v| map_comment(&v)).collect(),
        _ => Vec::new(),
    };

    Ok(BeadDetail {
        bead,
        dependencies,
        comments,
    })
}

pub(crate) fn get_project_knowledge_inner(project_id: &str) -> Result<ProjectKnowledge, String> {
    let dir = resolve_dir(project_id)?;
    match bd_json_lines(&dir, &["export"]) {
        Ok(issues) => Ok(build_project_knowledge(&issues)),
        Err(_) => Ok(ProjectKnowledge {
            comments: Vec::new(),
            knowledge: Vec::new(),
        }),
    }
}
