use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize, Clone)]
pub struct Comment {
    pub id: String,
    pub author: Option<String>,
    pub text: String,
    pub created_at: Option<String>,
}

#[derive(Serialize)]
pub struct RelatedBead {
    pub id: String,
    pub title: String,
    pub status: String,
    pub issue_type: String,
    pub dependency_type: String,
}

#[derive(Serialize, Clone)]
pub struct Bead {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub acceptance_criteria: Option<String>,
    pub design: Option<String>,
    pub notes: Option<String>,
    pub status: String,
    pub priority: i64,
    pub issue_type: String,
    pub assignee: Option<String>,
    pub owner: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub closed_at: Option<String>,
    pub labels: Vec<String>,
    pub parent: Option<String>,
    pub spec_id: Option<String>,
    pub external_ref: Option<String>,
    pub metadata: Option<Value>,
    pub comment_count: Option<i64>,
    pub dependency_count: Option<i64>,
    pub dependent_count: Option<i64>,
    /// Open blockers from `bd blocked --json`; None when bd could not say.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub waiting_on: Option<Vec<String>>,
    /// Membership in `bd ready --json`; None when bd could not say.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ready: Option<bool>,
    pub children: Option<Vec<String>>,
    // The frontend reads `childBeads`; every other field stays snake_case.
    #[serde(rename = "childBeads")]
    pub child_beads: Option<Vec<Bead>>,
    /// Dependency edges from `dependencies[].depends_on_id`; None when the bead has none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub links: Option<Vec<BeadLink>>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct BeadLink {
    pub id: String,
    #[serde(rename = "type")]
    pub link_type: String,
    /// "outgoing" | "incoming"
    pub direction: String,
}

#[derive(Serialize)]
pub struct BeadDetail {
    #[serde(flatten)]
    pub bead: Bead,
    pub dependencies: Vec<RelatedBead>,
    pub comments: Vec<Comment>,
}

#[derive(Deserialize, Default)]
pub struct BeadUpdateInput {
    pub title: Option<String>,
    pub description: Option<String>,
    pub acceptance_criteria: Option<String>,
    pub design: Option<String>,
    pub notes: Option<String>,
    pub priority: Option<i64>,
    pub issue_type: Option<String>,
    pub assignee: Option<String>,
    pub labels: Option<Vec<String>>,
}
