//! Where the SQL user, password and TLS flag come from. Only names and lookups live in config;
//! the secret itself is read here, at connect time, and never stored, logged or returned.

use crate::domain::dolt::is_allowed_credential_var;
use crate::domain::DoltLogin;
use std::path::PathBuf;

pub(super) struct Credentials {
    pub user: String,
    pub password: String,
}

// A derived Debug would print the password.
impl std::fmt::Debug for Credentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Credentials").finish_non_exhaustive()
    }
}

pub(super) type Env<'a> = &'a dyn Fn(&str) -> Option<String>;

fn nonempty(v: Option<String>) -> Option<String> {
    v.filter(|v| !v.is_empty())
}

/// `[host:port]` sections of bd's credentials file, `password = x` inside (INI).
fn file_password(text: &str, host: &str, port: u16) -> Option<String> {
    let want = format!("{host}:{port}");
    let mut in_section = false;
    for line in text.lines().map(str::trim) {
        if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            in_section = name.trim() == want;
        } else if in_section {
            if let Some((k, v)) = line.split_once('=') {
                if k.trim() == "password" {
                    return nonempty(Some(v.trim().to_string()));
                }
            }
        }
    }
    None
}

fn credentials_path(env: Env) -> Option<PathBuf> {
    if let Some(p) = nonempty(env("BEADS_CREDENTIALS_FILE")) {
        return Some(PathBuf::from(p));
    }
    let home = nonempty(env("HOME")).or_else(|| nonempty(env("USERPROFILE")))?;
    Some(PathBuf::from(home).join(".config/beads/credentials"))
}

/// Where the target came from decides what may supply the login.
///
/// - An explicit `mysql://` source (`from_bd_probe` false): the `credentials_ref` variables, else
///   the `[host:port]` entry of bd's credentials file, else none. bd's own variables
///   (`BEADS_DOLT_PASSWORD`, `BEADS_DOLT_SERVER_USER`) are never offered to a host the registry
///   merely names.
/// - The server `bd dolt show` reported (`from_bd_probe` true): the way bd resolves it, i.e.
///   `BEADS_DOLT_SERVER_USER` (else the user bd reports, else root), `BEADS_DOLT_PASSWORD`, then
///   the credentials file, then none.
///
/// A `credentials_ref` may only name the allowed variables, checked again here.
pub(super) fn resolve(
    refs: Option<&DoltLogin>,
    host: &str,
    port: u16,
    from_bd_probe: bool,
    bd_user: Option<&str>,
    env: Env,
    read_file: &dyn Fn(&std::path::Path) -> Option<String>,
) -> Result<Credentials, String> {
    let named = |name: &str| {
        if !is_allowed_credential_var(name) {
            return Err("credentials_ref names a variable that is not allowed".to_string());
        }
        nonempty(env(name)).ok_or_else(|| format!("credentials_ref: ${name} is not set"))
    };
    let file = || {
        let text = read_file(&credentials_path(env)?)?;
        file_password(&text, host, port)
    };
    let probe_user = || {
        nonempty(env("BEADS_DOLT_SERVER_USER"))
            .or_else(|| bd_user.map(String::from))
            .unwrap_or_else(|| "root".to_string())
    };
    let default_user = || {
        if from_bd_probe {
            probe_user()
        } else {
            "root".to_string()
        }
    };
    if let Some(refs) = refs {
        let user = match &refs.user {
            Some(name) => named(name)?,
            None => default_user(),
        };
        let password = match &refs.password {
            Some(name) => named(name)?,
            None => String::new(),
        };
        return Ok(Credentials { user, password });
    }
    let password = if from_bd_probe {
        nonempty(env("BEADS_DOLT_PASSWORD")).or_else(file)
    } else {
        file()
    };
    Ok(Credentials {
        user: default_user(),
        password: password.unwrap_or_default(),
    })
}

