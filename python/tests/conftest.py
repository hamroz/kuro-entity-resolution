import pytest

from resolver import extract_corpus, load_samples, resolve


@pytest.fixture(scope="session")
def docs():
    return load_samples()


@pytest.fixture(scope="session")
def mentions(docs):
    return extract_corpus(docs)


@pytest.fixture(scope="session")
def pairs(mentions):
    return resolve(mentions)


@pytest.fixture(scope="session")
def by_id(mentions):
    return {m["id"]: m for m in mentions}


def find(mentions, doc_id, surface, nth=0):
    hits = [m for m in mentions if m["doc_id"] == doc_id and m["surface"] == surface]
    assert len(hits) > nth, f"{surface!r} not found in {doc_id}"
    return hits[nth]


def pair_of(pairs, a, b):
    key = a["id"] + "|" + b["id"] if a["id"] < b["id"] else b["id"] + "|" + a["id"]
    for p in pairs:
        if p["key"] == key:
            return p
    return None
