//! Keeps the module dependencies pointing one way:
//! commands -> app -> ports <- adapters, and domain imports nothing outside domain.

use std::fs;
use std::path::{Path, PathBuf};

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(dir).unwrap().flatten() {
        let path = entry.path();
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

/// Every `crate::...` path mentioned in the layer's files, as "file: path" strings.
fn crate_paths(src: &Path, layer: &str) -> Vec<(String, String)> {
    let mut files = Vec::new();
    let dir = src.join(layer);
    if dir.is_dir() {
        rust_files(&dir, &mut files);
    } else {
        files.push(src.join(format!("{layer}.rs")));
    }
    let mut found = Vec::new();
    for file in files {
        let text = fs::read_to_string(&file).unwrap();
        let name = file.strip_prefix(src).unwrap().display().to_string();
        for line in text.lines() {
            if line.trim_start().starts_with("//") {
                continue;
            }
            let mut rest = line;
            while let Some(i) = rest.find("crate::") {
                let tail = &rest[i + "crate::".len()..];
                // `crate::{a, b::c}` names several modules at once.
                if let Some(group) = tail.strip_prefix('{') {
                    let end = group.find('}').unwrap_or(group.len());
                    for item in group[..end].split(',') {
                        let item = item.trim();
                        let module = item.split("::").next().unwrap_or(item);
                        found.push((name.clone(), module.to_string()));
                    }
                    rest = &group[end..];
                    continue;
                }
                let end = tail
                    .find(|c: char| !(c.is_alphanumeric() || c == '_'))
                    .unwrap_or(tail.len());
                found.push((name.clone(), tail[..end].to_string()));
                rest = &tail[end..];
            }
        }
    }
    found
}

fn src() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

fn assert_no_imports(layer: &str, forbidden: &[&str]) {
    let bad: Vec<_> = crate_paths(&src(), layer)
        .into_iter()
        .filter(|(_, module)| forbidden.contains(&module.as_str()))
        .collect();
    assert!(
        bad.is_empty(),
        "{layer} must not import {forbidden:?}: {bad:?}"
    );
}

#[test]
fn domain_imports_nothing_outside_domain() {
    let bad: Vec<_> = crate_paths(&src(), "domain")
        .into_iter()
        .filter(|(_, module)| module != "domain")
        .collect();
    assert!(
        bad.is_empty(),
        "domain may only import crate::domain: {bad:?}"
    );
}

#[test]
fn ports_depend_only_on_domain() {
    let bad: Vec<_> = crate_paths(&src(), "ports")
        .into_iter()
        .filter(|(_, module)| module != "domain")
        .collect();
    assert!(
        bad.is_empty(),
        "ports may only import crate::domain: {bad:?}"
    );
}

#[test]
fn adapters_do_not_reach_up_into_commands_or_app() {
    assert_no_imports("adapters", &["commands", "app", "desktop"]);
}

#[test]
fn app_does_not_import_commands() {
    assert_no_imports("app", &["commands", "desktop"]);
}
