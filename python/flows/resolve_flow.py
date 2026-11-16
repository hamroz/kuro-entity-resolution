"""Example Prefect flow: how the resolver would slot into an ingestion pipeline.

    pip install "prefect>=3"
    python flows/resolve_flow.py            # runs on the bundled samples

Without Prefect installed the same code runs as plain Python (the decorators
fall back to no-ops), which is how the tests exercise it.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

try:  # pragma: no cover - exercised only when Prefect is installed
    from prefect import flow, task
except ImportError:  # pragma: no cover
    def task(fn=None, **_kw):
        return fn if fn is not None else (lambda f: f)

    def flow(fn=None, **_kw):
        return fn if fn is not None else (lambda f: f)

from resolver import current_clusters, extract_corpus, load_samples, reconcile, resolve


@task(retries=2)
def load_documents() -> list[dict]:
    # In production: list new objects in S3 / the DMS since the last run.
    return load_samples()


@task
def extract(docs: list[dict]) -> list[dict]:
    # Rule-based here; an LLM extractor would be a drop-in task returning the
    # same mention shape (surface, offsets, line, context), grounded in the text.
    return extract_corpus(docs)


@task
def score(mentions: list[dict]) -> list[dict]:
    return resolve(mentions)


@task
def append_decisions(pairs: list[dict], log_path: Path, docs: int, mentions: int) -> list[dict]:
    """Append-only: earlier human decisions in the log are never overridden."""
    events = json.loads(log_path.read_text()) if log_path.exists() else []
    now = datetime.now(timezone.utc).isoformat()
    events = reconcile(pairs, events, now, mode="rules", docs=docs, mentions=mentions)
    log_path.write_text(json.dumps(events, ensure_ascii=False, indent=1))
    return events


@flow(name="entity-resolution")
def entity_resolution(log_path: str = "decision-log.json") -> dict:
    docs = load_documents()
    mentions = extract(docs)
    pairs = score(mentions)
    events = append_decisions(pairs, Path(log_path), len(docs), len(mentions))
    roots, _blocked, statuses = current_clusters([m["id"] for m in mentions], pairs, events)
    summary = {
        "documents": len(docs),
        "mentions": len(mentions),
        "entities": len(set(roots.values())),
        "auto_merged": sum(1 for s in statuses.values() if s == "merge"),
        "needs_human": sum(1 for s in statuses.values() if s == "unsure"),
        "kept_separate": sum(1 for s in statuses.values() if s == "separate"),
    }
    print(json.dumps(summary, indent=2))
    return summary


if __name__ == "__main__":
    entity_resolution()
