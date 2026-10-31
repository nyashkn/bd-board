//! Project-level bd operations: discovery, add/init, path checks, comment author.

use super::exec::{bd_json_array_prio, bd_json_prio, run_bd, run_bd_mut};
use super::probe::{probe_beads_location, probe_beads_location_prio};
use super::queue::Priority;
use crate::domain::project::{
    apply_blocked_to_counts, build_counts_from_groups, resolve_comment_author,
};
use crate::domain::{AddProjectOutcome, CommentAuthor, PathStatus, Project, ProjectCounts};
use crate::registry::{self, resolve_dir};
use serde_json::Value;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

pub(crate) fn list_projects() -> Result<Vec<Project>, String> {
    let mut projects = Vec::new();
    let registry = registry::load()?;

    for entry in registry.projects {
        let dir_path = PathBuf::from(&entry.path);

        // Check if folder exists
        if !dir_path.exists() {
            projects.push(Project {
                id: entry.id.clone(),
                name: entry.label.clone(),
                dir: entry.path.clone(),
                beads_path: String::new(),
                prefix: None,
                external: false,
                missing: true,
                error: Some("folder no longer exists".into()),
                counts: ProjectCounts {
                    open: 0,
                    in_progress: 0,
                    blocked: 0,
                    closed: 0,
                    deferred: 0,
                    total: 0,
                },
                readonly: entry.is_readonly(),
                filter_label: entry.effective_filter_label(),
            });
            continue;
        }

        // Probe beads location (this is the projects poll, so it queues behind user calls)
        match probe_beads_location_prio(&dir_path, Priority::Background) {
            Ok(location) => {
                let counts = project_counts_prio(&dir_path, Priority::Background);
                projects.push(Project {
                    id: entry.id.clone(),
                    name: entry.label.clone(),
                    dir: entry.path.clone(),
                    beads_path: location.beads_path,
                    prefix: location.prefix,
                    external: location.external,
                    missing: false,
                    error: None,
                    counts,
                    readonly: entry.is_readonly(),
                    filter_label: entry.effective_filter_label(),
                });
            }
            Err(err) => {
                projects.push(Project {
                    id: entry.id.clone(),
                    name: entry.label.clone(),
                    dir: entry.path.clone(),
                    beads_path: String::new(),
                    prefix: None,
                    external: false,
                    missing: false,
                    error: Some(err),
                    counts: ProjectCounts {
                        open: 0,
                        in_progress: 0,
                        blocked: 0,
                        closed: 0,
                        deferred: 0,
                        total: 0,
                    },
                    readonly: entry.is_readonly(),
                    filter_label: entry.effective_filter_label(),
                });
            }
        }
    }

    projects.sort_by(|a, b| {
        b.counts
            .total
            .cmp(&a.counts.total)
            .then_with(|| a.name.cmp(&b.name))
    });

    Ok(projects)
}

pub(crate) fn project_counts(dir: &Path) -> ProjectCounts {
    project_counts_prio(dir, Priority::User)
}

pub(crate) fn project_counts_prio(dir: &Path, priority: Priority) -> ProjectCounts {
    let result = bd_json_prio(dir, &["count", "--by-status", "--json"], priority).ok();
    let groups = result
        .as_ref()
        .and_then(|v| v.get("groups"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut counts = build_counts_from_groups(&groups);
    if let Some(blocked) = bd_json_array_prio(dir, &["blocked", "--json"], priority) {
        apply_blocked_to_counts(&mut counts, &blocked);
    }
    counts
}

pub(crate) fn comment_author_inner(project_id: &str) -> Result<CommentAuthor, String> {
    let dir = resolve_dir(project_id)?;
    let config_actor = run_bd(&dir, &["config", "get", "actor"])
        .map(|o| o.trim().to_string())
        .ok()
        .filter(|o| !o.starts_with("actor (not set"))
        .and_then(|o| o.lines().next().map(str::to_string))
        .unwrap_or_default();
    let git_name = Command::new("git")
        .current_dir(&dir)
        .args(["config", "user.name"])
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    Ok(resolve_comment_author(
        &|k| env::var(k).ok(),
        &config_actor,
        &git_name,
    ))
}

pub(crate) fn is_missing_workspace_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("no_beads_directory")
        || lower.contains("no active beads workspace")
        || lower.contains("bd where returned no beads path")
}

pub(crate) fn build_init_args(prefix: &str) -> Vec<String> {
    vec![
        "init".to_string(),
        "--non-interactive".to_string(),
        "--quiet".to_string(),
        "-p".to_string(),
        prefix.to_string(),
    ]
}

pub(crate) fn check_path(path: &str) -> PathStatus {
    let dir_path = PathBuf::from(path);

    if !dir_path.exists() {
        return PathStatus::Invalid {
            reason: "Path does not exist".to_string(),
        };
    }

    match probe_beads_location(&dir_path) {
        Ok(location) => PathStatus::Valid {
            prefix: location.prefix,
            external: location.external,
        },
        Err(err) if is_missing_workspace_error(&err) => {
            let suggested_prefix = dir_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("project")
                .to_string();
            PathStatus::NeedsInit { suggested_prefix }
        }
        Err(reason) => PathStatus::Invalid { reason },
    }
}

pub(crate) fn add_project(path: &str, name: Option<String>) -> Result<AddProjectOutcome, String> {
    let dir_path = PathBuf::from(path);

    match probe_beads_location(&dir_path) {
        Ok(location) => {
            // Register in the registry
            let entry = registry::add(&dir_path, name)?;

            // Get the counts
            let counts = project_counts(&dir_path);

            Ok(AddProjectOutcome::Registered {
                project: Project {
                    id: entry.id.clone(),
                    name: entry.label.clone(),
                    dir: entry.path.clone(),
                    beads_path: location.beads_path,
                    prefix: location.prefix,
                    external: location.external,
                    missing: false,
                    error: None,
                    counts,
                    readonly: entry.is_readonly(),
                    filter_label: entry.effective_filter_label(),
                },
            })
        }
        Err(err) if is_missing_workspace_error(&err) => {
            let canonical_path = std::fs::canonicalize(&dir_path)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| path.to_string());
            let suggested_prefix = dir_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("project")
                .to_string();

            Ok(AddProjectOutcome::NeedsInit {
                path: canonical_path,
                suggested_prefix,
            })
        }
        Err(err) => Err(err),
    }
}

