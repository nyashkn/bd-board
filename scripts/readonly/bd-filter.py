"""Keep only beads of one type carrying one label, plus their direct children.

Used by bd-readonly for list, count and export when BD_FILTER_LABEL is set.
  BD_FILTER_LABEL  label to keep (required; with it unset nothing is filtered by the shim)
  BD_FILTER_TYPE   issue type the label applies to (default: epic)

A matching bead's direct children pass too (except events), so each match is a swimlane
on the board and its steps are cards. Anything not under a match stays out.
This is a view filter, not access control.
Modes (first arg): list (JSON array in), export (JSON lines in), count (JSON array in, status groups out).
"""
import json
import os
import sys

LABEL = os.environ.get("BD_FILTER_LABEL", "")
TYPE = os.environ.get("BD_FILTER_TYPE") or "epic"


def is_match(x):
    return x.get("issue_type") == TYPE and LABEL in (x.get("labels") or [])


def parent_of(x):
    # `bd list` carries "parent"; `bd export` only has the parent-child dependency.
    if x.get("parent"):
        return x["parent"]
    for d in x.get("dependencies") or []:
        if d.get("type") == "parent-child":
            return d.get("depends_on_id")
    return None


def keep(items):
    if not LABEL:
        return items
    ids = {x["id"] for x in items if is_match(x)}
    return [x for x in items
            if is_match(x) or (parent_of(x) in ids and x.get("issue_type") != "event")]


def main(mode):
    raw = sys.stdin.read()
    if mode == "list":
        print(json.dumps(keep(json.loads(raw)), indent=2))
    elif mode == "export":
        rows = []
        for line in raw.splitlines():
            if not line.strip():
                continue
            x = json.loads(line)
            if x.get("_type", "issue") == "issue":
                rows.append((line, x))
        kept = {id(x) for x in keep([x for _, x in rows])}
        for line, x in rows:
            if id(x) in kept:
                print(line)
    elif mode == "count":
        items = keep(json.loads(raw))
        groups = {}
        for x in items:
            groups[x["status"]] = groups.get(x["status"], 0) + 1
        print(json.dumps({"groups": [{"count": c, "group": g} for g, c in sorted(groups.items())],
                          "schema_version": 1, "total": len(items)}, indent=2))
    else:
        sys.exit("bd-filter: unknown mode")


if __name__ == "__main__":
    main(sys.argv[1])
