use serde::Serialize;

/// What `bd dolt show --json` says about a project (mirrors `ProbeReply` in
/// src/lib/connector-select.ts): either the mode fields or `error`, plus the registry `sources`.
#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DoltProbe {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedded: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_ok: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema_version: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub sources: Vec<String>,
}

impl DoltProbe {
    pub fn error(message: impl Into<String>, sources: Vec<String>) -> Self {
        DoltProbe {
            error: Some(message.into()),
            sources,
            ..Default::default()
        }
    }
}
