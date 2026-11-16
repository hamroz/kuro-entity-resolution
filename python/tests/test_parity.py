"""The web app runs a TypeScript port of this package. This test checks that
both implementations produce the same mentions, scores, buckets, clusters and
review queue on the bundled samples. Regenerate the fixture with `npm run fixture`."""

import json
from pathlib import Path

import pytest

from resolver import current_clusters, reconcile
from resolver.events import review_queue

FIXTURE = Path(__file__).parent / "fixtures" / "ts_output.json"


@pytest.fixture(scope="module")
def ts():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_same_mentions(ts, mentions):
    def strip(m):
        return {k: m[k] for k in ("id", "type", "surface", "start", "end", "line", "how", "ctx", "norm")}
    assert [strip(m) for m in mentions] == [strip(m) for m in ts["mentions"]]


def test_same_pairs_scores_and_buckets(ts, pairs):
    assert [p["key"] for p in pairs] == [p["key"] for p in ts["pairs"]]
    for py, js in zip(pairs, ts["pairs"]):
        assert py["bucket"] == js["bucket"], py["key"]
        assert py["rule"] == js["rule"], py["key"]
        assert py["confidence"] == pytest.approx(js["confidence"], abs=1e-4), py["key"]
        assert py["name_sim"] == pytest.approx(js["name_sim"], abs=1e-4), py["key"]
        assert [e["code"] for e in py["evidence"]] == [e["code"] for e in js["evidence"]], py["key"]


def test_same_clusters_and_queue(ts, mentions, pairs):
    events = reconcile(pairs, [], "t0")
    roots, _, statuses = current_clusters([m["id"] for m in mentions], pairs, events)
    groups = {}
    for mid, r in roots.items():
        groups.setdefault(r, []).append(mid)
    clusters = sorted(sorted(g) for g in groups.values())
    assert clusters == sorted(ts["clusters"])
    assert [it["pair"]["key"] for it in review_queue(pairs, roots, statuses, events)] == ts["queue"]
