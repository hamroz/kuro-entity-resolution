"""Append-only decision log.

Nothing is ever overwritten. A merge, a split, an undo or a human verdict
is a new event; the current state of every pair is a fold over the log.

Event shapes (plain dicts, JSON-serialisable):
  {"id", "seq", "at", "type": "run", "mode", "docs", "mentions", "pairs"}
  {"id", "seq", "at", "type": "decision", "pair", "a", "b", "actor": "system"|"user",
   "decision": "merge"|"separate"|"unsure", "rule", "confidence", "note"}
  {"id", "seq", "at", "type": "undo", "target", "actor": "user", "note"}
  {"id", "seq", "at", "type": "skip", "pair", "actor": "user"}

Human decisions are memory: a later resolver run never overrides them, and a
confirmed non-match (or an identifier conflict) is a cannot-link constraint
for clustering, so it also holds against transitive merges via other mentions.
The TypeScript mirror is src/lib/er/events.ts.
"""

from __future__ import annotations

from .resolve import cluster

DECISION_FOR_BUCKET = {"auto": "merge", "unsure": "unsure", "separate": "separate"}


def _next(events: list[dict], at: str) -> tuple[str, int, str]:
    seq = len(events) + 1
    return f"e{seq:05d}", seq, at


def fold(events: list[dict]) -> dict[str, dict]:
    """Current state per pair key.

    active: the latest decision event for the pair that has not been undone.
    user_undo: a user undid an automatic decision on this pair.
    """
    undone = {e["target"] for e in events if e["type"] == "undo"}
    state: dict[str, dict] = {}
    for e in events:
        if e["type"] != "decision":
            continue
        st = state.setdefault(e["pair"], {"active": None, "history": [], "user_undo": False})
        st["history"].append(e)
        if e["id"] in undone:
            if e["actor"] == "system":
                st["user_undo"] = True
        else:
            st["active"] = e
    return state


def status_of(st: dict | None) -> str:
    if not st or st["active"] is None:
        return "unsure"
    return st["active"]["decision"]


def reconcile(pairs: list[dict], events: list[dict], at: str, mode: str = "rules",
              docs: int = 0, mentions: int = 0) -> list[dict]:
    """Append system decisions for a new resolver run, respecting memory.

    Returns the new, longer event list (the input list is not modified).
    """
    out = list(events)
    eid, seq, _ = _next(out, at)
    out.append({"id": eid, "seq": seq, "at": at, "type": "run", "mode": mode,
                "docs": docs, "mentions": mentions, "pairs": len(pairs)})
    state = fold(out)
    for p in pairs:
        st = state.get(p["key"])
        decision = DECISION_FOR_BUCKET[p["bucket"]]
        if st is not None:
            active = st["active"]
            if active is not None and active["actor"] == "user":
                continue  # a human already decided: remembered
            if active is None and st["user_undo"]:
                continue  # a human undid the automatic call: stays with the human
            if active is not None and active["decision"] == decision and active["rule"] == p["rule"]:
                continue  # unchanged
        eid, seq, _ = _next(out, at)
        out.append({"id": eid, "seq": seq, "at": at, "type": "decision", "pair": p["key"],
                    "a": p["a"], "b": p["b"], "actor": "system", "decision": decision,
                    "rule": p["rule"], "confidence": p["confidence"], "note": None})
    return out


def decide(events: list[dict], pair: dict, decision: str, at: str, note: str | None = None) -> list[dict]:
    """A human verdict on a pair: merge, separate (split / confirmed non-match) or unsure."""
    out = list(events)
    eid, seq, _ = _next(out, at)
    rule = {"merge": "H-merge", "separate": "H-separate", "unsure": "H-unsure"}[decision]
    out.append({"id": eid, "seq": seq, "at": at, "type": "decision", "pair": pair["key"],
                "a": pair["a"], "b": pair["b"], "actor": "user", "decision": decision,
                "rule": rule, "confidence": pair.get("confidence", 0.0), "note": note})
    return out


def undo(events: list[dict], target_id: str, at: str, note: str | None = None) -> list[dict]:
    out = list(events)
    if not any(e["id"] == target_id and e["type"] == "decision" for e in out):
        raise ValueError(f"no decision event {target_id}")
    eid, seq, _ = _next(out, at)
    out.append({"id": eid, "seq": seq, "at": at, "type": "undo", "target": target_id,
                "actor": "user", "note": note})
    return out


def current_clusters(mention_ids: list[str], pairs: list[dict], events: list[dict]):
    """Clusters implied by the log. Returns (mention -> cluster root, blocked keys, statuses)."""
    state = fold(events)
    by_key = {p["key"]: p for p in pairs}
    merges = []
    cannot: set[str] = set()
    statuses: dict[str, str] = {}
    for key, p in by_key.items():
        st = state.get(key)
        s = status_of(st)
        statuses[key] = s
        human = bool(st and st["active"] and st["active"]["actor"] == "user")
        if s == "merge":
            merges.append({"a": p["a"], "b": p["b"], "key": key, "confidence": p["confidence"], "human": human})
        elif s == "separate" and (human or p["rule"] == "R0"):
            cannot.add(key)
    roots, blocked = cluster(mention_ids, merges, cannot)
    return roots, blocked, statuses


def review_queue(pairs: list[dict], roots: dict[str, str], statuses: dict[str, str],
                 events: list[dict]) -> list[dict]:
    """Open questions for a human, one per pair of clusters.

    An unsure pair only needs a human if its two mentions are still in
    different clusters and no cannot-link constraint already separates
    those clusters. The strongest unsure pair represents the cluster pair.
    """
    state = fold(events)
    skipped = {e["pair"] for e in events if e["type"] == "skip"}
    members: dict[str, set[str]] = {}
    for mid, r in roots.items():
        members.setdefault(r, set()).add(mid)
    cannot = []
    for p in pairs:
        st = state.get(p["key"])
        human = bool(st and st["active"] and st["active"]["actor"] == "user")
        if statuses.get(p["key"]) == "separate" and (human or p["rule"] == "R0"):
            cannot.append((p["a"], p["b"]))
    blocked_clusters = {tuple(sorted((roots[a], roots[b]))) for a, b in cannot}
    best: dict[tuple[str, str], dict] = {}
    for p in pairs:
        if statuses.get(p["key"]) != "unsure":
            continue
        ra, rb = roots[p["a"]], roots[p["b"]]
        if ra == rb:
            continue
        ck = tuple(sorted((ra, rb)))
        if ck in blocked_clusters:
            continue
        cur = best.get(ck)
        if cur is None or (p["confidence"], cur["key"]) > (cur["confidence"], p["key"]):
            best[ck] = p
    items = [{"clusters": list(ck), "pair": p, "skipped": p["key"] in skipped} for ck, p in best.items()]
    items.sort(key=lambda it: (it["skipped"], -it["pair"]["confidence"], it["pair"]["key"]))
    return items
