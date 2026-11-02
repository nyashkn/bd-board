use super::bd_json::{value_opt_str, value_str};
use serde::Serialize;
use serde_json::Value;

const COMMENTS_LIMIT: usize = 250;
const KNOWLEDGE_LIMIT: usize = 500;

#[derive(Serialize)]
pub struct ProjectComment {
    pub id: String,
    pub bead_id: String,
    pub bead_title: Option<String>,
    pub author: Option<String>,
    pub text: String,
    pub created_at: Option<String>,
    pub knowledge_type: Option<String>,
}

#[derive(Serialize)]
pub struct ProjectKnowledgeEntry {
    pub id: String,
    pub bead_id: String,
    pub bead_title: Option<String>,
    pub author: Option<String>,
    pub text: String,
    pub created_at: Option<String>,
    #[serde(rename = "type")]
    pub kind: String,
    pub content: String,
    pub knowledge_type: Option<String>,
}

#[derive(Serialize)]
pub struct ProjectKnowledge {
    pub comments: Vec<ProjectComment>,
    pub knowledge: Vec<ProjectKnowledgeEntry>,
}

pub(crate) fn parse_comment_text(text: &str) -> Option<(String, String)> {
    let trimmed = text.trim_start();
    let lower = trimmed.to_ascii_uppercase();
    let prefixes = [
        "LEARNED:",
        "DECISION:",
        "FACT:",
        "PATTERN:",
        "INVESTIGATION:",
        "MUST-CHECK:",
        "DEVIATION:",
    ];

    for prefix in prefixes {
        if let Some(_rest) = lower.strip_prefix(prefix) {
            let content = trimmed[prefix.len()..].trim();
            if content.is_empty() {
                return None;
            }
            let kind = prefix.trim_end_matches(':').to_ascii_lowercase();
            return Some((kind, content.to_string()));
        }
    }

    None
}

pub(crate) fn map_project_comment(value: &Value) -> ProjectComment {
    let text = value
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let knowledge_type = parse_comment_text(&text).map(|(kind, _)| kind);
    ProjectComment {
        id: value_str(value, "id"),
        bead_id: value_str(value, "bead_id").if_empty_then(|| value_str(value, "issue_id")),
        bead_title: value_opt_str(value, "bead_title")
            .or_else(|| value_opt_str(value, "title"))
            .filter(|s| !s.is_empty()),
        author: value_opt_str(value, "author").or_else(|| value_opt_str(value, "created_by")),
        text,
        created_at: value_opt_str(value, "created_at"),
        knowledge_type,
    }
}

pub(crate) trait EmptyFallback {
    fn if_empty_then(self, fallback: impl FnOnce() -> String) -> String;
}

impl EmptyFallback for String {
    fn if_empty_then(self, fallback: impl FnOnce() -> String) -> String {
        if self.is_empty() {
            fallback()
        } else {
            self
        }
    }
}

pub(crate) fn map_knowledge_entry(value: &Value) -> Option<ProjectKnowledgeEntry> {
    let comment = map_project_comment(value);
    let (kind, content) = parse_comment_text(&comment.text)?;
    let knowledge_type = Some(kind.clone());
    Some(ProjectKnowledgeEntry {
        id: comment.id,
        bead_id: comment.bead_id,
        bead_title: comment.bead_title,
        author: comment.author,
        text: comment.text,
        created_at: comment.created_at,
        kind,
        content,
        knowledge_type,
    })
}

