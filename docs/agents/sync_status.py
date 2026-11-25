#!/usr/bin/env python3
"""Regenerates docs/agents/STATUS.md from the workflow journals, so every agent, task and its
state is stored in the repository and pushed, not only held in a session.

Usage: python3 docs/agents/sync_status.py <repo> <journals.json>
journals.json lists the workflows to report: [{"name": ..., "journal": path, "branch": ...}].
A journal is the workflow tool's journal.jsonl: "started" lines carry an agent's label, "result"
lines its return value. Journals live outside the repository and vanish with the session, which
is why this summary is written into the repository.
"""
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def git(repo, *args):
    r = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""


def first_line(text, limit=220):
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def summarise(result):
    """One line that says what an agent produced."""
    if isinstance(result, str):
        return first_line(result)
    if isinstance(result, dict):
        if isinstance(result.get("findings"), list):
            counts = {}
            for f in result["findings"]:
                s = f.get("severity", "?")
                counts[s] = counts.get(s, 0) + 1
            shown = ", ".join(f"{n} {s}" for s, n in sorted(counts.items())) or "no findings"
            return f"{shown}. {first_line(result.get('verdict', ''), 160)}"
        if "fixed" in result and "notFixed" in result:
            return f"fixed {len(result['fixed'])}, not fixed {len(result['notFixed'])}; commit {result.get('commit', '?')}"
        if "summary" in result:
            commit = result.get("commit")
            return (f"commit {commit}. " if commit and commit != "none" else "") + first_line(result["summary"])
        return first_line(json.dumps(result))
    return ""


def report(name, journal, branch, repo):
    lines = [f"## {name}", ""]
    if branch:
        head = git(repo, "log", "-1", "--format=%h %s", f"origin/{branch}") or git(repo, "log", "-1", "--format=%h %s", branch)
        lines.append(f"Branch `{branch}`, head: {head or 'unknown'}")
        lines.append("")
    path = Path(journal)
    if not path.exists():
        return lines + ["Journal not available in this session.", ""]
    labels, results, order = {}, {}, []
    for raw in path.read_text().splitlines():
        try:
            e = json.loads(raw)
        except json.JSONDecodeError:
            continue
        key = e.get("key")
        if e.get("type") == "started":
            labels[key] = e.get("label", "?")
            order.append(key)
        elif e.get("type") == "result":
            results[key] = e.get("result")
    # One row per agent label, in the order agents first started; the latest result wins, so a
    # step that was interrupted and rerun shows once, with its final outcome.
    rows = {}
    for key in order:
        label = labels[key]
        if key in results:
            rows[label] = ("done", summarise(results[key]))
        elif label not in rows or rows[label][0] != "done":
            rows[label] = ("running or interrupted", "")
    lines += ["| Agent | State | Outcome |", "|---|---|---|"]
    for label, (state, outcome) in rows.items():
        lines.append(f"| {label} | {state} | {outcome.replace('|', '/')} |")
    return lines + [""]


def main():
    repo, config = sys.argv[1], sys.argv[2]
    workflows = json.loads(Path(config).read_text())
    now = datetime.now(timezone.utc).strftime("%d %b %Y %H:%M UTC")
    out = [
        "# Live status of agents and tasks",
        "",
        f"_Generated {now} by `docs/agents/sync_status.py` from the workflow journals; pushed automatically. Who owns what: `docs/agents/BOARD.md`. The plan: `docs/PLAN.md`._",
        "",
    ]
    for w in workflows:
        out += report(w["name"], w["journal"], w.get("branch"), repo)
    target = Path(repo) / "docs" / "agents" / "STATUS.md"
    text = "\n".join(out) + "\n"
    old = target.read_text() if target.exists() else ""
    # Ignore the timestamp line when deciding whether anything changed.
    strip = lambda t: "\n".join(l for l in t.splitlines() if not l.startswith("_Generated"))
    if strip(old) != strip(text):
        target.write_text(text)
        print("changed")
    else:
        print("unchanged")


if __name__ == "__main__":
    main()