pub(crate) fn init_project(
    path: &str,
    prefix: Option<String>,
    name: Option<String>,
) -> Result<Project, String> {
    let dir_path = PathBuf::from(path);

    // Try to probe first to see if it already has beads
    let probe_result = probe_beads_location(&dir_path);

    if let Ok(location) = probe_result {
        // Already a beads project
        if !location.external {
            // Beads is in the expected location, just register it
            let entry = registry::add(&dir_path, name.clone())?;
            let counts = project_counts(&dir_path);
            return Ok(Project {
                id: entry.id.clone(),
                name: entry.label.clone(),
                dir: entry.path.clone(),
                beads_path: location.beads_path,
                prefix: location.prefix,
                external: location.external,
                missing: false,
                error: None,
                counts,
                readonly: entry.is_readonly(),
                filter_label: entry.effective_filter_label(),
            });
        }
    }

    // Initialize beads with the specified prefix
    let folder_name = dir_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("project")
        .to_string();

    let final_prefix = prefix.unwrap_or(folder_name);

    // Build and run bd init with proper args (no -C flag)
    let init_args = build_init_args(&final_prefix);
    run_bd_mut(&dir_path, &init_args)?;

    // Probe again to get the location
    let location = probe_beads_location(&dir_path)?;

    // Register in the registry
    let entry = registry::add(&dir_path, name)?;

    // Get the counts
    let counts = project_counts(&dir_path);

    Ok(Project {
        id: entry.id.clone(),
        name: entry.label.clone(),
        dir: entry.path.clone(),
        beads_path: location.beads_path,
        prefix: location.prefix,
        external: location.external,
        missing: false,
        error: None,
        counts,
        readonly: entry.is_readonly(),
        filter_label: entry.effective_filter_label(),
    })
}

#[cfg(test)]
mod tests {
    use super::super::exec::bd_error_message;
    use super::*;

    #[test]
    fn build_init_args_returns_correct_args_without_c_flag() {
        let args = build_init_args("ravo");
        assert_eq!(
            args,
            vec!["init", "--non-interactive", "--quiet", "-p", "ravo"]
        );
    }

    #[test]
    fn is_missing_workspace_error_matches_no_beads_directory_code() {
        assert!(is_missing_workspace_error(
            "no_beads_directory (run bd init)"
        ));
    }

    #[test]
    fn is_missing_workspace_error_matches_no_active_beads_workspace_text() {
        assert!(is_missing_workspace_error(
            "No active beads workspace found. (check BEADS_DIR/worktree setup, or run 'bd init' to create a new database)"
        ));
    }

    #[test]
    fn is_missing_workspace_error_matches_bd_where_internal_message() {
        assert!(is_missing_workspace_error(
            "bd where returned no beads path"
        ));
    }

    #[test]
    fn is_missing_workspace_error_ignores_unrelated_errors() {
        assert!(!is_missing_workspace_error("bd not found (tried: bd)"));
        assert!(!is_missing_workspace_error(
            "failed to parse bd where output: expected value"
        ));
    }

    #[test]
    fn bd_error_message_real_no_beads_directory_payload_is_classifiable() {
        let stdout = r#"{"error":"no_beads_directory","message":"No active beads workspace found.","hint":"check BEADS_DIR/worktree setup, or run 'bd init' to create a new database","schema_version":1}"#;
        let stderr = "";
        let status = std::process::Command::new("false").output().unwrap().status;

        let result = bd_error_message(stdout, stderr, &status);
        assert!(is_missing_workspace_error(&result));
        assert!(result.contains("No active beads workspace found."));
    }
}
