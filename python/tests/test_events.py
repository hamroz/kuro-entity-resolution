from conftest import find, pair_of

from resolver import current_clusters, decide, reconcile, undo
from resolver.events import fold, review_queue


def _state(mentions, pairs, events):
    return current_clusters([m["id"] for m in mentions], pairs, events)


def test_log_is_append_only(pairs):
    e1 = reconcile(pairs, [], "t0")
    e2 = reconcile(pairs, e1, "t1")
    assert e2[: len(e1)] == e1
    # nothing changed, so the second run only records the run itself
    assert len(e2) == len(e1) + 1 and e2[-1]["type"] == "run"


def test_undo_an_automatic_merge_splits_the_cluster(mentions, pairs):
    events = reconcile(pairs, [], "t0")
    a = find(mentions, "d03", "Müller Bau GmbH", 1)
    b = find(mentions, "d05", "MB Rohbau Berlin")
    roots, _, _ = _state(mentions, pairs, events)
    assert roots[a["id"]] == roots[b["id"]]
    key = pair_of(pairs, a, b)["key"]
    # MB Rohbau is linked by several identifier edges: split each of them
    for p in pairs:
        if p["rule"] == "R1" and b["id"] in (p["a"], p["b"]) or (p["key"] == key):
            target = [e for e in events if e["type"] == "decision" and e["pair"] == p["key"]][-1]
            events = undo(events, target["id"], "t1")
    st = fold(events)[key]
    assert st["active"] is None and st["user_undo"]
    # an undone automatic merge goes back to a human, and a re-run does not redo it
    events = reconcile(pairs, events, "t2")
    assert fold(events)[key]["active"] is None


def test_human_split_is_remembered_and_blocks_transitive_merges(mentions, pairs):
    events = reconcile(pairs, [], "t0")
    loose = find(mentions, "d02", "Müller Bau")
    berlin = find(mentions, "d03", "Müller Bau GmbH")
    p = pair_of(pairs, loose, berlin)
    events = decide(events, p, "separate", "t1", note="this is the Hamburg firm")
    # merge it with something that is in the Berlin cluster: the constraint must hold
    bridge = pair_of(pairs, loose, find(mentions, "d04", "Mueller-Bau"))
    events = decide(events, bridge, "merge", "t2")
    roots, blocked, _ = _state(mentions, pairs, events)
    assert roots[loose["id"]] != roots[berlin["id"]]
    # human edges are applied first, so the automatic edges that would close
    # the loop are the ones that get blocked, never the human decisions
    assert blocked and bridge["key"] not in blocked
    assert roots[loose["id"]] == roots[bridge["b"] if bridge["a"] == loose["id"] else bridge["a"]]
    # the next resolver run does not override the human decision
    events = reconcile(pairs, events, "t3")
    assert fold(events)[p["key"]]["active"]["actor"] == "user"


def test_review_queue_is_per_cluster_pair_and_shrinks(mentions, pairs):
    events = reconcile(pairs, [], "t0")
    roots, _, statuses = _state(mentions, pairs, events)
    queue = review_queue(pairs, roots, statuses, events)
    assert queue, "samples should contain open questions"
    keys = {tuple(it["clusters"]) for it in queue}
    assert len(keys) == len(queue)
    first = queue[0]["pair"]
    events = decide(events, first, "merge", "t1")
    roots, _, statuses = _state(mentions, pairs, events)
    assert roots[first["a"]] == roots[first["b"]]
    assert len(review_queue(pairs, roots, statuses, events)) < len(queue)


def test_undo_a_human_decision_restores_the_previous_one(mentions, pairs):
    events = reconcile(pairs, [], "t0")
    p = pair_of(pairs, find(mentions, "d02", "Müller Bau"), find(mentions, "d03", "Müller Bau GmbH"))
    events = decide(events, p, "merge", "t1")
    human = events[-1]
    events = undo(events, human["id"], "t2")
    assert fold(events)[p["key"]]["active"]["actor"] == "system"