pub(super) fn tls_from_env(env: Env) -> bool {
    matches!(
        nonempty(env("BEADS_DOLT_SERVER_TLS")).as_deref(),
        Some("1") | Some("true")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |k| map.get(k).cloned()
    }

    const FILE: &str =
        "[other:1]\npassword = nope\n\n[dolt-hub.example:3306]\n  password = from-file \n";

    #[test]
    fn credentials_ref_reads_the_named_variables() {
        let refs = DoltLogin {
            user: Some("DOLT_REMOTE_USER".into()),
            password: Some("DOLT_REMOTE_PASSWORD".into()),
        };
        let e = env(&[
            ("DOLT_REMOTE_USER", "reader"),
            ("DOLT_REMOTE_PASSWORD", "s3cret"),
            ("BEADS_DOLT_PASSWORD", "ignored"),
        ]);
        let c = resolve(
            Some(&refs),
            "dolt-hub.example",
            3306,
            false,
            None,
            &e,
            &|_| None,
        )
        .unwrap();
        assert_eq!((c.user.as_str(), c.password.as_str()), ("reader", "s3cret"));
    }

    #[test]
    fn a_missing_variable_names_itself_but_nothing_else() {
        let refs = DoltLogin {
            user: None,
            password: Some("DOLT_REMOTE_PASSWORD".into()),
        };
        let err = resolve(
            Some(&refs),
            "dolt-hub.example",
            3306,
            false,
            None,
            &env(&[]),
            &|_| None,
        )
        .unwrap_err();
        assert!(
            err.contains("DOLT_REMOTE_PASSWORD") && !err.contains("dolt-hub"),
            "{err}"
        );
    }

    #[test]
    fn a_ref_to_any_other_variable_is_refused_even_when_set() {
        let e = env(&[("AWS_SECRET_ACCESS_KEY", "topsecret")]);
        for refs in [
            DoltLogin {
                user: None,
                password: Some("AWS_SECRET_ACCESS_KEY".into()),
            },
            DoltLogin {
                user: Some("AWS_SECRET_ACCESS_KEY".into()),
                password: None,
            },
        ] {
            for probe in [false, true] {
                let err = resolve(
                    Some(&refs),
                    "attacker.example",
                    3306,
                    probe,
                    None,
                    &e,
                    &|_| None,
                )
                .unwrap_err();
                assert!(!err.contains("topsecret"), "{err}");
            }
        }
        let ok = DoltLogin {
            user: None,
            password: Some("BD_BOARD_DOLT_HUB_PASSWORD".into()),
        };
        let e = env(&[("BD_BOARD_DOLT_HUB_PASSWORD", "pw")]);
        let c = resolve(Some(&ok), "h", 1, false, None, &e, &|_| None).unwrap();
        assert_eq!((c.user.as_str(), c.password.as_str()), ("root", "pw"));
    }

    #[test]
    fn bd_variables_only_reach_the_server_bd_reported() {
        let file = |_: &std::path::Path| Some(FILE.to_string());
        let e = env(&[
            ("HOME", "/home/u"),
            ("BEADS_DOLT_PASSWORD", "from-env"),
            ("BEADS_DOLT_SERVER_USER", "bob"),
        ]);
        // bd's own server: env wins, as in bd
        let c = resolve(
            None,
            "dolt-hub.example",
            3306,
            true,
            Some("alice"),
            &e,
            &file,
        )
        .unwrap();
        assert_eq!((c.user.as_str(), c.password.as_str()), ("bob", "from-env"));
        // an explicit source: the credentials file entry only, never bd's variables
        let c = resolve(
            None,
            "dolt-hub.example",
            3306,
            false,
            Some("alice"),
            &e,
            &file,
        )
        .unwrap();
        assert_eq!(
            (c.user.as_str(), c.password.as_str()),
            ("root", "from-file")
        );
        let c = resolve(None, "other.example", 3306, false, None, &e, &file).unwrap();
        assert_eq!((c.user.as_str(), c.password.as_str()), ("root", ""));
        // a ref without a user does not borrow bd's user for an explicit source either
        let refs = DoltLogin {
            user: None,
            password: Some("DOLT_REMOTE_PASSWORD".into()),
        };
        let e = env(&[
            ("BEADS_DOLT_SERVER_USER", "bob"),
            ("DOLT_REMOTE_PASSWORD", "p"),
        ]);
        let c = resolve(Some(&refs), "h", 1, false, None, &e, &|_| None).unwrap();
        assert_eq!(c.user, "root");
    }

    #[test]
    fn without_a_ref_the_bd_server_follows_bd_env_then_file_then_empty() {
        let file = |_: &std::path::Path| Some(FILE.to_string());
        let home = env(&[("HOME", "/home/u")]);
        let c = resolve(None, "dolt-hub.example", 3306, true, None, &home, &file).unwrap();
        assert_eq!(
            (c.user.as_str(), c.password.as_str()),
            ("root", "from-file")
        );
        let c = resolve(None, "dolt-hub.example", 3307, true, None, &home, &file).unwrap();
        assert_eq!(c.password, "");
    }

    #[test]
    fn the_credentials_file_path_follows_bd() {
        let seen = std::cell::RefCell::new(None);
        let read = |p: &std::path::Path| {
            *seen.borrow_mut() = Some(p.to_path_buf());
            None
        };
        resolve(
            None,
            "h",
            1,
            false,
            None,
            &env(&[("HOME", "/home/u")]),
            &read,
        )
        .unwrap();
        assert_eq!(
            seen.borrow().as_deref(),
            Some(std::path::Path::new("/home/u/.config/beads/credentials"))
        );
        resolve(
            None,
            "h",
            1,
            false,
            None,
            &env(&[("BEADS_CREDENTIALS_FILE", "/x/c")]),
            &read,
        )
        .unwrap();
        assert_eq!(seen.borrow().as_deref(), Some(std::path::Path::new("/x/c")));
    }

    #[test]
    fn debug_never_prints_the_password() {
        let c = Credentials {
            user: "u".into(),
            password: "s3cret".into(),
        };
        assert!(!format!("{c:?}").contains("s3cret"));
    }

    #[test]
    fn tls_follows_the_bd_variable() {
        assert!(tls_from_env(&env(&[("BEADS_DOLT_SERVER_TLS", "1")])));
        assert!(tls_from_env(&env(&[("BEADS_DOLT_SERVER_TLS", "true")])));
        assert!(!tls_from_env(&env(&[("BEADS_DOLT_SERVER_TLS", "0")])));
        assert!(!tls_from_env(&env(&[])));
    }
}
