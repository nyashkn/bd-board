//! Edges, children and readiness stamped onto a bead list.

use super::bd_json::{value_opt_str, value_str};
use super::bead::{Bead, BeadLink};
use serde_json::Value;
use std::collections::HashMap;

/// Stamps `waiting_on` / `ready` from `bd blocked` / `bd ready` rows; `None` stamps nothing.
pub(crate) fn apply_readiness(
    beads: &mut [Bead],
    blocked: Option<&[Value]>,
    ready: Option<&[Value]>,
) {
    let waiting: HashMap<String, Vec<String>> = blocked
        .unwrap_or_default()
        .iter()
        .filter_map(|row| {
            let by: Vec<String> = row
                .get("blocked_by")?
                .as_array()?
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect();
            Some((row.get("id")?.as_str()?.to_string(), by)).filter(|(_, by)| !by.is_empty())
        })
        .collect();
    let ready_ids: Option<std::collections::HashSet<&str>> = ready.map(|rows| {
        rows.iter()
            .filter_map(|r| r.get("id").and_then(Value::as_str))
            .collect()
    });
    for bead in beads {
        if blocked.is_some() {
            bead.waiting_on = waiting.get(&bead.id).cloned();
        }
        if let Some(ids) = &ready_ids {
            bead.ready = Some(ids.contains(bead.id.as_str()));
        }
    }
}

/// Port of `collectEdges` in src/lib/bd.ts: stamps `links` (and a parent from a parent-child edge) onto beads.
pub(crate) fn apply_links(beads: &mut [Bead], raw: &[Value]) {
    let known: std::collections::HashSet<String> = beads.iter().map(|b| b.id.clone()).collect();
    let mut seen = std::collections::HashSet::new();
    let mut links: HashMap<String, Vec<BeadLink>> = HashMap::new();
    let mut parents: HashMap<String, String> = HashMap::new();
    for value in raw {
        let owner = value_str(value, "id");
        let deps = value.get("dependencies").and_then(Value::as_array);
        for dep in deps.into_iter().flatten() {
            let Some(to) = value_opt_str(dep, "depends_on_id").filter(|s| !s.is_empty()) else {
                continue;
            };
            let from = value_opt_str(dep, "issue_id").unwrap_or_else(|| owner.clone());
            let kind = value_opt_str(dep, "type").unwrap_or_else(|| "blocks".to_string());
            if from.is_empty()
                || !known.contains(&from)
                || !known.contains(&to)
                || !seen.insert((from.clone(), to.clone(), kind.clone()))
            {
                continue;
            }
            let mut push = |id: &str, other: &str, direction: &str| {
                links.entry(id.to_string()).or_default().push(BeadLink {
                    id: other.to_string(),
                    link_type: kind.clone(),
                    direction: direction.to_string(),
                });
            };
            push(&from, &to, "outgoing");
            push(&to, &from, "incoming");
            if kind == "parent-child" {
                parents.insert(from, to);
            }
        }
    }
    for bead in beads.iter_mut() {
        bead.links = links.remove(&bead.id);
        if bead.parent.is_none() {
            bead.parent = parents.remove(&bead.id);
        }
    }
}

pub(crate) fn derive_children(beads: Vec<Bead>) -> Vec<Bead> {
    let mut child_map: std::collections::BTreeMap<String, Vec<String>> =
        std::collections::BTreeMap::new();
    for bead in &beads {
        if let Some(parent) = &bead.parent {
            child_map
                .entry(parent.clone())
                .or_default()
                .push(bead.id.clone());
        }
    }

    let bead_by_id: std::collections::HashMap<String, Bead> =
        beads.iter().cloned().map(|b| (b.id.clone(), b)).collect();

    beads
        .into_iter()
        .map(|mut bead| {
            if let Some(children) = child_map.get(&bead.id) {
                bead.children = Some(children.clone());
                bead.child_beads = Some(
                    children
                        .iter()
                        .filter_map(|id| bead_by_id.get(id).cloned())
                        .collect(),
                );
            }
            bead
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::bd_json::map_bead;
    use serde_json::json;

    #[test]
    fn list_serializes_child_beads_and_links() {
        let raw = vec![
            json!({"id":"proj-1","title":"Epic","status":"open","issue_type":"epic","dependent_count":2,"dependencies":[]}),
            json!({"id":"proj-2","title":"Child","status":"open","issue_type":"task","dependencies":[
                {"issue_id":"proj-2","depends_on_id":"proj-1","type":"parent-child"},
                {"issue_id":"proj-2","depends_on_id":"proj-3","type":"blocks"},
                {"issue_id":"proj-2","depends_on_id":"proj-3","type":"blocks"},
                {"issue_id":"proj-2","depends_on_id":"gone-9","type":"blocks"}]}),
            json!({"id":"proj-3","title":"Other","status":"open","issue_type":"task"}),
        ];
        let mut beads: Vec<Bead> = raw.iter().map(map_bead).collect();
        apply_links(&mut beads, &raw);
        let out = serde_json::to_value(derive_children(beads)).unwrap();
        let epic = &out[0];
        assert_eq!(epic["childBeads"][0]["id"], "proj-2");
        assert!(epic.get("child_beads").is_none());
        assert_eq!(epic["issue_type"], "epic");
        assert_eq!(
            epic["links"],
            json!([{"id":"proj-2","type":"parent-child","direction":"incoming"}])
        );
        assert_eq!(out[1]["parent"], "proj-1");
        assert_eq!(
            out[1]["links"],
            json!([
                {"id":"proj-1","type":"parent-child","direction":"outgoing"},
                {"id":"proj-3","type":"blocks","direction":"outgoing"}
            ])
        );
        assert_eq!(
            out[2]["links"],
            json!([{"id":"proj-2","type":"blocks","direction":"incoming"}])
        );
    }

    #[test]
    fn readiness_is_stamped_only_for_lists_bd_returned() {
        let mut beads = vec![
            map_bead(&json!({"id": "a", "status": "open"})),
            map_bead(&json!({"id": "b", "status": "open"})),
        ];
        let blocked = vec![json!({"id": "b", "blocked_by": ["a"]})];
        apply_readiness(&mut beads, Some(&blocked), None);
        assert_eq!(beads[0].waiting_on, None);
        assert_eq!(beads[1].waiting_on, Some(vec!["a".to_string()]));
        assert_eq!(beads[1].ready, None);
        let ready = vec![json!({"id": "a"})];
        apply_readiness(&mut beads, None, Some(&ready));
        assert_eq!((beads[0].ready, beads[1].ready), (Some(true), Some(false)));
    }
}
