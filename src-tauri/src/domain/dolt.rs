use serde::{Deserialize, Serialize};

/// What `bd dolt show --json` says about a project (mirrors `ProbeReply` in
/// src/lib/connectors/select.ts): either the mode fields or `error`, plus the registry `sources`.
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
    /// Read from `bd dolt show` for the SQL reader; never sent to the webview.
    #[serde(skip)]
    pub user: Option<String>,
    #[serde(skip)]
    pub tls: Option<bool>,
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

/// A registry `credentials_ref`: environment variable NAMES, never values, and the form says which
/// connector it is for. A string is the http-snapshot reader token (`BD_BOARD_SNAPSHOT_*`, read by
/// the web server); an object is the dolt-sql login. Each connector accepts only its own form.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(untagged)]
pub enum CredentialsRef {
    Token(String),
    Login(DoltLogin),
}

/// `BD_BOARD_SNAPSHOT_` followed by upper-case letters, digits and underscores.
pub fn is_snapshot_token_var(s: &str) -> bool {
    s.strip_prefix("BD_BOARD_SNAPSHOT_").is_some_and(|rest| {
        !rest.is_empty()
            && rest
                .chars()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
    })
}

impl CredentialsRef {
    /// Errors say what is wrong, never the value.
    pub fn check(&self) -> Result<(), String> {
        match self {
            CredentialsRef::Token(name) if is_snapshot_token_var(name) => Ok(()),
            CredentialsRef::Token(_) => Err("\"credentials_ref\" must be an environment variable named BD_BOARD_SNAPSHOT_<NAME> (http-snapshot), or an object naming the SQL user and password variables (dolt-sql)".to_string()),
            CredentialsRef::Login(login) => login.check(),
        }
    }

    /// The SQL login names, when this ref is the dolt-sql form.
    pub fn login(&self) -> Option<&DoltLogin> {
        match self {
            CredentialsRef::Login(l) => Some(l),
            CredentialsRef::Token(_) => None,
        }
    }
}

/// Names of the environment variables that hold the SQL user and password.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct DoltLogin {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
}

/// The only variables a registry entry may name. Anything else (say `AWS_SECRET_ACCESS_KEY`)
/// would let a `mysql://attacker/db` source collect it: with `caching_sha2_password` the server
/// can ask for the password in clear. `DOLT_REMOTE_USER` / `DOLT_REMOTE_PASSWORD` are the hub
/// convention; `BD_BOARD_DOLT_*` is for everything else.
pub fn is_allowed_credential_var(s: &str) -> bool {
    matches!(s, "DOLT_REMOTE_USER" | "DOLT_REMOTE_PASSWORD")
        || s.strip_prefix("BD_BOARD_DOLT_").is_some_and(|rest| {
            !rest.is_empty()
                && rest
                    .chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
        })
}

impl DoltLogin {
    /// Errors name the field, never its value.
    pub fn check(&self) -> Result<(), String> {
        for (field, v) in [("user", &self.user), ("password", &self.password)] {
            if v.as_deref().is_some_and(|v| !is_allowed_credential_var(v)) {
                return Err(format!(
                    "credentials_ref.{field} must name DOLT_REMOTE_USER, DOLT_REMOTE_PASSWORD or a BD_BOARD_DOLT_* environment variable"
                ));
            }
        }
        Ok(())
    }
}

#[cfg_attr(not(feature = "dolt-sql"), allow(dead_code))]
/// Plaintext SQL is only for this machine: 127.0.0.0/8, `::1` and `localhost`.
pub fn is_loopback_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback())
}

#[cfg_attr(not(feature = "dolt-sql"), allow(dead_code))]
/// A password must not cross a network in clear.
pub fn check_transport(host: &str, tls: bool) -> Result<(), String> {
    if tls || is_loopback_host(host) {
        Ok(())
    } else {
        Err("remote source requires tls=true".to_string())
    }
}

/// Where a `mysql://host:port/database[?tls=true]` source points. The URL never carries a user or
/// a password; those come from `credentials_ref` or bd's own lookup.
#[derive(Debug, Clone, PartialEq)]
pub struct DoltUrl {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub tls: bool,
}

fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = s.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Errors say what is wrong, never the URL (it could name a private host).
pub fn parse_mysql_url(url: &str) -> Result<DoltUrl, String> {
    let rest = url
        .strip_prefix("mysql://")
        .ok_or("source is not a mysql:// URL")?;
    let (authority, tail) = rest.split_once('/').ok_or("source has no database name")?;
    if authority.contains('@') {
        return Err("source must not carry a user or password; use credentials_ref".into());
    }
    let (host, port) = if let Some(v6) = authority.strip_prefix('[') {
        let (h, after) = v6.split_once(']').ok_or("source has an invalid host")?;
        (h, after.strip_prefix(':'))
    } else {
        match authority.split_once(':') {
            Some((h, p)) => (h, Some(p)),
            None => (authority, None),
        }
    };
    let port = match port {
        Some(p) => p.parse::<u16>().map_err(|_| "source has an invalid port")?,
        None => 3306,
    };
    if host.is_empty() {
        return Err("source has no host".into());
    }
    let (db, query) = tail.split_once('?').unwrap_or((tail, ""));
    let database = percent_decode(db).filter(|d| !d.is_empty() && !d.contains('/'));
    let database = database.ok_or("source has an invalid database name")?;
    let tls = query
        .split('&')
        .any(|kv| matches!(kv, "tls=true" | "tls=1" | "ssl=true" | "ssl=1"));
    Ok(DoltUrl {
        host: host.to_string(),
        port,
        database,
        tls,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_host_port_database_and_tls() {
        let u = parse_mysql_url("mysql://dolt-hub.example:3307/my%20db?tls=true").unwrap();
        assert_eq!(
            u,
            DoltUrl {
                host: "dolt-hub.example".into(),
                port: 3307,
                database: "my db".into(),
                tls: true
            }
        );
        let u = parse_mysql_url("mysql://127.0.0.1/mydb").unwrap();
        assert_eq!((u.port, u.tls), (3306, false));
        assert_eq!(
            parse_mysql_url("mysql://[::1]:3307/mydb").unwrap().host,
            "::1"
        );
    }

    #[test]
    fn credentials_ref_may_only_name_the_allowed_variables() {
        for name in [
            "DOLT_REMOTE_USER",
            "DOLT_REMOTE_PASSWORD",
            "BD_BOARD_DOLT_PASSWORD",
            "BD_BOARD_DOLT_HUB_2_USER",
        ] {
            let ok = DoltLogin {
                user: Some(name.into()),
                password: Some(name.into()),
            };
            assert!(ok.check().is_ok(), "{name}");
        }
        assert!(DoltLogin::default().check().is_ok());
        for bad in [
            "AWS_SECRET_ACCESS_KEY",
            "GITHUB_TOKEN",
            "HOME",
            "BEADS_DOLT_PASSWORD",
            "BD_BOARD_DOLT_",
            "BD_BOARD_DOLT_lower",
            "hunter2",
            "p@ss word",
            "",
        ] {
            let err = DoltLogin {
                user: None,
                password: Some(bad.into()),
            }
            .check()
            .unwrap_err();
            // one fixed message: the value is never echoed
            assert_eq!(
                err,
                "credentials_ref.password must name DOLT_REMOTE_USER, DOLT_REMOTE_PASSWORD or a BD_BOARD_DOLT_* environment variable"
            );
        }
    }

    #[test]
    fn one_credentials_ref_two_forms_each_checked_for_its_own_connector() {
        let parse = |v: serde_json::Value| serde_json::from_value::<CredentialsRef>(v);
        // http-snapshot: a string, BD_BOARD_SNAPSHOT_* only
        let token = parse(serde_json::json!("BD_BOARD_SNAPSHOT_TOKEN")).unwrap();
        assert!(token.check().is_ok() && token.login().is_none());
        for bad in [
            "AWS_SECRET_ACCESS_KEY",
            "DOLT_REMOTE_PASSWORD",
            "BD_BOARD_DOLT_PASSWORD",
            "BD_BOARD_SNAPSHOT_",
            "BD_BOARD_SNAPSHOT_lower",
            "s3cret-token",
        ] {
            let err = parse(serde_json::json!(bad)).unwrap().check().unwrap_err();
            // one fixed message: the value is never echoed
            assert!(err.starts_with("\"credentials_ref\" must be"), "{err}");
        }
        // dolt-sql: an object, its own names only
        let login = parse(serde_json::json!({"password": "DOLT_REMOTE_PASSWORD"})).unwrap();
        assert!(login.check().is_ok() && login.login().is_some());
        for bad in ["AWS_SECRET_ACCESS_KEY", "BD_BOARD_SNAPSHOT_TOKEN"] {
            let r = parse(serde_json::json!({ "password": bad })).unwrap();
            assert!(r.check().is_err(), "{bad}");
        }
        // a typo in the object is an error, not a silently empty login
        assert!(parse(serde_json::json!({"pass": "DOLT_REMOTE_PASSWORD"})).is_err());
    }

    #[test]
    fn plaintext_is_only_for_loopback() {
        for host in ["127.0.0.1", "127.1.2.3", "::1", "localhost", "LOCALHOST"] {
            assert!(check_transport(host, false).is_ok(), "{host}");
        }
        for host in [
            "dolt-hub.example",
            "10.0.0.5",
            "192.168.1.2",
            "0.0.0.0",
            "127.0.0.1.example",
            "::ffff:10.0.0.1",
        ] {
            let err = check_transport(host, false).unwrap_err();
            assert_eq!(err, "remote source requires tls=true");
            assert!(check_transport(host, true).is_ok());
        }
        // the URL's own flag is what the check receives
        let u = parse_mysql_url("mysql://dolt-hub.example:3306/mydb").unwrap();
        assert!(check_transport(&u.host, u.tls).is_err());
        let u = parse_mysql_url("mysql://dolt-hub.example:3306/mydb?tls=true").unwrap();
        assert!(check_transport(&u.host, u.tls).is_ok());
    }

    #[test]
    fn refuses_secrets_in_the_url_and_never_echoes_it() {
        for bad in [
            "mysql://root:hunter2@dolt-hub.example:3306/mydb",
            "mysql://dolt-hub.example:99999/mydb",
            "mysql://dolt-hub.example:3306",
            "mysql:///mydb",
            "https://dolt-hub.example/mydb",
        ] {
            let err = parse_mysql_url(bad).unwrap_err();
            assert!(
                !err.contains("hunter2") && !err.contains("dolt-hub"),
                "{err}"
            );
        }
    }
}
