r"""Generates bd-board-rum.json, an org-kn dashboard for bd-board's OpenObserve RUM data.

  python3 scripts/o2/gen_bd_board_rum_dashboard.py     # writes scripts/o2/bd-board-rum.json
  # create (folder `bd-board`: one folder per project; create it once in the UI or with `o2`)
  curl -u USER:PASS -X POST -H 'Content-Type: application/json' \
       "$O2/api/kn/dashboards?folder=bd-board" -d @scripts/o2/bd-board-rum.json
  # update: read the current top-level `hash`, then PUT with `dashboardId` in the body
  HASH=$(curl -s -u USER:PASS "$O2/api/kn/dashboards/<id>?folder=bd-board" | jq -r .hash)
  curl -u USER:PASS -X PUT -H 'Content-Type: application/json' \
       "$O2/api/kn/dashboards/<id>?folder=bd-board&hash=$HASH" -d @bd-board-rum.json

The owner posts it; nothing here calls an API. Every panel is custom SQL over `_rumdata`, so
each can be tried in the Logs search first. Same layout conventions as gen_mac_dashboard.py
(layouts written on 24 columns, doubled to O2's 48).

COLUMNS. Event payloads were captured from SDK 0.4.3 against a fake intake, so the nested keys
below are verified: type, service, version, view.name, view.largest_contentful_paint (ns),
view.interaction_to_next_paint (ns, in the SDK's event types), view.cumulative_layout_shift,
session.id, vital.name, vital.duration (NANOSECONDS), context.* (our extras), error.message.
NOT verified: how OpenObserve flattens them into column names. This file assumes `_` joins
(view.name -> view_name, as `columns_remote_address` in the mac dashboard suggests). Check once in
Logs > _rumdata > fields and fix the names in COLS below if they differ:
  TODO(verify) view_name, view_largest_contentful_paint, view_interaction_to_next_paint,
  TODO(verify) view_cumulative_layout_shift, session_id, vital_name, vital_duration,
  TODO(verify) context_ok, context_profile, context_rank, action_target_name, error_message.
Also TODO(verify): `env` (the SDK sends it inside the `o2tags` string; no top-level column seen).
Durations from the SDK are ns, so panels divide by 1e6 to show ms. `profile` (full / standard /
minimal) is added to every event's context by the app's beforeSend.
"""
import json
import pathlib

CONFIG = {
    "show_legends": True, "legends_position": None, "decimals": 0, "line_thickness": 1.5,
    "step_value": "0", "top_results_others": False, "axis_border_show": False,
    "label_option": {"rotate": 0}, "show_symbol": False, "line_interpolation": "smooth",
    "legend_width": {"unit": "px"}, "base_map": {"type": "osm"}, "map_type": {"type": "world"},
    "map_view": {"zoom": 1, "lat": 0, "lng": 0},
    "map_symbol_style": {"size": "by Value", "size_by_value": {"min": 1, "max": 100}, "size_fixed": 2},
    "drilldown": [], "mark_line": [], "override_config": [], "connect_nulls": False,
    "no_value_replacement": "", "wrap_table_cells": False, "table_transpose": False,
    "table_dynamic_columns": False,
}


def col(alias, label=None):
    return {"label": label or alias, "alias": alias, "column": alias, "color": None}


def panel(pid, ptype, title, sql, x, y, layout, stream="_rumdata", stream_type="logs", desc=""):
    return {
        "id": pid, "type": ptype, "title": title, "description": desc,
        "config": CONFIG,
        "queries": [{
            "query": sql, "customQuery": True,
            "fields": {"stream": stream, "stream_type": stream_type,
                       "x": [col(a) for a in x], "y": [col(a) for a in y], "z": [], "breakdown": [],
                       "filter": {"filterType": "group", "logicalOperator": "AND", "conditions": []}},
            "config": {"promql_legend": "", "layer_type": "scatter", "weight_fixed": 1, "limit": 0,
                       "min": 0, "max": 100, "time_shift": []},
        }],
        # OpenObserve's dashboard grid is 48 columns wide; layouts above are written on 24.
        "layout": {"x": layout[0] * 2, "y": layout[1], "w": layout[2] * 2, "h": layout[3], "i": int(pid.split("_")[1])},
        "htmlContent": "", "markdownContent": "", "customChartContent": "",
    }


