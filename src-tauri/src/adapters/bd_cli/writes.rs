use super::exec::{run_bd, run_bd_mut};
use super::reads::get_bead_detail_inner;
use crate::domain::BeadUpdateInput;
use crate::registry::resolve_writable_dir;
use std::env;

pub(crate) fn update_bead_status_inner(
    project_id: &str,
    id: &str,
    status: &str,
) -> Result<(), String> {
    let dir = resolve_writable_dir(project_id)?;
    run_bd(&dir, &["update", id, "--status", status])?;
    Ok(())
}

pub(crate) fn build_update_bead_args(
    id: &str,
    update: &BeadUpdateInput,
    existing_labels: &[String],
) -> Vec<String> {
    let mut args = vec!["update".to_string(), id.to_string()];

    if let Some(title) = &update.title {
        args.push("--title".to_string());
        args.push(title.clone());
    }
    if let Some(description) = &update.description {
        args.push("--description".to_string());
        args.push(description.clone());
    }
    if let Some(acceptance) = &update.acceptance_criteria {
        args.push("--acceptance".to_string());
        args.push(acceptance.clone());
    }
    if let Some(design) = &update.design {
        args.push("--design".to_string());
        args.push(design.clone());
    }
    if let Some(notes) = &update.notes {
        args.push("--notes".to_string());
        args.push(notes.clone());
    }
    if let Some(priority) = update.priority {
        args.push("--priority".to_string());
        args.push(priority.to_string());
    }
    if let Some(issue_type) = &update.issue_type {
        args.push("--type".to_string());
        args.push(issue_type.clone());
    }
    if let Some(assignee) = &update.assignee {
        args.push("--assignee".to_string());
        args.push(assignee.clone());
    }
    if let Some(labels) = &update.labels {
        if !labels.is_empty() {
            args.push("--set-labels".to_string());
            args.push(labels.join(","));
        } else {
            for label in existing_labels {
                args.push("--remove-label".to_string());
                args.push(label.clone());
            }
        }
    }

    args
}

pub(crate) fn update_bead_inner(
    project_id: &str,
    id: &str,
    update: BeadUpdateInput,
) -> Result<(), String> {
    let dir = resolve_writable_dir(project_id)?;
    let existing_labels = if update.labels.is_some() {
        get_bead_detail_inner(project_id, id)?.bead.labels
    } else {
        Vec::new()
    };
    let args = build_update_bead_args(id, &update, &existing_labels);
    if args.len() <= 2 {
        return Ok(());
    }
    run_bd_mut(&dir, &args)?;
    Ok(())
}

pub(crate) fn build_preview_delete_bead_args(id: &str) -> Vec<String> {
    vec![
        "delete".to_string(),
        id.to_string(),
        "--cascade".to_string(),
    ]
}

pub(crate) fn build_delete_bead_args(id: &str) -> Vec<String> {
    vec![
        "delete".to_string(),
        id.to_string(),
        "--cascade".to_string(),
        "--force".to_string(),
    ]
}

pub(crate) fn preview_delete_bead_inner(project_id: &str, id: &str) -> Result<String, String> {
    let dir = resolve_writable_dir(project_id)?;
    let args = build_preview_delete_bead_args(id);
    let out = run_bd_mut(&dir, &args)?;
    Ok(out.trim().to_string())
}

pub(crate) fn delete_bead_inner(project_id: &str, id: &str) -> Result<(), String> {
    let dir = resolve_writable_dir(project_id)?;
    let args = build_delete_bead_args(id);
    run_bd_mut(&dir, &args)
        .map(|_| ())
        .map_err(|err| format!("Unable to delete bead. {err}"))
}

pub(crate) fn create_bead_inner(
    project_id: &str,
    title: &str,
    description: Option<&str>,
    kind: Option<&str>,
    parent: Option<&str>,
) -> Result<String, String> {
    let dir = resolve_writable_dir(project_id)?;
    let mut args = vec![
        "create".to_string(),
        "--title".to_string(),
        title.to_string(),
        "--silent".to_string(),
    ];
    if let Some(description) = description.filter(|s| !s.is_empty()) {
        args.push("-d".to_string());
        args.push(description.to_string());
    }
    if let Some(kind) = kind.filter(|s| !s.is_empty()) {
        args.push("--type".to_string());
        args.push(kind.to_string());
    }
    if let Some(parent) = parent.filter(|s| !s.is_empty()) {
        args.push("--parent".to_string());
        args.push(parent.to_string());
    }
    let out = run_bd_mut(&dir, &args)?;
    Ok(out.trim().to_string())
}

pub(crate) fn add_comment_inner(project_id: &str, id: &str, text: &str) -> Result<(), String> {
    let dir = resolve_writable_dir(project_id)?;
    let mut args: Vec<String> = Vec::new();
    // BD_BOARD_AUTHOR is the board's own override; otherwise bd records its own actor.
    if let Some(a) = board_author_override() {
        args.push("--actor".to_string());
        args.push(a);
    }
    args.extend(["comment".to_string(), id.to_string(), text.to_string()]);
    run_bd_mut(&dir, &args)?;
    Ok(())
}

pub(crate) fn board_author_override() -> Option<String> {
    env::var("BD_BOARD_AUTHOR")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

pub(crate) fn enable_events_journal_inner(project_id: &str) -> Result<(), String> {
    run_bd(
        &resolve_writable_dir(project_id)?,
        &["config", "set", "events-journal", "true"],
    )
    .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_update_bead_args_builds_arguments_for_editable_fields() {
        let update = BeadUpdateInput {
            title: Some("Updated title".to_string()),
            description: Some("Updated description".to_string()),
            acceptance_criteria: Some("Updated acceptance".to_string()),
            design: Some("Updated design".to_string()),
            notes: Some("Updated notes".to_string()),
            priority: Some(0),
            issue_type: Some("feature".to_string()),
            assignee: Some("Jean".to_string()),
            labels: Some(vec!["backend".to_string(), "ui".to_string()]),
        };

        let args = build_update_bead_args("bd-board-a2k", &update, &[]);

        assert_eq!(
            args,
            vec![
                "update",
                "bd-board-a2k",
                "--title",
                "Updated title",
                "--description",
                "Updated description",
                "--acceptance",
                "Updated acceptance",
                "--design",
                "Updated design",
                "--notes",
                "Updated notes",
                "--priority",
                "0",
                "--type",
                "feature",
                "--assignee",
                "Jean",
                "--set-labels",
                "backend,ui",
            ]
        );
    }

    #[test]
    fn build_update_bead_args_removes_existing_labels_when_labels_explicitly_empty() {
        let update = BeadUpdateInput {
            labels: Some(vec![]),
            ..Default::default()
        };
        let existing = vec!["old".to_string(), "ui".to_string()];

        let args = build_update_bead_args("bd-board-a2k", &update, &existing);

        assert_eq!(
            args,
            vec![
                "update",
                "bd-board-a2k",
                "--remove-label",
                "old",
                "--remove-label",
                "ui",
            ]
        );
    }

    #[test]
    fn delete_bead_args_keep_preview_and_confirmed_commands_separate() {
        assert_eq!(
            build_preview_delete_bead_args("bd-board-a2k"),
            vec!["delete", "bd-board-a2k", "--cascade"]
        );
        assert_eq!(
            build_delete_bead_args("bd-board-a2k"),
            vec!["delete", "bd-board-a2k", "--cascade", "--force"]
        );
    }
}
