use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BeadFeedMessage {
    Live {
        seq: i64,
    },
    /// `ops` are the journal ops behind the change; empty means unknown.
    Change {
        seq: i64,
        issue_ids: Vec<String>,
        ops: Vec<String>,
    },
    Disabled,
    Unsupported {
        message: String,
    },
    Error {
        message: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bead_feed_message_change_serializes_correctly() {
        let msg = BeadFeedMessage::Change {
            seq: 5,
            issue_ids: vec!["x".to_string()],
            ops: vec!["comment".to_string()],
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert_eq!(
            json,
            r#"{"type":"change","seq":5,"issueIds":["x"],"ops":["comment"]}"#
        );
    }
}
