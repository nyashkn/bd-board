use serde::Serialize;
use serde_json::Value;

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

/// Parses `bd dolt show --json` defensively: anything unexpected is an error, never a guess.
pub fn parse_dolt_show(stdout: &str, sources: Vec<String>) -> DoltProbe {
    let Ok(Value::Object(o)) = serde_json::from_str::<Value>(stdout) else {
        return DoltProbe::error("bd dolt show did not print a JSON object", sources);
    };
    let Some(embedded) = o.get("embedded").and_then(Value::as_bool) else {
        return DoltProbe::error("bd dolt show printed an unexpected shape", sources);
    };
    let text = |k: &str| o.get(k).and_then(Value::as_str).map(String::from);
    DoltProbe {
        embedded: Some(embedded),
        host: text("host"),
        port: o
            .get("port")
            .and_then(Value::as_u64)
            .and_then(|p| u16::try_from(p).ok()),
        database: text("database"),
        connection_ok: o.get("connection_ok").and_then(Value::as_bool),
        schema_version: o.get("schema_version").and_then(Value::as_i64),
        error: None,
        sources,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_embedded_mode() {
        let p = parse_dolt_show(
            r#"{"backend":"dolt","data_dir":"/d","database":"hq","embedded":true,"schema_version":9}"#,
            vec![],
        );
        assert_eq!(p.embedded, Some(true));
        assert_eq!(p.database.as_deref(), Some("hq"));
        assert_eq!(p.schema_version, Some(9));
        assert_eq!(
            (p.host, p.port, p.connection_ok, p.error),
            (None, None, None, None)
        );
    }

    #[test]
    fn parses_server_mode() {
        let p = parse_dolt_show(
            r#"{"backend":"dolt","connection_ok":true,"database":"hq","embedded":false,"host":"127.0.0.1","port":61687,"schema_version":1,"shared_server":false,"tls":false,"user":"root"}"#,
            vec!["bd:".into()],
        );
        assert_eq!(p.embedded, Some(false));
        assert_eq!(p.host.as_deref(), Some("127.0.0.1"));
        assert_eq!(p.port, Some(61687));
        assert_eq!(p.connection_ok, Some(true));
        assert_eq!(p.sources, vec!["bd:".to_string()]);
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["connectionOk"], true);
        assert!(v.get("error").is_none());
    }

    #[test]
    fn garbage_becomes_an_error_that_keeps_sources() {
        for raw in [
            "",
            "not json",
            "[]",
            r#"{"embedded":"yes"}"#,
            r#"{"host":"x"}"#,
        ] {
            let p = parse_dolt_show(raw, vec!["bd:".into()]);
            assert!(p.error.is_some(), "{raw}");
            assert_eq!(p.embedded, None);
            assert_eq!(p.sources, vec!["bd:".to_string()]);
        }
    }
}
