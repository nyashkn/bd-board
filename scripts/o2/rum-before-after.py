#!/usr/bin/env python3
"""Re-runs the RUM before/after queries of docs/read-layer.md and prints the table as markdown.

  O2_URL=... O2_ORG=... O2_USER=... O2_PASS=... python3 scripts/o2/rum-before-after.py
  Optional: CUTOVER_UTC (default 2026-10-31T00:34:00Z, the new desktop build), SERVICE (default bd-board-desktop).

Window A is the 2 days before CUTOVER_UTC, window B runs from CUTOVER_UTC until now. Reads the
credentials from the environment only; prints nothing but the table. Cells with N < 20 say so.
"""
import base64, json, os, sys, time, urllib.request
from datetime import datetime, timedelta, timezone

MIN_N = 20
MS = 1_000_000  # the SDK reports ns
SERVICE = os.environ.get("SERVICE", "bd-board-desktop")
CUT = datetime.fromisoformat(os.environ.get("CUTOVER_UTC", "2026-10-31T00:34:00Z").replace("Z", "+00:00"))
us = lambda d: int(d.timestamp() * 1e6)
NOW = datetime.now(timezone.utc)
WINDOWS = {"A": (CUT - timedelta(days=2), CUT), "B": (CUT, NOW)}


def pc(q, col):
    return f"approx_percentile_cont({col} / {MS}, {q})"


BASE = f"""FROM "_rumdata" WHERE service = '{SERVICE}'"""
QUERIES = {
    "calls": f"""SELECT replace(vital_name, 'bd.call.', '') AS label, count(*) AS n, {pc(0.5, 'vital_duration')} AS p50, {pc(0.95, 'vital_duration')} AS p95
{BASE} AND type = 'vital' AND vital_name LIKE 'bd.call.%' GROUP BY label ORDER BY label""",
    "inp": f"""SELECT count(*) AS n, {pc(0.5, 'view_interaction_to_next_paint')} AS p50, {pc(0.95, 'view_interaction_to_next_paint')} AS p95
{BASE} AND type = 'view' AND view_name = 'bead-modal' AND view_interaction_to_next_paint IS NOT NULL""",
    "modal_views": f"""SELECT count(distinct view_id) AS n {BASE} AND view_name = 'bead-modal'""",
    "calls_in_modal": f"""SELECT replace(vital_name, 'bd.call.', '') AS label, count(*) AS n
{BASE} AND type = 'vital' AND vital_name LIKE 'bd.call.%' AND view_name = 'bead-modal' GROUP BY label ORDER BY label""",
    "calls_by_view": f"""SELECT context_view AS cv, count(*) AS n
{BASE} AND type = 'vital' AND vital_name LIKE 'bd.call.%' GROUP BY cv ORDER BY n DESC""",
    "long_tasks": f"""SELECT count(*) AS n {BASE} AND type = 'long_task'""",
    "errors": f"""SELECT count(*) AS n {BASE} AND type = 'error'""",
}


def search(sql, win):
    body = json.dumps({"query": {"sql": sql, "start_time": us(win[0]), "end_time": us(win[1]), "from": 0, "size": 1000}}).encode()
    auth = base64.b64encode(f"{os.environ['O2_USER']}:{os.environ['O2_PASS']}".encode()).decode()
    req = urllib.request.Request(f"{os.environ['O2_URL'].rstrip('/')}/api/{os.environ['O2_ORG']}/_search?type=logs",
                                 body, {"Content-Type": "application/json", "Authorization": "Basic " + auth})
    return json.load(urllib.request.urlopen(req, timeout=60)).get("hits", [])


def cell(n, p50=None, p95=None):
    n = int(n or 0)
    if n == 0:
        return "no data"
    s = f"{p50:.0f} / {p95:.0f} ms, N={n}" if p50 is not None and p95 is not None else f"N={n}"
    return s + (" (too few samples)" if n < MIN_N else "")


def main():
    for k in ("O2_URL", "O2_ORG", "O2_USER", "O2_PASS"):
        if not os.environ.get(k):
            sys.exit(f"missing env var {k}")
    r = {w: {k: search(q, win) for k, q in QUERIES.items()} for w, win in WINDOWS.items()}
    print(f"service={SERVICE}  A={WINDOWS['A'][0]:%Y-%m-%d %H:%M}..{WINDOWS['A'][1]:%Y-%m-%d %H:%M} UTC  B={CUT:%Y-%m-%d %H:%M}..{NOW:%Y-%m-%d %H:%M} UTC\n")
    print("| Metric | A (before) p50 / p95, N | B (after) p50 / p95, N |\n|---|---|---|")
    labels = sorted({h["label"] for w in r.values() for h in w["calls"]})
    for lab in labels:
        row = [next((cell(h["n"], h["p50"], h["p95"]) for h in r[w]["calls"] if h["label"] == lab), "no data") for w in "AB"]
        print(f"| bd.call.{lab} | {row[0]} | {row[1]} |")
    print("| INP, bead-modal view | " + " | ".join(cell(r[w]["inp"][0]["n"], r[w]["inp"][0].get("p50"), r[w]["inp"][0].get("p95")) for w in "AB") + " |")
    for w in "AB":
        v = int(r[w]["modal_views"][0]["n"])
        c = {h["label"]: int(h["n"]) for h in r[w]["calls_in_modal"]}
        r[w]["per_view"] = f"{v} modal views; bd.call inside them: " + (", ".join(f"{k} {n} ({n / v:.1f}/view)" for k, n in c.items()) if v else "none") + (" (too few samples)" if v < MIN_N else "")
    print(f"| bd.call per bead-modal view | {r['A']['per_view']} | {r['B']['per_view']} |")
    for k, name in (("long_tasks", "Long tasks"), ("errors", "Errors")):
        print(f"| {name} | " + " | ".join(cell(r[w][k][0]["n"]) if int(r[w][k][0]["n"]) else "0" for w in "AB") + " |")
    print("\nbd.call by `view` attribute (context_view):")
    for w in "AB":
        print(f"  {w}: " + (", ".join(f"{h.get('cv') or '(none)'}={h['n']}" for h in r[w]["calls_by_view"]) or "no data"))


if __name__ == "__main__":
    main()