pub(crate) fn build_project_knowledge(issues: &[Value]) -> ProjectKnowledge {
    let mut raw_comments: Vec<Value> = Vec::new();
    for issue in issues {
        let title = issue.get("title").cloned().unwrap_or(Value::Null);
        if let Some(Value::Array(issue_comments)) = issue.get("comments") {
            for comment in issue_comments {
                let mut merged = comment.clone();
                if let Value::Object(map) = &mut merged {
                    map.insert("title".to_string(), title.clone());
                }
                raw_comments.push(merged);
            }
        }
    }

    let by_date_desc = |a: &Option<String>, b: &Option<String>| {
        b.as_deref().unwrap_or("").cmp(a.as_deref().unwrap_or(""))
    };

    let mut comments: Vec<ProjectComment> = raw_comments.iter().map(map_project_comment).collect();
    comments.sort_by(|a, b| by_date_desc(&a.created_at, &b.created_at));
    comments.truncate(COMMENTS_LIMIT);

    let mut knowledge: Vec<ProjectKnowledgeEntry> = raw_comments
        .iter()
        .filter_map(map_knowledge_entry)
        .collect();
    knowledge.sort_by(|a, b| by_date_desc(&a.created_at, &b.created_at));
    knowledge.truncate(KNOWLEDGE_LIMIT);

    ProjectKnowledge {
        comments,
        knowledge,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn build_project_knowledge_combines_and_orders_comments_newest_first() {
        let issues = vec![
            json!({
                "id": "ravo-fvs",
                "title": "Primeiro deploy manual",
                "comments": [{
                    "id": "c1",
                    "issue_id": "ravo-fvs",
                    "author": "Jean",
                    "text": "ping",
                    "created_at": "2026-08-10T00:00:00Z",
                }],
            }),
            json!({
                "id": "ravo-cbf",
                "title": "Ligar backup automático",
                "comments": [{
                    "id": "c2",
                    "issue_id": "ravo-cbf",
                    "author": "Jean",
                    "text": "LEARNED: backups precisam de restore testado",
                    "created_at": "2026-08-12T00:00:00Z",
                }],
            }),
        ];

        let result = build_project_knowledge(&issues);
        let ids: Vec<&str> = result.comments.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, vec!["c2", "c1"]);
        assert_eq!(result.comments[0].bead_id, "ravo-cbf");
        assert_eq!(
            result.comments[0].bead_title.as_deref(),
            Some("Ligar backup automático")
        );
    }

    #[test]
    fn build_project_knowledge_splits_tagged_and_plain_comments() {
        let issues = vec![json!({
            "id": "ravo-cbf",
            "title": "Ligar backup automático",
            "comments": [
                {
                    "id": "c1",
                    "issue_id": "ravo-cbf",
                    "author": "Jean",
                    "text": "LEARNED: backups precisam de restore testado",
                    "created_at": "2026-08-12T00:00:00Z",
                },
                {
                    "id": "c2",
                    "issue_id": "ravo-cbf",
                    "author": "Jean",
                    "text": "just a note",
                    "created_at": "2026-08-11T00:00:00Z",
                },
            ],
        })];

        let result = build_project_knowledge(&issues);
        assert_eq!(result.comments.len(), 2);
        assert_eq!(result.knowledge.len(), 1);
        assert_eq!(result.knowledge[0].id, "c1");
        assert_eq!(result.knowledge[0].kind, "learned");
        assert_eq!(
            result.knowledge[0].content,
            "backups precisam de restore testado"
        );
    }

    #[test]
    fn build_project_knowledge_handles_issue_without_comments() {
        let issues = vec![json!({"id": "ravo-nyu", "title": "No comments"})];
        let result = build_project_knowledge(&issues);
        assert!(result.comments.is_empty());
        assert!(result.knowledge.is_empty());
    }

    #[test]
    fn build_project_knowledge_truncates_to_configured_limits() {
        let many: Vec<Value> = (0..(COMMENTS_LIMIT + 20))
            .map(|i| {
                json!({
                    "id": format!("c{i}"),
                    "issue_id": "ravo-many",
                    "author": "Jean",
                    "text": format!("LEARNED: entry {i}"),
                    "created_at": format!("2026-08-{:02}T00:00:00Z", (i % 28) + 1),
                })
            })
            .collect();
        let issues = vec![json!({"id": "ravo-many", "title": "Many comments", "comments": many})];

        let result = build_project_knowledge(&issues);
        assert_eq!(result.comments.len(), COMMENTS_LIMIT);
        assert_eq!(
            result.knowledge.len(),
            KNOWLEDGE_LIMIT.min(COMMENTS_LIMIT + 20)
        );
    }
}