def table(pid, title, sql, cols, layout, **kw):
    return panel(pid, "table", title, sql, cols, [], layout, **kw)


# Column names in one place so a flattening surprise is a one-line fix.
COLS = {
    "view_name": "view_name",
    "lcp": "view_largest_contentful_paint",
    "inp": "view_interaction_to_next_paint",
    "cls": "view_cumulative_layout_shift",
    "session": "session_id",
    "vital_name": "vital_name",
    "vital_dur": "vital_duration",
    "ctx_ok": "context_ok",
    "ctx_profile": "context_profile",
    "ctx_rank": "context_rank",
    "action_name": "action_target_name",
    "error_msg": "error_message",
}
C = COLS
R = 'FROM "_rumdata"'
MS = 1_000_000  # ns per ms


def vital_ms(names):
    """WHERE clause + ms expression for custom duration vitals."""
    inlist = ", ".join(f"'{n}'" for n in names)
    return f"{R} WHERE type = 'vital' AND {C['vital_name']} IN ({inlist})"


def p(q, expr):
    return f"approx_percentile_cont({expr}, {q})"



PANELS = [
    panel("Panel_1", "line", "LCP p75 by service (ms)",
          f"SELECT histogram(_timestamp) AS x, service, {p(0.75, C['lcp'] + ' / ' + str(MS))} AS lcp_ms "
          f"{R} WHERE type = 'view' AND {C['lcp']} IS NOT NULL GROUP BY x, service ORDER BY x",
          ["x"], ["lcp_ms"], (0, 0, 8, 8), stream="_rumdata",
          desc="Good < 2500 ms. Web has the server-function round trip; desktop uses IPC."),
    panel("Panel_2", "line", "INP p75 by service (ms)",
          f"SELECT histogram(_timestamp) AS x, service, {p(0.75, C['inp'] + ' / ' + str(MS))} AS inp_ms "
          f"{R} WHERE type = 'view' AND {C['inp']} IS NOT NULL GROUP BY x, service ORDER BY x",
          ["x"], ["inp_ms"], (8, 0, 8, 8), desc="Good < 200 ms."),
    panel("Panel_3", "line", "CLS p75 by service",
          f"SELECT histogram(_timestamp) AS x, service, {p(0.75, C['cls'])} AS cls "
          f"{R} WHERE type = 'view' AND {C['cls']} IS NOT NULL GROUP BY x, service ORDER BY x",
          ["x"], ["cls"], (16, 0, 8, 8), desc="Good < 0.1."),
    table("Panel_4", "Cold-load phases (ms)",
          f"SELECT {C['vital_name']} AS phase, service, count(*) AS n, "
          f"{p(0.5, C['vital_dur'] + ' / ' + str(MS))} AS p50_ms, {p(0.95, C['vital_dur'] + ' / ' + str(MS))} AS p95_ms "
          f"{vital_ms(['cold.skeleton', 'cold.projects', 'cold.beads'])} GROUP BY phase, service ORDER BY phase",
          ["phase", "service", "n", "p50_ms", "p95_ms"], (0, 8, 12, 8),
          desc="Time since navigation start: skeleton on screen, projects list, first beads rendered."),
    panel("Panel_5", "line", "Palette search per keystroke (ms)",
          f"SELECT histogram(_timestamp) AS x, {C['vital_name']} AS series, "
          f"avg({C['vital_dur']} / {MS}) AS ms {vital_ms(['palette.search.p50', 'palette.search.p95'])} "
          f"GROUP BY x, series ORDER BY x",
          ["x"], ["ms"], (12, 8, 12, 8),
          desc="p50 and p95 per typing burst, as reported by the app; averaged per bucket."),
    table("Panel_6", "Palette open and index build (ms)",
          f"SELECT {C['vital_name']} AS step, count(*) AS n, "
          f"{p(0.5, C['vital_dur'] + ' / ' + str(MS))} AS p50_ms, {p(0.95, C['vital_dur'] + ' / ' + str(MS))} AS p95_ms "
          f"{vital_ms(['palette.open', 'palette.index.build', 'palette.index.comments'])} GROUP BY step ORDER BY step",
          ["step", "n", "p50_ms", "p95_ms"], (0, 16, 12, 7)),
    panel("Panel_7", "bar", "bd call p95 by command (ms)",
          f"SELECT replace({C['vital_name']}, 'bd.call.', '') AS cmd, "
          f"{p(0.95, C['vital_dur'] + ' / ' + str(MS))} AS p95_ms "
          f"{R} WHERE type = 'vital' AND {C['vital_name']} LIKE 'bd.call.%' GROUP BY cmd ORDER BY p95_ms DESC",
          ["cmd"], ["p95_ms"], (12, 16, 12, 7), desc="Client-side round trip of every bd call (server function or IPC)."),
    panel("Panel_8", "line", "Errors per 100 views",
          f"SELECT histogram(_timestamp) AS x, service, "
          f"100.0 * sum(CASE WHEN type = 'error' THEN 1 ELSE 0 END) / "
          f"greatest(sum(CASE WHEN type = 'view' THEN 1 ELSE 0 END), 1) AS errors_per_100_views "
          f"{R} GROUP BY x, service ORDER BY x",
          ["x"], ["errors_per_100_views"], (0, 23, 12, 7)),
    table("Panel_9", "Sessions by profile and version",
          f"SELECT {C['ctx_profile']} AS profile, service, version, count(distinct {C['session']}) AS sessions "
          f"{R} WHERE type = 'view' GROUP BY profile, service, version ORDER BY sessions DESC",
          ["profile", "service", "version", "sessions"], (12, 23, 12, 7)),
    table("Panel_10", "Modal, route and feed (ms / count)",
          f"SELECT {C['vital_name']} AS step, count(*) AS n, "
          f"{p(0.5, C['vital_dur'] + ' / ' + str(MS))} AS p50_ms, {p(0.95, C['vital_dur'] + ' / ' + str(MS))} AS p95_ms "
          f"{vital_ms(['modal.ready', 'route.transition'])} GROUP BY step ORDER BY step",
          ["step", "n", "p50_ms", "p95_ms"], (0, 30, 12, 6)),
    table("Panel_11", "Palette result rank picked, scope and chip use",
          f"SELECT {C['action_name']} AS action, count(*) AS n, avg({C['ctx_rank']}) AS avg_rank "
          f"{R} WHERE type = 'action' AND ({C['action_name']} LIKE 'palette.%' OR {C['action_name']} = 'feed.reconnect') "
          f"GROUP BY action ORDER BY n DESC",
          ["action", "n", "avg_rank"], (12, 30, 12, 6),
          desc="palette.pick carries the row rank; palette.scope and palette.chip count usage; feed.reconnect counts live-feed drops."),
]

DASH = {
    "version": 5,
    "title": "bd-board RUM",
    "description": "Web vitals, cold-load phases, palette and bd-call timings, errors and sessions for "
                   "bd-board-web and bd-board-desktop. Source: _rumdata.",
    "role": "", "owner": "",
    "tabs": [{"tabId": "default", "name": "Default", "panels": PANELS}],
    "variables": {"list": [], "showDynamicFilters": False},
    "defaultDatetimeDuration": {"type": "relative", "relativeTimePeriod": "7d"},
}

if __name__ == "__main__":
    out = pathlib.Path(__file__).with_name("bd-board-rum.json")
    out.write_text(json.dumps(DASH, indent=1) + "\n")
    print(f"wrote {out} ({len(PANELS)} panels)")
